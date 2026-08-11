import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createApplicationServices } from '@/app/ApplicationServices';
import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';
import type GrimoirePlugin from '@/main';

function acceptsGrimoirePlugin(plugin: GrimoirePlugin): LegacyProviderContext {
  return createApplicationServices(plugin);
}

describe('LegacyProviderContext', () => {
  it('keeps core provider sources independent of the plugin entry point', () => {
    const providersDirectory = resolve(process.cwd(), 'src/core/providers');
    const providerSources = [
      'LegacyProviderContext.ts',
      'ProviderRegistry.ts',
      'ProviderWorkspaceRegistry.ts',
      'types.ts',
    ];

    for (const source of providerSources) {
      expect(readFileSync(resolve(providersDirectory, source), 'utf8')).not.toMatch(
        /from ['"][.]+\/main['"]|GrimoirePlugin/,
      );
    }
  });

  it('accepts the existing plugin-shaped host without wrapping it', () => {
    const plugin = {
      app: {} as LegacyProviderContext['app'],
      manifest: {} as LegacyProviderContext['manifest'],
      settings: {} as LegacyProviderContext['settings'],
      storage: {} as LegacyProviderContext['storage'],
      loadData: async () => ({}),
      saveData: async () => {},
      saveSettings: async () => {},
      getEnvironmentVariablesForScope: () => '',
      applyEnvironmentVariables: async () => {},
      applyEnvironmentVariablesBatch: async () => {},
      getActiveEnvironmentVariables: () => '',
      getResolvedProviderCliPath: () => null,
      getAllViews: () => [],
      getView: () => null,
    } satisfies LegacyProviderContext;

    expect(createApplicationServices(plugin)).toBe(plugin);
    expect(acceptsGrimoirePlugin).toBeDefined();
  });
});
