import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { geminiWorkspaceRegistration } from '@/providers/gemini/app/GeminiWorkspaceServices';
import { getGeminiProviderSettings, updateGeminiProviderSettings } from '@/providers/gemini/settings';

describe('Gemini provider registration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers Gemini as an opt-in provider', () => {
    expect(ProviderRegistry.getRegisteredProviderIds()).toContain('gemini');
    expect(ProviderRegistry.getProviderDisplayName('gemini')).toBe('Gemini CLI (Legacy)');
    expect(ProviderRegistry.isEnabled('gemini', {})).toBe(false);

    const settings: Record<string, unknown> = {};
    updateGeminiProviderSettings(settings, { enabled: true });

    expect(ProviderRegistry.isEnabled('gemini', settings)).toBe(true);
  });

  it('creates a Gemini runtime through the composition the plugin owns', () => {
    // Flipped: the registry no longer constructs a runtime, it asks the
    // execution the plugin built at load. A plugin that has none is a bug with
    // a name rather than a runtime that quietly answers for no kernel.
    const created = { providerId: 'gemini' };
    const runtime = ProviderRegistry.createChatRuntime({
      plugin: { getGeminiExecution: () => ({ createRuntime: () => created }) } as any,
      providerId: 'gemini',
    });

    expect(runtime.providerId).toBe('gemini');
    expect(() => ProviderRegistry.createChatRuntime({
      plugin: {
        getGeminiExecution: () => {
          throw new Error('Gemini execution is not available before plugin load.');
        },
      } as any,
      providerId: 'gemini',
    })).toThrow('not available before plugin load');
  });

  it('creates Gemini workspace services', async () => {
    const services = await geminiWorkspaceRegistration.initialize({
      homeAdapter: {} as any,
      plugin: {} as any,
      storage: {} as any,
      vaultAdapter: {} as any,
    });

    expect(services.cliResolver).toBeTruthy();
    expect(services.modelCatalog).toBeTruthy();
    expect(services.settingsTabRenderer).toBeTruthy();
  });

  it('refreshes Gemini model discovery through the isolated metadata session', async () => {
    // The catalog used to build a whole chat runtime to ask this. What that
    // runtime was doing for it — opening a session and reading its reply — is
    // now one isolated session, and the catalog's answer is still the narrower
    // question it always asked: did the *model list* change.
    const settings: Record<string, unknown> = {};
    updateGeminiProviderSettings(settings, { enabled: true });
    const discoverMetadata = jest.fn(async () => {
      updateGeminiProviderSettings(settings, {
        discoveredModels: [{ label: 'Gemini 3 Pro', rawId: 'gemini-3-pro' }],
        visibleModels: ['gemini-3-pro'],
      });
      return true;
    });
    const plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      getGeminiExecution: () => ({ metadata: { discoverMetadata } }),
    };
    const services = await geminiWorkspaceRegistration.initialize({
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
    expect(getGeminiProviderSettings(settings).discoveredModels).toEqual([
      { label: 'Gemini 3 Pro', rawId: 'gemini-3-pro' },
    ]);
  });

  it('reports no change when the session named the models the vault already had', async () => {
    const settings: Record<string, unknown> = {};
    updateGeminiProviderSettings(settings, {
      discoveredModels: [{ label: 'Gemini 3 Pro', rawId: 'gemini-3-pro' }],
      enabled: true,
    });
    const plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      getGeminiExecution: () => ({ metadata: { discoverMetadata: async () => true } }),
    };
    const services = await geminiWorkspaceRegistration.initialize({
      homeAdapter: {} as any,
      plugin: plugin as any,
      storage: {} as any,
      vaultAdapter: {} as any,
    });

    // The session may report a mode or a current model that changed while the
    // catalogue did not; the surface this feeds is the model list.
    await expect(services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    })).resolves.toBe(false);
  });
});
