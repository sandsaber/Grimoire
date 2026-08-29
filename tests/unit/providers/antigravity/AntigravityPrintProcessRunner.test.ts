import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { AntigravityInvocation } from '@/providers/antigravity/execution/AntigravityExecutionBackend';
import { AntigravityExecutionBackend } from '@/providers/antigravity/execution/AntigravityExecutionBackend';
import {
  type AntigravityManagedChildProcess,
  AntigravityPrintProcessRunner,
  type AntigravityProcessTransportSpec,
} from '@/providers/antigravity/runtime/AntigravityPrintProcessRunner';

describe('AntigravityPrintProcessRunner', () => {
  it('builds the provider print protocol without shell-interpreting the prompt', async () => {
    const child = new FakeManagedChild();
    const transport = new FakeTransport(child);
    const removeLog = jest.fn().mockResolvedValue(undefined);
    const runner = new AntigravityPrintProcessRunner({
      transport,
      createLogPath: () => '/tmp/antigravity.log',
      removeLog,
    });

    const handle = runner.start(INVOCATION);
    child.exit.resolve({ code: 0 });
    await handle.completed;

    expect(transport.specs).toHaveLength(1);
    expect(transport.specs[0]).toMatchObject({
      cwd: '/vault',
      environment: { PATH: '/usr/local/bin' },
      shell: false,
    });
    expect(transport.specs[0]?.args).toEqual(expect.arrayContaining([
      '--dangerously-skip-permissions',
      '--log-file',
      '/tmp/antigravity.log',
      '--model',
      'Gemini 3.5 Flash (High)',
      '--print',
      'hello && keep this as one argument',
    ]));
    expect(removeLog).toHaveBeenCalledWith('/tmp/antigravity.log');
  });

  it('admits the vault only when the CLI says it knows the flag', async () => {
    // **`agy` scopes its workspace to what it was told about, not to where it
    // was started** (#67), so the vault has to be named — and an older build
    // treats an unknown flag as an argument and fails the run on it. Both
    // halves are the test: sent when advertised, absent when not.
    const advertised = new FakeTransport(new FakeManagedChild());
    const legacy = new FakeTransport(new FakeManagedChild());

    for (const [transport, addDir] of [[advertised, true], [legacy, false]] as const) {
      const runner = new AntigravityPrintProcessRunner({
        transport,
        createLogPath: () => '/tmp/antigravity.log',
        removeLog: jest.fn().mockResolvedValue(undefined),
      });
      const handle = runner.start({
        ...INVOCATION,
        addDirPath: '/vault',
        cliCapabilities: { addDir, printTimeout: false, streamJson: false },
      });
      (transport.child as FakeManagedChild).exit.resolve({ code: 0 });
      await handle.completed;
    }

    expect(advertised.specs[0]?.args).toEqual(expect.arrayContaining(['--add-dir', '/vault']));
    expect(legacy.specs[0]?.args).not.toContain('--add-dir');
  });

  it('sends no vault to add when there is no vault', async () => {
    // `cwd` falls back to the process directory, and a fallback is not a vault:
    // adding it would widen the agent's workspace to wherever Obsidian was
    // started from.
    const transport = new FakeTransport(new FakeManagedChild());
    const runner = new AntigravityPrintProcessRunner({
      transport,
      createLogPath: () => '/tmp/antigravity.log',
      removeLog: jest.fn().mockResolvedValue(undefined),
    });

    const handle = runner.start({
      ...INVOCATION,
      cliCapabilities: { addDir: true, printTimeout: false, streamJson: false },
    });
    (transport.child as FakeManagedChild).exit.resolve({ code: 0 });
    await handle.completed;

    expect(transport.specs[0]?.args).not.toContain('--add-dir');
  });

  it('sends the prompt on stdin and reads the answer out of the result frame', async () => {
    // **`agy` refuses `--print` with `--input-format stream-json`**, so the two
    // shapes are exclusive: the transcript leaves argv entirely, which is what
    // survives a conversation past the Windows command-line limit (#69). And
    // the answer is one field of the last frame — accumulating the pipe would
    // spend the byte ceiling on NDJSON envelopes.
    const child = new FakeManagedChild({
      // The frame shapes are the parser's own, which were verified against a
      // live `agy --output-format stream-json` capture — not a plausible
      // spelling: `step_update` carries the step under its own name, and the
      // answer is `result.response`.
      stdout: [
        '{"event":"step_update","step_update":{"step_type":"text","text_delta":"par"}}\n',
        '{"event":"step_update","step_update":{"step_type":"text","text_delta":"tial"}}\n',
        '{"event":"result","result":{"status":"ok","response":"partial answer","error":null}}\n',
      ],
    });
    const transport = new FakeTransport(child);
    const streamed: string[] = [];
    const runner = new AntigravityPrintProcessRunner({
      transport,
      createLogPath: () => '/tmp/antigravity.log',
      removeLog: jest.fn().mockResolvedValue(undefined),
    });

    const handle = runner.start({
      ...INVOCATION,
      cliCapabilities: { addDir: false, printTimeout: false, streamJson: true },
    }, { onAssistantText: text => streamed.push(text) });
    child.exit.resolve({ code: 0 });
    const outcome = await handle.completed;

    expect(transport.specs[0]?.args).toEqual(expect.arrayContaining([
      '--input-format', 'stream-json', '--output-format', 'stream-json',
    ]));
    expect(transport.specs[0]?.args).not.toContain('--print');
    expect(transport.specs[0]?.stdin).toBe('pipe');
    expect(child.stdinWrites).toEqual([
      expect.stringContaining('"event":"user"'),
    ]);
    expect(outcome.stdout).toBe('partial answer');
    // And the pieces reached the caller while the run was still open, rather
    // than only as the finished whole.
    expect(streamed).toEqual(['par', 'tial']);
  });

  it('signals a combined byte overflow instead of silently truncating provider output', async () => {
    const child = new FakeManagedChild({
      stdout: ['123', '4567'],
    });
    const runner = new AntigravityPrintProcessRunner({
      transport: new FakeTransport(child),
      outputByteLimit: 6,
      createLogPath: () => '/tmp/antigravity.log',
      removeLog: async () => undefined,
    });
    const handle = runner.start(INVOCATION);
    child.exit.resolve({ code: 0 });

    await expect(handle.outputLimitExceeded).resolves.toBeUndefined();
    await expect(handle.completed).resolves.toMatchObject({
      stdout: '123',
      outputLimitExceeded: true,
    });
  });

  it('recovers the Windows transcript only after a successful empty stdout', async () => {
    const child = new FakeManagedChild();
    const recoverTranscript = jest.fn().mockResolvedValue({
      output: 'transcript result',
      outputLimitExceeded: false,
    });
    const runner = new AntigravityPrintProcessRunner({
      transport: new FakeTransport(child),
      createLogPath: () => '/tmp/antigravity.log',
      recoverTranscript,
      removeLog: async () => undefined,
    });
    const handle = runner.start(INVOCATION);
    child.exit.resolve({ code: 0 });

    await expect(handle.completed).resolves.toMatchObject({
      exitCode: 0,
      stdout: '',
      transcriptOutput: 'transcript result',
    });
    expect(recoverTranscript).toHaveBeenCalledWith(
      '/tmp/antigravity.log',
      INVOCATION.environment,
      64_000,
    );
  });

  it('maps a real runner overflow through the backend to failed/output-limit', async () => {
    const child = new FakeManagedChild({ stdout: ['12345', '67890'] });
    const resultSink = { storeResult: jest.fn() };
    const backend = new AntigravityExecutionBackend({
      requestResolver: { resolve: async () => INVOCATION },
      processRunner: new AntigravityPrintProcessRunner({
        transport: new FakeTransport(child),
        outputByteLimit: 6,
        createLogPath: () => '/tmp/antigravity.log',
        removeLog: async () => undefined,
      }),
      resultSink,
      scheduler: new ImmediateScheduler(),
      sessionInstanceIdFactory: () => sessionInstanceId(`si-${'a'.repeat(32)}`),
      timeoutMs: 1_000,
      gracefulTerminationMs: 1,
      forcedTerminationMs: 1,
    });
    const session = await backend.createSession({
      executionSessionId: executionSessionId(`es-${'b'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'runner-composition' },
      backendGeneration: 1,
    });
    const run = session.createRun({
      runId: runId(`run-${'c'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'runner-composition' },
      requestRef: 'opaque-request',
      resultExpectation: 'required',
    });

    const events = [];
    for await (const event of run.events) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({
      event: { kind: 'terminal', terminal: 'failed', reason: 'output-limit' },
    });
    expect(resultSink.storeResult).not.toHaveBeenCalled();
  });

  it('delegates complete-tree confirmation and termination to application infrastructure', async () => {
    const child = new FakeManagedChild();
    child.confirmed = false;
    const runner = new AntigravityPrintProcessRunner({
      transport: new FakeTransport(child),
      createLogPath: () => '/tmp/antigravity.log',
      removeLog: async () => undefined,
    });
    const handle = runner.start(INVOCATION);

    await expect(handle.confirmTerminated()).resolves.toBe(false);
    await expect(handle.terminate('graceful')).resolves.toBe('unconfirmed');
    await expect(handle.terminate('forced')).resolves.toBe('confirmed');
    expect(child.terminationModes).toEqual(['graceful', 'forced']);
  });
});

const INVOCATION: AntigravityInvocation = {
  command: process.platform === 'win32' ? 'C:\\agy.exe' : '/usr/local/bin/agy',
  cwd: '/vault',
  environment: { PATH: '/usr/local/bin' },
  model: 'Gemini 3.5 Flash (High)',
  permissionMode: 'full_access',
  prompt: 'hello && keep this as one argument',
};

class FakeTransport {
  readonly specs: AntigravityProcessTransportSpec[] = [];

  constructor(readonly child: AntigravityManagedChildProcess) {}

  launch(spec: AntigravityProcessTransportSpec): AntigravityManagedChildProcess {
    this.specs.push(spec);
    return this.child;
  }
}

class FakeManagedChild implements AntigravityManagedChildProcess {
  readonly started = Promise.resolve();
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exited: Promise<{ readonly code: number | null; readonly signal?: string }>;
  readonly exit = deferred<{ readonly code: number | null; readonly signal?: string }>();
  readonly terminationModes: Array<'graceful' | 'forced'> = [];
  readonly stdinWrites: string[] = [];
  confirmed = true;

  async sendInput(text: string): Promise<void> {
    this.stdinWrites.push(text);
  }

  constructor(output: { readonly stdout?: string[]; readonly stderr?: string[] } = {}) {
    this.stdout = chunks(output.stdout ?? []);
    this.stderr = chunks(output.stderr ?? []);
    this.exited = this.exit.promise;
  }

  confirmTerminated(): Promise<boolean> {
    return Promise.resolve(this.confirmed);
  }

  terminate(mode: 'graceful' | 'forced'): Promise<'confirmed' | 'unconfirmed'> {
    this.terminationModes.push(mode);
    return Promise.resolve(mode === 'forced' ? 'confirmed' : 'unconfirmed');
  }
}

class ImmediateScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown {
    if (delayMs <= 1) {
      queueMicrotask(callback);
    }
    return callback;
  }

  clearTimeout(): void {}
}

function chunks(values: readonly string[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) {
        yield Buffer.from(value, 'utf8');
      }
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}
