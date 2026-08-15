import {
  type ChildProcess,
  spawn,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';

import type {
  LocalShellExit,
  LocalShellLaunchSpec,
  LocalShellPlatform,
  LocalShellProcessLauncher,
  LocalShellProcessSupervisor,
  LocalShellTerminationTarget,
} from '@/core/execution/local/LocalShellBackend';

export interface SpawnedLocalProcess {
  readonly termination: LocalShellTerminationTarget;
  readonly stdin?: Writable;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly stdoutReadable?: Readable;
  readonly stderrReadable?: Readable;
  readonly started: Promise<void>;
  readonly exited: Promise<LocalShellExit>;
}

export interface LocalProcessSystem {
  spawn(spec: LocalShellLaunchSpec): SpawnedLocalProcess;
  processGroupExists(pid: number): boolean;
  signalProcessGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void;
  windowsJobTerminated(ownershipId: string): boolean;
  terminateWindowsJob(ownershipId: string, forced: boolean): Promise<boolean>;
}

export class NodeLocalShellProcessAdapter implements
LocalShellProcessLauncher,
LocalShellProcessSupervisor {
  constructor(private readonly system: LocalProcessSystem = new NodeLocalProcessSystem()) {}

  launch(spec: LocalShellLaunchSpec): SpawnedLocalProcess {
    const child = this.system.spawn(spec);
    try {
      requireTerminationTarget(child.termination);
    } catch (error) {
      void child.started.catch(() => undefined);
      throw error;
    }
    return child;
  }

  async confirmTerminated(target: LocalShellTerminationTarget): Promise<boolean> {
    requireTerminationTarget(target);
    return target.kind === 'windows-process-tree'
      ? this.system.windowsJobTerminated(target.ownershipId)
      : !this.system.processGroupExists(target.pid);
  }

  async terminate(
    target: LocalShellTerminationTarget,
    mode: 'graceful' | 'forced',
  ): Promise<'confirmed' | 'unconfirmed'> {
    requireTerminationTarget(target);
    if (target.kind === 'windows-process-tree') {
      return await this.system.terminateWindowsJob(
        target.ownershipId,
        mode === 'forced',
      ) ? 'confirmed' : 'unconfirmed';
    }
    if (!this.system.processGroupExists(target.pid)) {
      return 'confirmed';
    }
    try {
      this.system.signalProcessGroup(
        target.pid,
        mode === 'forced' ? 'SIGKILL' : 'SIGTERM',
      );
    } catch {
      return this.system.processGroupExists(target.pid) ? 'unconfirmed' : 'confirmed';
    }
    return this.system.processGroupExists(target.pid) ? 'unconfirmed' : 'confirmed';
  }
}

interface WindowsJobRecord {
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
  didExit: boolean;
}

export class NodeLocalProcessSystem implements LocalProcessSystem {
  private readonly windowsJobs = new Map<string, WindowsJobRecord>();
  private readonly completedWindowsJobs = new Set<string>();

  spawn(spec: LocalShellLaunchSpec): SpawnedLocalProcess {
    return spec.terminationKind === 'windows-process-tree'
      ? this.spawnWindowsJob(spec)
      : this.spawnPosixGroup(spec);
  }

  processGroupExists(pid: number): boolean {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return !isNoSuchProcess(error);
    }
  }

  signalProcessGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
    process.kill(-pid, signal);
  }

  windowsJobTerminated(ownershipId: string): boolean {
    const record = this.windowsJobs.get(ownershipId);
    if (!record) {
      return this.completedWindowsJobs.has(ownershipId);
    }
    if (!record.didExit) {
      return false;
    }
    this.rememberCompletedWindowsJob(ownershipId);
    this.windowsJobs.delete(ownershipId);
    return true;
  }

  async terminateWindowsJob(ownershipId: string, forced: boolean): Promise<boolean> {
    const record = this.windowsJobs.get(ownershipId);
    if (!record) {
      return this.completedWindowsJobs.has(ownershipId);
    }
    if (record.didExit) {
      return this.windowsJobTerminated(ownershipId);
    }
    if (!forced) {
      // Console applications have no general safe graceful signal on Windows.
      return false;
    }
    try {
      record.child.kill();
    } catch {
      return this.windowsJobTerminated(ownershipId);
    }
    const exited = await settleWithin(record.exited, 1_000);
    return exited && this.windowsJobTerminated(ownershipId);
  }

  private spawnPosixGroup(spec: LocalShellLaunchSpec): SpawnedLocalProcess {
    const child = spawn(spec.executable, [...spec.arguments], {
      cwd: spec.cwd,
      env: spec.environment ? { ...spec.environment } : undefined,
      detached: true,
      stdio: [spec.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const started = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const exited = observeExit(child);
    const stdout = requireReadablePipe(child.stdout, child);
    const stderr = requireReadablePipe(child.stderr, child);
    return {
      termination: { pid: child.pid ?? 0, kind: 'posix-process-group' },
      ...(child.stdin ? { stdin: child.stdin } : {}),
      stdout,
      stderr,
      stdoutReadable: stdout,
      stderrReadable: stderr,
      started,
      exited,
    };
  }

  private spawnWindowsJob(spec: LocalShellLaunchSpec): SpawnedLocalProcess {
    const ownershipId = `windows-job-${randomUUID()}`;
    const guardian = spawnWindowsGuardian(spec, ownershipId);
    const stderr = new PassThrough();
    const started = filterGuardianReadiness(guardian, stderr);
    let resolveExited!: () => void;
    const ownershipExited = new Promise<void>(resolve => { resolveExited = resolve; });
    const record: WindowsJobRecord = {
      child: guardian,
      exited: ownershipExited,
      didExit: false,
    };
    this.windowsJobs.set(ownershipId, record);
    const exited = new Promise<LocalShellExit>(resolve => {
      let settled = false;
      const finish = (exit: LocalShellExit) => {
        if (settled) {
          return;
        }
        settled = true;
        record.didExit = true;
        resolveExited();
        stderr.end();
        resolve(exit);
      };
      guardian.once('exit', code => finish({ code }));
      guardian.once('error', () => finish({ code: null }));
    });
    const stdout = requireReadablePipe(guardian.stdout, guardian);
    return {
      termination: {
        pid: guardian.pid ?? 0,
        kind: 'windows-process-tree',
        ownershipId,
      },
      ...(guardian.stdin ? { stdin: guardian.stdin } : {}),
      stdout,
      stderr,
      stdoutReadable: stdout,
      stderrReadable: stderr,
      started,
      exited,
    };
  }

  private rememberCompletedWindowsJob(ownershipId: string): void {
    this.completedWindowsJobs.add(ownershipId);
    while (this.completedWindowsJobs.size > 256) {
      const oldest = this.completedWindowsJobs.values().next().value;
      if (!oldest) {
        return;
      }
      this.completedWindowsJobs.delete(oldest);
    }
  }
}

export function localShellPlatformForNode(platform: NodeJS.Platform): LocalShellPlatform {
  if (platform === 'darwin' || platform === 'linux') {
    return 'posix';
  }
  if (platform === 'win32') {
    return 'windows';
  }
  throw new Error(`Local shell execution does not support Node platform "${platform}".`);
}

function spawnWindowsGuardian(
  spec: LocalShellLaunchSpec,
  ownershipId: string,
): ChildProcess {
  const suffix = ownershipId.replaceAll('-', '_');
  const executableVariable = `GRIMOIRE_JOB_EXECUTABLE_${suffix}`;
  const argumentsVariable = `GRIMOIRE_JOB_ARGUMENTS_${suffix}`;
  const childLaunch = createWindowsGuardianChildLaunch(spec, suffix);
  const command = [
    `$source=@'\r\n${WINDOWS_JOB_GUARDIAN_SOURCE}\r\n'@`,
    'Add-Type -TypeDefinition $source -Language CSharp',
    `$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${executableVariable}))`,
    `$arguments=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${argumentsVariable}))`,
    `[Environment]::SetEnvironmentVariable('${executableVariable}',$null,'Process')`,
    `[Environment]::SetEnvironmentVariable('${argumentsVariable}',$null,'Process')`,
    `$exitCode=[GrimoireJobGuardian]::Run($exe,$arguments,${spec.stdin === 'pipe' ? '$true' : '$false'})`,
    'exit $exitCode',
  ].join('\r\n');
  return spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(command, 'utf16le').toString('base64'),
  ], {
    cwd: spec.cwd,
    env: {
      ...(spec.environment ? { ...spec.environment } : process.env),
      ...childLaunch.environment,
      [executableVariable]: encodeBase64(childLaunch.executable),
      [argumentsVariable]: encodeBase64(childLaunch.arguments),
    },
    stdio: [spec.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

interface WindowsGuardianChildLaunch {
  readonly executable: string;
  readonly arguments: string;
  readonly environment: Readonly<Record<string, string>>;
}

function createWindowsGuardianChildLaunch(
  spec: LocalShellLaunchSpec,
  suffix: string,
): WindowsGuardianChildLaunch {
  if (spec.windowsInvocationMode !== 'argument-array') {
    return {
      executable: spec.executable,
      arguments: windowsProcessArguments(spec),
      environment: {},
    };
  }
  const targetVariable = `GRIMOIRE_JOB_TARGET_${suffix}`;
  const targetArgumentsVariable = `GRIMOIRE_JOB_TARGET_ARGUMENTS_${suffix}`;
  const invocation = [
    `$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${targetVariable}))`,
    `$targetArgumentsJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${targetArgumentsVariable}))`,
    '$targetArguments=@([string[]](ConvertFrom-Json $targetArgumentsJson))',
    `[Environment]::SetEnvironmentVariable('${targetVariable}',$null,'Process')`,
    `[Environment]::SetEnvironmentVariable('${targetArgumentsVariable}',$null,'Process')`,
    '$ErrorActionPreference="Stop"',
    'try {',
    '  $global:LASTEXITCODE=$null',
    '  & $target @targetArguments',
    '  if ($null -eq $LASTEXITCODE) { exit 126 }',
    '  exit $LASTEXITCODE',
    '} catch {',
    '  [Console]::Error.WriteLine("Windows argument-array target failed to launch.")',
    '  exit 127',
    '}',
  ].join('\r\n');
  return {
    executable: 'powershell.exe',
    arguments: windowsDirectProcessArguments([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(invocation, 'utf16le').toString('base64'),
    ]),
    environment: {
      [targetVariable]: encodeBase64(spec.executable),
      [targetArgumentsVariable]: encodeBase64(JSON.stringify(spec.arguments)),
    },
  };
}

function filterGuardianReadiness(
  guardian: ChildProcess,
  output: PassThrough,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    let ready = false;
    let settled = false;
    const finishError = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    guardian.stderr?.on('data', (chunk: unknown) => {
      if (!(chunk instanceof Uint8Array)) {
        return;
      }
      if (ready) {
        output.write(chunk);
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      const markerIndex = pending.indexOf(WINDOWS_JOB_READY_MARKER);
      if (markerIndex < 0) {
        if (pending.byteLength > 65_536) {
          finishError(new Error('Windows Job Object guardian readiness output exceeded its bound.'));
          guardian.kill();
        }
        return;
      }
      ready = true;
      settled = true;
      const remainder = pending.subarray(markerIndex + WINDOWS_JOB_READY_MARKER.length);
      if (remainder.byteLength > 0) {
        output.write(remainder);
      }
      pending = Buffer.alloc(0);
      resolve();
    });
    guardian.once('error', () => {
      finishError(new Error('Windows Job Object guardian failed to start.'));
    });
    guardian.once('exit', () => {
      if (!ready) {
        finishError(new Error('Windows Job Object guardian exited before acquiring ownership.'));
      }
    });
  });
}

function observeExit(child: ChildProcess): Promise<LocalShellExit> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (exit: LocalShellExit) => {
      if (!settled) {
        settled = true;
        resolve(exit);
      }
    };
    child.once('exit', code => finish({ code }));
    child.once('error', () => finish({ code: null }));
  });
}

