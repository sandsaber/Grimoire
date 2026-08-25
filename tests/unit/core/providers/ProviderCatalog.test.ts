import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  type CatalogProviderModule,
  installProviderCatalog,
  ProviderCatalog,
  providerCatalog,
} from '@/core/providers/ProviderCatalog';

interface TestSettings {
  enabled: boolean;
  label: string;
}

function testModule(
  providerId: string,
  overrides: Partial<CatalogProviderModule> = {},
): CatalogProviderModule {
  const settings = {
    providerId,
    schemaVersion: 1,
    defaults: (): TestSettings => ({ enabled: true, label: providerId }),
    decode: (input: unknown) => ({
      ok: true as const,
      value: input as TestSettings,
      preservedUnknown: {},
    }),
    encode: (value: TestSettings) => ({ ...value }),
    isEnabled: (value: TestSettings) => value.enabled,
    withEnabled: (value: TestSettings, enabled: boolean) => ({ ...value, enabled }),
    runtimeInputKeys: ['label'],
    reconcile: (value: TestSettings) => ({
      settings: value,
      changed: false,
      invalidatesSessions: false,
    }),
  };

  return {
    manifest: { id: providerId, displayName: providerId.toUpperCase(), order: 10 },
    settings,
    workspace: {
      providerId,
      initialize: async () => ({}),
      dispose: async () => {},
    },
    execution: {
      descriptor: {
        backendId: executionBackendId(`${providerId}-backend`),
        association: { kind: 'provider', providerId },
      },
      create: async () => ({}),
    },
    auxiliary: { providerId },
    capabilities: { providerId } as CatalogProviderModule['capabilities'],
    features: () => ({ providerId }) as ReturnType<CatalogProviderModule['features']>,
    ...overrides,
  };
}

/** Replaces one contribution of an otherwise valid module. */
function moduleWith(
  providerId: string,
  patch: Record<string, unknown>,
): CatalogProviderModule {
  const module = testModule(providerId);
  return { ...module, ...patch };
}

