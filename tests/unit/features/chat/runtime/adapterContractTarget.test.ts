import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { RunTerminalReason } from '@/core/execution/ExecutionContracts';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  runId as toRunId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import { ExecutionRunStream } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatTurnMetadata } from '@/core/runtime/types';
import type { StreamChunk } from '@/core/types/chat';

/**
 * Executable specification of the presentation adapter's semantics.
 *
 * The sibling suite, `chatRuntimeCharacterization.test.ts`, pins what the
 * current runtime path does. This one pins what the adapter must do instead,
 * and the two disagree by design at the defect-fix points: today the generator
 * closes when the provider stops yielding, and here it closes only on a
 * terminal fact.
 *
 * It first ran against a spec-level double, which proved the specification in
 * `docs/provider-execution-adapter-contract.md` was coherent and executable but
 * not that anything implemented it. At M2-adapter `createSubject` was re-pointed
 * at the real `ExecutionRunStream`. **Eleven of the twelve assertions held
 * unchanged; one did not, and it was the specification that was wrong** — it
 * assumed the provider's error string reaches the UI, which the kernel does not
 * carry. That is recorded at the assertion itself rather than quietly amended.
 *
 * Ingress is still fed directly rather than through the registry, on purpose:
 * these assertions are about one turn's lifetime, and routing them through
 * session creation and dispatch would test the registry twice and this once.
 * The registry path is covered by the adapter conformance suite.
 */

type RunOutcome =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'invalidated'
  | 'indeterminate';

/** What the lifecycle delivers to the adapter, in the order the ingestor accepted it. */
type IngressEvent =
  | { kind: 'chunk'; chunk: StreamChunk }
  | { kind: 'disconnected' }
  | { kind: 'recovering' }
  | { kind: 'terminal'; outcome: RunOutcome; reason?: RunTerminalReason };

interface Subject {
  query(): AsyncGenerator<StreamChunk>;
  cancel(): void;
  consumeTurnMetadata(): ChatTurnMetadata;
  /** Test-only ingress: feeds one accepted event to the run. */
  deliver(event: IngressEvent): void;
  /** Test-only: whether `cancel()` dispatched a cancellation to the run. */
  cancelDispatched(): boolean;
}

const RUN_ID = toRunId(`run-${'a'.repeat(32)}`);

/** Wraps one ingress event in the envelope the registry would have delivered. */
function envelope(event: IngressEvent, sequence: number): ExecutionEventEnvelope {
  const inner = ((): ExecutionEventEnvelope['event'] => {
    if (event.kind === 'chunk') {
      const chunk = event.chunk;
      if (chunk.type !== 'text' && chunk.type !== 'thinking') {
        throw new Error(`This suite only feeds streamed content, got "${chunk.type}".`);
      }
      return {
        kind: 'output-delta',
        channel: chunk.type === 'thinking' ? 'reasoning' : 'assistant',
        text: chunk.content,
      };
    }
    if (event.kind === 'disconnected') {
      return { kind: 'connection-lost' };
    }
    if (event.kind === 'recovering') {
      return { kind: 'recovery-started' };
    }
    return {
      kind: 'terminal',
      terminal: event.outcome,
      reason: event.reason ?? (event.outcome === 'failed' ? 'provider-failure' : 'completed'),
    };
  })();
  return {
    schemaVersion: 1,
    backendId: executionBackendId('provider-target'),
    backendGeneration: 1,
    executionSessionId: executionSessionId(`es-${'a'.repeat(32)}`),
    sessionInstanceId: sessionInstanceId(`si-${'a'.repeat(32)}`),
    eventId: `target-${sequence}`,
    sequence,
    occurredAt: sequence,
    scope: { kind: 'run', runId: RUN_ID },
    event: inner,
  };
}

/** The production stream, wearing the shape these assertions were written for. */
function createSubject(): Subject {
  const stream = new ExecutionRunStream(RUN_ID);
  let sequence = 0;
  return {
    deliver(event: IngressEvent): void {
      stream.accept(envelope(event, ++sequence));
    },
    cancel: () => stream.requestCancel(),
    cancelDispatched: () => stream.cancelDispatched(),
    consumeTurnMetadata: () => stream.consumeTurnMetadata(),
    query: () => stream.chunks(),
  };
}

