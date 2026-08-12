import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { ExecutionEvent } from '@/core/execution/ExecutionEvents';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import {
  applyRunReconciliation,
  applyRunRecord,
  createRunProjection,
  reduceRunProjection,
} from '@/core/execution/RunProjection';

const RUN_ID = runId(`run-${'1'.repeat(32)}`);
const OTHER_RUN_ID = runId(`run-${'2'.repeat(32)}`);
const SESSION_ID = executionSessionId(`es-${'3'.repeat(32)}`);
const INSTANCE_ID = sessionInstanceId(`si-${'4'.repeat(32)}`);
const BACKEND_ID = executionBackendId('internal-projection-test');

describe('RunProjection', () => {
  it('is referentially idempotent for duplicate, stale, and wrong-run envelopes', () => {
    const initial = createRunProjection(RUN_ID, 'optional');
    const first = reduceRunProjection(initial, envelope(1, 'event-1', {
      kind: 'thinking-activity',
    }));

    expect(reduceRunProjection(first, envelope(1, 'event-1', {
      kind: 'thinking-activity',
    }))).toBe(first);
    expect(reduceRunProjection(first, envelope(1, 'different-stale-id', {
      kind: 'tool-activity',
      toolCallId: 'tool-1',
    }))).toBe(first);
    expect(reduceRunProjection(first, {
      ...envelope(2, 'wrong-run', { kind: 'thinking-activity' }),
      scope: { kind: 'run', runId: OTHER_RUN_ID },
    })).toBe(first);
  });

  it('keeps result, thinking, tools, and progress distinct', () => {
    let projection = createRunProjection(RUN_ID, 'required');
    projection = reduceRunProjection(projection, envelope(1, 'thinking', {
      kind: 'thinking-activity',
    }));
    projection = reduceRunProjection(projection, envelope(2, 'tool', {
      kind: 'tool-activity',
      toolCallId: 'tool-1',
    }));
    projection = reduceRunProjection(projection, envelope(3, 'progress', {
      kind: 'progress',
      progressId: 'progress-1',
    }));
    projection = reduceRunProjection(projection, envelope(4, 'terminal', {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    }));

    expect(projection).toMatchObject({
      state: 'failed',
      sawThinking: true,
      toolCallIds: ['tool-1'],
      progressIds: ['progress-1'],
      terminal: { kind: 'failed', reason: 'missing-required-result' },
    });
    expect(projection.result).toBeUndefined();
  });

  it('does not rewrite a terminal and materializes later reconciliation separately', () => {
    let projection = createRunProjection(RUN_ID, 'optional');
    projection = reduceRunProjection(projection, envelope(1, 'terminal', {
      kind: 'terminal',
      terminal: 'indeterminate',
      reason: 'effects-unknown',
    }));
    const immutableTerminal = projection.terminal;

    expect(reduceRunProjection(projection, envelope(2, 'late-result', {
      kind: 'result',
      result: { resultId: 'late-result-1', storage: 'provider-native' },
    }))).toBe(projection);

    const reconciled = applyRunReconciliation(projection, {
      reconciliationId: `rec-${'5'.repeat(32)}`,
      runId: RUN_ID,
      originalTerminal: 'indeterminate',
      observedOutcome: 'succeeded',
      observedResult: { resultId: 'observed-result-1', storage: 'provider-native' },
      evidence: { kind: 'status-query', evidenceRef: 'status-1' },
      recordedAt: 20,
    });

    expect(reconciled.terminal).toBe(immutableTerminal);
    expect(reconciled.reconciledOutcomes).toEqual([expect.objectContaining({
      observedOutcome: 'succeeded',
      observedResult: { resultId: 'observed-result-1', storage: 'provider-native' },
      evidence: { kind: 'status-query', evidenceRef: 'status-1' },
    })]);
    expect(applyRunReconciliation(reconciled, {
      reconciliationId: `rec-${'5'.repeat(32)}`,
      runId: RUN_ID,
      originalTerminal: 'indeterminate',
      observedOutcome: 'succeeded',
      evidence: { kind: 'status-query', evidenceRef: 'status-1' },
      recordedAt: 20,
    })).toBe(reconciled);
  });

  it('does not let an older envelope regress a newer durable record', () => {
    const recorded = applyRunRecord(createRunProjection(RUN_ID, 'optional'), runRecord({
      state: 'waiting-interaction',
      resultRef: { resultId: 'result-1', storage: 'projection' },
      openInteractionIds: ['interaction-1'],
      lastSequence: 2,
    }), 2);

    const projected = reduceRunProjection(recorded, envelope(1, 'older-thinking', {
      kind: 'thinking-activity',
    }));

    expect(projected).toMatchObject({
      state: 'waiting-interaction',
      result: { resultId: 'result-1' },
      interactionIds: ['interaction-1'],
      sawThinking: true,
      lastSequence: 2,
      lastRecordRevision: 2,
    });
  });

  it('does not erase an immutable terminal with a stale equal-sequence record', () => {
    const terminal = applyRunRecord(createRunProjection(RUN_ID, 'optional'), runRecord({
      state: 'failed',
      terminal: { kind: 'failed', reason: 'provider-failure', occurredAt: 10 },
      lastSequence: 2,
    }), 3);

    expect(applyRunRecord(terminal, runRecord({
      state: 'running',
      lastSequence: 2,
    }), 2)).toBe(terminal);
  });

  it('converges when an equal-sequence durable record and detail envelope reorder', () => {
    const record = runRecord({ state: 'running', lastSequence: 1 });
    const detail = envelope(1, 'tool-detail', {
      kind: 'tool-activity',
      toolCallId: 'tool-1',
    });
    const recordFirst = reduceRunProjection(
      applyRunRecord(createRunProjection(RUN_ID, 'optional'), record, 1),
      detail,
    );
    const envelopeFirst = applyRunRecord(
      reduceRunProjection(createRunProjection(RUN_ID, 'optional'), detail),
      record,
      1,
    );

    expect(recordFirst).toEqual(envelopeFirst);
  });
});

function runRecord(overrides: Partial<{
  state: 'running' | 'waiting-interaction' | 'failed';
  resultRef: { resultId: string; storage: 'projection' };
  terminal: { kind: 'failed'; reason: 'provider-failure'; occurredAt: number };
  openInteractionIds: string[];
  lastSequence: number;
}>) {
  return {
    runId: RUN_ID,
    executionSessionId: SESSION_ID,
    owner: { kind: 'conversation' as const, ownerId: 'conversation-1' },
    resultExpectation: 'optional' as const,
    state: overrides.state ?? 'running',
    dispatchState: 'accepted' as const,
    cancellationRequested: false,
    ...(overrides.resultRef ? { resultRef: overrides.resultRef } : {}),
    ...(overrides.terminal ? { terminal: overrides.terminal } : {}),
    openInteractionIds: overrides.openInteractionIds ?? [],
    lastSequence: overrides.lastSequence ?? 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function envelope(sequence: number, eventId: string, event: ExecutionEvent) {
  return {
    schemaVersion: 1 as const,
    backendId: BACKEND_ID,
    backendGeneration: 1,
    executionSessionId: SESSION_ID,
    sessionInstanceId: INSTANCE_ID,
    eventId,
    sequence,
    occurredAt: sequence,
    scope: { kind: 'run' as const, runId: RUN_ID },
    event,
  };
}
