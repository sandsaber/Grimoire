import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';

import {
  localShellPlatformForNode,
  windowsJobGuardianAssemblyPath,
  windowsJobGuardianPreamble,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';
import { NodeCodexExecutionProcess } from '@/providers/codex/execution/NodeCodexExecutionProcess';

describe('Codex persistent process ownership on the host OS', () => {
  // Generous because of the Windows guardian compile described below, not
  // because the assertions are slow: every wait inside has its own bound, so a
  // hang still fails with a specific message rather than a suite timeout.
  jest.setTimeout(45_000);

  it('writes the cached guardian assembly, and says why when it does not', () => {
    if (process.platform !== 'win32') {
      return;
    }
    // The script itself, in a real PowerShell, with its own errors read back.
    // The first Windows run of this cache reported only its consequence — the
    // guardian started and no file was written — because every step of the
    // branch is deliberately caught. `$Error` still holds what was caught, so
    // this asks for it rather than inferring the cause from a launch.
    //
    // **First in the file on purpose.** The cost this checkpoint is about is
    // the *first* compile on a machine, which pays for `csc.exe` starting and
    // for whatever scans a newly written DLL. A case that runs after two
    // launches have already compiled measures none of that. Three runs
    // separate it: cold, then warm from the file, then a recompile with the
    // compiler already warm.
    const cachePath = String(windowsJobGuardianAssemblyPath(process.env));
    rmSync(cachePath, { force: true });

    const cold = runGuardianPreamble(cachePath);
    const warm = runGuardianPreamble(cachePath);
    rmSync(cachePath, { force: true });
    const recompiled = runGuardianPreamble(cachePath);

    process.stdout.write(`guardian preamble: cold ${cold.elapsedMs}ms, warm ${warm.elapsedMs}ms, `
      + `recompiled ${recompiled.elapsedMs}ms\n${cold.output}`);
    expect(cold.output).toContain('TYPE: True');
    expect(cold.output).toContain('CACHE: True');
    expect(cold.output).toContain('COMPILED: True');
    // The second run loaded what the first compiled, which is the whole point:
    // the compile is what costs, and only one run may pay it.
    expect(warm.output).toContain('TYPE: True');
    expect(warm.output).toContain('COMPILED: False');
    expect(recompiled.output).toContain('COMPILED: True');
  }, 60_000);

  it('keeps JSONL stdin usable and terminates the complete descendant tree', async () => {
    const platform = localShellPlatformForNode(process.platform);
    const directory = mkdtempSync(join(tmpdir(), 'grimoire-codex-process-'));
    const pidPath = join(directory, 'descendant.pid');
    const processAdapter = new NodeCodexExecutionProcess({
      launchSpec: {
        command: process.execPath,
        args: ['-e', persistentServerSource(), pidPath],
        spawnCwd: directory,
        env: definedEnvironment(process.env),
      },
      platform,
      gracefulTerminationMs: 100,
      forcedTerminationMs: 2_000,
    });
    let descendantPid: number | undefined;
    try {
      processAdapter.start();
      // Windows pays a startup cost the other platforms do not: the job
      // guardian is C# that PowerShell compiles with `Add-Type` at every
      // launch, which on a cold runner takes seconds before the child is even
      // spawned. Budgeted rather than hidden, because it is real latency a
      // Codex daemon start will pay on Windows.
      descendantPid = await waitForPidFile(
        pidPath,
        platform === 'windows' ? 15_000 : 5_000,
        'direct',
      );
      expect(isProcessRunning(descendantPid)).toBe(true);

      const response = nextLine(processAdapter.stdout, 5_000);
      processAdapter.stdin.write(`${JSON.stringify({ id: 7, method: 'ping' })}\n`);
      await expect(response).resolves.toBe(JSON.stringify({ id: 7, result: 'pong' }));

      await expect(processAdapter.shutdown()).resolves.toBeUndefined();
      await expect(waitForPidTermination(descendantPid)).resolves.toBeUndefined();
    } finally {
      await processAdapter.shutdown().catch(() => undefined);
      if (descendantPid !== undefined && isProcessRunning(descendantPid)) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {
          // The independently tracked descendant already exited.
        }
      }
      await removeWhenReleased(directory);
    }
  });

  it('supports direct and shim app-server forms on Windows', async () => {
    if (process.platform !== 'win32') {
      return;
    }
    const directory = mkdtempSync(join(tmpdir(), 'grimoire-codex-windows-forms-'));
    const serverPath = join(directory, 'persistent app server.js');
    writeFileSync(
      serverPath,
      persistentServerSource().replace('process.argv[1]', 'process.argv[2]'),
      'utf8',
    );
    const cmdPath = join(directory, 'codex shim.cmd');
    const batPath = join(directory, 'codex shim.bat');
    const shim = ['@echo off', '"%~1" "%~2" "%~3"', ''].join('\r\n');
    writeFileSync(cmdPath, shim, 'utf8');
    writeFileSync(batPath, shim, 'utf8');
    const comPath = join(directory, 'codex shim.com');
    copyFileSync(resolveCommandInterpreter(), comPath);
    try {
      const forms = [
        {
          name: 'exe',
          command: process.execPath,
          args: (pidPath: string) => [serverPath, pidPath],
        },
        {
          name: 'cmd',
          command: cmdPath,
          args: (pidPath: string) => [process.execPath, serverPath, pidPath],
        },
        {
          name: 'bat',
          command: batPath,
          args: (pidPath: string) => [process.execPath, serverPath, pidPath],
        },
        {
          // A command interpreter reached under another name, which is what
          // `%ComSpec%` is: an absolute path, never the bare string `cmd.exe`.
          name: 'com',
          command: comPath,
          args: (pidPath: string) => [
            '/d',
            '/s',
            '/c',
            // The whole command carries its own enclosing quote pair, because
            // `/s` strips the first and last quote character of the tail.
            // Without it cmd removes one quote from each end of the real
            // command line and runs something that was never written.
            // `CodexAppServerProcess` wraps for the same reason.
            `""${process.execPath}" "${serverPath}" "${pidPath}""`,
          ],
        },
      ];
      for (const form of forms) {
        const pidPath = join(directory, `${form.name}.pid`);
        // Named, because the failure this case is most likely to report is
        // "the descendant did not publish its pid" and the four forms fail for
        // different reasons — a `.cmd` shim is not a `.com` copy of cmd.exe.
        // Naming the form is what turned one CI log into two distinct defects.
        await runPersistentForm({
          command: form.command,
          args: form.args(pidPath),
          spawnCwd: directory,
          env: definedEnvironment(process.env),
        }, pidPath, form.name);
      }

      const missing = new NodeCodexExecutionProcess({
        launchSpec: {
          command: join(directory, 'missing-codex.cmd'),
          args: ['app-server'],
          spawnCwd: directory,
          env: definedEnvironment(process.env),
        },
        platform: 'windows',
        gracefulTerminationMs: 100,
        forcedTerminationMs: 2_000,
      });
      const exit = new Promise<{ code: number | null; error?: Error }>(resolve => {
        missing.onExit((code, _signal, error) => resolve({ code, ...(error ? { error } : {}) }));
      });
      missing.start();
      const missingExit = await within(exit, 10_000);
      expect(missingExit.code).not.toBe(0);
      await missing.shutdown();
    } finally {
      await removeWhenReleased(directory);
    }
  }, 60_000);

  it('compiles the job guardian once and launches from the cached assembly', async () => {
    if (process.platform !== 'win32') {
      return;
    }
    // The measurement this case exists for: every launch used to run the
    // CodeDom compiler over the guardian's C# before the child was spawned at
    // all, two to three seconds of it, which is latency the product pays and
    // the reason this suite's 15s budget was tight enough to go red on a
    // stalled runner. Reported rather than asserted — a shared runner's clock
    // is exactly what this checkpoint refuses to build a gate on.
    const assembly = windowsJobGuardianAssemblyPath(process.env);
    expect(assembly).not.toBeNull();
    const cachePath = String(assembly);
    rmSync(cachePath, { force: true });
    const directory = mkdtempSync(join(tmpdir(), 'grimoire-guardian-cache-'));
    try {
      const cold = await measureLaunch(directory, 'cold');
      expect(existsSync(cachePath)).toBe(true);
      const compiledAt = statSync(cachePath).mtimeMs;

      const warm = await measureLaunch(directory, 'warm');

      process.stdout.write(`guardian launch: cold ${cold}ms, warm ${warm}ms\n`);
      // The second launch loaded what the first compiled: had it compiled
      // again, it would have moved a freshly built assembly into this path.
      expect(statSync(cachePath).mtimeMs).toBe(compiledAt);
    } finally {
      await removeWhenReleased(directory);
    }
  }, 90_000);

  it('starts the guardian anyway when the cached assembly is unusable, and repairs it', async () => {
    if (process.platform !== 'win32') {
      return;
    }
    // The floor. A cache is an optimization, and the one failure it may never
    // cause is a guardian that does not start — so the path is filled with
    // something that is not an assembly and the launch must still own its tree.
    const cachePath = String(windowsJobGuardianAssemblyPath(process.env));
    const directory = mkdtempSync(join(tmpdir(), 'grimoire-guardian-broken-'));
    const junk = 'this is not a .NET assembly';
    try {
      writeFileSync(cachePath, junk, 'utf8');

      await measureLaunch(directory, 'broken-cache');

      // And it repaired itself: a file that will not load is removed, so the
      // next launch compiles into the space rather than paying forever.
      expect(existsSync(cachePath)).toBe(true);
      expect(readFileSync(cachePath, 'utf8')).not.toBe(junk);
    } finally {
      rmSync(cachePath, { force: true });
      await removeWhenReleased(directory);
    }
  }, 90_000);
});

