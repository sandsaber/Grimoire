import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  defineExecutionBackendConformance,
  type ExecutionBackendConformanceDriver,
  type ExecutionBackendConformanceOptions,
} from '@test/helpers/execution/ExecutionBackendConformance';

import { ExecutionEventQueue } from '@/core/execution/ExecutionEventQueue';
import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  ClaudeExecutionBackend,
  type ClaudeExecutionInvocation,
  type ClaudeExecutionQuery,
  type ClaudeExecutionQueryFactoryInput,
  type ClaudeExecutionScheduler,
} from '@/providers/claude/execution/ClaudeExecutionBackend';

defineExecutionBackendConformance('Claude', createDriver);

function createDriver(
  options: ExecutionBackendConformanceOptions = {},
): ExecutionBackendConformanceDriver {
  const scheduler = new ConformanceScheduler();
  const query = new ConformanceQuery(options.termination ?? 'confirmed');
  const requestResolution = deferred<ClaudeExecutionInvocation>();
  let storedResults = 0;
  const invocation: ClaudeExecutionInvocation = {
    startupRef: 'startup-ref',
    restartFingerprint: 'startup-v1',
    session: { kind: 'resume', sessionId: 'claude-session' },
    message: userMessage('11111111-1111-4111-8111-111111111111'),
  };
  if (options.requestResolution !== 'pending') {
    requestResolution.resolve(invocation);
  }
  const backend = new ClaudeExecutionBackend({
    queryFactory: {
      create: async (input) => {
        query.consumeInput(input);
        query.emit(initMessage('claude-session'));
        return query;
      },
    },
    requestResolver: { resolve: () => requestResolution.promise },
    interactionBridge: {
      prepare: () => Promise.reject(new Error('No interactions in conformance driver.')),
    },
    resultSink: {
      storeResult: async () => ({
        kind: 'committed',
        result: { resultId: `result-${++storedResults}`, storage: 'projection' },
      }),
    },
    taskResultLoader: { load: async () => null },
    reconciler: {
      reconcile: async () => options.termination === 'unconfirmed'
        ? { kind: 'unknown', effectsPossible: true }
        : {
          kind: 'terminal',
          terminal: {
            kind: 'interrupted',
            reason: 'known-process-exit',
            occurredAt: 1,
          },
        },
    },
    auxiliaryQueries: { execute: async () => '' },
    scheduler,
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'a'.repeat(32)}`),
    interactionIdFactory: () => interactionId(`ix-${'b'.repeat(32)}`),
    now: () => 1,
    runTimeoutMs: 5_000,
    resultCommitTimeoutMs: 500,
    recoveryTimeoutMs: 500,
    maxResultBytes: 8,
    maxTaskResultBytes: 8,
  });

  return {
    backend,
    request: {
      runId: runId(`run-${'c'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'claude-conformance' },
      resultExpectation: 'required',
      requestRef: 'opaque-request',
    },
    sessionConfig: {
      executionSessionId: executionSessionId(`es-${'d'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'claude-conformance' },
      backendGeneration: 1,
      nativeSessionRef: 'claude-session',
    },
    // The SDK user message uuid: what a Claude run is addressed by when the
    // transcript has to be reconciled after a crash.
    expectedNativeRunRef: () => '11111111-1111-4111-8111-111111111111',
    completeEmpty: () => query.complete(''),
    completeSuccess: () => query.complete('done'),
    fireAllTimers: () => scheduler.fireAll(),
    fireNextTimer: () => scheduler.fireNext(),
    releaseRequest: () => requestResolution.resolve(invocation),
    signalOutputLimit: () => query.complete('output exceeds bound'),
    startCount: () => query.received.length,
    storedResultCount: () => storedResults,
    waitForDispatch: () => waitFor(() => query.received.length === 1),
  };
}

class ConformanceQuery implements ClaudeExecutionQuery {
  readonly received: SDKUserMessage[] = [];
  private readonly output = new ExecutionEventQueue<SDKMessage>();
  private readonly connectionLossListeners = new Set<(error?: Error) => void>();
  private closed = false;

  constructor(private readonly termination: 'confirmed' | 'unconfirmed') {}

  consumeInput(input: ClaudeExecutionQueryFactoryInput): void {
    void (async () => {
      for await (const message of input.messages) {
        this.received.push(message);
      }
    })();
  }

  complete(output: string): void {
    this.output.push(resultMessage(output));
  }

  emit(message: SDKMessage): void {
    this.output.push(message);
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.output[Symbol.asyncIterator]();
  }

  async interrupt(): Promise<void> {
    if (this.termination === 'unconfirmed') {
      throw new Error('interrupt acknowledgement lost');
    }
  }

  async setPermissionMode(): Promise<void> {}
  async setModel(): Promise<void> {}
  async applyFlagSettings(): Promise<void> {}
  async setMcpServers(): Promise<void> {}
  async rewindFiles(): Promise<{ canRewind: boolean }> { return { canRewind: true }; }
  async stopTask(): Promise<void> {}

  onConnectionLost(listener: (error?: Error) => void) {
    this.connectionLossListeners.add(listener);
    return () => this.connectionLossListeners.delete(listener);
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.output.close();
    }
  }
}

class ConformanceScheduler implements ClaudeExecutionScheduler {
  private readonly tasks = new Map<object, () => void>();

  setTimeout(callback: () => void): object {
    const handle = {};
    this.tasks.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null) {
      this.tasks.delete(handle);
    }
  }

  fireNext(): void {
    const task = this.tasks.entries().next().value;
    if (!task) {
      throw new Error('No timer was scheduled.');
    }
    this.tasks.delete(task[0]);
    task[1]();
  }

  fireAll(): void {
    for (const [handle, callback] of [...this.tasks]) {
      this.tasks.delete(handle);
      callback();
    }
  }
}

function userMessage(uuid: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: 'Execute bounded work' },
    parent_tool_use_id: null,
    session_id: 'claude-session',
    uuid,
  } as SDKUserMessage;
}

function resultMessage(output: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: output,
    user_message_uuid: '11111111-1111-4111-8111-111111111111',
    uuid: '22222222-2222-4222-8222-222222222222',
    session_id: 'claude-session',
  } as unknown as SDKMessage;
}

function initMessage(sessionId: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    uuid: `init-${sessionId}`,
  } as unknown as SDKMessage;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Condition was not reached.');
}
