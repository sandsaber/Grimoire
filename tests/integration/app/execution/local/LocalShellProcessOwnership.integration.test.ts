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
  jest.setTimeout(20_000);

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
      await within(child.started, 5_000);
      await expect(within(child.exited, 5_000)).resolves.toEqual({ code: 0 });
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
      `(echo "hello world" & echo nested)> "${outputPath}"`,
      `start "" /b powershell.exe -NoLogo -NoProfile -NonInteractive -File "${workerPath}"`,
      `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$deadline=(Get-Date).AddSeconds(5); while (-not (Test-Path -LiteralPath '${escapedPidPath}')) { if ((Get-Date) -gt $deadline) { exit 7 }; Start-Sleep -Milliseconds 25 }"`,
      'ping -n 3 127.0.0.1 >nul',
      'exit /b 0',
    ].join(' & ');
    const adapter = new NodeLocalShellProcessAdapter();
    const child = adapter.launch(windowsSpec(command));
    let descendantPid: number | undefined;
    try {
      await within(child.started, 10_000);
      descendantPid = await waitForPidFile(pidPath, 5_000);
      expect(isProcessRunning(descendantPid)).toBe(true);
      await expect(within(child.exited, 10_000)).resolves.toEqual({ code: 0 });
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

function delay(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}
