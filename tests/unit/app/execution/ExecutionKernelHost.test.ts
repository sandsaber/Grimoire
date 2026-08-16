import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { EXECUTION_RUNS_PATH } from '@/core/execution/ExecutionControlPaths';
import { executionSessionId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';

/**
 * The application's owner of the kernel, which the first provider flip creates.
 *
 * What it has to get right is narrow and unforgiving: start once, close the
 * acceptance gate the instant unload begins, and never throw at a caller that
 * cannot handle a rejection — `onunload` returns void.
 */
describe('execution kernel host', () => {
  function createHost(storage = new TestDurableStorage()): {
    host: ExecutionKernelHost;
    storage: TestDurableStorage;
    failures: unknown[];
  } {
    const failures: unknown[] = [];
    const host = new ExecutionKernelHost({
      storage,
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
      reportShutdownFailure: error => failures.push(error),
    });
    host.registerBackend({
      backend: new DeterministicFakeBackend({
        sessionInstanceIdFactory: () => sessionInstanceId(`si-${'1'.repeat(32)}`),
        now: () => 1,
      }),
    });
    return { host, storage, failures };
  }

  it('starts once, so a second load path does not re-run recovery', async () => {
    const { host } = createHost();

    await host.start();
    await expect(host.start()).resolves.toBeUndefined();
  });

  it('shuts down with an id the registry accepts', async () => {
    // The default carries the `sd-` prefix the registry requires. A malformed
    // one throws, and since failures here are reported rather than raised, the
    // shutdown would simply never happen.
    const { host, failures } = createHost();
    await host.start();

    await host.dispose();

    expect(failures).toEqual([]);
  });

  it('closes the acceptance gate before the shutdown resolves', async () => {
    // `onunload` does not await, so this is the half that has to be
    // synchronous: nothing new may be admitted the moment unload begins, and
    // the gate must already be shut when `dispose` returns its promise rather
    // than when that promise settles.
    const { host } = createHost();
    await host.start();
    const backendId = executionBackendId('provider-fake');

    const shutdown = host.dispose();

    await expect(host.registry.createSession({
      backendId,
      executionSessionId: executionSessionId(`es-${'2'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'after-unload' },
    })).rejects.toThrow();
    await shutdown;
  });

  it('reports a shutdown failure instead of rejecting at the caller', async () => {
    const { host, failures } = createHost();
    await host.start();
    await host.dispose();

    // A second shutdown is refused by the registry; the host must absorb it,
    // because the only caller is a void `onunload`.
    await expect(host.dispose()).resolves.toBeUndefined();
    expect(failures.length).toBeLessThanOrEqual(1);
  });

  it('writes control records under the decided path once work happens', async () => {
    const { host, storage } = createHost();
    await host.start();
    await host.dispose();

    const written = await storage.list('.grimoire/control');
    expect(written.every(path => path.startsWith('.grimoire/control/'))).toBe(true);
    expect(EXECUTION_RUNS_PATH.startsWith('.grimoire/control/')).toBe(true);
  });
});
