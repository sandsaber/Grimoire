import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  expandGrokVisibleModelsWithFrontier,
  parseGrokConfigDefaultModel,
  parseGrokConfigModelDefinitions,
  parseGrokModelsCache,
  parseGrokModelsCliOutput,
  readGrokNativeModelCatalog,
  resolveGrokCatalogDefaultModel,
  resolveNativeGrokDataDir,
  shouldUpgradeGrokFrontierDefault,
} from '../../../../src/providers/grok/runtime/GrokModelsCache';

describe('GrokModelsCache', () => {
  it('parses the live grok models CLI list and its default marker', () => {
    expect(parseGrokModelsCliOutput(`
You are logged in with grok.com.

Default model: grok-4.6

Available models:
  * grok-4.6 (default)
  - grok-4.5
`)).toEqual({
      defaultModelId: 'grok-4.6',
      models: [
        { label: 'Grok 4.6', rawId: 'grok-4.6' },
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    });
  });

  it('parses the native Grok models cache and skips hidden entries', () => {
    expect(parseGrokModelsCache({
      models: {
        'grok-4.6': {
          info: {
            description: 'SpaceXAI\'s latest frontier model',
            hidden: false,
            id: 'grok-4.6',
            name: 'Grok 4.6',
          },
        },
        'grok-4.5': {
          info: {
            id: 'grok-4.5',
            name: 'Grok 4.5',
          },
        },
        'hidden-model': {
          info: {
            hidden: true,
            id: 'hidden-model',
            name: 'Hidden',
          },
        },
      },
    })).toEqual({
      defaultModelId: 'grok-4.6',
      models: [
        {
          description: 'SpaceXAI\'s latest frontier model',
          label: 'Grok 4.6',
          rawId: 'grok-4.6',
        },
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    });
  });

  it('reads the configured default model from Grok config.toml', () => {
    expect(parseGrokConfigDefaultModel(`
[cli]
installer = "internal"

[models]
default = "grok-4.6"
default_reasoning_effort = "high"

[ui]
yolo = false
`)).toBe('grok-4.6');
  });

  it('resolves the native data dir from GROK_AUTH_PATH even when GROK_HOME is redirected', () => {
    expect(resolveNativeGrokDataDir({
      GROK_AUTH_PATH: '/home/tester/.grok/auth.json',
      GROK_HOME: '/vault/.grimoire/grok',
      HOME: '/home/tester',
    })).toBe('/home/tester/.grok');
  });

  it('adds newly cached frontier models to a previously seeded visible list', () => {
    expect(expandGrokVisibleModelsWithFrontier(
      ['grok-4.5'],
      [
        { label: 'Grok 4.6', rawId: 'grok-4.6' },
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    )).toEqual(['grok-4.5', 'grok-4.6']);
  });

  it('upgrades a singleton previous frontier default to the newer catalog default', () => {
    expect(shouldUpgradeGrokFrontierDefault({
      defaultRawId: 'grok-4.6',
      savedRawId: 'grok-4.5',
      visibleModels: ['grok-4.5'],
    })).toBe(true);
    expect(shouldUpgradeGrokFrontierDefault({
      defaultRawId: 'grok-4.6',
      savedRawId: 'grok-4.5',
      visibleModels: ['grok-4.6', 'grok-4.5'],
    })).toBe(false);
  });

  it('prefers the configured default when it is present in the catalog', () => {
    expect(resolveGrokCatalogDefaultModel([
      { label: 'Grok 4.5', rawId: 'grok-4.5' },
      { label: 'Grok 4.6', rawId: 'grok-4.6' },
    ], 'grok-4.6')).toBe('grok-4.6');
  });

  it('reads the native cache when GROK_HOME points at a managed home without 4.6', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-grok-cache-'));
    const nativeHome = path.join(tempRoot, 'native');
    const managedHome = path.join(tempRoot, 'managed');
    fs.mkdirSync(nativeHome, { recursive: true });
    fs.mkdirSync(managedHome, { recursive: true });
    fs.writeFileSync(path.join(nativeHome, 'config.toml'), '[models]\ndefault = "grok-4.6"\n');
    fs.writeFileSync(path.join(nativeHome, 'models_cache.json'), JSON.stringify({
      models: {
        'grok-4.6': { info: { id: 'grok-4.6', name: 'Grok 4.6' } },
        'grok-4.5': { info: { id: 'grok-4.5', name: 'Grok 4.5' } },
      },
    }));
    fs.writeFileSync(path.join(managedHome, 'models_cache.json'), JSON.stringify({
      models: {
        'grok-4.5': { info: { id: 'grok-4.5', name: 'Grok 4.5' } },
      },
    }));

    expect(readGrokNativeModelCatalog({
      env: {
        GROK_AUTH_PATH: path.join(nativeHome, 'auth.json'),
        GROK_HOME: managedHome,
      },
      managedGrokHomePath: managedHome,
    })).toEqual({
      defaultModelId: 'grok-4.6',
      models: [
        { label: 'Grok 4.6', rawId: 'grok-4.6' },
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    });
  });

  it('parses locally defined [model."..."] sections from config.toml', () => {
    expect(parseGrokConfigModelDefinitions(`
[models]
default = "grok-4.6"

[model."grok-0.7"]
model = "qwen2.5-coder-32k:7b"
base_url = "http://127.0.0.1:11434/v1"
name = "Qwen2.5 Coder 7B 32k (Ollama)"
description = "Local Ollama slot"
`)).toEqual([
      {
        description: 'Local Ollama slot',
        label: 'Qwen2.5 Coder 7B 32k (Ollama)',
        rawId: 'grok-0.7',
      },
    ]);
  });

  it('falls back to the catalog label when a local model has no name', () => {
    expect(parseGrokConfigModelDefinitions(`
[model."grok-0.7"]
model = "qwen2.5-coder-32k:7b"
`)).toEqual([{ label: 'Grok 0.7', rawId: 'grok-0.7' }]);
  });

  it('ignores scalars under [model] and malformed config.toml', () => {
    expect(parseGrokConfigModelDefinitions(`
[model]
default_timeout = 30

[model."grok-0.7"]
model = "qwen2.5-coder-32k:7b"
`)).toEqual([{ label: 'Grok 0.7', rawId: 'grok-0.7' }]);
    expect(parseGrokConfigModelDefinitions('this is not = valid toml [[[')).toEqual([]);
    expect(parseGrokConfigModelDefinitions('[models]\ndefault = "grok-4.6"\n')).toEqual([]);
  });

  it('keeps config.toml-defined local models in the native catalog the runtime reads', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-grok-local-'));
    const nativeHome = path.join(tempRoot, 'native');
    const managedHome = path.join(tempRoot, 'managed');
    fs.mkdirSync(nativeHome, { recursive: true });
    fs.mkdirSync(managedHome, { recursive: true });
    // The cloud-sourced cache only ever has the frontier models.
    fs.writeFileSync(path.join(managedHome, 'models_cache.json'), JSON.stringify({
      models: {
        'grok-4.6': { info: { id: 'grok-4.6', name: 'Grok 4.6' } },
        'grok-4.5': { info: { id: 'grok-4.5', name: 'Grok 4.5' } },
      },
    }));
    // The managed config.toml is where Grimoire writes local Ollama models.
    fs.writeFileSync(path.join(managedHome, 'config.toml'), [
      '[models]',
      'default = "grok-4.6"',
      '',
      '[model."grok-0.7"]',
      'model = "qwen2.5-coder-32k:7b"',
      'base_url = "http://127.0.0.1:11434/v1"',
      'name = "Qwen2.5 Coder 7B 32k (Ollama)"',
      '',
    ].join('\n'));

    const catalog = readGrokNativeModelCatalog({
      env: {
        GROK_AUTH_PATH: path.join(nativeHome, 'auth.json'),
        GROK_HOME: managedHome,
      },
      managedGrokHomePath: managedHome,
    });

    expect(catalog.models.map((model) => model.rawId)).toEqual(
      expect.arrayContaining(['grok-4.6', 'grok-4.5', 'grok-0.7']),
    );
    expect(catalog.models.find((model) => model.rawId === 'grok-0.7')).toEqual({
      label: 'Qwen2.5 Coder 7B 32k (Ollama)',
      rawId: 'grok-0.7',
    });
  });

  it('lets a config.toml override win over the cached entry for the same model', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-grok-override-'));
    const managedHome = path.join(tempRoot, 'managed');
    fs.mkdirSync(managedHome, { recursive: true });
    fs.writeFileSync(path.join(managedHome, 'models_cache.json'), JSON.stringify({
      models: { 'grok-4.6': { info: { id: 'grok-4.6', name: 'Grok 4.6' } } },
    }));
    // Grok resolves `[model.*]` above the prefetched cloud catalog, so an override of a
    // frontier model has to reach the picker as the user wrote it.
    fs.writeFileSync(path.join(managedHome, 'config.toml'), [
      '[model."grok-4.6"]',
      'base_url = "https://gateway.example/v1"',
      'name = "Grok 4.6 (corp gateway)"',
      '',
    ].join('\n'));

    const catalog = readGrokNativeModelCatalog({
      env: { GROK_HOME: managedHome },
      managedGrokHomePath: managedHome,
    });

    expect(catalog.models.filter((model) => model.rawId === 'grok-4.6')).toEqual([
      { label: 'Grok 4.6 (corp gateway)', rawId: 'grok-4.6' },
    ]);
  });
});
