import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { ExecutionEventIngestor } from '@/core/execution/ExecutionEventIngestor';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';

const BACKEND_ID = executionBackendId('fake');
const SESSION_ID = executionSessionId(`es-${'1'.repeat(32)}`);
const INSTANCE_ID = sessionInstanceId(`si-${'2'.repeat(32)}`);
const RUN_ID = runId(`run-${'3'.repeat(32)}`);

function event(
  deliveryId: string,
  overrides: Partial<ProviderExecutionEvent> = {},
): ProviderExecutionEvent {
  return {
    backendId: BACKEND_ID,
    backendGeneration: 1,
    executionSessionId: SESSION_ID,
    sessionInstanceId: INSTANCE_ID,
    deliveryId,
    occurredAt: 10,
    scope: { kind: 'run', runId: RUN_ID },
    event: { kind: 'thinking-activity' },
    ...overrides,
  };
}

describe('ExecutionEventIngestor', () => {
  it('deduplicates the same stable delivery across run and session ingress', () => {
    const ingestor = new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
    });

    expect(ingestor.ingest(event('native-1'))).toMatchObject({
      kind: 'accepted',
      envelopes: [{ sequence: 1, eventId: 'native-1' }],
    });
    expect(ingestor.ingest(event('native-1', {
      scope: { kind: 'session' },
    }))).toEqual({ kind: 'duplicate' });
    expect(ingestor.getLastAssignedSequence()).toBe(1);
  });

  it('buffers causal reordering and assigns core sequence only in causal order', () => {
    const ingestor = new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
    });

    expect(ingestor.ingest(event('native-2', {
      causal: { streamId: 'native-stream', sequence: 2 },
    }))).toEqual({ kind: 'buffered' });
    expect(ingestor.ingest(event('native-2', {
      causal: { streamId: 'native-stream', sequence: 2 },
    }))).toEqual({ kind: 'duplicate' });
    expect(ingestor.ingest(event('native-1', {
      causal: { streamId: 'native-stream', sequence: 1 },
    }))).toMatchObject({
      kind: 'accepted',
      envelopes: [{ eventId: 'native-1', sequence: 1 }],
    });
    expect(ingestor.drainReady()).toMatchObject({ eventId: 'native-2', sequence: 2 });
    expect(ingestor.drainReady()).toBeNull();
  });

  it('reports a typed gap without applying an event across the gap', () => {
    const ingestor = new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
      maxReorderDistance: 2,
    });

    expect(ingestor.ingest(event('native-4', {
      causal: { streamId: 'native-stream', sequence: 4 },
    }))).toEqual({
      kind: 'gap',
      diagnostic: {
        streamId: 'native-stream',
        expectedCausalSequence: 1,
        firstObservedCausalSequence: 4,
        affectedRunIds: [RUN_ID],
      },
    });
    expect(ingestor.getLastAssignedSequence()).toBe(0);
  });

  it('rejects stale generations and session incarnations before deduplication', () => {
    const ingestor = new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 2,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
    });

    expect(ingestor.ingest(event('old-generation'))).toEqual({
      kind: 'stale-generation',
    });
    expect(ingestor.ingest(event('old-instance', {
      backendGeneration: 2,
      sessionInstanceId: sessionInstanceId(`si-${'4'.repeat(32)}`),
    }))).toEqual({ kind: 'stale-instance' });
  });

  it('fences old emitters after instance rotation while retaining logical sequence', () => {
    const ingestor = new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
    });
    const nextInstance = sessionInstanceId(`si-${'5'.repeat(32)}`);
    expect(ingestor.ingest(event('before-rotate'))).toMatchObject({ kind: 'accepted' });

    ingestor.rotateSessionInstance(nextInstance);

    expect(ingestor.ingest(event('late-old'))).toEqual({ kind: 'stale-instance' });
    expect(ingestor.ingest(event('new-instance', {
      sessionInstanceId: nextInstance,
    }))).toMatchObject({
      kind: 'accepted',
      envelopes: [{ sequence: 2 }],
    });
  });

  it('drops old-incarnation causal buffers during instance rotation', () => {
    const ingestor = new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
    });
    const nextInstance = sessionInstanceId(`si-${'5'.repeat(32)}`);
    expect(ingestor.ingest(event('old-terminal', {
      causal: { streamId: 'native-stream', sequence: 2 },
      event: { kind: 'terminal', terminal: 'failed', reason: 'provider-failure' },
    }))).toEqual({ kind: 'buffered' });

    ingestor.rotateSessionInstance(nextInstance);

    expect(ingestor.ingest(event('new-predecessor', {
      sessionInstanceId: nextInstance,
      causal: { streamId: 'native-stream', sequence: 1 },
    }))).toMatchObject({
      kind: 'accepted',
      envelopes: [{ eventId: 'new-predecessor', sequence: 1 }],
    });
    expect(ingestor.drainReady()).toBeNull();
  });

  it('reports conflicting deliveries at the same buffered causal position', () => {
    const ingestor = new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
    });
    expect(ingestor.ingest(event('native-2a', {
      causal: { streamId: 'native-stream', sequence: 2 },
    }))).toEqual({ kind: 'buffered' });

    expect(ingestor.ingest(event('native-2b', {
      causal: { streamId: 'native-stream', sequence: 2 },
    }))).toMatchObject({
      kind: 'causal-conflict',
      diagnostic: {
        streamId: 'native-stream',
        expectedCausalSequence: 1,
        firstObservedCausalSequence: 2,
      },
    });
    expect(ingestor.ingest(event('native-1-before-recovery', {
      causal: { streamId: 'native-stream', sequence: 1 },
    }))).toMatchObject({ kind: 'gap' });
    ingestor.rebaseCausalStream('native-stream', 1);
    expect(ingestor.ingest(event('native-1-after-recovery', {
      causal: { streamId: 'native-stream', sequence: 1 },
    }))).toMatchObject({ kind: 'accepted' });
    expect(ingestor.drainReady()).toBeNull();
  });

  it('restores dedupe and sequence state after a failed durable apply', () => {
    const ingestor = new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
    });
    const checkpoint = ingestor.createCheckpoint();
    expect(ingestor.ingest(event('retryable'))).toMatchObject({
      kind: 'accepted',
      envelopes: [{ sequence: 1 }],
    });

    ingestor.restoreCheckpoint(checkpoint);

    expect(ingestor.ingest(event('retryable'))).toMatchObject({
      kind: 'accepted',
      envelopes: [{ sequence: 1 }],
    });
  });
});

