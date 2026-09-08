import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

import {
  localShellPlatformForNode,
  NodeLocalShellProcessAdapter,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type {
  LocalShellChildProcess,
  LocalShellLaunchSpec,
} from '@/core/execution/local/LocalShellBackend';

describe('local shell process ownership on the host OS', () => {
  // The Windows row's start is a cold C# compile every time it runs in CI: the
  // POSIX row returns immediately there, the step runs `--runInBand`, and the
  // guardian assembly is cached per machine — so the one launch in the job
  // always pays `Add-Type`, which this repository measured at two to three
  // seconds before the cache existed. Green runs of that row have taken 8.6s,
  // 8.6s, 8.9s, 9.6s and 12.2s end to end; the one that failed reached the old
  // 10s start budget at 10034ms. The row asserts ownership, not latency, so
  // the budget is a hang detector and belongs far from where a loaded runner
  // lands.
  jest.setTimeout(120_000);

  it('owns and terminates a POSIX descendant after the root shell exits', async () => {
    if (localShellPlatformForNode(process.platform) !== 'posix') {
      return;
    }
    const adapter = new NodeLocalShellProcessAdapter();
    const child = adapter.launch({
      executable: '/bin/bash',
      arguments: ['-lc', 'sleep 30 & echo descendant-ready'],
      terminationKind: 'posix-process-group',
    });
    try {
      await within(child.started, 5_000, 'the POSIX shell to start');
      await expect(within(child.exited, 5_000, 'the POSIX shell to exit'))
        .resolves.toEqual({ code: 0 });
      await expect(adapter.confirmTerminated(child.termination)).resolves.toBe(false);

      await adapter.terminate(child.termination, 'forced');
      await expect(waitForTermination(adapter, child)).resolves.toBeUndefined();
    } finally {
      await adapter.terminate(child.termination, 'forced');
    }
  });

  it('uses a Job Object guardian to kill Windows descendants when the root exits', async () => {
    if (localShellPlatformForNode(process.platform) !== 'windows') {
      return;
    }
    const directory = mkdtempSync(join(tmpdir(), 'grimoire-windows-job-'));
    const outputPath = join(directory, 'quoted output.txt');
    const pidPath = join(directory, 'descendant pid.txt');
    const workerPath = join(directory, 'descendant worker.ps1');
    const escapedPidPath = pidPath.replaceAll("'", "''");
    writeFileSync(workerPath, [
      `Set-Content -LiteralPath '${escapedPidPath}' -Value $PID -NoNewline -Encoding ascii`,
      'Start-Sleep -Seconds 30',
      '',
    ].join('\r\n'), 'utf8');
    const command = [
      // No space before `&`: cmd includes it in the echoed line, so
      // `echo "hello world" &` writes a trailing space the assertion below
      // would have to tolerate. Removing the cause keeps the assertion exact.
      `(echo "hello world"& echo nested)> "${outputPath}"`,
      `start "" /b powershell.exe -NoLogo -NoProfile -NonInteractive -File "${workerPath}"`,
      `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$deadline=(Get-Date).AddSeconds(5); while (-not (Test-Path -LiteralPath '${escapedPidPath}')) { if ((Get-Date) -gt $deadline) { exit 7 }; Start-Sleep -Milliseconds 25 }"`,
      'ping -n 3 127.0.0.1 >nul',
      'exit /b 0',
    ].join(' & ');
    const adapter = new NodeLocalShellProcessAdapter();
    const child = adapter.launch(windowsSpec(command));
    let descendantPid: number | undefined;
    try {
      await within(child.started, 60_000, 'the Windows job guardian to start');
      // The pid comes from a second cold `powershell.exe`, started by the
      // shell under test. Its sibling in CodexPersistentProcessOwnership
      // budgets that same wait at 15s on Windows and says why; this one was
      // left at the POSIX figure.
      descendantPid = await waitForPidFile(pidPath, 15_000);
      expect(isProcessRunning(descendantPid)).toBe(true);
      await expect(within(child.exited, 10_000, 'the Windows job root to exit'))
        .resolves.toEqual({ code: 0 });
      expect(readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n'))
        .toBe('"hello world"\nnested\n');
      await expect(waitForPidTermination(descendantPid)).resolves.toBeUndefined();
      await expect(adapter.confirmTerminated(child.termination)).resolves.toBe(true);
    } finally {
      await adapter.terminate(child.termination, 'forced');
      if (descendantPid !== undefined && isProcessRunning(descendantPid)) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {
          // The independently tracked descendant already exited.
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function windowsSpec(command: string): LocalShellLaunchSpec {
  return {
    executable: 'cmd.exe',
    arguments: ['/d', '/s', '/c', command],
    terminationKind: 'windows-process-tree',
  };
}

async function waitForTermination(
  adapter: NodeLocalShellProcessAdapter,
  child: LocalShellChildProcess,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await adapter.confirmTerminated(child.termination)) {
      return;
    }
    await delay(25);
  }
  throw new Error('The local shell termination target remained live.');
}

async function waitForPidFile(path: string, timeoutMs: number): Promise<number> {
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
  throw new Error('The Windows descendant did not publish its pid.');
}

async function waitForPidTermination(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await delay(25);
  }
  throw new Error(`The Windows descendant pid ${pid} remained live.`);
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

function within<T>(promise: Promise<T>, timeoutMs: number, waitingFor: string): Promise<T> {
  return new Promise((resolve, reject) => {
    // Named, because the phase is the whole diagnosis: three waits in this
    // file share one helper, and a bare "Timed out." left the last Windows
    // failure to be attributed by arithmetic on the suite's own duration.
    const timeout = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${waitingFor}.`)),
      timeoutMs,
    );
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

function delay(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}
