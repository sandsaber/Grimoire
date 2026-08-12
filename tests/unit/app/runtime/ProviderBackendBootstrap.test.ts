import {
  ProviderBackendBootstrap,
  type ProviderBackendCatalogPort,
} from '@/app/runtime/ProviderBackendBootstrap';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { ExecutionBackend } from '@/core/execution/ExecutionContracts';
import type { BackendLifecycleRegistration } from '@/core/execution/ExecutionLifecycleRegistry';
import type { ProviderModule } from '@/core/providers/ProviderModule';

describe('ProviderBackendBootstrap', () => {
  it('prepares the complete catalog before registering recovery and interaction ports', async () => {
    const calls: string[] = [];
    const registrations: BackendLifecycleRegistration[] = [];
    const first = createModule('first', calls, { operationalPorts: true });
    const second = createModule('second', calls);
    const bootstrap = new ProviderBackendBootstrap(
      catalog(first.module, second.module),
      {
        resolve: async ({ providerId, generation }) => {
          calls.push(`context:${providerId}:${generation}`);
          return { providerId };
        },
      },
      { getGeneration: id => id === 'first' ? 2 : 7 },
      {
        registerBackends: entries => {
          for (const registration of entries) {
            calls.push(`register:${registration.backend.descriptor.backendId}`);
            registrations.push(registration);
          }
        },
      },
    );

    const one = bootstrap.initialize();
    const two = bootstrap.initialize();
    expect(two).toBe(one);
    await one;

    expect(calls).toEqual([
      'context:first:2',
      'create:first',
      'context:second:7',
      'create:second',
      'register:provider-first',
      'register:provider-second',
    ]);
    expect(registrations[0]).toMatchObject({
      backend: first.backend,
      initialGeneration: 2,
      recovery: first.backend,
      interactions: first.backend,
    });
    expect(registrations[1]).toMatchObject({
      backend: second.backend,
      initialGeneration: 7,
    });
    expect(registrations[1]).not.toHaveProperty('recovery');
    expect(registrations[1]).not.toHaveProperty('interactions');
  });

  it('disposes prepared backends in reverse order when a later factory fails', async () => {
    const calls: string[] = [];
    const first = createModule('first', calls);
    const second = createModule('second', calls);
    second.module.execution.create = async () => {
      calls.push('create:second');
      throw new Error('factory failed');
    };
    const bootstrap = new ProviderBackendBootstrap(
      catalog(first.module, second.module),
      { resolve: async () => ({}) },
      { getGeneration: () => 1 },
      { registerBackends: () => { calls.push('register'); } },
    );

    await expect(bootstrap.initialize()).rejects.toThrow('factory failed');
    expect(calls).toEqual(['create:first', 'create:second', 'dispose:first']);
  });

  it('rejects a backend whose descriptor does not match its module', async () => {
    const calls: string[] = [];
    const fixture = createModule('first', calls);
    fixture.backend.descriptor = {
      ...fixture.backend.descriptor,
      backendId: executionBackendId('provider-conflict'),
    };
    const bootstrap = new ProviderBackendBootstrap(
      catalog(fixture.module),
      { resolve: async () => ({}) },
      { getGeneration: () => 1 },
      { registerBackends: () => undefined },
    );

    await expect(bootstrap.initialize()).rejects.toThrow('invalid execution backend');
  });

  it('disposes the complete prepared batch when atomic registration is rejected', async () => {
    const calls: string[] = [];
    const first = createModule('first', calls);
    const second = createModule('second', calls);
    const bootstrap = new ProviderBackendBootstrap(
      catalog(first.module, second.module),
      { resolve: async () => ({}) },
      { getGeneration: () => 1 },
      {
        registerBackends: () => {
          calls.push('register-batch');
          throw new Error('registration rejected');
        },
      },
    );

    await expect(bootstrap.initialize()).rejects.toThrow('registration rejected');
    expect(calls).toEqual([
      'create:first',
      'create:second',
      'register-batch',
      'dispose:second',
      'dispose:first',
    ]);
  });

  it('retains and retries a backend whose failed initialization cleanup was unconfirmed', async () => {
    const calls: string[] = [];
    const first = createModule('first', calls);
    const second = createModule('second', calls);
    second.module.execution.create = async () => { throw new Error('factory failed'); };
    let disposalAttempt = 0;
    first.backend.dispose = async () => {
      calls.push(`dispose:first:${++disposalAttempt}`);
      if (disposalAttempt === 1) throw new Error('cleanup failed');
    };
    const bootstrap = new ProviderBackendBootstrap(
      catalog(first.module, second.module),
      { resolve: async () => ({}) },
      { getGeneration: () => 1 },
      { registerBackends: () => undefined },
    );

    await expect(bootstrap.initialize()).rejects.toThrow('preparation and cleanup failed');
    await expect(bootstrap.dispose()).resolves.toBeUndefined();
    expect(calls).toEqual([
      'create:first',
      'dispose:first:1',
      'dispose:first:2',
    ]);
  });
});

function createModule(
  id: string,
  calls: string[],
  options: { readonly operationalPorts?: boolean } = {},
): {
  readonly module: ProviderModule<object>;
  readonly backend: MutableExecutionBackend;
} {
  const descriptor = {
    backendId: executionBackendId(`provider-${id}`),
    association: { kind: 'provider' as const, providerId: id },
  };
  const backend: MutableExecutionBackend = {
    descriptor,
    createSession: async () => { throw new Error('not used'); },
    dispose: async () => { calls.push(`dispose:${id}`); },
    ...(options.operationalPorts ? {
      reconcile: async () => ({ kind: 'stopped-safe' as const }),
      resolve: async () => undefined,
      cancel: async () => undefined,
    } : {}),
  };
  const module = {
    manifest: {
      id,
      displayName: id,
      order: 1,
      settingsPresentation: { name: id, tabName: id, descriptionKey: id },
    },
    execution: {
      descriptor,
      create: async () => {
        calls.push(`create:${id}`);
        return backend;
      },
    },
  } as unknown as ProviderModule<object>;
  return { module, backend };
}

interface MutableExecutionBackend extends ExecutionBackend {
  descriptor: ExecutionBackend['descriptor'];
  reconcile?: (...args: never[]) => Promise<{ readonly kind: 'stopped-safe' }>;
  resolve?: (...args: never[]) => Promise<void>;
  cancel?: (...args: never[]) => Promise<void>;
}

function catalog(...modules: ProviderModule<object>[]): ProviderBackendCatalogPort {
  return { list: () => modules };
}
