import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type ExecutionBackendDescriptor,
  executionBackendId,
} from '@/core/execution/ExecutionBackendDescriptor';
import { ProviderCatalog } from '@/core/providers/ProviderCatalog';
import type { ProviderModule } from '@/core/providers/ProviderModule';

function createFakeModule(
  providerId = 'fake',
  order = 10,
): ProviderModule<Record<string, unknown>, object, object> {
  const descriptor: ExecutionBackendDescriptor = {
    backendId: executionBackendId(`${providerId}-backend`),
    association: { kind: 'provider', providerId },
  };

  return {
    manifest: {
      id: providerId,
      displayName: 'Fake provider',
      order,
      settingsPresentation: {
        name: 'Fake provider',
        tabName: 'Fake',
        descriptionKey: 'settings.providers.fake.desc',
      },
    },
    settings: {
      providerId,
      schemaVersion: 1,
      defaults: () => ({ enabled: true }),
      decode: input => ({
        ok: true,
        value: typeof input === 'object' && input !== null
          ? { ...input }
          : { enabled: true },
        preservedUnknown: {},
      }),
      encode: value => ({ ...value }),
      runtimeFingerprintInput: value => ({ ...value }),
    },
    workspace: {
      providerId,
      initialize: async () => ({}),
      dispose: async () => {},
    },
    execution: {
      descriptor,
      create: async () => ({}),
    },
    capabilities: {
      providerId,
      process: {
        topology: 'per-run-process',
        concurrency: 'parallel-runs',
      },
      session: {
        resume: 'unsupported',
        transcriptHydration: 'unsupported',
      },
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
        filesystem: 'grimoire',
        network: 'unsupported',
        permissions: 'unsupported',
      },
    },
    features: {
      providerId,
      ports: {},
    },
  };
}

