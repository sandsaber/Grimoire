import {
  type ExecutionBackendDescriptor,
  executionBackendId,
} from '@/core/execution/ExecutionBackendDescriptor';
import { ProviderCatalog } from '@/core/providers/ProviderCatalog';
import type { ProviderModule } from '@/core/providers/ProviderModule';
import {
  ProviderWorkspaceManager,
  type ProviderWorkspaceScheduler,
  ProviderWorkspaceTransitionError,
  ProviderWorkspaceUnavailableError,
} from '@/core/providers/ProviderWorkspaceManager';

class ManualScheduler implements ProviderWorkspaceScheduler {
  private readonly callbacks = new Set<() => void>();

  setTimeout(callback: () => void): unknown {
    this.callbacks.add(callback);
    return callback;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as () => void);
  }

  expireAll(): void {
    const callbacks = [...this.callbacks];
    this.callbacks.clear();
    callbacks.forEach(callback => callback());
  }
}

interface FakeWorkspace {
  readonly id: string;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createModule(
  providerId: string,
  order: number,
  initialize: (signal: AbortSignal) => Promise<FakeWorkspace>,
  dispose: (workspace: FakeWorkspace) => Promise<void> = async () => {},
): ProviderModule<Record<string, unknown>, FakeWorkspace> {
  const descriptor: ExecutionBackendDescriptor = {
    backendId: executionBackendId(`provider-${providerId}`),
    association: { kind: 'provider', providerId },
  };
  return {
    manifest: {
      id: providerId,
      displayName: providerId,
      order,
      settingsPresentation: {
        name: providerId,
        tabName: providerId,
        descriptionKey: `settings.providers.${providerId}.desc`,
      },
    },
    settings: {
      providerId,
      schemaVersion: 1,
      defaults: () => ({ enabled: true }),
      decode: () => ({ ok: true, value: { enabled: true }, preservedUnknown: {} }),
      encode: value => ({ ...value }),
      runtimeFingerprintInput: value => value,
    },
    workspace: {
      providerId,
      initialize: (_context, signal) => initialize(signal),
      dispose,
    },
    execution: { descriptor, create: async () => ({}) },
    capabilities: capabilities(providerId),
    features: { providerId, ports: {} },
  };
}

describe('ProviderWorkspaceManager', () => {
  it('does no startup work and shares concurrent first use', async () => {
    const gate = deferred<FakeWorkspace>();
    const initialize = jest.fn(() => gate.promise);
    const manager = fixture([createModule('first', 1, initialize)]).manager;

    expect(initialize).not.toHaveBeenCalled();
    expect(manager.snapshot('first').state).toBe('uninitialized');
    const first = manager.get('first');
    const second = manager.get('first');
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(manager.snapshot('first').state).toBe('initializing');

    gate.resolve({ id: 'workspace-1' });
    await expect(first).resolves.toEqual({ id: 'workspace-1' });
    await expect(second).resolves.toEqual({ id: 'workspace-1' });
    expect(manager.snapshot('first').state).toBe('ready');
  });

  it('isolates provider failures and retries only on an explicit request', async () => {
    const failing = jest.fn()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce({ id: 'recovered' });
    const healthy = jest.fn(async () => ({ id: 'healthy' }));
    const { manager } = fixture([
      createModule('failing', 1, failing),
      createModule('healthy', 2, healthy),
    ]);

    await expect(manager.get('failing')).rejects.toThrow('first failed');
    await expect(manager.get('failing')).rejects.toBeInstanceOf(
      ProviderWorkspaceUnavailableError,
    );
    expect(failing).toHaveBeenCalledTimes(1);
    await expect(manager.get('healthy')).resolves.toEqual({ id: 'healthy' });
    await expect(manager.retry('failing')).resolves.toEqual({ id: 'recovered' });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('fences a stale initialization and disposes it before the next generation publishes', async () => {
    const firstGate = deferred<FakeWorkspace>();
    const dispose = jest.fn(async () => {});
    const initialize = jest.fn()
      .mockImplementationOnce(() => firstGate.promise)
      .mockResolvedValueOnce({ id: 'generation-2' });
    const { manager, generations } = fixture([
      createModule('first', 1, initialize, dispose),
    ]);
    const pending = manager.get('first');
    generations.set('first', 2);
    const invalidation = manager.invalidate('first');
    firstGate.resolve({ id: 'generation-1' });

    await expect(pending).rejects.toThrow('stale generation');
    await expect(invalidation).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledWith({ id: 'generation-1' });
    await expect(manager.get('first')).resolves.toEqual({ id: 'generation-2' });
    expect(manager.snapshot('first')).toMatchObject({ generation: 2, state: 'ready' });
  });

  it('disposes every provider even when one disposal fails and retains retry ownership', async () => {
    const firstDispose = jest.fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce(undefined);
    const secondDispose = jest.fn(async () => {});
    const { manager } = fixture([
      createModule('first', 1, async () => ({ id: 'first' }), firstDispose),
      createModule('second', 2, async () => ({ id: 'second' }), secondDispose),
    ]);
    await manager.get('first');
    await manager.get('second');

    await expect(manager.dispose()).rejects.toThrow('first:');
    expect(secondDispose).toHaveBeenCalledTimes(1);
    expect(manager.snapshot('first')).toMatchObject({
      state: 'failed',
      failurePhase: 'dispose',
    });
    await expect(manager.dispose()).resolves.toBeUndefined();
    expect(firstDispose).toHaveBeenCalledTimes(2);
    expect(manager.snapshot('first').state).toBe('disposed');
  });

  it('shares concurrent disposal and never initializes an unused provider', async () => {
    const disposeGate = deferred<void>();
    const firstInitialize = jest.fn(async () => ({ id: 'first' }));
    const unusedInitialize = jest.fn(async () => ({ id: 'unused' }));
    const { manager } = fixture([
      createModule('first', 1, firstInitialize, () => disposeGate.promise),
      createModule('unused', 2, unusedInitialize),
    ]);
    await manager.get('first');

    const first = manager.dispose();
    const second = manager.dispose();
    expect(second).toBe(first);
    expect(unusedInitialize).not.toHaveBeenCalled();
    disposeGate.resolve();
    await expect(first).resolves.toBeUndefined();
    expect(manager.snapshot('unused').state).toBe('disposed');
  });

  it('keeps workspace admission closed across the full settings generation transition', async () => {
    const initialize = jest.fn()
      .mockResolvedValueOnce({ id: 'generation-1' })
      .mockResolvedValueOnce({ id: 'generation-2' });
    const dispose = jest.fn(async () => {});
    const { manager, generations } = fixture([
      createModule('first', 1, initialize, dispose),
    ]);
    await manager.get('first');
    const transitionId = `st-${'1'.repeat(32)}`;

    await manager.beginSettingsTransition('first', transitionId);
    expect(manager.snapshot('first')).toMatchObject({
      state: 'uninitialized',
      transitionId,
    });
    await expect(manager.get('first')).rejects.toBeInstanceOf(
      ProviderWorkspaceTransitionError,
    );
    generations.set('first', 2);
    await manager.completeSettingsTransition('first', transitionId);

    await expect(manager.get('first')).resolves.toEqual({ id: 'generation-2' });
    expect(dispose).toHaveBeenCalledWith({ id: 'generation-1' });
    expect(manager.snapshot('first')).toMatchObject({ generation: 2, state: 'ready' });
    expect(manager.snapshot('first')).not.toHaveProperty('transitionId');
  });

  it('bounds signal-ignoring initialization and retains ownership across unload', async () => {
    const gate = deferred<FakeWorkspace>();
    const initialize = jest.fn((_signal: AbortSignal) => gate.promise);
    const dispose = jest.fn(async () => {});
    const { manager, scheduler } = fixture([
      createModule('first', 1, initialize, dispose),
    ]);

    const pending = manager.get('first');
    await flushPromises();
    const signal = initialize.mock.calls[0]?.[0];
    scheduler.expireAll();
    await expect(pending).rejects.toThrow('did not settle before its deadline');
    expect(signal?.aborted).toBe(true);

    const unload = manager.dispose();
    await flushPromises();
    scheduler.expireAll();
    await expect(unload).rejects.toThrow('disposal failed');
    expect(dispose).not.toHaveBeenCalled();

    gate.resolve({ id: 'late-workspace' });
    await flushPromises();
    expect(dispose).toHaveBeenCalledWith({ id: 'late-workspace' });
    await expect(manager.dispose()).resolves.toBeUndefined();
  });

  it('bounds never-settling disposal and retries the same owned operation', async () => {
    const disposeGate = deferred<void>();
    const dispose = jest.fn(() => disposeGate.promise);
    const { manager, scheduler } = fixture([
      createModule('first', 1, async () => ({ id: 'workspace' }), dispose),
    ]);
    await manager.get('first');

    const firstUnload = manager.dispose();
    await flushPromises();
    scheduler.expireAll();
    await expect(firstUnload).rejects.toThrow('disposal failed');
    expect(manager.snapshot('first')).toMatchObject({
      state: 'failed',
      failurePhase: 'dispose',
    });
    expect(dispose).toHaveBeenCalledTimes(1);

    const retryUnload = manager.dispose();
    await flushPromises();
    scheduler.expireAll();
    await expect(retryUnload).rejects.toThrow('disposal failed');
    expect(dispose).toHaveBeenCalledTimes(1);

    disposeGate.resolve();
    await flushPromises();
    await expect(manager.dispose()).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

function fixture(modules: readonly ProviderModule<Record<string, unknown>, FakeWorkspace>[]) {
  const generations = new Map(modules.map(module => [module.manifest.id, 1]));
  const catalog = new ProviderCatalog(modules);
  const scheduler = new ManualScheduler();
  const manager = new ProviderWorkspaceManager(
    catalog,
    { resolve: async providerId => ({ providerId }) },
    { getGeneration: providerId => generations.get(providerId) ?? 1 },
    { settlementTimeoutMs: 1_000, scheduler },
  );
  return { manager, generations, scheduler };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function capabilities(providerId: string): ProviderModule['capabilities'] {
  return {
    providerId,
    process: { topology: 'per-run-process', concurrency: 'serial-runs' },
    session: { resume: 'unsupported', transcriptHydration: 'unsupported' },
    history: { ownership: 'none' },
    commands: { discovery: 'unsupported' },
    mcp: {
      ownership: 'unsupported',
      sessionConfiguration: 'unsupported',
      perRunSelection: 'unsupported',
    },
    agents: {
      definitionInventory: 'none',
      spawnOrigins: [],
      stableIdentity: false,
      observation: 'none',
      resultExtraction: 'unsupported',
      cancellation: 'unsupported',
      statusQuery: 'unsupported',
      reattachment: 'unsupported',
    },
    controls: {
      fork: 'unsupported',
      rewind: 'unsupported',
      steering: 'unsupported',
      compaction: 'unsupported',
    },
    interactions: {
      approval: 'unsupported',
      question: 'unsupported',
      planExit: 'unsupported',
    },
    security: {
      process: 'grimoire',
      filesystem: 'unsupported',
      network: 'unsupported',
      permissions: 'unsupported',
    },
  };
}
