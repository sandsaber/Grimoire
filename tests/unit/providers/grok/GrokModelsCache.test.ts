import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  expandGrokVisibleModelsWithFrontier,
  parseGrokConfigDefaultModel,
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
});
