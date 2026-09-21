import {
  DEFAULT_REASONIX_PROVIDER_SETTINGS,
  getReasonixProviderSettings,
  updateReasonixProviderSettings,
} from '@/providers/reasonix/settings';

describe('Reasonix provider settings', () => {
  it('requires explicit image opt-in and preserves it across settings updates', () => {
    const settings: Record<string, unknown> = {};
    expect(getReasonixProviderSettings(settings).imageAttachmentsAsFiles).toBe(false);
    expect(getReasonixProviderSettings({ providerConfigs: { reasonix: { imageAttachmentsAsFiles: 'true' } } }).imageAttachmentsAsFiles).toBe(false);
    updateReasonixProviderSettings(settings, { imageAttachmentsAsFiles: true });
    updateReasonixProviderSettings(settings, { enabled: true });
    expect(getReasonixProviderSettings(settings).imageAttachmentsAsFiles).toBe(true);
  });

  it('defaults the discovery fingerprint to an empty string and ignores a non-string', () => {
    expect(getReasonixProviderSettings({}).discoveredModelsFingerprint).toBe('');
    expect(getReasonixProviderSettings({
      providerConfigs: { reasonix: { discoveredModelsFingerprint: 42 } },
    }).discoveredModelsFingerprint).toBe('');
  });

  it('round-trips the discovery fingerprint and keeps it across unrelated updates', () => {
    const settings: Record<string, unknown> = {};
    updateReasonixProviderSettings(settings, { discoveredModelsFingerprint: 'abc12345' });

    expect((settings as any).providerConfigs.reasonix.discoveredModelsFingerprint).toBe('abc12345');

    updateReasonixProviderSettings(settings, { environmentHash: 'REASONIX_MODEL=opus' });

    expect(getReasonixProviderSettings(settings).discoveredModelsFingerprint).toBe('abc12345');
  });

  it('is disabled by default and falls back to reasonix from PATH', () => {
    const settings = getReasonixProviderSettings({});

    expect(settings.enabled).toBe(false);
    expect(settings.cliPath).toBe('');
    expect(settings.cliPathsByHost).toEqual({});
    expect(settings.environmentVariables).toBe('');
    expect(settings.visibleModels).toEqual([]);
    expect(settings.modelAliases).toEqual({});
    expect(settings.discoveredModels).toEqual([]);
    expect(settings.availableModes).toEqual([]);
    expect(DEFAULT_REASONIX_PROVIDER_SETTINGS.enabled).toBe(false);
  });

  it('round-trips provider settings through providerConfigs.reasonix', () => {
    const root: Record<string, unknown> = {};
    const next = updateReasonixProviderSettings(root, {
      cliPath: '/usr/local/bin/reasonix',
      enabled: true,
      environmentVariables: 'REASONIX_MODEL=opus',
      modelAliases: { 'swe-1-6-slow': 'SWE slow' },
      visibleModels: ['swe-1-6-slow'],
    });

    expect(next.enabled).toBe(true);
    expect(getReasonixProviderSettings(root).cliPath).toBe('');
    expect(Object.values(getReasonixProviderSettings(root).cliPathsByHost)).toContain('/usr/local/bin/reasonix');
    expect(getReasonixProviderSettings(root).environmentVariables).toBe('REASONIX_MODEL=opus');
    expect(getReasonixProviderSettings(root).visibleModels).toEqual(['swe-1-6-slow']);
    expect(getReasonixProviderSettings(root).modelAliases).toEqual({ 'swe-1-6-slow': 'SWE slow' });
  });

  it('normalizes visible models and prunes aliases for hidden models', () => {
    const root: Record<string, unknown> = {};

    updateReasonixProviderSettings(root, {
      modelAliases: {
        'claude-opus-5-medium': 'Opus',
        'swe-1-6-slow': 'SWE',
      },
      visibleModels: ['swe-1-6-slow', 'swe-1-6-slow', '', '  claude-opus-5-medium  '],
    });

    expect(getReasonixProviderSettings(root).visibleModels).toEqual([
      'swe-1-6-slow',
      'claude-opus-5-medium',
    ]);
    expect(getReasonixProviderSettings(root).modelAliases).toEqual({
      'claude-opus-5-medium': 'Opus',
      'swe-1-6-slow': 'SWE',
    });

    updateReasonixProviderSettings(root, {
      visibleModels: ['swe-1-6-slow'],
    });

    expect(getReasonixProviderSettings(root).modelAliases).toEqual({
      'swe-1-6-slow': 'SWE',
    });
  });
});
