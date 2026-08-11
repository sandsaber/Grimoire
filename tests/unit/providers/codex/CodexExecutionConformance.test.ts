import {
  defineExecutionBackendConformance,
  type ExecutionBackendConformanceDriver,
  type ExecutionBackendConformanceOptions,
} from '@test/helpers/execution/ExecutionBackendConformance';

import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  CodexExecutionBackend,
  type CodexExecutionInvocation,
  type CodexExecutionScheduler,
} from '@/providers/codex/execution/CodexExecutionBackend';
import type { InitializeResult, Thread, Turn } from '@/providers/codex/runtime/codexAppServerTypes';
import type {
  CodexExecutionConnection,
  CodexExecutionNotificationListener,
  CodexExecutionServerRequestHandler,
} from '@/providers/codex/runtime/CodexExecutionConnection';

defineExecutionBackendConformance('Codex', createDriver);

function createDriver(
  options: ExecutionBackendConformanceOptions = {},
): ExecutionBackendConformanceDriver {
  const scheduler = new ConformanceScheduler();
  const connection = new ConformanceConnection(options.termination ?? 'confirmed');
  const requestResolution = deferred<CodexExecutionInvocation>();
  let storedResults = 0;
  const invocation: CodexExecutionInvocation = {
    thread: {
      kind: 'new',
      params: {
        model: 'gpt-5.6-codex',
        cwd: '/vault',
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        experimentalRawEvents: true,
      },
    },
    turn: {
      kind: 'start',
      params: { input: [{ type: 'text', text: 'Execute bounded work' }] },
    },
  };
  if (options.requestResolution !== 'pending') {
    requestResolution.resolve(invocation);
  }
  const backend = new CodexExecutionBackend({
    connectionFactory: { create: () => connection },
    requestResolver: {
      resolve: () => requestResolution.promise,
      resolveSteer: async () => [],
    },
    resultSink: {
      storeResult: async () => ({
        kind: 'committed',
        result: {
          resultId: `result-${++storedResults}`,
          storage: 'projection',
        },
      }),
    },
    interactionBridge: {
      prepare: () => Promise.reject(new Error('No interactions in conformance driver.')),
    },
    turnReconcilerFactory: {
      create: () => ({
        reconcile: async () => options.termination === 'unconfirmed'
          ? { kind: 'unknown' }
          : { kind: 'turn', turn: turn('turn-1', 'interrupted') },
      }),
    },
    defaultResumeParams: {
      experimentalRawEvents: true,
      persistExtendedHistory: true,
    },
    scheduler,
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'a'.repeat(32)}`),
    interactionIdFactory: () => interactionId(`ix-${'b'.repeat(32)}`),
    now: () => 1,
    runTimeoutMs: 5_000,
    resultCommitTimeoutMs: 500,
    cancellationTurnIdTimeoutMs: 500,
    recoveryDelayMs: 100,
    maxResultBytes: 8,
  });

  return {
    backend,
    request: {
      runId: runId(`run-${'c'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'codex-conformance' },
      resultExpectation: 'required',
      requestRef: 'opaque-request',
    },
    sessionConfig: {
      executionSessionId: executionSessionId(`es-${'d'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'codex-conformance' },
      backendGeneration: 1,
    },
    completeEmpty: () => connection.complete(''),
    completeSuccess: () => connection.complete('done'),
    fireAllTimers: () => scheduler.fireAll(),
    fireNextTimer: () => scheduler.fireNext(),
    releaseRequest: () => requestResolution.resolve(invocation),
    signalOutputLimit: () => connection.complete('output exceeds bound'),
    startCount: () => connection.calls.filter(method => method === 'turn/start').length,
    storedResultCount: () => storedResults,
    waitForDispatch: () => waitFor(
      () => connection.calls.includes('turn/start'),
    ),
  };
}

class ConformanceConnection implements CodexExecutionConnection {
  initializeResult: InitializeResult | null = null;
  readonly calls: string[] = [];
  private readonly notifications = new Set<CodexExecutionNotificationListener>();
  private readonly serverRequests = new Set<CodexExecutionServerRequestHandler>();
  private readonly losses = new Set<(error?: Error) => void>();

  constructor(private readonly termination: 'confirmed' | 'unconfirmed') {}

  async initialize(): Promise<InitializeResult> {
    return this.initializeResult ??= {
      userAgent: 'codex-conformance',
      platformFamily: 'test',
      platformOs: 'test',
    };
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.calls.push(method);
    if (method === 'thread/start') {
      return startResult() as T;
    }
    if (method === 'turn/start') {
      return { turn: turn('turn-1', 'inProgress') } as T;
    }
    if (method === 'turn/interrupt' && this.termination === 'confirmed') {
      const scope = params as { threadId: string; turnId: string };
      this.emit('turn/completed', {
        threadId: scope.threadId,
        turn: turn(scope.turnId, 'interrupted'),
      });
    }
    return {} as T;
  }

  notify(): void {}

  onNotification(listener: CodexExecutionNotificationListener) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onServerRequest(handler: CodexExecutionServerRequestHandler) {
    this.serverRequests.add(handler);
    return () => this.serverRequests.delete(handler);
  }

  onConnectionLost(listener: (error?: Error) => void) {
    this.losses.add(listener);
    return () => this.losses.delete(listener);
  }

  async dispose(): Promise<void> {}

  complete(output: string): void {
    if (output) {
      this.emit('item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'message-1',
        delta: output,
      });
    }
    this.emit('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'completed'),
    });
  }

  private emit(method: string, params: unknown): void {
    for (const listener of this.notifications) {
      listener(method, params);
    }
  }
}

class ConformanceScheduler implements CodexExecutionScheduler {
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

function startResult() {
  return {
    thread: thread(),
    model: 'gpt-5.6-codex',
    modelProvider: 'openai',
    serviceTier: null,
    cwd: '/vault',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess' as const },
    reasoningEffort: 'high',
  };
}

function thread(): Thread {
  return {
    id: 'thread-1',
    preview: '',
    ephemeral: false,
    path: '',
    cwd: '/vault',
    cliVersion: 'test',
    status: { type: 'active' },
    turns: [],
    createdAt: 1,
    updatedAt: 1,
    name: null,
    modelProvider: 'openai',
    source: 'app-server',
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
  };
}

function turn(id: string, status: Turn['status']): Turn {
  return { id, status, items: [], error: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, attempts = 40): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Condition was not reached.');
}
