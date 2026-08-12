import '@/providers/index';

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

const EXPECTED_PROVIDERS = [
  ['claude', 'Claude', 10, 'provider-claude'],
  ['codex', 'Codex', 20, 'provider-codex'],
  ['opencode', 'OpenCode', 30, 'provider-opencode'],
  ['grok', 'Grok Build', 40, 'provider-grok'],
  ['mimocode', 'MiMoCode', 50, 'provider-mimocode'],
  ['kimicode', 'Kimi Code', 60, 'provider-kimicode'],
  ['antigravity', 'Antigravity', 70, 'provider-antigravity'],
  ['gemini', 'Gemini CLI (Legacy)', 80, 'provider-gemini'],
  ['qwen', 'Qwen Code', 90, 'provider-qwen'],
] as const;

describe('builtInProviderCatalog', () => {
  it('publishes one immutable, complete, ordered nine-provider inventory', () => {
    expect(builtInProviderCatalog.list().map(module => [
      module.manifest.id,
      module.manifest.displayName,
      module.manifest.order,
      module.execution.descriptor.backendId,
    ])).toEqual(EXPECTED_PROVIDERS);
    expect(Object.isFrozen(builtInProviderCatalog)).toBe(true);
    expect(Object.isFrozen(builtInProviderCatalog.list())).toBe(true);
    expect(builtInProviderCatalog.list().every(Object.isFrozen)).toBe(true);
  });

  it('keeps every contribution identity aligned with its manifest', () => {
    for (const module of builtInProviderCatalog.list()) {
      const providerId = module.manifest.id;
      expect(module.settings.providerId).toBe(providerId);
      expect(module.workspace.providerId).toBe(providerId);
      expect(module.execution.descriptor.association).toEqual({
        kind: 'provider',
        providerId,
      });
      expect(module.capabilities.providerId).toBe(providerId);
      expect(module.features.providerId).toBe(providerId);
      expect(module.manifest.settingsPresentation).toEqual(expect.objectContaining({
        name: expect.any(String),
        tabName: expect.any(String),
        descriptionKey: `settings.providers.${providerId}.desc`,
      }));
      expect(module.settings.runtimeFingerprintInput(module.settings.defaults()))
        .toEqual(expect.any(Object));
    }
  });

  it('preserves unknown settings and fails closed on malformed enablement for every provider', () => {
    for (const module of builtInProviderCatalog.list()) {
      const encodedDefaults = module.settings.encode(module.settings.defaults());
      const futureField = { retained: module.manifest.id };
      const decoded = module.settings.decode({
        ...encodedDefaults,
        futureProviderField: futureField,
      });
      expect(decoded.ok).toBe(true);
      const value = decoded.ok ? decoded.value : decoded.fallback;
      expect(module.settings.encode(value, decoded.preservedUnknown).futureProviderField)
        .toEqual(futureField);

      const invalid = module.settings.decode({ ...encodedDefaults, enabled: 'unsafe' });
      expect(invalid.ok).toBe(false);
    }
  });

  it('matches the unchanged production registry and default-config inventories before cutover', () => {
    const catalogIds = builtInProviderCatalog.list().map(module => module.manifest.id);
    const defaults = getBuiltInProviderDefaultConfigs();
    expect(ProviderRegistry.getRegisteredProviderIds()).toEqual(catalogIds);
    expect(Object.keys(defaults).sort()).toEqual([...catalogIds].sort());
    for (const module of builtInProviderCatalog.list()) {
      const legacyDefaults = defaults[module.manifest.id] ?? {};
      const encodedDefaults = module.settings.encode(module.settings.defaults());
      expect(module.manifest.displayName).toBe(
        ProviderRegistry.getProviderDisplayName(module.manifest.id),
      );
      expect(encodedDefaults).toEqual(expect.objectContaining(legacyDefaults));
      expect(Object.keys(encodedDefaults)
        .filter(key => !(key in legacyDefaults))
        .every(key => key === 'availableModes' || key === 'discoveredModels'))
        .toBe(true);
    }
  });

  it('keeps exactly one module file for each built-in provider directory', () => {
    const providersRoot = resolve(process.cwd(), 'src/providers');
    const moduleProviders = readdirSync(providersRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => {
        const files = readdirSync(join(providersRoot, entry.name));
        return files
          .filter(file => file.endsWith('ProviderModule.ts'))
          .map(file => [entry.name, basename(file)] as const);
      })
      .sort(([left], [right]) => left.localeCompare(right));

    const expectedFiles = EXPECTED_PROVIDERS.map(([providerId]) => [
      providerId,
      `${toModulePrefix(providerId)}ProviderModule.ts`,
    ] as const).sort(([left], [right]) => left.localeCompare(right));
    expect(moduleProviders).toEqual(expectedFiles);
  });

  it('does not derive the new inventory from either legacy registry', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/providers/BuiltInProviderCatalog.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /ProviderRegistry|ProviderWorkspaceRegistry|defaultProviderConfigs|registration/,
    );
  });

  it('has exactly one production catalog construction site', () => {
    const sourceRoot = resolve(process.cwd(), 'src');
    const constructionSites = listTypescriptFiles(sourceRoot)
      .filter(file => readFileSync(file, 'utf8').includes('new ProviderCatalog('))
      .map(file => file.slice(sourceRoot.length + 1).replaceAll('\\', '/'));

    expect(constructionSites).toEqual(['providers/BuiltInProviderCatalog.ts']);
  });
});

function toModulePrefix(providerId: string): string {
  const explicit: Record<string, string> = {
    antigravity: 'Antigravity',
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
    grok: 'Grok',
    kimicode: 'Kimicode',
    mimocode: 'Mimocode',
    opencode: 'Opencode',
    qwen: 'Qwen',
  };
  const prefix = explicit[providerId];
  if (!prefix) throw new Error(`Missing module prefix for ${providerId}.`);
  return prefix;
}

function listTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return listTypescriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}