function requireReadablePipe(stream: Readable | null, child: ChildProcess): Readable {
  if (stream) {
    return stream;
  }
  child.kill();
  throw new Error('Owned process launch did not create its required output pipe.');
}

function settleWithin(task: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const timeout = setNodeTimeout(() => resolve(false), timeoutMs);
    void task.then(() => {
      clearNodeTimeout(timeout);
      resolve(true);
    });
  });
}

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function windowsCommandArguments(spec: LocalShellLaunchSpec): string {
  const [disableAutoRun, stripQuotes, execute, command, ...extra] = spec.arguments;
  if (spec.executable.toLowerCase() !== 'cmd.exe'
    || spec.terminationKind !== 'windows-process-tree'
    || disableAutoRun !== '/d'
    || stripQuotes !== '/s'
    || execute !== '/c'
    || command === undefined
    || extra.length > 0) {
    throw new Error('Windows local shell launch must use cmd.exe /d /s /c with one raw command.');
  }
  return `/d /s /c ${command}`;
}

export function windowsDirectProcessArguments(argumentsValue: readonly string[]): string {
  return argumentsValue.map(quoteWindowsDirectArgument).join(' ');
}

function windowsProcessArguments(spec: LocalShellLaunchSpec): string {
  return spec.executable.toLowerCase() === 'cmd.exe'
    ? windowsCommandArguments(spec)
    : windowsDirectProcessArguments(spec.arguments);
}