/** One guarded launch through the production path, and what it cost. */
async function measureLaunch(directory: string, label: string): Promise<number> {
  const pidPath = join(directory, `${label}.pid`);
  const startedAt = Date.now();
  await runPersistentForm({
    command: process.execPath,
    args: ['-e', persistentServerSource(), pidPath],
    spawnCwd: directory,
    env: definedEnvironment(process.env),
  }, pidPath, label);
  return Date.now() - startedAt;
}

/**
 * Runs the guardian preamble the way a launch does, and reports what it did.
 *
 * `COMPILED` is the fact a timing number can only suggest: whether this run
 * reached the compile at all, or found the type already in the assembly it
 * loaded from disk.
 */
function runGuardianPreamble(cachePath: string): { output: string; elapsedMs: number } {
  const script = [
    ...windowsJobGuardianPreamble(cachePath),
    '[Console]::Out.WriteLine("CACHE: " + [IO.File]::Exists($assembly))',
    '[Console]::Out.WriteLine("TYPE: " + '
      + '[bool](([Management.Automation.PSTypeName]\'GrimoireJobGuardian\').Type))',
    '[Console]::Out.WriteLine("COMPILED: " + $compiled)',
    '$Error | ForEach-Object { [Console]::Out.WriteLine("PS-ERROR: " + $_.Exception.Message) }',
  ].join('\r\n');
  const startedAt = Date.now();
  const output = execFileSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  return { output, elapsedMs: Date.now() - startedAt };
}

