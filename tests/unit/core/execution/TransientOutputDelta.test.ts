import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import { ExecutionEventIngestor } from '@/core/execution/ExecutionEventIngestor';
import {
  type ExecutionEvent,
  type ExecutionEventEnvelope,
  isTransientExecutionEvent,
  type ProviderExecutionEvent,
} from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';
import { createRunProjection, reduceRunProjection } from '@/core/execution/RunProjection';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';

/**
 * The transient content channel, and the three things it must stay out of.
 *
 * Streamed output is the one content-bearing event, added at M2-adapter because
 * the kernel had no way to carry a turn while it was still running: every other
 * event is a fact, and the committed result arrives only at the end, so an
 * adapter over the kernel would have rendered nothing until the turn finished.
 *
 * It travels the normal delivery path so text stays ordered against tool and
 * interaction events. Everything below is the price of that decision being
 * honest rather than convenient.
 */

const BACKEND_ID = executionBackendId('provider-fake');
const SESSION_ID = executionSessionId(`es-${'1'.repeat(32)}`);
const INSTANCE_ID = sessionInstanceId(`si-${'1'.repeat(32)}`);
const RUN_ID = runId(`run-${'1'.repeat(32)}`);

function delivery(deliveryId: string, event: ExecutionEvent): ProviderExecutionEvent {
  return {
    backendId: BACKEND_ID,
    backendGeneration: 1,
    executionSessionId: SESSION_ID,
    sessionInstanceId: INSTANCE_ID,
    deliveryId,
    occurredAt: 1,
    scope: { kind: 'run', runId: RUN_ID },
    event,
  };
}

function createIngestor(): ExecutionEventIngestor {
  return new ExecutionEventIngestor({
    backendId: BACKEND_ID,
    backendGeneration: 1,
    executionSessionId: SESSION_ID,
    sessionInstanceId: INSTANCE_ID,
    maxRememberedDeliveryIds: 4,
  });
}

function accepted(result: ReturnType<ExecutionEventIngestor['ingest']>): ExecutionEventEnvelope[] {
  if (result.kind !== 'accepted') {
    throw new Error(`Expected an accepted ingest result, got "${result.kind}".`);
  }
  return [...result.envelopes];
}