/** Drains the generator into an array; resolves only when it closes. */
function collect(subject: Subject): Promise<StreamChunk[]> {
  return (async () => {
    const chunks: StreamChunk[] = [];
    for await (const chunk of subject.query()) {
      chunks.push(chunk);
    }
    return chunks;
  })();
}

/** Resolves to true if the promise is still pending after the event loop turns over. */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  const flushed = new Promise(resolve => setTimeout(() => resolve(marker), 0));
  return (await Promise.race([promise, flushed])) === marker;
}

describe('adapter contract (target semantics)', () => {
  it('closes the generator on a terminal, not on the provider going quiet', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'chunk', chunk: { type: 'text', content: 'hi' } });
    expect(await isPending(collected)).toBe(true);

    subject.deliver({ kind: 'terminal', outcome: 'succeeded' });

    // Both directions of the probe, so the assertions above cannot pass vacuously.
    expect(await isPending(collected)).toBe(false);
    expect(await collected).toEqual([{ type: 'text', content: 'hi' }]);
  });

  it('keeps the generator open across transport loss and recovery', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'disconnected' });
    subject.deliver({ kind: 'recovering' });

    // Today an iterator that ends here renders as a completed turn. It must not.
    expect(await isPending(collected)).toBe(true);

    subject.deliver({ kind: 'terminal', outcome: 'succeeded' });
    await collected;
  });

  it('does not close the generator when cancellation is requested', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.cancel();

    expect(subject.cancelDispatched()).toBe(true);
    expect(await isPending(collected)).toBe(true);

    subject.deliver({ kind: 'terminal', outcome: 'cancelled' });
    await collected;
  });

  it('reports a failure through the existing error chunk', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'terminal', outcome: 'failed', reason: 'nonzero-exit' });

    // The one assertion that changed when this suite was re-pointed at the real
    // stream, and it changed because the spec was wrong: it assumed the
    // provider's own error string reaches the UI. The kernel classifies instead
    // — `RunTerminalReason` is a closed set of sixteen causes — so the chunk
    // names the cause rather than echoing a string the kernel never carries.
    // The behaviour being specified, that a failure is reported through the
    // existing error chunk, is unchanged.
    expect(await collected).toEqual([
      { type: 'error', content: 'The provider process exited with an error.' },
    ]);
  });

  it('reports an indeterminate run honestly instead of as success', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'terminal', outcome: 'indeterminate' });

    expect(await collected).toEqual([
      expect.objectContaining({ type: 'notice', level: 'warning' }),
    ]);
  });

  it.each(['succeeded', 'cancelled', 'interrupted'] as const)(
    'adds no chunk for a %s terminal',
    async outcome => {
      const subject = createSubject();
      const collected = collect(subject);

      subject.deliver({ kind: 'terminal', outcome });

      expect(await collected).toEqual([]);
    },
  );

  it('says so when a turn never reached the provider', async () => {
    // The second assertion in this suite where the specification was wrong.
    // The contract table mapped `invalidated` to "nothing", justified by
    // today's `wasInvalidated` path — but that flag means the *UI* moved on
    // (tab closed, conversation switched), while this terminal means the turn
    // was rejected before anything ran. Two different facts under one word.
    //
    // Rendering nothing for the second leaves an empty assistant message where
    // an explanation belongs, and the first provider flip made it the default
    // first-turn experience: `agy --print` cannot request approvals, and the
    // shipped permission mode is `normal`.
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'terminal', outcome: 'invalidated', reason: 'pre-dispatch-rejected' });

    expect(await collected).toEqual([
      { type: 'error', content: 'The turn was rejected before it started, so nothing ran.' },
    ]);
    expect(subject.consumeTurnMetadata().wasSent).toBe(false);
  });

  it('accepts exactly one terminal and drops everything after it', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'terminal', outcome: 'succeeded' });
    subject.deliver({ kind: 'terminal', outcome: 'failed', reason: 'provider-failure' });
    subject.deliver({ kind: 'chunk', chunk: { type: 'text', content: 'late text' } });

    expect(await collected).toEqual([]);
  });

  it('consumes turn metadata once, and reports whether the turn was dispatched', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'terminal', outcome: 'succeeded' });
    await collected;

    expect(subject.consumeTurnMetadata()).toEqual({ wasSent: true });
    expect(subject.consumeTurnMetadata()).toEqual({});
  });

  it('reports an invalidated run as never dispatched', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'terminal', outcome: 'invalidated' });
    await collected;

    expect(subject.consumeTurnMetadata()).toEqual({ wasSent: false });
  });
});