describe('ProviderCatalog', () => {
  it('validates and orders provider modules without application types', () => {
    const later = createFakeModule('later', 20);
    const earlier = createFakeModule('earlier', 10);
    const catalog = new ProviderCatalog([later, earlier]);

    expect(catalog.list().map(module => module.manifest.id)).toEqual([
      'earlier',
      'later',
    ]);
    expect(catalog.require('later')).not.toBe(later);
    expect(catalog.require('later').manifest).toEqual(later.manifest);
  });

  it('keeps the module and catalog contracts provider-neutral', () => {
    const paths = [
      resolve(process.cwd(), 'src/core/providers/ProviderModule.ts'),
      resolve(process.cwd(), 'src/core/providers/ProviderCatalog.ts'),
      resolve(process.cwd(), 'src/core/execution/ExecutionBackendDescriptor.ts'),
    ];

    for (const path of paths) {
      expect(readFileSync(path, 'utf8')).not.toMatch(
        /from ['"](?:obsidian|@\/features|@\/providers|\.\.\/\.\.\/providers)/,
      );
    }
  });

  it('rejects duplicate provider ids and ordering slots', () => {
    expect(() => new ProviderCatalog([
      createFakeModule('duplicate', 10),
      createFakeModule('duplicate', 20),
    ])).toThrow('Duplicate provider id "duplicate".');

    expect(() => new ProviderCatalog([
      createFakeModule('first', 10),
      createFakeModule('second', 10),
    ])).toThrow('Duplicate provider order 10.');
  });

  it('rejects inconsistent contribution identities', () => {
    const module = createFakeModule();
    (module.capabilities as unknown as { providerId: string }).providerId = 'other';

    expect(() => new ProviderCatalog([module])).toThrow(
      'Provider "fake" has mismatched capabilities identity "other".',
    );
  });

  it('rejects invalid ordering, missing contributions, and security claims', () => {
    expect(() => new ProviderCatalog([
      createFakeModule('invalid-order', -1),
    ])).toThrow('Provider "invalid-order" has invalid order -1.');

    const invalidPresentation = createFakeModule();
    (invalidPresentation.manifest.settingsPresentation as { tabName: string }).tabName = '';
    expect(() => new ProviderCatalog([invalidPresentation])).toThrow(
      'Provider "fake" has invalid settings presentation tabName.',
    );

    const missingWorkspace = createFakeModule() as unknown as Record<string, unknown>;
    delete missingWorkspace.workspace;
    expect(() => new ProviderCatalog([
      missingWorkspace as unknown as ProviderModule,
    ])).toThrow('Provider "fake" is missing workspace.');

    const invalidSecurity = createFakeModule();
    (invalidSecurity.capabilities.security as unknown as { network: string }).network = 'pretend';
    expect(() => new ProviderCatalog([invalidSecurity])).toThrow(
      'Provider "fake" has invalid security enforcement "pretend" for network.',
    );
  });

  it('rejects malformed JavaScript contributions and capability shapes', () => {
    const cases: Array<{
      mutate(module: Record<string, any>): void;
      error: string;
    }> = [
      {
        mutate: module => { delete module.settings.decode; },
        error: 'Provider "fake" settings.decode must be a function.',
      },
      {
        mutate: module => { delete module.settings.runtimeFingerprintInput; },
        error: 'Provider "fake" settings.runtimeFingerprintInput must be a function.',
      },
      {
        mutate: module => { module.settings.defaults = () => ({}); },
        error: 'Provider "fake" settings defaults must encode enabled as boolean.',
      },
      {
        mutate: module => { delete module.workspace.dispose; },
        error: 'Provider "fake" workspace.dispose must be a function.',
      },
      {
        mutate: module => { delete module.execution.create; },
        error: 'Provider "fake" execution.create must be a function.',
      },
      {
        mutate: module => { delete module.features.ports; },
        error: 'Provider "fake" features.ports must be an object.',
      },
      {
        mutate: module => { module.features.ports.future = {}; },
        error: 'Provider "fake" has unknown feature port "future".',
      },
      {
        mutate: module => { module.capabilities.security = {}; },
        error: 'Provider "fake" has invalid security enforcement "undefined" for process.',
      },
      {
        mutate: module => { module.capabilities.agents.stableIdentity = 'maybe'; },
        error: 'Provider "fake" has invalid capabilities.agents.stableIdentity value "maybe".',
      },
    ];

    for (const testCase of cases) {
      const module = createFakeModule() as unknown as Record<string, any>;
      testCase.mutate(module);
      expect(() => new ProviderCatalog([
        module as unknown as ProviderModule,
      ])).toThrow(testCase.error);
    }
  });

  it('snapshots validated identities and capability declarations', () => {
    const module = createFakeModule();
    const catalog = new ProviderCatalog([module]);
    const published = catalog.require('fake');

    (module.manifest as unknown as { id: string }).id = 'mutated';
    (module.capabilities.security as unknown as { network: string }).network = 'pretend';

    expect(catalog.require('fake')).toBe(published);
    expect(published.manifest.id).toBe('fake');
    expect(Object.isFrozen(published.manifest.settingsPresentation)).toBe(true);
    expect(published.capabilities.security.network).toBe('unsupported');
    expect(Object.isFrozen(published.capabilities.security)).toBe(true);
  });

  it('preserves class-backed contribution methods in the published snapshot', async () => {
    class SettingsCodec {
      readonly providerId = 'classy';
      readonly schemaVersion = 1;
      private readonly marker = 'settings';

      defaults(): Record<string, unknown> {
        return { enabled: true, marker: this.marker };
      }

      decode(): ReturnType<ProviderModule['settings']['decode']> {
        return { ok: true, value: this.defaults(), preservedUnknown: {} };
      }

      encode(): Record<string, unknown> {
        return this.defaults();
      }

      runtimeFingerprintInput(): Record<string, unknown> {
        return this.defaults();
      }
    }

    class WorkspaceContribution {
      readonly providerId = 'classy';
      private readonly marker = 'workspace';

      async initialize(): Promise<object> {
        return { marker: this.marker };
      }

      async dispose(): Promise<void> {}
    }

    class BackendFactory {
      readonly descriptor: ExecutionBackendDescriptor = {
        backendId: executionBackendId('classy-backend'),
        association: { kind: 'provider', providerId: 'classy' },
      };
      private readonly marker = 'backend';

      async create(): Promise<object> {
        return { marker: this.marker };
      }
    }

    const base = createFakeModule('classy');
    const catalog = new ProviderCatalog([{
      ...base,
      settings: new SettingsCodec(),
      workspace: new WorkspaceContribution(),
      execution: new BackendFactory(),
    }]);
    const published = catalog.require('classy');

    expect(published.settings.defaults()).toEqual({ enabled: true, marker: 'settings' });
    expect(await published.workspace.initialize(undefined, new AbortController().signal))
      .toEqual({ marker: 'workspace' });
    expect(await published.execution.create(undefined)).toEqual({ marker: 'backend' });
  });
});
