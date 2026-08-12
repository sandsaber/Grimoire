import {
  type ProviderApplicationContextFactory,
  ProviderApplicationContextRegistry,
} from '@/app/runtime/ProviderApplicationContextRegistry';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { ProviderModule } from '@/core/providers/ProviderModule';

describe('ProviderApplicationContextRegistry', () => {
  it('resolves backend and workspace contexts from the exact catalog factory', async () => {
    const module = providerModule('alpha', 'backend-alpha');
    const factory = providerFactory('alpha');
    const registry = new ProviderApplicationContextRegistry(catalog([module]), [factory]);

    await expect(registry.resolve({ providerId: 'alpha', generation: 3, module }))
      .resolves.toEqual({ kind: 'backend', generation: 3, providerId: 'alpha' });
    await expect(registry.resolveWorkspace('alpha', 3))
      .resolves.toEqual({ kind: 'workspace', generation: 3, providerId: 'alpha' });
  });

  it('requires exact one-to-one coverage of every catalog provider', () => {
    const alpha = providerModule('alpha', 'backend-alpha');
    const beta = providerModule('beta', 'backend-beta');

    expect(() => new ProviderApplicationContextRegistry(
      catalog([alpha, beta]),
      [providerFactory('alpha')],
    )).toThrow('incomplete: beta');
    expect(() => new ProviderApplicationContextRegistry(
      catalog([alpha]),
      [providerFactory('alpha'), providerFactory('alpha')],
    )).toThrow('duplicate');
    expect(() => new ProviderApplicationContextRegistry(
      catalog([alpha]),
      [providerFactory('outside')],
    )).toThrow('not in the catalog');
  });

  it('rejects invalid generations and mismatched module identity before factory execution', async () => {
    const alpha = providerModule('alpha', 'backend-alpha');
    const conflicting = providerModule('alpha', 'backend-alpha');
    const registry = new ProviderApplicationContextRegistry(
      catalog([alpha]),
      [providerFactory('alpha')],
    );

    await expect(registry.resolve({ providerId: 'alpha', generation: -1, module: alpha }))
      .rejects.toThrow('generation is invalid');
    await expect(registry.resolve({ providerId: 'alpha', generation: 1, module: conflicting }))
      .rejects.toThrow('module identity conflicts');
  });
});

function catalog(modules: readonly ProviderModule<object>[]) {
  const byId = new Map(modules.map(module => [module.manifest.id, module]));
  return {
    list: () => modules,
    require: (providerId: string) => {
      const module = byId.get(providerId);
      if (!module) throw new Error('missing module');
      return module;
    },
  };
}

function providerFactory(providerId: string): ProviderApplicationContextFactory {
  return {
    providerId,
    createBackendContext: async input => ({
      kind: 'backend',
      generation: input.generation,
      providerId,
    }),
    createWorkspaceContext: async input => ({
      kind: 'workspace',
      generation: input.generation,
      providerId,
    }),
  };
}

function providerModule(providerId: string, backendId: string): ProviderModule<object> {
  return {
    manifest: {
      id: providerId,
      displayName: providerId,
      order: 1,
      settingsPresentation: {
        name: providerId,
        tabName: providerId,
        descriptionKey: providerId,
      },
    },
    settings: {
      providerId,
      schemaVersion: 1,
      defaults: () => ({}),
      decode: () => ({ ok: true, value: {}, preservedUnknown: {} }),
      encode: () => ({ enabled: true }),
      runtimeFingerprintInput: () => ({}),
    },
    workspace: {
      providerId,
      initialize: async () => ({}),
      dispose: async () => undefined,
    },
    execution: {
      descriptor: {
        backendId: executionBackendId(backendId),
        association: { kind: 'provider', providerId },
      },
      create: async () => ({}),
    },
    capabilities: {
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
    },
    features: { providerId, ports: {} },
  };
}