describe('ProviderCatalog', () => {
  describe('inventory', () => {
    it('lists modules in declared order rather than construction order', () => {
      const catalog = new ProviderCatalog([
        testModule('late', { manifest: { id: 'late', displayName: 'Late', order: 30 } }),
        testModule('early', { manifest: { id: 'early', displayName: 'Early', order: 10 } }),
        testModule('middle', { manifest: { id: 'middle', displayName: 'Middle', order: 20 } }),
      ]);

      expect(catalog.ids()).toEqual(['early', 'middle', 'late']);
    });

    it('answers for a module it holds and refuses one it does not', () => {
      const catalog = new ProviderCatalog([testModule('one')]);

      expect(catalog.get('one')?.manifest.id).toBe('one');
      expect(catalog.get('two')).toBeNull();
      expect(catalog.has('one')).toBe(true);
      expect(catalog.has('two')).toBe(false);
      expect(catalog.has(2)).toBe(false);
      expect(() => catalog.require('two')).toThrow('"two" is not in the catalog');
    });

    it('names a provider it knows and falls back to the id for one it does not', () => {
      const catalog = new ProviderCatalog([testModule('one')]);

      expect(catalog.displayName('one')).toBe('ONE');
      expect(catalog.displayNameOrId('one')).toBe('ONE');
      // A conversation stored by a build that shipped a provider this one does
      // not still has to render its provider somewhere.
      expect(catalog.displayNameOrId('retired')).toBe('retired');
      expect(() => catalog.displayName('retired')).toThrow();
    });

    it('publishes an inventory nothing downstream can edit', () => {
      const catalog = new ProviderCatalog([testModule('one')]);
      const module = catalog.require('one');

      expect(() => {
        (module.manifest as { displayName: string }).displayName = 'Renamed';
      }).toThrow();
      expect(catalog.displayName('one')).toBe('ONE');
    });
  });

  describe('validation', () => {
    it('rejects two modules claiming the same id', () => {
      expect(() => new ProviderCatalog([testModule('one'), testModule('one')]))
        .toThrow('Duplicate provider id "one"');
    });

    it('rejects two modules claiming the same order', () => {
      // The defect this catalog was built to catch: three forked modules
      // shipped with the order they were copied from, and the product ordering
      // silently fell back to comparing ids.
      expect(() => new ProviderCatalog([testModule('one'), testModule('two')]))
        .toThrow('both claim order 10');
    });

    it('rejects two modules claiming the same execution backend', () => {
      const clash = testModule('two', {
        execution: {
          descriptor: {
            backendId: executionBackendId('one-backend'),
            association: { kind: 'provider', providerId: 'two' },
          },
          create: async () => ({}),
        },
        manifest: { id: 'two', displayName: 'Two', order: 20 },
      });

      expect(() => new ProviderCatalog([testModule('one'), clash]))
        .toThrow('Duplicate execution backend id "one-backend"');
    });

    it.each([
      ['settings', { settings: { ...testModule('one').settings, providerId: 'other' } }],
      ['workspace', { workspace: { ...testModule('one').workspace, providerId: 'other' } }],
      ['auxiliary', { auxiliary: { providerId: 'other' } }],
      ['capabilities', { capabilities: { providerId: 'other' } }],
    ])('rejects a %s contribution claiming another provider', (contribution, patch) => {
      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow(`has a ${contribution} contribution claiming "other"`);
    });

    it('rejects a backend associated with something other than its provider', () => {
      const patch = {
        execution: {
          descriptor: {
            backendId: executionBackendId('one-backend'),
            association: { kind: 'provider', providerId: 'other' },
          },
          create: async () => ({}),
        },
      };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('has a execution contribution claiming "other"');
    });

    it('rejects a backend that is not associated with a provider at all', () => {
      const patch = {
        execution: {
          descriptor: {
            backendId: executionBackendId('one-backend'),
            association: { kind: 'internal', service: 'title' },
          },
          create: async () => ({}),
        },
      };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('must associate its backend with a provider');
    });

    it.each([
      ['manifest', { manifest: undefined }],
      ['settings', { settings: undefined }],
      ['workspace', { workspace: undefined }],
      ['execution', { execution: undefined }],
      ['auxiliary', { auxiliary: undefined }],
      ['capabilities', { capabilities: undefined }],
    ])('rejects a module missing its %s contribution', (contribution, patch) => {
      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow(`missing its ${contribution} contribution`);
    });

    it('rejects a manifest with no display name', () => {
      const patch = { manifest: { id: 'one', displayName: '  ', order: 10 } };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('has an empty display name');
    });

    it('rejects a manifest with a fractional or negative order', () => {
      expect(() => new ProviderCatalog([
        moduleWith('one', { manifest: { id: 'one', displayName: 'One', order: 1.5 } }),
      ])).toThrow('has an invalid order 1.5');
      expect(() => new ProviderCatalog([
        moduleWith('one', { manifest: { id: 'one', displayName: 'One', order: -1 } }),
      ])).toThrow('has an invalid order -1');
    });

    it('requires the workspace lifecycle to declare both halves', () => {
      const patch = {
        workspace: { providerId: 'one', initialize: async () => ({}) },
      };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('workspace.dispose must be a function');
    });

    it('requires a features factory rather than a features object', () => {
      // A plain object cannot carry a port that needs vault-facing services,
      // which is how a real history service is dropped at a flip.
      expect(() => new ProviderCatalog([moduleWith('one', { features: {} })]))
        .toThrow('module.features must be a function');
    });

    it('rejects settings runtime input keys that are not strings', () => {
      const module = testModule('one');
      const patch = { settings: { ...module.settings, runtimeInputKeys: ['ok', 7] } };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('invalid settings runtime input keys');
    });

    it('rejects a settings schema version below one', () => {
      const module = testModule('one');
      const patch = { settings: { ...module.settings, schemaVersion: 0 } };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('invalid settings schema version 0');
    });

    it('rejects a codec whose defaults do not decode', () => {
      const module = testModule('one');
      const patch = {
        settings: {
          ...module.settings,
          decode: () => ({ ok: false, fallback: {}, issues: ['label is required'], preservedUnknown: {} }),
        },
      };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('defaults do not round-trip: label is required');
    });

    it('rejects a codec that throws on its own defaults', () => {
      const module = testModule('one');
      const patch = {
        settings: {
          ...module.settings,
          encode: () => { throw new Error('cannot encode'); },
        },
      };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('settings codec rejected its own defaults');
    });

    it('rejects enablement that does not survive being written', () => {
      const module = testModule('one');
      const patch = {
        settings: {
          ...module.settings,
          withEnabled: (value: TestSettings) => value,
        },
      };

      expect(() => new ProviderCatalog([moduleWith('one', patch)]))
        .toThrow('enablement does not round-trip');
    });
  });

  describe('installation', () => {
    it('refuses to answer before a catalog is installed', () => {
      installProviderCatalog(undefined as unknown as ProviderCatalog);

      expect(() => providerCatalog()).toThrow('has not been installed');
    });

    it('answers with the installed catalog', () => {
      const catalog = new ProviderCatalog([testModule('one')]);
      installProviderCatalog(catalog);

      expect(providerCatalog()).toBe(catalog);
    });
  });
});
