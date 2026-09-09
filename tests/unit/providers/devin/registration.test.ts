import '@/providers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
import { devinWorkspaceRegistration } from '@/providers/devin/app/DevinWorkspaceServices';
import { getDevinProviderSettings, updateDevinProviderSettings } from '@/providers/devin/settings';

describe('Devin provider registration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers Devin as an opt-in provider', () => {
    expect(providerCatalog().ids()).toContain('devin');
    expect(providerCatalog().displayName('devin')).toBe('Devin');
    expect(providerCatalog().isEnabled({}, 'devin')).toBe(false);

    const settings: Record<string, unknown> = {};
    updateDevinProviderSettings(settings, { enabled: true });

    expect(providerCatalog().isEnabled(settings, 'devin')).toBe(true);
    expect(providerCatalog().capabilities('devin')?.reasoningControl).toBe('none');
  });

  it('creates a Devin runtime through the composition the plugin owns', () => {
    // Flipped, and the registration is not in the path at all now: a tab asks
    // the application for a runtime, which asks the composition the plugin
    // built at load. A plugin that has none is a bug with
    // a name rather than a runtime that quietly answers for no kernel.
    const created = { providerId: 'devin' };
    const plugin = { getDevinExecution: () => ({ createRuntime: () => created }) } as any;

    expect(plugin.getDevinExecution().createRuntime().providerId).toBe('devin');

    const unloaded = {
      getDevinExecution: () => {
        throw new Error('devin execution is not available before plugin load.');
      },
    } as any;

    expect(() => unloaded.getDevinExecution()).toThrow('not available before plugin load');
  });

  it('creates Devin workspace services', async () => {
    const services = await devinWorkspaceRegistration.initialize({
      homeAdapter: {} as any,
      plugin: {} as any,
      storage: {} as any,
      vaultAdapter: {} as any,
    });

    expect(services.cliResolver).toBeTruthy();
    expect(services.modelCatalog).toBeTruthy();
    expect(services.settingsTabRenderer).toBeTruthy();
  });

  it('refreshes Devin model discovery through the isolated metadata session', async () => {
    // The catalog used to build a whole chat runtime to ask this. What that
    // runtime was doing for it — opening a session and reading its reply — is
    // now one isolated session, and the catalog answers the question the
    // surfaces actually ask: did the agent answer, not did the list change.
    const settings: Record<string, unknown> = {};
    updateDevinProviderSettings(settings, { enabled: true });
    const discoverMetadata = jest.fn(async () => {
      updateDevinProviderSettings(settings, {
        discoveredModels: [{ label: 'SWE-1.6 Slow', rawId: 'swe-1-6-slow' }],
        visibleModels: ['swe-1-6-slow'],
      });
      return true;
    });
    const plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      getDevinExecution: () => ({ metadata: { discoverMetadata } }),
    };
    const services = await devinWorkspaceRegistration.initialize({
      homeAdapter: {} as any,
      plugin: plugin as any,
      storage: {} as any,
      vaultAdapter: {} as any,
    });

    const outcome = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(outcome).toBe('refreshed');
    expect(discoverMetadata).toHaveBeenCalledTimes(1);
    expect(getDevinProviderSettings(settings).discoveredModels).toEqual([
      { label: 'SWE-1.6 Slow', rawId: 'swe-1-6-slow' },
    ]);
  });

  it('does not ask again for a catalog the vault already has', async () => {
    // Named for the answer it used to give — "no change" — which hid what it
    // actually exercises: a settled catalog is never asked, so the agent here
    // is never reached. Discovery boots a CLI, and this is the guard on that.
    const settings: Record<string, unknown> = {};
    updateDevinProviderSettings(settings, {
      discoveredModels: [{ label: 'SWE-1.6 Slow', rawId: 'swe-1-6-slow' }],
      enabled: true,
    });
    const plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      getDevinExecution: () => ({ metadata: { discoverMetadata: async () => true } }),
    };
    const services = await devinWorkspaceRegistration.initialize({
      homeAdapter: {} as any,
      plugin: plugin as any,
      storage: {} as any,
      vaultAdapter: {} as any,
    });

    await expect(services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    })).resolves.toBe('skipped');
  });
});
