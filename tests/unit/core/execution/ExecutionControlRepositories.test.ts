import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type { ExecutionRunRecord } from '@/core/execution/ExecutionControlRecords';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';

const RUN_ID = `run-${'1'.repeat(32)}`;
const SESSION_ID = `es-${'2'.repeat(32)}`;
const RECONCILIATION_ID = `rec-${'3'.repeat(32)}`;

function runRecord(): ExecutionRunRecord {
  return {
    runId: RUN_ID,
    executionSessionId: SESSION_ID,
    owner: { kind: 'conversation', ownerId: 'conversation-1' },
    resultExpectation: 'required',
    state: 'running',
    dispatchState: 'accepted',
    cancellationRequested: false,
    openInteractionIds: [],
    lastSequence: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('ExecutionControlRepositories', () => {
  it('persists only schema-valid lifecycle control records', async () => {
    const repositories = new ExecutionControlRepositories(new TestDurableStorage(), () => 10);

    const created = await repositories.runs.create(RUN_ID, runRecord());
    const terminal = await repositories.runs.update(RUN_ID, created.revision, record => ({
      ...record,
      state: 'succeeded',
      resultRef: { resultId: 'projection-result-1', storage: 'projection' },
      terminal: {
        kind: 'succeeded',
        reason: 'completed',
        occurredAt: 2,
        resultRef: { resultId: 'projection-result-1', storage: 'projection' },
      },
      updatedAt: 2,
    }));

    expect(terminal).toMatchObject({
      revision: 2,
      payload: { state: 'succeeded', terminal: { kind: 'succeeded' } },
    });
  });

  it('rejects schema drift and prohibited payload classes before persistence', async () => {
    const repositories = new ExecutionControlRepositories(new TestDurableStorage());

    await expect(repositories.runs.create(RUN_ID, {
      ...runRecord(),
      state: 'succeeded',
    })).rejects.toThrow('Run terminal must match terminal state exactly.');
    await expect(repositories.runs.create(RUN_ID, {
      ...runRecord(),
      prompt: 'must not persist',
    } as ExecutionRunRecord)).rejects.toThrow('execution run contains unknown fields');
    await expect(repositories.runs.create(RUN_ID, {
      ...runRecord(),
      state: 'succeeded',
      terminal: { kind: 'succeeded', reason: 'provider-failure', occurredAt: 2 },
    })).rejects.toThrow('incompatible with kind "succeeded"');
    await expect(repositories.runs.create(RUN_ID, {
      ...runRecord(),
      state: 'failed',
      terminal: { kind: 'failed', reason: 'completed', occurredAt: 2 },
    })).rejects.toThrow('incompatible with kind "failed"');
  });

  it('keeps reconciliation append-only and separate from the original terminal', async () => {
    const repositories = new ExecutionControlRepositories(new TestDurableStorage());
    const record = {
      reconciliationId: RECONCILIATION_ID,
      runId: RUN_ID,
      originalTerminal: 'indeterminate' as const,
      observedOutcome: 'succeeded' as const,
      observedResult: { resultId: 'native-result-1', storage: 'provider-native' as const },
      evidence: { kind: 'native-history' as const, evidenceRef: 'history-entry-1' },
      recordedAt: 3,
    };

    await expect(repositories.reconciliations.append(RECONCILIATION_ID, record))
      .resolves.toMatchObject({ revision: 1 });
    await expect(repositories.reconciliations.append(RECONCILIATION_ID, record))
      .rejects.toThrow('revision conflict');
  });
});
