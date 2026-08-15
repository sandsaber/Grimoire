import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type {
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '@/core/execution/ExecutionControlRecords';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import {
  ExecutionControlTransactionCoordinator,
  type ExecutionControlWrite,
} from '@/core/execution/ExecutionControlTransactionCoordinator';
import type { TransactionCrashPoint } from '@/core/persistence/TransactionIntentCoordinator';

const SESSION_ID = `es-${'1'.repeat(32)}`;
const INSTANCE_ID = `si-${'2'.repeat(32)}`;
const RUN_ID = `run-${'3'.repeat(32)}`;
const TRANSACTION_ID = `tx-${'4'.repeat(32)}`;

function crashOnceAt(target: TransactionCrashPoint): (point: TransactionCrashPoint) => void {
  let crashed = false;
  return point => {
    if (!crashed && point === target) {
      crashed = true;
      throw new Error(`crash:${point}`);
    }
  };
}

function records(): {
  session: ExecutionSessionRecord;
  run: ExecutionRunRecord;
} {
  const owner = { kind: 'conversation' as const, ownerId: 'conversation-1' };
  return {
    session: {
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
      backendId: 'fake',
      backendGeneration: 1,
      owner,
      status: 'active',
      runIds: [RUN_ID],
      lastSequence: 0,
      acceptedEventIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    run: {
      runId: RUN_ID,
      executionSessionId: SESSION_ID,
      owner,
      resultExpectation: 'required',
      state: 'queued',
      dispatchState: 'pending',
      cancellationRequested: false,
      openInteractionIds: [],
      lastSequence: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function writes(): ExecutionControlWrite[] {
  const { session, run } = records();
  return [
    {
      repository: 'sessions',
      recordId: SESSION_ID,
      expectedRevision: null,
      record: session as unknown as Record<string, unknown>,
    },
    {
      repository: 'runs',
      recordId: RUN_ID,
      expectedRevision: null,
      record: run as unknown as Record<string, unknown>,
    },
  ];
}

describe('ExecutionControlTransactionCoordinator', () => {
  it('recovers a multi-record control write without duplicating the committed first step', async () => {
    const storage = new TestDurableStorage();
    const repositories = new ExecutionControlRepositories(storage, () => 10);
    const coordinator = new ExecutionControlTransactionCoordinator(storage, repositories, {
      crashInjector: crashOnceAt('after-step-effect:step-0'),
    });

    await expect(coordinator.execute(TRANSACTION_ID, writes()))
      .rejects.toThrow('crash:after-step-effect:step-0');
    const freshRepositories = new ExecutionControlRepositories(storage, () => 10);
    await new ExecutionControlTransactionCoordinator(storage, freshRepositories)
      .recoverPending();

    await expect(freshRepositories.sessions.read(SESSION_ID)).resolves.toMatchObject({
      kind: 'current',
      record: { revision: 1 },
    });
    await expect(freshRepositories.runs.read(RUN_ID)).resolves.toMatchObject({
      kind: 'current',
      record: { revision: 1 },
    });
  });
});
