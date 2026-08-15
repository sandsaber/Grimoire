import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';

import { NodeCodexExecutionProcess } from '@/app/execution/codex/NodeCodexExecutionProcess';
import { localShellPlatformForNode } from '@/app/execution/local/NodeLocalShellProcessAdapter';

describe('Codex persistent process ownership on the host OS', () => {
  // Generous because of the Windows guardian compile described below, not
  // because the assertions are slow: every wait inside has its own bound, so a
  // hang still fails with a specific message rather than a suite timeout.
  jest.setTimeout(45_000);

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
      descendantPid = await waitForPidFile(pidPath, platform === 'windows' ? 15_000 : 5_000);
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
      rmSync(directory, { recursive: true, force: true });
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
          name: 'com',
          command: comPath,
          args: (pidPath: string) => [
            '/d',
            '/s',
            '/c',
            `"${process.execPath}" "${serverPath}" "${pidPath}"`,
          ],
        },
      ];
      for (const form of forms) {
        const pidPath = join(directory, `${form.name}.pid`);
        await runPersistentForm({
          command: form.command,
          args: form.args(pidPath),
          spawnCwd: directory,
          env: definedEnvironment(process.env),
        }, pidPath);
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
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

async function runPersistentForm(
  launchSpec: ConstructorParameters<typeof NodeCodexExecutionProcess>[0]['launchSpec'],
  pidPath: string,
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
    descendantPid = await waitForPidFile(pidPath, 10_000);
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
  throw new Error('The persistent process descendant did not publish its pid.');
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
