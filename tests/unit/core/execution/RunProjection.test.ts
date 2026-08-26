import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { ExecutionEvent } from '@/core/execution/ExecutionEvents';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import {
  applyRunReconciliation,
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

  it('takes a terminal the registry synthesized at the position it follows', () => {
    // A terminal the registry reaches on its own - a pre-dispatch rejection, a
    // recovery, a cancellation the provider never acknowledged - never passes
    // the ingestor, so it carries the sequence it follows rather than a new
    // one. The guard below reads that as a replay and drops it, and a consumer
    // that closes a turn on the terminal then waits for one that already
    // happened. The same shape as the transient case, and the same fix: decide
    // before the sequence guard, not inside it.
    let projection = createRunProjection(RUN_ID, 'optional');
    projection = reduceRunProjection(projection, envelope(7, 'thinking', {
      kind: 'thinking-activity',
    }));

    const terminalized = reduceRunProjection(projection, {
      ...envelope(7, `terminalized:${RUN_ID}`, {
        kind: 'terminal',
        terminal: 'indeterminate',
        reason: 'cancellation-unknown',
      }),
      synthesized: true,
    });

    expect(terminalized.terminal?.kind).toBe('indeterminate');
    expect(terminalized.state).toBe('indeterminate');
    // Still deduplicated: the registry publishes one of these per run, and a
    // second delivery of the same one must not rewrite a settled terminal.
    expect(reduceRunProjection(terminalized, {
      ...envelope(7, `terminalized:${RUN_ID}`, {
        kind: 'terminal',
        terminal: 'failed',
        reason: 'provider-failure',
      }),
      synthesized: true,
    })).toBe(terminalized);
  });

  it('still refuses an ingested envelope that repeats a position', () => {
    // Guards the guard the test above relaxes: the ordering rule holds for
    // every envelope that did pass the ingestor, which is all of them but one.
    let projection = createRunProjection(RUN_ID, 'optional');
    projection = reduceRunProjection(projection, envelope(7, 'thinking', {
      kind: 'thinking-activity',
    }));

    expect(reduceRunProjection(projection, envelope(7, 'late-terminal', {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    }))).toBe(projection);
  });
});

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