function quoteWindowsDirectArgument(value: string): string {
  if (value.length > 0 && !/[\s"]/u.test(value)) {
    return value;
  }
  let quoted = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === '\\') {
      backslashes += 1;
    } else if (character === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      quoted += '\\'.repeat(backslashes) + character;
      backslashes = 0;
    }
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

function isNoSuchProcess(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ESRCH';
}

function requireTerminationTarget(target: LocalShellTerminationTarget): void {
  if (!Number.isSafeInteger(target.pid) || target.pid < 1) {
    throw new Error('Local shell child pid must be a positive safe integer.');
  }
  if (target.kind === 'windows-process-tree'
    && !/^windows-job-[0-9a-f-]{36}$/.test(target.ownershipId)) {
    throw new Error('Windows local shell ownership id is invalid.');
  }
}

const WINDOWS_JOB_READY_MARKER = Buffer.from('__GRIMOIRE_JOB_READY__\r\n', 'utf8');

const WINDOWS_JOB_GUARDIAN_SOURCE = String.raw`
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

public static class GrimoireJobGuardian
{
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    // Copies one pipe to another, flushing every chunk.
    //
    // This replaced Stream.CopyToAsync, which is correct only for a process
    // that exits: the destination FileStream buffers, and the flush that
    // delivers the last partial buffer happens at close. A persistent daemon
    // never closes, so a JSON-RPC line sat in the buffer and both directions
    // stalled - the request never reached the app-server, and its reply never
    // reached us. Threads rather than async so the source compiles under the
    // CodeDom compiler Add-Type uses.
    private static Thread StartPump(Stream source, Stream destination)
    {
        Thread pump = new Thread(delegate()
        {
            byte[] buffer = new byte[4096];
            try
            {
                int read;
                while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
                {
                    destination.Write(buffer, 0, read);
                    destination.Flush();
                }
            }
            catch (IOException) { }
            catch (ObjectDisposedException) { }
        });
        pump.IsBackground = true;
        pump.Start();
        return pump;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    public static int Run(string executable, string arguments, bool pipeInput)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error());

        try
        {
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr limitsPointer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limits, limitsPointer, false);
                if (!SetInformationJobObject(job, 9, limitsPointer, (uint)size))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            finally
            {
                Marshal.FreeHGlobal(limitsPointer);
            }

            if (!AssignProcessToJobObject(job, GetCurrentProcess()))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            var start = new ProcessStartInfo();
            start.FileName = executable;
            start.Arguments = arguments;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.RedirectStandardInput = pipeInput;

            using (Process process = Process.Start(start))
            {
                if (process == null)
                    throw new InvalidOperationException("The guarded process did not start.");
                Console.Error.WriteLine("__GRIMOIRE_JOB_READY__");
                Console.Error.Flush();
                Thread stdout = StartPump(process.StandardOutput.BaseStream, Console.OpenStandardOutput());
                Thread stderr = StartPump(process.StandardError.BaseStream, Console.OpenStandardError());
                if (pipeInput) StartPump(Console.OpenStandardInput(), process.StandardInput.BaseStream);
                process.WaitForExit();
                if (pipeInput) process.StandardInput.Close();
                stdout.Join(250);
                stderr.Join(250);
                Environment.Exit(process.ExitCode);
                return process.ExitCode;
            }
        }
        finally
        {
            CloseHandle(job);
        }
    }
}
`;
