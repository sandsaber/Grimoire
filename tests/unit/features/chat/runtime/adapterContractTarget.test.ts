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
 * It runs against a spec-level double, so passing proves the specification in
 * `docs/provider-execution-adapter-contract.md` is coherent and executable —
 * not that an adapter exists. At M2-adapter, `createSubject` is re-pointed at
 * the real adapter and every assertion below must hold unchanged.
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
  | { kind: 'terminal'; outcome: RunOutcome; error?: string };

interface Subject {
  query(): AsyncGenerator<StreamChunk>;
  cancel(): void;
  consumeTurnMetadata(): ChatTurnMetadata;
  /** Test-only ingress: feeds one accepted event to the run. */
  deliver(event: IngressEvent): void;
  /** Test-only: whether `cancel()` dispatched a cancellation to the run. */
  cancelDispatched(): boolean;
}

/**
 * Minimal implementation of the specified adapter semantics.
 *
 * Replaced at M2-adapter by the production adapter over
 * `ExecutionLifecycleRegistry`. Everything it does here is a restatement of the
 * mapping table in the adapter contract, deliberately with no other behavior.
 */
function createSubject(): Subject {
  const pending: StreamChunk[] = [];
  let waiting: (() => void) | null = null;
  let terminal: RunOutcome | null = null;
  let cancelRequested = false;
  let metadataConsumed = false;

  function wake(): void {
    waiting?.();
    waiting = null;
  }

  function push(chunk: StreamChunk): void {
    pending.push(chunk);
    wake();
  }

  return {
    deliver(event: IngressEvent): void {
      // Exactly one terminal: everything after it is dropped, never rewritten.
      if (terminal !== null) {
        return;
      }

      if (event.kind === 'chunk') {
        push(event.chunk);
        return;
      }

      // Transport loss is non-terminal. The generator stays open while
      // status query, reattach, or checkpoint recovery remains possible.
      if (event.kind === 'disconnected' || event.kind === 'recovering') {
        return;
      }

      terminal = event.outcome;
      if (event.outcome === 'failed') {
        push({ type: 'error', content: event.error ?? 'Run failed' });
      } else if (event.outcome === 'indeterminate') {
        push({
          type: 'notice',
          level: 'warning',
          content: 'Grimoire could not establish whether this run completed.',
        });
      }
      wake();
    },

    cancel(): void {
      // Dispatch only. The run decides when, and whether, it stopped.
      cancelRequested = true;
    },

    cancelDispatched(): boolean {
      return cancelRequested;
    },

    consumeTurnMetadata(): ChatTurnMetadata {
      if (metadataConsumed) {
        return {};
      }
      metadataConsumed = true;
      return { wasSent: terminal !== null && terminal !== 'invalidated' };
    },

    async *query(): AsyncGenerator<StreamChunk> {
      for (;;) {
        while (pending.length > 0) {
          yield pending.shift() as StreamChunk;
        }
        if (terminal !== null) {
          return;
        }
        await new Promise<void>(resolve => {
          waiting = resolve;
        });
      }
    },
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

    subject.deliver({ kind: 'terminal', outcome: 'failed', error: 'process died' });

    expect(await collected).toEqual([{ type: 'error', content: 'process died' }]);
  });

  it('reports an indeterminate run honestly instead of as success', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'terminal', outcome: 'indeterminate' });

    expect(await collected).toEqual([
      expect.objectContaining({ type: 'notice', level: 'warning' }),
    ]);
  });

  it.each(['succeeded', 'cancelled', 'interrupted', 'invalidated'] as const)(
    'adds no chunk for a %s terminal',
    async outcome => {
      const subject = createSubject();
      const collected = collect(subject);

      subject.deliver({ kind: 'terminal', outcome });

      expect(await collected).toEqual([]);
    },
  );

  it('accepts exactly one terminal and drops everything after it', async () => {
    const subject = createSubject();
    const collected = collect(subject);

    subject.deliver({ kind: 'terminal', outcome: 'succeeded' });
    subject.deliver({ kind: 'terminal', outcome: 'failed', error: 'late failure' });
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
