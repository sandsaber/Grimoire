import {
  DEFAULT_DEVIN_PROVIDER_SETTINGS,
  getDevinProviderSettings,
  updateDevinProviderSettings,
} from '@/providers/devin/settings';

describe('Devin provider settings', () => {
  it('defaults the discovery fingerprint to an empty string and ignores a non-string', () => {
    expect(getDevinProviderSettings({}).discoveredModelsFingerprint).toBe('');
    expect(getDevinProviderSettings({
      providerConfigs: { devin: { discoveredModelsFingerprint: 42 } },
    }).discoveredModelsFingerprint).toBe('');
  });

  it('round-trips the discovery fingerprint and keeps it across unrelated updates', () => {
    const settings: Record<string, unknown> = {};
    updateDevinProviderSettings(settings, { discoveredModelsFingerprint: 'abc12345' });

    expect((settings as any).providerConfigs.devin.discoveredModelsFingerprint).toBe('abc12345');

    updateDevinProviderSettings(settings, { environmentHash: 'DEVIN_MODEL=opus' });

    expect(getDevinProviderSettings(settings).discoveredModelsFingerprint).toBe('abc12345');
  });

  it('is disabled by default and falls back to devin from PATH', () => {
    const settings = getDevinProviderSettings({});

    expect(settings.enabled).toBe(false);
    expect(settings.cliPath).toBe('');
    expect(settings.cliPathsByHost).toEqual({});
    expect(settings.environmentVariables).toBe('');
    expect(settings.visibleModels).toEqual([]);
    expect(settings.modelAliases).toEqual({});
    expect(settings.discoveredModels).toEqual([]);
    expect(settings.availableModes).toEqual([]);
    expect(DEFAULT_DEVIN_PROVIDER_SETTINGS.enabled).toBe(false);
  });

  it('round-trips provider settings through providerConfigs.devin', () => {
    const root: Record<string, unknown> = {};
    const next = updateDevinProviderSettings(root, {
      cliPath: '/usr/local/bin/devin',
      enabled: true,
      environmentVariables: 'DEVIN_MODEL=opus',
      modelAliases: { 'swe-1-6-slow': 'SWE slow' },
      visibleModels: ['swe-1-6-slow'],
    });

    expect(next.enabled).toBe(true);
    expect(getDevinProviderSettings(root).cliPath).toBe('');
    expect(Object.values(getDevinProviderSettings(root).cliPathsByHost)).toContain('/usr/local/bin/devin');
    expect(getDevinProviderSettings(root).environmentVariables).toBe('DEVIN_MODEL=opus');
    expect(getDevinProviderSettings(root).visibleModels).toEqual(['swe-1-6-slow']);
    expect(getDevinProviderSettings(root).modelAliases).toEqual({ 'swe-1-6-slow': 'SWE slow' });
  });

  it('normalizes visible models and prunes aliases for hidden models', () => {
    const root: Record<string, unknown> = {};

    updateDevinProviderSettings(root, {
      modelAliases: {
        'claude-opus-5-medium': 'Opus',
        'swe-1-6-slow': 'SWE',
      },
      visibleModels: ['swe-1-6-slow', 'swe-1-6-slow', '', '  claude-opus-5-medium  '],
    });

    expect(getDevinProviderSettings(root).visibleModels).toEqual([
      'swe-1-6-slow',
      'claude-opus-5-medium',
    ]);
    expect(getDevinProviderSettings(root).modelAliases).toEqual({
      'claude-opus-5-medium': 'Opus',
      'swe-1-6-slow': 'SWE',
    });

    updateDevinProviderSettings(root, {
      visibleModels: ['swe-1-6-slow'],
    });

    expect(getDevinProviderSettings(root).modelAliases).toEqual({
      'swe-1-6-slow': 'SWE',
    });
  });
});
