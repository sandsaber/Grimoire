import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
// Bound through the module, not the global: jest.useRealTimers() does not put
// the lazily defined global setImmediate back on newer Node, so one suite that
// fakes timers would otherwise strand every later test in the file without it.
import { setImmediate } from 'node:timers';

import {
  probeAntigravityCliCapabilities,
  resetAntigravityCliCapabilitiesCache,
} from '@/providers/antigravity/runtime/AntigravityCliCapabilities';
import { buildAntigravityProcessLaunch } from '@/providers/antigravity/runtime/AntigravityProcessLaunch';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const mockedSpawn = spawn as jest.Mock;

function createMockChildProcess(): any {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  // Probe teardown destroys the pipes; tolerate writes that arrive after it.
  proc.stdout.on('error', () => {});
  proc.stderr.on('error', () => {});
  proc.stdin = null;
  // Mirrors ChildProcess.kill, which flips `killed`; the probe detects
  // aborted children through it because Windows closes carry no signal.
  proc.kill = jest.fn(() => {
    proc.killed = true;
  });
  proc.pid = 4321;
  return proc;
}

function emitHelpAndExit(proc: any, helpText: string): void {
  proc.stdout.write(helpText);
  proc.emit('close', 0, null);
}

// Fake timers also fake setImmediate, so async setup inside fake-timer tests
// must be flushed through microtasks instead.
async function flushAsyncQueue(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe('probeAntigravityCliCapabilities', () => {
  beforeEach(() => {
    resetAntigravityCliCapabilitiesCache();
    mockedSpawn.mockReset();
  });

  it('detects every capability in agy --help output', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);
    const runtimeEnv = { SHELL: '/bin/zsh' };

    const promise = probeAntigravityCliCapabilities('/usr/local/bin/agy', runtimeEnv);
    emitHelpAndExit(proc, [
      'Usage: agy [flags]',
      '  --add-dir <dir>          Add a workspace directory',
      '  --input-format <format>  Input format',
      '  --output-format <format> Output format',
      '  --print-timeout <dur>    Print timeout',
      '  --print',
    ].join('\n'));

    await expect(promise).resolves.toEqual({
      addDir: true,
      printTimeout: true,
      streamJson: true,
    });
    // The launch shape (POSIX login shell, Windows cmd.exe wrapper, or a
    // direct exec) is buildAntigravityProcessLaunch's decision, not this
    // probe's; asserting through it keeps the expectation correct on every
    // platform the suite runs on instead of hardcoding the POSIX shape.
    const launch = buildAntigravityProcessLaunch('/usr/local/bin/agy', ['--help'], runtimeEnv);
    expect(mockedSpawn).toHaveBeenCalledWith(
      launch.command,
      launch.args,
      expect.objectContaining({ shell: launch.shell }),
    );
  });

  it('reports mixed capabilities when help advertises only some flags', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const promise = probeAntigravityCliCapabilities('agy', {});
    emitHelpAndExit(proc, [
      'Usage: agy [flags]',
      '  --add-dir <dir>          Add a workspace directory',
      '  --print-timeout <dur>    Print timeout',
      '  --print',
    ].join('\n'));

    await expect(promise).resolves.toEqual({
      addDir: true,
      printTimeout: true,
      streamJson: false,
    });
  });

  it('requires both format flags for stream-json support', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const promise = probeAntigravityCliCapabilities('agy', {});
    emitHelpAndExit(proc, [
      'Usage: agy [flags]',
      '  --input-format <format>  Input format',
      '  --print',
    ].join('\n'));

    const capabilities = await promise;
    expect(capabilities.streamJson).toBe(false);
  });

  it('reports no support when help output lacks the flags', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const promise = probeAntigravityCliCapabilities('agy', {});
    emitHelpAndExit(proc, 'Usage: agy [flags]\n  --print');

    await expect(promise).resolves.toEqual({
      addDir: false,
      printTimeout: false,
      streamJson: false,
    });
  });

  it('fail-closes when the probe child cannot be spawned', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const promise = probeAntigravityCliCapabilities('agy', {});
    proc.emit('error', new Error('ENOENT'));

    await expect(promise).resolves.toEqual({
      addDir: false,
      printTimeout: false,
      streamJson: false,
    });
  });

  it('fail-closes when spawn throws', async () => {
    mockedSpawn.mockImplementation(() => {
      throw new Error('spawn refused');
    });

    await expect(probeAntigravityCliCapabilities('agy', {})).resolves.toEqual({
      addDir: false,
      printTimeout: false,
      streamJson: false,
    });
  });

  it('scans stderr because some CLIs print help there', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const promise = probeAntigravityCliCapabilities('agy', {});
    proc.stderr.write('  --add-dir <dir>   Additional workspace\n');
    proc.emit('close', 1, null);

    const capabilities = await promise;
    expect(capabilities.addDir).toBe(true);
  });

  it('caches the probe result per CLI command', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const first = probeAntigravityCliCapabilities('/usr/local/bin/agy', {});
    emitHelpAndExit(proc, '  --add-dir <dir>');
    await expect(first).resolves.toEqual(expect.objectContaining({ addDir: true }));

    await expect(probeAntigravityCliCapabilities('/usr/local/bin/agy', {}))
      .resolves.toEqual(expect.objectContaining({ addDir: true }));
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('also caches negative results so failed probes do not respawn every turn', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const first = probeAntigravityCliCapabilities('agy', {});
    emitHelpAndExit(proc, '  --print');
    await expect(first).resolves.toEqual(expect.objectContaining({ addDir: false }));

    await expect(probeAntigravityCliCapabilities('agy', {}))
      .resolves.toEqual(expect.objectContaining({ addDir: false }));
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('releases the help child early once every probed flag is advertised', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const promise = probeAntigravityCliCapabilities('agy', {});
    proc.stdout.write([
      '  --add-dir <dir>',
      '  --input-format <format>',
      '  --output-format <format>',
      '  --print-timeout <dur>',
    ].join('\n'));
    await new Promise((resolve) => setImmediate(resolve));

    await expect(promise).resolves.toEqual({
      addDir: true,
      printTimeout: true,
      streamJson: true,
    });
    expect(proc.kill).toHaveBeenCalledTimes(1);
  });

  it('fail-closes when agy --help never finishes and retries instead of caching', async () => {
    jest.useFakeTimers();
    try {
      const proc = createMockChildProcess();
      mockedSpawn.mockReturnValue(proc);

      const promise = probeAntigravityCliCapabilities('agy', {});
      jest.advanceTimersByTime(10_000);

      await expect(promise).resolves.toEqual({
        addDir: false,
        printTimeout: false,
        streamJson: false,
      });
      expect(proc.kill).toHaveBeenCalledTimes(1);

      // The timed-out probe is inconclusive, so the next turn probes again
      // instead of reusing the fail-closed result.
      const retryProc = createMockChildProcess();
      mockedSpawn.mockReturnValue(retryProc);
      const retry = probeAntigravityCliCapabilities('agy', {});
      await flushAsyncQueue();
      retryProc.stdout.write('  --add-dir <dir>  --input-format <f>  --output-format <f>  --print-timeout <d>');
      retryProc.emit('close', 0, null);

      await expect(retry).resolves.toEqual({
        addDir: true,
        printTimeout: true,
        streamJson: true,
      });
      expect(mockedSpawn).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not cache a probe killed mid-flight so cancellation cannot pin legacy flags', async () => {
    const cancelledProc = createMockChildProcess();
    mockedSpawn.mockReturnValue(cancelledProc);

    const first = probeAntigravityCliCapabilities('agy', {});
    await new Promise((resolve) => setImmediate(resolve));
    cancelledProc.stdout.write('  --add-dir <dir>');
    (cancelledProc.kill as jest.Mock)('SIGTERM');
    cancelledProc.emit('close', null, 'SIGTERM');
    await expect(first).resolves.toEqual(expect.objectContaining({ addDir: false }));

    const retryProc = createMockChildProcess();
    mockedSpawn.mockReturnValue(retryProc);
    const second = probeAntigravityCliCapabilities('agy', {});
    await new Promise((resolve) => setImmediate(resolve));
    retryProc.stdout.write('  --add-dir <dir>');
    retryProc.emit('close', 0, null);
    await expect(second).resolves.toEqual(expect.objectContaining({ addDir: true }));
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });

  it('does not cache a probe that failed to spawn', async () => {
    const failedProc = createMockChildProcess();
    mockedSpawn.mockReturnValue(failedProc);

    const first = probeAntigravityCliCapabilities('agy', {});
    failedProc.emit('error', new Error('ENOENT'));
    await expect(first).resolves.toEqual(expect.objectContaining({ addDir: false }));

    const retryProc = createMockChildProcess();
    mockedSpawn.mockReturnValue(retryProc);
    const second = probeAntigravityCliCapabilities('agy', {});
    await new Promise((resolve) => setImmediate(resolve));
    retryProc.stdout.write('  --add-dir <dir>');
    retryProc.emit('close', 0, null);
    await expect(second).resolves.toEqual(expect.objectContaining({ addDir: true }));
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });

  it('does not cache a probe killed on Windows where close carries no signal', async () => {
    const cancelledProc = createMockChildProcess();
    mockedSpawn.mockReturnValue(cancelledProc);

    const first = probeAntigravityCliCapabilities('agy', {});
    await new Promise((resolve) => setImmediate(resolve));
    // cancel() kills the probe; on Windows TerminateProcess surfaces as
    // close(1, null) with no signal argument.
    (cancelledProc.kill as jest.Mock)();
    cancelledProc.emit('close', 1, null);
    await expect(first).resolves.toEqual(expect.objectContaining({ addDir: false }));

    const retryProc = createMockChildProcess();
    mockedSpawn.mockReturnValue(retryProc);
    const second = probeAntigravityCliCapabilities('agy', {});
    await new Promise((resolve) => setImmediate(resolve));
    retryProc.stdout.write('  --add-dir <dir>');
    retryProc.emit('close', 0, null);
    await expect(second).resolves.toEqual(expect.objectContaining({ addDir: true }));
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });

  it('does not match sibling flags that merely contain the substring', async () => {
    const directoryProc = createMockChildProcess();
    mockedSpawn.mockReturnValue(directoryProc);
    const directoryPromise = probeAntigravityCliCapabilities('agy', {});
    emitHelpAndExit(directoryProc, [
      '  --add-directory <dir>   Add many directories',
      '  --input-format-json     JSON input',
      '  --print-timeout-max <dur>',
      '  --print',
    ].join('\n'));
    await expect(directoryPromise).resolves.toEqual({
      addDir: false,
      printTimeout: false,
      streamJson: false,
    });

    resetAntigravityCliCapabilitiesCache();
    const negationProc = createMockChildProcess();
    mockedSpawn.mockReturnValue(negationProc);
    const negationPromise = probeAntigravityCliCapabilities('agy', {});
    emitHelpAndExit(negationProc, '  --no-add-dir            Disable extra directories\n  --print');
    await expect(negationPromise).resolves.toEqual(expect.objectContaining({ addDir: false }));
  });

  it('fail-closes past the output cap even when --add-dir arrives later', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);

    const promise = probeAntigravityCliCapabilities('agy', {});
    const filler = `${'x'.repeat(1024)}\n`;
    for (let i = 0; i < 80; i += 1) {
      proc.stdout.write(filler);
    }
    proc.stdout.write('  --add-dir <dir>');
    proc.emit('close', 0, null);

    await expect(promise).resolves.toEqual(expect.objectContaining({ addDir: false }));
  });

  it('reports the spawned probe child so callers can cancel it', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);
    const onSpawn = jest.fn();

    const promise = probeAntigravityCliCapabilities('agy', {}, onSpawn);
    expect(onSpawn).toHaveBeenCalledWith(proc);
    emitHelpAndExit(proc, '  --add-dir <dir>');

    await expect(promise).resolves.toEqual(expect.objectContaining({ addDir: true }));
  });

  it('probes different CLI commands separately', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);
    const first = probeAntigravityCliCapabilities('agy', {});
    emitHelpAndExit(proc, '  --add-dir <dir>');
    await expect(first).resolves.toEqual(expect.objectContaining({ addDir: true }));

    const other = createMockChildProcess();
    mockedSpawn.mockReturnValue(other);
    const second = probeAntigravityCliCapabilities('/opt/other/agy', {});
    emitHelpAndExit(other, '  --print');
    await expect(second).resolves.toEqual(expect.objectContaining({ addDir: false }));
  });

  it('shares a single in-flight probe between concurrent callers', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);
    const first = probeAntigravityCliCapabilities('agy', {});
    const second = probeAntigravityCliCapabilities('agy', {});
    emitHelpAndExit(proc, '  --add-dir <dir>');

    await expect(first).resolves.toEqual(expect.objectContaining({ addDir: true }));
    await expect(second).resolves.toEqual(expect.objectContaining({ addDir: true }));
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });
});
