import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import {
  EXECUTION_RUNS_PATH,
  TRANSACTION_INTENTS_PATH,
} from '@/core/execution/ExecutionControlPaths';
import { executionSessionId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';
import type { DurableStorage } from '@/core/persistence/DurableStorage';

/**
 * The application's owner of the kernel, which the first provider flip creates.
 *
 * What it has to get right is narrow and unforgiving: start once, close the
 * acceptance gate the instant unload begins, never throw at a caller that
 * cannot handle a rejection — `onunload` returns void — and survive load and
 * unload arriving in either order, because Obsidian orders neither.
 */
describe('execution kernel host', () => {
  /** The id the fake backend actually registers under. */
  const BACKEND_ID = new DeterministicFakeBackend({
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'0'.repeat(32)}`),
    now: () => 1,
  }).descriptor.backendId;

  function createHost(storage: DurableStorage = new TestDurableStorage()): {
    host: ExecutionKernelHost;
    failures: unknown[];
    backend: DeterministicFakeBackend;
  } {
    const failures: unknown[] = [];
    const host = new ExecutionKernelHost({
      storage,
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
      reportShutdownFailure: error => failures.push(error),
    });
    const backend = new DeterministicFakeBackend({
      sessionInstanceIdFactory: () => sessionInstanceId(`si-${'1'.repeat(32)}`),
      now: () => 1,
    });
    host.registerBackend({ backend });
    return { host, failures, backend };
  }

  /** Storage that holds the first read of startup open until released. */
  class PausedStorage implements DurableStorage {
    private readonly inner = new TestDurableStorage();
    private release: (() => void) | undefined;
    readonly reached: Promise<void>;
    private announceReached!: () => void;
    private gate: Promise<void> | undefined;

    constructor() {
      this.reached = new Promise(resolve => {
        this.announceReached = resolve;
      });
      this.gate = new Promise(resolve => {
        this.release = resolve;
      });
    }

    private async pause(): Promise<void> {
      if (!this.gate) {
        return;
      }
      const pending = this.gate;
      this.announceReached();
      await pending;
    }

    open(): void {
      this.gate = undefined;
      this.release?.();
    }

    async read(path: string): Promise<string | null> {
      await this.pause();
      return this.inner.read(path);
    }

    async writeAtomic(path: string, content: string): Promise<void> {
      return this.inner.writeAtomic(path, content);
    }

    async compareAndSwap(
      path: string,
      expectedContent: string | null,
      nextContent: string | null,
    ): Promise<boolean> {
      return this.inner.compareAndSwap(path, expectedContent, nextContent);
    }

    async remove(path: string): Promise<void> {
      return this.inner.remove(path);
    }

    async list(prefix: string): Promise<string[]> {
      await this.pause();
      return this.inner.list(prefix);
    }
  }

  const REFUSED = 'Execution lifecycle registry is not accepting new work.';

  /**
   * What the registry answers when asked for a session — the message, not just
   * the fact of a rejection. A bare `toThrow()` here passes just as well on an
   * unrelated rejection, such as the unknown backend id an earlier version of
   * this suite asked for.
   */
  async function admissionAnswer(host: ExecutionKernelHost, id: string): Promise<string> {
    try {
      await host.registry.createSession({
        backendId: BACKEND_ID,
        executionSessionId: executionSessionId(`es-${id.repeat(32)}`),
        owner: { kind: 'conversation', ownerId: `owner-${id}` },
      });
    } catch (error) {
      return (error as Error).message;
    }
    return 'the registry admitted the session';
  }

  it('starts once, so a second load path does not re-run recovery', async () => {
    const { host } = createHost();

    await host.start();
    await expect(host.start()).resolves.toBeUndefined();
  });

  it('makes a concurrent second start wait for recovery rather than skip it', async () => {
    const storage = new PausedStorage();
    const { host } = createHost(storage);
    let secondResolved = false;

    const first = host.start();
    const second = host.start().then(() => {
      secondResolved = true;
    });
    await storage.reached;

    // A flag set before the await would let this caller through while recovery
    // is still reading the control store.
    expect(secondResolved).toBe(false);
    storage.open();
    await Promise.all([first, second]);
    expect(secondResolved).toBe(true);
  });

  it('shuts down with an id the registry accepts', async () => {
    // The default carries the `sd-` prefix the registry requires. A malformed
    // one throws, and since failures here are reported rather than raised, the
    // shutdown would simply never happen.
    const { host, failures } = createHost();
    await host.start();

    await host.dispose();

    expect(failures).toEqual([]);
    expect(await admissionAnswer(host, '2')).toBe(REFUSED);
  });

  it('closes the acceptance gate before the shutdown resolves', async () => {
    // `onunload` does not await, so this is the half that has to be
    // synchronous: nothing new may be admitted the moment unload begins, and
    // the gate must already be shut when `dispose` returns its promise rather
    // than when that promise settles.
    const { host } = createHost();
    await host.start();

    const shutdown = host.dispose();

    expect(await admissionAnswer(host, '3')).toBe(REFUSED);
    await shutdown;
  });

  it('never opens the gate when unload beats load', async () => {
    // Obsidian's `onload` is async and `onunload` is not withheld until it
    // finishes. A dispose that latched a failed shutdown here would leave the
    // start that follows free to open a gate nothing can close.
    const { host, failures } = createHost();

    await host.dispose();
    await host.start();

    expect(await admissionAnswer(host, '4')).toBe(REFUSED);
    expect(failures).toEqual([]);
  });

  it('closes a gate that opens after unload has already begun', async () => {
    const storage = new PausedStorage();
    const { host, failures } = createHost(storage);

    const started = host.start();
    await storage.reached;
    const shutdown = host.dispose();
    storage.open();
    await Promise.all([started, shutdown]);

    expect(await admissionAnswer(host, '5')).toBe(REFUSED);
    expect(failures).toEqual([]);
  });

  it('reports a shutdown failure instead of rejecting at the caller', async () => {
    const { host, failures } = createHost();
    await host.start();

    // A malformed checkpoint id is refused by the registry. The host must
    // absorb it, because the only caller is a void `onunload`.
    await expect(host.dispose('not-a-checkpoint-id')).resolves.toBeUndefined();

    expect(failures).toHaveLength(1);
    expect((failures[0] as Error).message).toContain('shutdown checkpoint id');
  });

  it('reports nothing when the control store is read-only', async () => {
    // Migration-required means the registry never accepted work, so there is no
    // gate to close and no failure to report on every unload.
    const storage = new TestDurableStorage();
    await storage.writeAtomic(
      `${EXECUTION_RUNS_PATH}/run-${'3'.repeat(32)}.json`,
      JSON.stringify({
        schemaVersion: 99,
        recordId: `run-${'3'.repeat(32)}`,
        revision: 1,
        updatedAt: 1_000,
        payload: { writtenBy: 'a newer build' },
      }),
    );
    const { host, failures, backend } = createHost(storage);
    await host.start();

    await host.dispose();

    expect(host.migrationRequirement()?.recordKind).toBe('future');
    expect(failures).toEqual([]);
    // The gate never opened, so there is no work to cancel and no checkpoint to
    // write — but the backend was registered before any of that and owns a
    // provider process. Leaving it running is what a reverted build did on its
    // first unload, for the life of the application.
    expect(backend.disposeCount).toBe(1);
  });

  it('reports a pending intent this build cannot read as a migration, not a crash', async () => {
    // The record a reverted build actually meets: a newer build wrote a
    // transaction intent, was interrupted, and the older build now finds it
    // during startup recovery. Raised as a plain error it fails startup as a
    // defect — the migration requirement stays null, so nothing can tell the
    // user why, and no backend is disposed either.
    const storage = new TestDurableStorage();
    await storage.writeAtomic(
      `${TRANSACTION_INTENTS_PATH}/tx-${'4'.repeat(32)}.json`,
      JSON.stringify({
        schemaVersion: 99,
        recordId: `tx-${'4'.repeat(32)}`,
        revision: 1,
        updatedAt: 1_000,
        payload: { writtenBy: 'a newer build' },
      }),
    );
    const { host, failures, backend } = createHost(storage);

    await expect(host.start()).resolves.toBeUndefined();

    expect(host.migrationRequirement()?.recordKind).toBe('future');
    await host.dispose();
    expect(failures).toEqual([]);
    expect(backend.disposeCount).toBe(1);
  });

  it('says the same about an intent it cannot parse at all', async () => {
    const storage = new TestDurableStorage();
    await storage.writeAtomic(
      `${TRANSACTION_INTENTS_PATH}/tx-${'5'.repeat(32)}.json`,
      'not json at all',
    );
    const { host } = createHost(storage);

    await expect(host.start()).resolves.toBeUndefined();

    expect(host.migrationRequirement()?.recordKind).toBe('corrupt');
    await host.dispose();
  });

  it('writes control records under the decided path once work happens', async () => {
    const storage = new TestDurableStorage();
    const { host } = createHost(storage);
    await host.start();
    await host.dispose();

    const written = await storage.list('.grimoire/control');
    // Asserted non-empty first: `every` over nothing is true, which would make
    // this pass for a host that wrote no control records at all.
    expect(written.length).toBeGreaterThan(0);
    expect(written.every(path => path.startsWith('.grimoire/control/'))).toBe(true);
    expect(EXECUTION_RUNS_PATH.startsWith('.grimoire/control/')).toBe(true);
  });
});
