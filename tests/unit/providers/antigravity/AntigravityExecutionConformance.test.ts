import {
  defineExecutionBackendConformance,
  type ExecutionBackendConformanceDriver,
  type ExecutionBackendConformanceOptions,
} from '@test/helpers/execution/ExecutionBackendConformance';

import {
  executionSessionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  AntigravityExecutionBackend,
  type AntigravityInvocation,
  type AntigravityProcessHandle,
  type AntigravityProcessOutcome,
  type AntigravityProcessRunner,
  type AntigravityScheduler,
} from '@/providers/antigravity/execution/AntigravityExecutionBackend';

const INVOCATION: AntigravityInvocation = {
  command: '/provider/agy',
  cwd: '/vault',
  environment: {},
  model: null,
  permissionMode: 'full_access',
  prompt: 'opaque prompt',
};

defineExecutionBackendConformance('Antigravity', createDriver);

function createDriver(
  options: ExecutionBackendConformanceOptions = {},
): ExecutionBackendConformanceDriver {
  const requestResolution = deferred<AntigravityInvocation>();
  const process = new ConformanceProcess(options.termination ?? 'confirmed');
  const runner = new ConformanceRunner(process);
  const scheduler = new ConformanceScheduler();
  const resultSink = new ConformanceResultSink();
  const backend = new AntigravityExecutionBackend({
    requestResolver: {
      resolve: () => options.requestResolution === 'pending'
        ? requestResolution.promise
        : Promise.resolve(INVOCATION),
    },
    processRunner: runner,
    resultSink,
    scheduler,
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'1'.repeat(32)}`),
    timeoutMs: 100,
    gracefulTerminationMs: 10,
    forcedTerminationMs: 10,
  });
  return {
    backend,
    request: {
      runId: runId(`run-${'2'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'conformance-owner' },
      requestRef: 'opaque-request',
      resultExpectation: 'required',
    },
    sessionConfig: {
      executionSessionId: executionSessionId(`es-${'3'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'conformance-owner' },
      backendGeneration: 1,
    },
    // Print mode is one process per run with no provider-side run identity, so
    // there is nothing to address after a crash beyond the process itself.
    expectedNativeRunRef: () => null,
    completeEmpty: () => process.complete({ exitCode: 0, stdout: '', stderr: '' }),
    completeSuccess: () => process.complete({ exitCode: 0, stdout: 'result', stderr: '' }),
    fireAllTimers: () => scheduler.fireAll(),
    fireNextTimer: () => scheduler.fireNext(),
    releaseRequest: () => requestResolution.resolve(INVOCATION),
    signalOutputLimit: () => process.signalOutputLimit(),
    startCount: () => runner.startCount,
    storedResultCount: () => resultSink.count,
    waitForDispatch: () => waitFor(() => runner.startCount === 1),
  };
}

class ConformanceRunner implements AntigravityProcessRunner {
  startCount = 0;

  constructor(private readonly process: ConformanceProcess) {}

  start(): AntigravityProcessHandle {
    this.startCount += 1;
    return this.process;
  }
}

class ConformanceProcess implements AntigravityProcessHandle {
  readonly started = Promise.resolve();
  readonly completed: Promise<AntigravityProcessOutcome>;
  readonly outputLimitExceeded: Promise<void>;
  private readonly completion = deferred<AntigravityProcessOutcome>();
  private readonly outputLimit = deferred<void>();

  constructor(private readonly termination: 'confirmed' | 'unconfirmed') {
    this.completed = this.completion.promise;
    this.outputLimitExceeded = this.outputLimit.promise;
  }

  complete(outcome: AntigravityProcessOutcome): void {
    this.completion.resolve(outcome);
  }

  signalOutputLimit(): void {
    this.outputLimit.resolve();
  }

  confirmTerminated(): Promise<boolean> {
    return Promise.resolve(this.termination === 'confirmed');
  }

  terminate(): Promise<'confirmed' | 'unconfirmed'> {
    return Promise.resolve(this.termination);
  }
}

class ConformanceResultSink {
  count = 0;

  storeResult() {
    this.count += 1;
    return Promise.resolve({
      kind: 'committed' as const,
      result: { resultId: 'conformance-result', storage: 'projection' as const },
    });
  }
}

class ConformanceScheduler implements AntigravityScheduler {
  private readonly callbacks: Array<() => void> = [];

  setTimeout(callback: () => void): unknown {
    this.callbacks.push(callback);
    return callback;
  }

  clearTimeout(handle: unknown): void {
    const index = this.callbacks.indexOf(handle as () => void);
    if (index >= 0) {
      this.callbacks.splice(index, 1);
    }
  }

  fireNext(): void {
    this.callbacks.shift()?.();
  }

  fireAll(): void {
    for (const callback of this.callbacks.splice(0)) {
      callback();
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for Antigravity dispatch.');
}
