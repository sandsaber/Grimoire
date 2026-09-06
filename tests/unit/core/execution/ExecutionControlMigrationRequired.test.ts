import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { EXECUTION_RUNS_PATH } from '@/core/execution/ExecutionControlPaths';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import { executionSessionId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';

/**
 * Persistence decision D5, enforced.
 *
 * A control record written by a newer build must open read-only and surface a
 * migration-required state — never be guessed at, downgraded, or discarded.
 * Before this, every startup read went through a helper that threw on such a
 * record, so a single newer record made the registry fail to start. That is the
 * exact path a user takes when a shipped flip is reverted, which is the
 * scenario the revert-safety rule exists for.
 */
describe('control store migration requirement', () => {
  function createRegistry(storage: TestDurableStorage): ExecutionLifecycleRegistry {
    let ordinal = 0;
    const now = (): number => 1_000;
    const repositories = new ExecutionControlRepositories(storage, now);
    const registry = new ExecutionLifecycleRegistry({
      repositories,
      controlTransactions: new ExecutionControlTransactionCoordinator(
        storage,
        repositories,
        { now },
      ),
      nextTransactionId: () => `tx-${(++ordinal).toString(16).padStart(32, '0')}`,
      now,
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
      shutdownGracePeriodMs: 10,
    });
    registry.registerBackend({
      backend: new DeterministicFakeBackend({
        sessionInstanceIdFactory: () => sessionInstanceId(`si-${'1'.repeat(32)}`),
        now,
      }),
    });
    return registry;
  }

  async function writeFutureRun(storage: TestDurableStorage): Promise<void> {
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
  }

  it('starts read-only instead of throwing when a record is from the future', async () => {
    const storage = new TestDurableStorage();
    await writeFutureRun(storage);
    const registry = createRegistry(storage);

    await expect(registry.start()).resolves.toBeUndefined();

    const requirement = registry.getMigrationRequirement();
    expect(requirement?.recordKind).toBe('future');
    expect(requirement?.detail).toContain('99');
  });

  it('refuses new work while migration is required', async () => {
    const storage = new TestDurableStorage();
    await writeFutureRun(storage);
    const registry = createRegistry(storage);
    await registry.start();

    await expect(
      registry.createSession({
        backendId: new DeterministicFakeBackend({
          sessionInstanceIdFactory: () => sessionInstanceId(`si-${'2'.repeat(32)}`),
          now: () => 1_000,
        }).descriptor.backendId,
        executionSessionId: executionSessionId(`es-${'1'.repeat(32)}`),
        owner: { kind: 'conversation', ownerId: 'conversation-1' },
      }),
    ).rejects.toThrow(/requires migration/);
  });

  it('leaves the unreadable record untouched', async () => {
    const storage = new TestDurableStorage();
    await writeFutureRun(storage);
    const path = `${EXECUTION_RUNS_PATH}/run-${'3'.repeat(32)}.json`;
    const before = await storage.read(path);

    await createRegistry(storage).start();

    // Read-only means read-only: a build that cannot understand the record has
    // no business rewriting it.
    expect(await storage.read(path)).toBe(before);
  });

  it('starts normally when the store is readable', async () => {
    const registry = createRegistry(new TestDurableStorage());

    await registry.start();

    expect(registry.getMigrationRequirement()).toBeNull();
  });
});