/**
 * Added on this branch, not harvested.
 *
 * The v1 suite covered the reordering and rotation paths but left three of the
 * four scope rejections, the bounded-dedupe window, and the reconnect rebase
 * unexercised. The M1 exit gate depends on those, so they are pinned here
 * rather than assumed from the v1 review.
 */
describe('ExecutionEventIngestor — scope, bounds, and recovery', () => {
  function ingestor(overrides: Partial<{ maxRememberedDeliveryIds: number }> = {}) {
    return new ExecutionEventIngestor({
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
      ...overrides,
    });
  }

  it('rejects an event from another backend', () => {
    expect(
      ingestor().ingest(event('foreign', { backendId: executionBackendId('other') })),
    ).toEqual({ kind: 'wrong-backend' });
  });

  it('rejects an event addressed to another logical session', () => {
    expect(
      ingestor().ingest(
        event('foreign', { executionSessionId: executionSessionId(`es-${'9'.repeat(32)}`) }),
      ),
    ).toEqual({ kind: 'wrong-session' });
  });

  it('forgets deliveries beyond the remembered window, so dedupe is bounded not infinite', () => {
    const subject = ingestor({ maxRememberedDeliveryIds: 2 });

    subject.ingest(event('first'));
    subject.ingest(event('second'));
    subject.ingest(event('third'));

    // 'first' has been evicted, so it is accepted again. Bounded memory is a
    // deliberate trade: an adapter without stable replay identity must
    // reconcile rather than lean on the ingestor remembering forever.
    expect(subject.ingest(event('first'))).toMatchObject({ kind: 'accepted' });
    expect(subject.getRecentDeliveryIds()).toHaveLength(2);
  });

  it('refuses a backend generation that does not advance', () => {
    const subject = ingestor();

    expect(() => subject.advanceBackendGeneration(1)).toThrow(/monotonically/);
    expect(() => subject.advanceBackendGeneration(0)).toThrow(/monotonically/);
  });

  it('clears dedupe memory when the backend generation advances', () => {
    const subject = ingestor();
    subject.ingest(event('carried'));

    subject.advanceBackendGeneration(2);

    expect(subject.ingest(event('carried', { backendGeneration: 2 })))
      .toMatchObject({ kind: 'accepted' });
  });

  it('quarantines a stream when buffered events are flushed as gaps', () => {
    const subject = ingestor();
    subject.ingest(event('ahead', { causal: { streamId: 'main', sequence: 5 } }));

    const diagnostics = subject.flushGaps();

    expect(diagnostics).toMatchObject([{ streamId: 'main', expectedCausalSequence: 1 }]);
    // Quarantined: further events on that stream are gaps, not silent skips.
    expect(subject.ingest(event('after', { causal: { streamId: 'main', sequence: 1 } })))
      .toMatchObject({ kind: 'gap' });
  });

  it('resumes a quarantined stream after a reconnect rebases it', () => {
    const subject = ingestor();
    subject.ingest(event('ahead', { causal: { streamId: 'main', sequence: 9 } }));
    subject.flushGaps();

    subject.rebaseCausalStream('main', 9);

    expect(subject.ingest(event('resumed', { causal: { streamId: 'main', sequence: 9 } })))
      .toMatchObject({ kind: 'accepted' });
  });

  it('refuses malformed delivery and causal identifiers', () => {
    const subject = ingestor();

    expect(() => subject.ingest(event(''))).toThrow(/Delivery id/);
    expect(() => subject.ingest(event('ok', { causal: { streamId: '', sequence: 1 } })))
      .toThrow(/Causal stream id/);
    expect(() => subject.ingest(event('ok', { causal: { streamId: 'main', sequence: 0 } })))
      .toThrow(/Causal sequence/);
  });
});
