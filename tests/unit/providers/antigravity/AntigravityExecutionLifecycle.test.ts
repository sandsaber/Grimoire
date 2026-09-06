import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import {
  executionSessionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';
import {
  AntigravityExecutionBackend,
  type AntigravityProcessHandle,
  type AntigravityProcessOutcome,
} from '@/providers/antigravity/execution/AntigravityExecutionBackend';

const SESSION_ID = executionSessionId(`es-${'e'.repeat(32)}`);
const RUN_ID = runId(`run-${'f'.repeat(32)}`);
const OWNER = { kind: 'conversation' as const, ownerId: 'conversation-lifecycle' };

describe('Antigravity execution lifecycle conformance', () => {
  it('persists one result and terminal despite duplicate run/session delivery', async () => {
    const storage = new TestDurableStorage();
    let clock = 0;
    const now = () => ++clock;
    const repositories = new ExecutionControlRepositories(storage, now);
    const transactions = new ExecutionControlTransactionCoordinator(storage, repositories, { now });
    const process = new FakeAntigravityProcess();
    const backend = new AntigravityExecutionBackend({
      requestResolver: {
        resolve: async () => ({
          command: '/usr/local/bin/agy',
          cwd: '/vault',
          environment: {},
          model: null,
          permissionMode: 'full_access',
          prompt: 'opaque test prompt',
        }),
      },
      processRunner: { start: () => process },
      resultSink: {
        storeResult: async () => ({
          kind: 'committed',
          result: { resultId: 'result-antigravity', storage: 'projection' },
        }),
      },
      scheduler: new PassiveScheduler(),
      sessionInstanceIdFactory: () => sessionInstanceId(`si-${'1'.repeat(32)}`),
      now,
    });
    const registry = new ExecutionLifecycleRegistry({
      repositories,
      controlTransactions: transactions,
      nextTransactionId: transactionIds(),
      now,
      scheduler: new PassiveScheduler(),
    });
    registry.registerBackend({ backend });
    await registry.start();
    await registry.createSession({
      backendId: backend.descriptor.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    await registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      resultExpectation: 'required',
      requestRef: 'request-antigravity',
    });

    process.complete({ exitCode: 0, stdout: 'visible result', stderr: '' });
    await registry.waitForRunStream(RUN_ID);

    expect(registry.getRun(RUN_ID)).toMatchObject({
      state: 'succeeded',
      dispatchState: 'accepted',
      resultRef: { resultId: 'result-antigravity', storage: 'projection' },
      terminal: { kind: 'succeeded', reason: 'completed' },
      lastSequence: 3,
    });
    expect(registry.getSession(SESSION_ID)).toMatchObject({
      backendId: 'provider-antigravity',
      backendGeneration: 1,
      lastSequence: 3,
    });
  });
});

class FakeAntigravityProcess implements AntigravityProcessHandle {
  readonly started = Promise.resolve();
  readonly completed: Promise<AntigravityProcessOutcome>;
  readonly outputLimitExceeded = new Promise<void>(() => undefined);
  private readonly completion = deferred<AntigravityProcessOutcome>();

  constructor() {
    this.completed = this.completion.promise;
  }

  complete(outcome: AntigravityProcessOutcome): void {
    this.completion.resolve(outcome);
  }

  confirmTerminated(): Promise<boolean> {
    return Promise.resolve(true);
  }

  terminate(): Promise<'confirmed'> {
    return Promise.resolve('confirmed');
  }
}

class PassiveScheduler implements ExecutionLifecycleScheduler {
  setTimeout(callback: () => void): unknown {
    return callback;
  }

  clearTimeout(): void {}
}

function transactionIds(): () => string {
  let ordinal = 0;
  return () => `tx-${(++ordinal).toString(16).padStart(32, '0')}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}
