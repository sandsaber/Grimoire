import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeAntigravityProcessTransport } from '@/app/execution/antigravity/NodeAntigravityProcessTransport';

/* eslint-disable jest/no-conditional-expect -- The host assertion branch is selected by CI OS. */
describe('NodeAntigravityProcessTransport on the host OS', () => {
  jest.setTimeout(20_000);

  it('preserves argument boundaries and complete-tree ownership on the host OS', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'grimoire-antigravity-transport-'));
    const expected = 'hello & "quoted world"';
    if (process.platform !== 'win32') {
      const child = new NodeAntigravityProcessTransport().launch(posixSpec(directory, expected));
      try {
        await child.started;
        const output = collectText(child.stdout);
        await expect(child.exited).resolves.toEqual({ code: 0 });
        await expect(output).resolves.toBe(expected);
        await expect(child.confirmTerminated()).resolves.toBe(true);
      } finally {
        await child.terminate('forced');
        rmSync(directory, { recursive: true, force: true });
      }
      return;
    }

    const fixture = createWindowsOwnershipFixture(directory);
    const child = new NodeAntigravityProcessTransport().launch(
      windowsSpec(directory, expected, fixture),
    );
    let descendantPid = 0;
    try {
      await child.started;
      const output = collectText(child.stdout);
      await waitFor(() => existsSync(fixture.pidPath));
      descendantPid = Number.parseInt(readFileSync(fixture.pidPath, 'utf8'), 10);
      expect(isProcessAlive(descendantPid)).toBe(true);
      writeFileSync(fixture.releasePath, 'release', 'utf8');
      await expect(child.exited).resolves.toEqual({ code: 0 });
      await expect(output).resolves.toBe(expected);
      await waitFor(() => !isProcessAlive(descendantPid));
      await expect(child.confirmTerminated()).resolves.toBe(true);
    } finally {
      await child.terminate('forced');
      if (isProcessAlive(descendantPid)) {
        process.kill(descendantPid);
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('executes direct and shim Windows forms and rejects a missing shim', async () => {
    if (process.platform !== 'win32') {
      return;
    }
    const directory = mkdtempSync(join(tmpdir(), 'grimoire-antigravity-forms-'));
    const transport = new NodeAntigravityProcessTransport();
    try {
      const directValue = 'direct & "quoted"';
      const direct = await runToExit(transport, windowsDirectSpec(directory, directValue));
      expect(direct).toEqual({ code: 0, output: directValue, terminated: true });

      const batchValue = 'batch & "quoted"';
      const batchPath = join(directory, 'agy shim.bat');
      writeFileSync(batchPath, ['@echo off', '<nul set /p "=%~1"', ''].join('\r\n'), 'utf8');
      const batch = await runToExit(transport, {
        command: batchPath,
        args: [batchValue],
        cwd: directory,
        environment: process.env,
        shell: true,
      });
      expect(batch).toEqual({ code: 0, output: batchValue, terminated: true });

      const comPath = join(directory, 'agy shim.com');
      copyFileSync(resolveCommandInterpreter(), comPath);
      const com = await runToExit(transport, {
        command: comPath,
        args: ['/d', '/s', '/c', '<nul set /p "=com-ok"'],
        cwd: directory,
        environment: process.env,
        shell: true,
      });
      expect(com).toEqual({ code: 0, output: 'com-ok', terminated: true });

      const missing = await runToExit(transport, {
        command: join(directory, 'missing-agy.cmd'),
        args: ['--print', 'must fail'],
        cwd: directory,
        environment: process.env,
        shell: true,
      });
      expect(missing.code).not.toBe(0);
      expect(missing.terminated).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
/* eslint-enable jest/no-conditional-expect */

function posixSpec(cwd: string, value: string) {
  return {
    command: '/bin/bash',
    args: ['-c', 'printf %s "$1"', 'grimoire-antigravity', value],
    cwd,
    environment: process.env,
    shell: false,
  };
}

interface WindowsOwnershipFixture {
  readonly batchPath: string;
  readonly pidPath: string;
  readonly releasePath: string;
  readonly workerPath: string;
}

function createWindowsOwnershipFixture(cwd: string): WindowsOwnershipFixture {
  const batchPath = join(cwd, 'agy argument shim.cmd');
  const workerPath = join(cwd, 'owned descendant.ps1');
  const pidPath = join(cwd, 'owned descendant.pid');
  const releasePath = join(cwd, 'release root.txt');
  writeFileSync(workerPath, [
    'param([string]$PidPath)',
    '[IO.File]::WriteAllText($PidPath, [string]$PID)',
    'Start-Sleep -Seconds 30',
    '',
  ].join('\r\n'), 'utf8');
  writeFileSync(batchPath, [
    '@echo off',
    'start "" /b powershell.exe -NoLogo -NoProfile -NonInteractive -File "%~2" "%~3"',
    ':wait_pid',
    'if not exist "%~3" (ping -n 2 127.0.0.1 >nul & goto wait_pid)',
    ':wait_release',
    'if not exist "%~4" (ping -n 2 127.0.0.1 >nul & goto wait_release)',
    '<nul set /p "=%~1"',
    '',
  ].join('\r\n'), 'utf8');
  return { batchPath, pidPath, releasePath, workerPath };
}

function windowsSpec(
  cwd: string,
  value: string,
  fixture: WindowsOwnershipFixture,
) {
  return {
    command: fixture.batchPath,
    args: [
      value,
      fixture.workerPath,
      fixture.pidPath,
      fixture.releasePath,
    ],
    cwd,
    environment: process.env,
    shell: true,
  };
}

function windowsDirectSpec(cwd: string, value: string) {
  const scriptPath = join(cwd, 'print direct argument.ps1');
  writeFileSync(scriptPath, [
    'param([string]$Value)',
    '[Console]::Out.Write($Value)',
    '',
  ].join('\r\n'), 'utf8');
  return {
    command: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      scriptPath,
      value,
    ],
    cwd,
    environment: process.env,
    shell: false,
  };
}

async function runToExit(
  transport: NodeAntigravityProcessTransport,
  spec: Parameters<NodeAntigravityProcessTransport['launch']>[0],
) {
  const child = transport.launch(spec);
  try {
    await child.started;
    const output = collectText(child.stdout);
    const exit = await child.exited;
    return {
      code: exit.code,
      output: await output,
      terminated: await child.confirmTerminated(),
    };
  } finally {
    await child.terminate('forced');
  }
}

function resolveCommandInterpreter(): string {
  const comSpec = process.env.ComSpec?.trim();
  if (comSpec) {
    return comSpec;
  }
  const systemRoot = process.env.SystemRoot?.trim() || 'C:\\Windows';
  return join(systemRoot, 'System32', 'cmd.exe');
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for Windows process ownership evidence.');
}

async function collectText(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
