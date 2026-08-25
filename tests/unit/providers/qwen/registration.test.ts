import '@/providers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { qwenWorkspaceRegistration } from '@/providers/qwen/app/QwenWorkspaceServices';
import { getQwenProviderSettings, updateQwenProviderSettings } from '@/providers/qwen/settings';

describe('Qwen provider registration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers Qwen as an opt-in provider', () => {
    expect(providerCatalog().ids()).toContain('qwen');
    expect(providerCatalog().displayName('qwen')).toBe('Qwen Code');
    expect(providerCatalog().isEnabled({}, 'qwen')).toBe(false);

    const settings: Record<string, unknown> = {};
    updateQwenProviderSettings(settings, { enabled: true });

    expect(providerCatalog().isEnabled(settings, 'qwen')).toBe(true);
    expect(ProviderRegistry.getCapabilities('qwen')?.reasoningControl).toBe('effort');
  });

  it('creates a Qwen runtime through the composition the plugin owns', () => {
    // Flipped: the registry no longer constructs a runtime, it asks the
    // execution the plugin built at load. A plugin that has none is a bug with
    // a name rather than a runtime that quietly answers for no kernel.
    const created = { providerId: 'qwen' };
    const runtime = ProviderRegistry.createChatRuntime({
      plugin: { getQwenExecution: () => ({ createRuntime: () => created }) } as any,
      providerId: 'qwen',
    });

    expect(runtime.providerId).toBe('qwen');
    expect(() => ProviderRegistry.createChatRuntime({
      plugin: {
        getQwenExecution: () => {
          throw new Error('Qwen execution is not available before plugin load.');
        },
      } as any,
      providerId: 'qwen',
    })).toThrow('not available before plugin load');
  });

  it('creates Qwen workspace services', async () => {
    const services = await qwenWorkspaceRegistration.initialize({
      homeAdapter: {} as any,
      plugin: {} as any,
      storage: {} as any,
      vaultAdapter: {} as any,
    });

    expect(services.cliResolver).toBeTruthy();
    expect(services.modelCatalog).toBeTruthy();
    expect(services.settingsTabRenderer).toBeTruthy();
  });

  it('refreshes Qwen model discovery through the isolated metadata session', async () => {
    // The catalog used to build a whole chat runtime to ask this. What that
    // runtime was doing for it — opening a session and reading its reply — is
    // now one isolated session, and the catalog's answer is still the narrower
    // question it always asked: did the *model list* change.
    const settings: Record<string, unknown> = {};
    updateQwenProviderSettings(settings, { enabled: true });
    const discoverMetadata = jest.fn(async () => {
      updateQwenProviderSettings(settings, {
        discoveredModels: [{ label: 'Qwen 3 Pro', rawId: 'qwen-3-pro' }],
        visibleModels: ['qwen-3-pro'],
      });
      return true;
    });
    const plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      getQwenExecution: () => ({ metadata: { discoverMetadata } }),
    };
    const services = await qwenWorkspaceRegistration.initialize({
      homeAdapter: {} as any,
      plugin: plugin as any,
      storage: {} as any,
      vaultAdapter: {} as any,
    });

    const changed = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(true);
    expect(discoverMetadata).toHaveBeenCalledTimes(1);
    expect(getQwenProviderSettings(settings).discoveredModels).toEqual([
      { label: 'Qwen 3 Pro', rawId: 'qwen-3-pro' },
    ]);
  });

  it('reports no change when the session named the models the vault already had', async () => {
    const settings: Record<string, unknown> = {};
    updateQwenProviderSettings(settings, {
      discoveredModels: [{ label: 'Qwen 3 Pro', rawId: 'qwen-3-pro' }],
      enabled: true,
    });
    const plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      getQwenExecution: () => ({ metadata: { discoverMetadata: async () => true } }),
    };
    const services = await qwenWorkspaceRegistration.initialize({
      homeAdapter: {} as any,
      plugin: plugin as any,
      storage: {} as any,
      vaultAdapter: {} as any,
    });

    await expect(services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    })).resolves.toBe(false);
  });
});
