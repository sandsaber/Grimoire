import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import trace from '@test/fixtures/provider-traces/claude-execution.json';

import { ClaudeAuxiliaryQuery } from '@/providers/claude/execution/ClaudeAuxiliaryQuery';
import type { ClaudeExecutionQueryFactoryInput } from '@/providers/claude/execution/ClaudeExecutionBackend';
import { ClaudeExecutionMessageChannel } from '@/providers/claude/execution/ClaudeExecutionMessageChannel';
import {
  ClaudeSdkExecutionQueryFactory,
  type ClaudeSdkQueryFunction,
} from '@/providers/claude/execution/ClaudeSdkExecutionAdapter';
import { ClaudeTaskOutputLoader } from '@/providers/claude/execution/ClaudeTaskOutputLoader';

describe('Claude execution adapters', () => {
  it('preserves the exact native run UUID when the SDK starts consuming lazily', async () => {
    const channel = new ClaudeExecutionMessageChannel();
    const message = {
      type: 'user',
      message: { role: 'user', content: 'Exact message' },
      parent_tool_use_id: null,
      session_id: 'native-session',
      uuid: '11111111-1111-4111-8111-111111111111',
    } as SDKUserMessage;
    channel.enqueue(message);

    const delivered = await channel[Symbol.asyncIterator]().next();
    expect(delivered).toEqual({ value: message, done: false });
    expect(delivered.value).toBe(message);
    expect(delivered.value?.uuid).toBe('11111111-1111-4111-8111-111111111111');
    channel.close();
  });

  it('creates resume/fork SDK options and owns stdin connection errors', async () => {
    const stdin = new EventEmitter();
    const close = jest.fn();
    const generator = createSdkQuery([], {
      close,
      transport: { processStdin: stdin },
    });
    const queryMock = jest.fn((params: Parameters<ClaudeSdkQueryFunction>[0]) => {
      void params;
      return generator;
    });
    const queryFunction = queryMock as unknown as ClaudeSdkQueryFunction;
    const factory = new ClaudeSdkExecutionQueryFactory(
      { resolve: async () => ({ cwd: '/vault', model: 'sonnet' }) },
      queryFunction,
    );

    const wrapped = await factory.create(factoryInput());
    const losses: Error[] = [];
    wrapped.onConnectionLost(error => {
      if (error) losses.push(error);
    });
    const pipeError = Object.assign(new Error('pipe closed'), { code: 'EPIPE' });
    stdin.emit('error', pipeError);

    expect(losses).toEqual([pipeError]);
    const call = queryMock.mock.calls[0][0];
    expect(call.options).toEqual(expect.objectContaining({
      cwd: '/vault',
      model: 'sonnet',
      resume: 'native-session',
      resumeSessionAt: 'assistant-checkpoint',
      forkSession: true,
      canUseTool: expect.any(Function),
    }));
    wrapped.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(stdin.listenerCount('error')).toBe(0);
  });

  it('runs auxiliary queries in a distinct cold query and closes them', async () => {
    const close = jest.fn();
    const generator = createSdkQuery([
      resultMessage('auxiliary result'),
    ], { close });
    const queryMock = jest.fn(() => generator);
    const queryFunction = queryMock as unknown as ClaudeSdkQueryFunction;
    const auxiliary = new ClaudeAuxiliaryQuery(
      {
        resolve: async () => ({
          prompt: 'Inspect models',
          options: { cwd: '/vault' },
        }),
      },
      1024,
      queryFunction,
      new AdapterScheduler(),
    );

    const result = await auxiliary.execute(
      'aux-ref',
      new AbortController().signal,
    );
    expect(result).toBe('auxiliary result');
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect([
      ...(queryMock.mock.calls.length > 0 ? ['auxiliary-query/start'] : []),
      ...(result ? ['auxiliary-query/result'] : []),
      ...(close.mock.calls.length > 0 ? ['auxiliary-query/close'] : []),
    ]).toEqual(trace.cases.isolatedAuxiliary);
  });

  it('rejects an oversized auxiliary result before returning it', async () => {
    const interrupt = jest.fn(async () => undefined);
    const close = jest.fn();
    const generator = createSdkQuery([resultMessage('too large')], { interrupt, close });
    const auxiliary = new ClaudeAuxiliaryQuery(
      { resolve: async () => ({ prompt: 'x', options: {} }) },
      3,
      jest.fn(() => generator),
      new AdapterScheduler(),
    );

    await expect(auxiliary.execute(
      'aux-ref',
      new AbortController().signal,
    )).rejects.toThrow('byte limit');
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('aborts an auxiliary resolver before any SDK process is created', async () => {
    const resolution = deferred<never>();
    const queryFunction: jest.MockedFunction<ClaudeSdkQueryFunction> = jest.fn();
    const auxiliary = new ClaudeAuxiliaryQuery(
      { resolve: () => resolution.promise },
      1024,
      queryFunction,
      new AdapterScheduler(),
    );
    const abort = new AbortController();
    const execution = auxiliary.execute('aux-ref', abort.signal);
    abort.abort(new Error('backend disposed'));
    await expect(execution).rejects.toThrow('backend disposed');
    expect(queryFunction).not.toHaveBeenCalled();
  });

  it('closes a pending auxiliary SDK iterator when lifecycle ownership is aborted', async () => {
    const close = jest.fn();
    const pending = createPendingSdkQuery(close);
    const queryMock = jest.fn((input: Parameters<ClaudeSdkQueryFunction>[0]) => {
      void input;
      return pending;
    });
    const queryFunction: ClaudeSdkQueryFunction = queryMock;
    const auxiliary = new ClaudeAuxiliaryQuery(
      { resolve: async () => ({ prompt: 'x', options: {} }) },
      1024,
      queryFunction,
      new AdapterScheduler(),
    );
    const abort = new AbortController();
    const execution = auxiliary.execute('aux-ref', abort.signal);
    await waitFor(() => queryMock.mock.calls.length === 1);
    abort.abort(new Error('backend disposed'));
    await expect(execution).rejects.toThrow('backend disposed');
    expect(close).toHaveBeenCalledTimes(1);
    const options = queryMock.mock.calls[0][0].options;
    expect(options?.abortController?.signal.aborted).toBe(true);
  });

  it('bounds a hanging oversized-result interrupt before closing the cold query', async () => {
    const scheduler = new AdapterScheduler();
    const interrupt = jest.fn(() => new Promise<never>(() => undefined));
    const close = jest.fn();
    const generator = createSdkQuery([resultMessage('too large')], { interrupt, close });
    const auxiliary = new ClaudeAuxiliaryQuery(
      { resolve: async () => ({ prompt: 'x', options: {} }) },
      3,
      jest.fn(() => generator),
      scheduler,
      60_000,
      500,
    );
    const execution = auxiliary.execute('aux-ref', new AbortController().signal);
    await waitFor(() => interrupt.mock.calls.length === 1);
    scheduler.fireLast();
    await expect(execution).rejects.toThrow('byte limit');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reads task output on macOS, Linux, and Windows-compatible Node paths with a byte bound', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'grimoire-claude-task-'));
    const outputFile = join(directory, 'task output.txt');
    await writeFile(outputFile, 'bounded result', 'utf8');
    const loader = new ClaudeTaskOutputLoader();
    const abort = new AbortController();
    try {
      await expect(loader.load({
        outputFile,
        maxBytes: 64,
        signal: abort.signal,
      })).resolves.toBe('bounded result');
      await expect(loader.load({
        outputFile,
        maxBytes: 3,
        signal: abort.signal,
      })).rejects.toThrow('byte limit');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function factoryInput(): ClaudeExecutionQueryFactoryInput {
  return {
    startupRef: 'startup-ref',
    messages: emptyMessages(),
    nativeSessionRef: 'native-session',
    resumeAt: 'assistant-checkpoint',
    forkSession: true,
    onUserDialog: async () => null,
    signal: new AbortController().signal,
    canUseTool: async () => ({ behavior: 'deny', message: 'No.' }),
  };
}

async function* emptyMessages(): AsyncIterable<SDKUserMessage> {}

function createSdkQuery(
  messages: readonly SDKMessage[],
  overrides: {
    readonly interrupt?: jest.Mock;
    readonly close?: jest.Mock;
    readonly transport?: { readonly processStdin: EventEmitter };
  } = {},
): Query {
  const generator = (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();
  return Object.assign(generator, {
    interrupt: overrides.interrupt ?? jest.fn(async () => undefined),
    close: overrides.close ?? jest.fn(),
    setPermissionMode: jest.fn(async () => undefined),
    setModel: jest.fn(async () => undefined),
    applyFlagSettings: jest.fn(async () => undefined),
    setMcpServers: jest.fn(async () => ({})),
    rewindFiles: jest.fn(async () => ({ canRewind: true })),
    stopTask: jest.fn(async () => undefined),
    ...(overrides.transport ? { transport: overrides.transport } : {}),
  }) as unknown as Query;
}

function createPendingSdkQuery(close: jest.Mock): Query {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<SDKMessage>>(() => undefined),
    }),
    interrupt: jest.fn(async () => undefined),
    close,
  } as unknown as Query;
}

function resultMessage(result: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    uuid: 'result-uuid',
    session_id: 'aux-session',
  } as unknown as SDKMessage;
}

class AdapterScheduler {
  private readonly tasks = new Map<object, () => void>();

  setTimeout(callback: () => void): object {
    const handle = {};
    this.tasks.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null) this.tasks.delete(handle);
  }

  fireLast(): void {
    const entries = [...this.tasks.entries()];
    const entry = entries.at(-1);
    if (!entry) throw new Error('No timer was scheduled.');
    this.tasks.delete(entry[0]);
    entry[1]();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition was not reached.');
}