describe('transient output deltas', () => {
  const delta: ExecutionEvent = {
    kind: 'output-delta',
    channel: 'assistant',
    text: 'partial answer',
  };

  it('is the only event kind classified as transient', () => {
    // Guards the classification itself: a second content event added later must
    // be a deliberate decision, not an accident of this predicate widening.
    const kinds: ExecutionEvent[] = [
      delta,
      { kind: 'run-started' },
      { kind: 'thinking-activity' },
      { kind: 'tool-activity', toolCallId: 'tool-1' },
      { kind: 'result', result: { resultId: 'r-1', storage: 'projection' } },
      { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
    ];

    expect(kinds.filter(isTransientExecutionEvent).map(event => event.kind)).toEqual([
      'output-delta',
    ]);
  });

  describe('in the ingestor', () => {
    it('does not consume a sequence number', () => {
      const ingestor = createIngestor();

      const started = accepted(ingestor.ingest(delivery('d-1', { kind: 'run-started' })));
      const streamed = accepted(ingestor.ingest(delivery('d-2', delta)));
      const thinking = accepted(ingestor.ingest(delivery('d-3', { kind: 'thinking-activity' })));

      // The sequence space belongs to durable facts, so a run's `lastSequence`
      // still counts what happened rather than how much was said.
      expect(started[0].sequence).toBe(1);
      expect(streamed[0].sequence).toBe(1);
      expect(thinking[0].sequence).toBe(2);
    });

    it('does not evict remembered delivery ids', () => {
      // The bounded set protects against redelivery of facts. A turn's worth of
      // token-rate traffic would flush it in a moment, which is why deltas are
      // not remembered at all.
      const ingestor = createIngestor();
      accepted(ingestor.ingest(delivery('fact-1', { kind: 'run-started' })));
      for (let index = 0; index < 32; index += 1) {
        accepted(ingestor.ingest(delivery(`delta-${index}`, delta)));
      }

      expect(ingestor.ingest(delivery('fact-1', { kind: 'run-started' })))
        .toEqual({ kind: 'duplicate' });
    });

    it('is delivered again when redelivered, because content is never deduplicated', () => {
      // Stated rather than left implicit: at-most-once holds because a backend
      // emits each delta once and recovery replays facts, not text.
      const ingestor = createIngestor();

      expect(accepted(ingestor.ingest(delivery('d-1', delta)))).toHaveLength(1);
      expect(accepted(ingestor.ingest(delivery('d-1', delta)))).toHaveLength(1);
    });
  });

  it('changes nothing in the run projection', () => {
    const projection = createRunProjection(RUN_ID, 'required');
    const envelope: ExecutionEventEnvelope = {
      schemaVersion: 1,
      backendId: BACKEND_ID,
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: INSTANCE_ID,
      eventId: 'd-1',
      sequence: 0,
      occurredAt: 1,
      scope: { kind: 'run', runId: RUN_ID },
      event: delta,
    };

    expect(reduceRunProjection(projection, envelope)).toBe(projection);
  });

  describe('through the registry', () => {
    async function createRegistry(): Promise<{
      registry: ExecutionLifecycleRegistry;
      storage: TestDurableStorage;
      backend: DeterministicFakeBackend;
    }> {
      let clock = 10;
      let ordinal = 0;
      const now = (): number => ++clock;
      const storage = new TestDurableStorage();
      const repositories = new ExecutionControlRepositories(storage, now);
      const scheduler: ExecutionLifecycleScheduler = {
        setTimeout: () => undefined,
        clearTimeout: () => undefined,
      };
      const registry = new ExecutionLifecycleRegistry({
        repositories,
        controlTransactions: new ExecutionControlTransactionCoordinator(
          storage,
          repositories,
          { now },
        ),
        nextTransactionId: () => `tx-${(++ordinal).toString(16).padStart(32, '0')}`,
        now,
        scheduler,
      });
      const backend = new DeterministicFakeBackend({
        sessionInstanceIdFactory: () => INSTANCE_ID,
        now,
      });
      registry.registerBackend({ backend });
      await registry.start();
      await registry.createSession({
        backendId: backend.descriptor.backendId,
        executionSessionId: SESSION_ID,
        owner: { kind: 'conversation', ownerId: 'transient-delta' },
      });
      return { registry, storage, backend };
    }

    it('reaches observers in order with the facts around it', async () => {
      const { registry, backend } = await createRegistry();
      const seen: string[] = [];
      registry.observe(SESSION_ID, envelope => {
        seen.push(envelope.event.kind);
      });

      const backendId = backend.descriptor.backendId;
      await registry.startRun(SESSION_ID, {
        runId: RUN_ID,
        owner: { kind: 'conversation', ownerId: 'transient-delta' },
        resultExpectation: 'optional',
        requestRef: 'opaque-request',
      });
      await registry.ingest({
        ...delivery('d-1', { kind: 'run-started' }),
        backendId,
      });
      await registry.ingest({ ...delivery('d-2', delta), backendId });
      await registry.ingest({
        ...delivery('d-3', { kind: 'tool-activity', toolCallId: 'tool-1' }),
        backendId,
      });

      // Ordering is the point: text stays interleaved with the facts around it
      // because it travels the same delivery path rather than a channel beside
      // it.
      expect(seen).toEqual(
        expect.arrayContaining(['run-started', 'output-delta', 'tool-activity']),
      );
      expect(seen.indexOf('output-delta')).toBeGreaterThan(seen.indexOf('run-started'));
      expect(seen.indexOf('tool-activity')).toBeGreaterThan(seen.indexOf('output-delta'));
    });

    it('writes no control record, so the text is never persisted', async () => {
      const { registry, storage, backend } = await createRegistry();
      const before = await storage.list('.grimoire/control');

      await registry.ingest({
        ...delivery('d-1', delta),
        backendId: backend.descriptor.backendId,
      });
      await registry.waitForIdle();

      // D2 forbids a second copy of a provider transcript in the control store.
      // A stream of deltas is exactly that, so the honest guard is that this
      // path writes nothing at all.
      expect(await storage.list('.grimoire/control')).toEqual(before);
      const written = await Promise.all(
        (await storage.list('.grimoire/control')).map(path => storage.read(path)),
      );
      expect(written.some(content => content?.includes('partial answer'))).toBe(false);
    });

    it('stops reaching an observer that unsubscribed', async () => {
      const { registry, backend } = await createRegistry();
      const seen: string[] = [];
      registry.observe(SESSION_ID, envelope => seen.push(envelope.eventId))();

      await registry.ingest({
        ...delivery('d-1', delta),
        backendId: backend.descriptor.backendId,
      });

      expect(seen).toEqual([]);
    });

    it('keeps ingestion alive when an observer throws', async () => {
      // Presentation is downstream of the record. A view that fails to render
      // must not be able to fail a run.
      const { registry, backend } = await createRegistry();
      const seen: string[] = [];
      registry.observe(SESSION_ID, () => {
        throw new Error('render failed');
      });
      registry.observe(SESSION_ID, envelope => seen.push(envelope.event.kind));

      await expect(registry.ingest({
        ...delivery('d-1', delta),
        backendId: backend.descriptor.backendId,
      })).resolves.toMatchObject({ kind: 'accepted' });
      expect(seen).toEqual(['output-delta']);
    });
  });
});