async function runPersistentForm(
  launchSpec: ConstructorParameters<typeof NodeCodexExecutionProcess>[0]['launchSpec'],
  pidPath: string,
  form: string,
): Promise<void> {
  const adapter = new NodeCodexExecutionProcess({
    launchSpec,
    platform: 'windows',
    gracefulTerminationMs: 100,
    forcedTerminationMs: 2_000,
  });
  let descendantPid: number | undefined;
  try {
    adapter.start();
    // Each launch form pays its own `Add-Type` compile of the guardian, and
    // this case runs four of them in sequence, so the budget is per form and
    // matches the one the first case uses.
    descendantPid = await waitForPidFile(pidPath, 15_000, form);
    expect(isProcessRunning(descendantPid)).toBe(true);
    const response = nextLine(adapter.stdout, 10_000);
    adapter.stdin.write(`${JSON.stringify({ id: 8, method: 'ping' })}\n`);
    await expect(response).resolves.toBe(JSON.stringify({ id: 8, result: 'pong' }));
    await adapter.shutdown();
    await waitForPidTermination(descendantPid);
  } finally {
    await adapter.shutdown().catch(() => undefined);
    if (descendantPid !== undefined && isProcessRunning(descendantPid)) {
      process.kill(descendantPid);
    }
  }
}

function persistentServerSource(): string {
  return [
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const readline = require("node:readline");',
    'const pidPath = process.argv[1];',
    'const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    'fs.writeFileSync(pidPath, String(worker.pid));',
    'const lines = readline.createInterface({ input: process.stdin });',
    'lines.on("line", line => {',
    '  const request = JSON.parse(line);',
    '  process.stdout.write(JSON.stringify({ id: request.id, result: "pong" }) + "\\n");',
    '});',
    'setInterval(() => {}, 1000);',
  ].join('\n');
}

function definedEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  );
}

function nextLine(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<string> {
  const lines = createInterface({ input: stream });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      lines.close();
      reject(new Error('Timed out waiting for the persistent process response.'));
    }, timeoutMs);
    lines.once('line', line => {
      clearTimeout(timeout);
      lines.close();
      resolve(line);
    });
  });
}

/**
 * Removes the working directory once Windows has released its handles.
 *
 * Confirmed termination and released handles are not the same instant on
 * Windows: the process object is gone while the directory it ran in is still
 * locked, and `rmSync` answers `EBUSY`. Bounded rather than swallowed — a
 * directory still held after two seconds is a leak, and this still fails on it.
 */
async function removeWhenReleased(directory: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await delay(50);
    }
  }
}

async function waitForPidFile(path: string, timeoutMs: number, form: string): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pid = Number.parseInt(readFileSync(path, 'utf8'), 10);
      if (Number.isSafeInteger(pid) && pid > 0) {
        return pid;
      }
    } catch {
      // The descendant has not published its ownership marker yet.
    }
    await delay(25);
  }
  throw new Error(
    `The persistent process descendant did not publish its pid `
    + `(form "${form}", waited ${timeoutMs}ms).`,
  );
}

async function waitForPidTermination(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await delay(25);
  }
  throw new Error(`The persistent process descendant pid ${pid} remained live.`);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as NodeJS.ErrnoException).code === 'ESRCH');
  }
}

function delay(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function resolveCommandInterpreter(): string {
  const configured = process.env.ComSpec?.trim();
  return configured || join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
}

function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out.')), timeoutMs);
    void promise.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
