import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { TRANSACTION_INTENTS_PATH } from '@/core/bootstrap/StoragePaths';
import {
  type TransactionCrashPoint,
  TransactionIntentCoordinator,
  type TransactionStepHandler,
} from '@/core/persistence/TransactionIntentCoordinator';
import { getVersionedRecordPath } from '@/core/persistence/VersionedRepository';

const TRANSACTION_KINDS = ['test-write'] as const;

function crashOnceAt(target: TransactionCrashPoint): (point: TransactionCrashPoint) => void {
  let crashed = false;
  return point => {
    if (!crashed && point === target) {
      crashed = true;
      throw new Error(`crash:${point}`);
    }
  };
}

function createHandler(apply: (key: string) => Promise<void>): TransactionStepHandler {
  return {
    handlerId: 'set-flag',
    validate(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('set-flag input must be an object');
      }
      const record = input as Record<string, unknown>;
      if (Object.keys(record).length !== 1
        || typeof record.key !== 'string'
        || !/^[a-z][a-z0-9-]{0,31}$/.test(record.key)) {
        throw new Error('set-flag input must contain one constrained key');
      }
      return { key: record.key };
    },
    async apply(input) {
      await apply(input.key as string);
    },
  };
}

function createTransactionId(sequence: number): string {
  return `tx-${sequence.toString(16).padStart(32, '0')}`;
}

function createOperation(sequence: number) {
  return {
    transactionId: createTransactionId(sequence),
    kind: 'test-write',
    steps: [{
      id: 'step-0',
      handlerId: 'set-flag',
      input: { key: 'written' },
    }],
  };
}

describe('TransactionIntentCoordinator', () => {
  it('leaves no false recovery claim when a crash happens before the intent write', async () => {
    const storage = new TestDurableStorage();
    const apply = jest.fn().mockResolvedValue(undefined);
    const handler = createHandler(apply);
    const coordinator = new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
      crashInjector: crashOnceAt('before-intent'),
    });

    await expect(coordinator.execute(createOperation(0)))
      .rejects.toThrow('crash:before-intent');
    await expect(new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
    }).recoverPending()).resolves.toEqual([]);
    await expect(new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
    }).execute(createOperation(0))).resolves.toMatchObject({ status: 'completed' });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('discovers and recovers an intent after restart without the old operation', async () => {
    const storage = new TestDurableStorage();
    const apply = jest.fn().mockResolvedValue(undefined);
    const handler = createHandler(apply);
    const coordinator = new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
      crashInjector: crashOnceAt('after-intent'),
    });

    await expect(coordinator.execute(createOperation(1)))
      .rejects.toThrow('crash:after-intent');
    await expect(new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
    }).recoverPending()).resolves.toEqual([{
      transactionId: createTransactionId(1),
      status: 'completed',
      recovered: true,
    }]);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('replays an idempotent effect that crashed before its checkpoint', async () => {
    const storage = new TestDurableStorage();
    const state = new Set<string>();
    const apply = jest.fn(async (key: string) => {
      state.add(key);
    });
    const handler = createHandler(apply);
    const coordinator = new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
      crashInjector: crashOnceAt('after-step-effect:step-0'),
    });

    await expect(coordinator.execute(createOperation(2)))
      .rejects.toThrow('crash:after-step-effect:step-0');
    await new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
    }).recoverPending();

    expect(apply).toHaveBeenCalledTimes(2);
    expect(state).toEqual(new Set(['written']));
  });

  it('replays an idempotent effect interrupted at the checkpoint boundary', async () => {
    const storage = new TestDurableStorage();
    const apply = jest.fn().mockResolvedValue(undefined);
    const handler = createHandler(apply);
    const coordinator = new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
      crashInjector: crashOnceAt('before-step-checkpoint:step-0'),
    });

    await expect(coordinator.execute(createOperation(12)))
      .rejects.toThrow('crash:before-step-checkpoint:step-0');
    await new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
    }).recoverPending();

    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('does not replay a checkpointed effect during startup recovery', async () => {
    const storage = new TestDurableStorage();
    const apply = jest.fn().mockResolvedValue(undefined);
    const handler = createHandler(apply);
    const coordinator = new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
      crashInjector: crashOnceAt('after-step-checkpoint:step-0'),
    });

    await expect(coordinator.execute(createOperation(3)))
      .rejects.toThrow('crash:after-step-checkpoint:step-0');
    await new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
    }).recoverPending();

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['before-completion', 4, 1],
    ['after-completion', 5, 0],
  ] as const)('recovers across the %s boundary', async (point, sequence, recoveredCount) => {
    const storage = new TestDurableStorage();
    const apply = jest.fn().mockResolvedValue(undefined);
    const handler = createHandler(apply);
    const coordinator = new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
      crashInjector: crashOnceAt(point),
    });

    await expect(coordinator.execute(createOperation(sequence)))
      .rejects.toThrow(`crash:${point}`);
    await expect(new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [handler],
    }).recoverPending()).resolves.toHaveLength(recoveredCount);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('shares one durable execution across concurrent callers', async () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const coordinator = new TransactionIntentCoordinator(new TestDurableStorage(), {
      kinds: TRANSACTION_KINDS,
      handlers: [createHandler(apply)],
    });
    const operation = createOperation(6);

    const results = await Promise.all([
      coordinator.execute(operation),
      coordinator.execute(operation),
    ]);

    expect(results).toEqual([
      { transactionId: operation.transactionId, status: 'completed', recovered: false },
      { transactionId: operation.transactionId, status: 'completed', recovered: true },
    ]);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('rejects hidden payloads through constrained kinds, ids, and handler input schemas', async () => {
    const coordinator = new TransactionIntentCoordinator(new TestDurableStorage(), {
      kinds: TRANSACTION_KINDS,
      handlers: [createHandler(jest.fn().mockResolvedValue(undefined))],
    });

    await expect(coordinator.execute({
      ...createOperation(7),
      kind: 'copy this private prompt',
    })).rejects.toThrow('Transaction kind must be a constrained identifier.');
    await expect(coordinator.execute({
      ...createOperation(8),
      steps: [{
        id: 'step-0',
        handlerId: 'set-flag',
        input: { key: 'written', content: 'private payload' },
      }],
    })).rejects.toThrow('set-flag input must contain one constrained key');
    await expect(coordinator.execute({
      ...createOperation(9),
      transactionId: 'private-payload-without-spaces',
    })).rejects.toThrow('Transaction id must be an opaque tx identifier.');
    await expect(new TransactionIntentCoordinator(new TestDurableStorage(), {
      kinds: ['known-kind'],
      handlers: [createHandler(jest.fn().mockResolvedValue(undefined))],
    }).execute(createOperation(10))).rejects.toThrow(
      'Transaction kind "test-write" is not registered.',
    );
  });

  it('refuses a durable intent with fields outside the exact control schema', async () => {
    const storage = new TestDurableStorage();
    const apply = jest.fn().mockResolvedValue(undefined);
    const transactionId = createTransactionId(11);
    storage.seed(getVersionedRecordPath(
      TRANSACTION_INTENTS_PATH,
      transactionId,
    ), JSON.stringify({
      schemaVersion: 1,
      recordId: transactionId,
      revision: 1,
      updatedAt: 1,
      payload: {
        transactionId,
        kind: 'test-write',
        steps: [{
          id: 'step-0',
          handlerId: 'set-flag',
          input: { key: 'written' },
          content: 'hidden raw payload',
        }],
        completedStepIds: [],
        status: 'pending',
        createdAt: 1,
        updatedAt: 1,
      },
    }));
    const coordinator = new TransactionIntentCoordinator(storage, {
      kinds: TRANSACTION_KINDS,
      handlers: [createHandler(apply)],
    });

    await expect(coordinator.recoverPending())
      .rejects.toThrow('transaction step 0 contains unknown or missing fields');
    expect(apply).not.toHaveBeenCalled();
  });
});
