import {
  DEFAULT_GEMINI_PROVIDER_SETTINGS,
  getGeminiProviderSettings,
  updateGeminiProviderSettings,
} from '@/providers/gemini/settings';

describe('Gemini provider settings', () => {
  it('defaults the discovery fingerprint to an empty string and ignores a non-string', () => {
    expect(getGeminiProviderSettings({}).discoveredModelsFingerprint).toBe('');
    expect(getGeminiProviderSettings({
      providerConfigs: { gemini: { discoveredModelsFingerprint: 42 } },
    }).discoveredModelsFingerprint).toBe('');
  });

  it('round-trips the discovery fingerprint and keeps it across unrelated updates', () => {
    const settings: Record<string, unknown> = {};
    updateGeminiProviderSettings(settings, { discoveredModelsFingerprint: 'abc12345' });

    expect((settings as any).providerConfigs.gemini.discoveredModelsFingerprint).toBe('abc12345');

    updateGeminiProviderSettings(settings, { environmentHash: 'API_KEY=new' });

    expect(getGeminiProviderSettings(settings).discoveredModelsFingerprint).toBe('abc12345');
  });

  it('is disabled by default and falls back to gemini from PATH', () => {
    const settings = getGeminiProviderSettings({});

    expect(settings.enabled).toBe(false);
    expect(settings.cliPath).toBe('');
    expect(settings.cliPathsByHost).toEqual({});
    expect(settings.environmentVariables).toBe('');
    expect(settings.visibleModels).toEqual([]);
    expect(settings.modelAliases).toEqual({});
    expect(settings.discoveredModels).toEqual([]);
    expect(settings.availableModes).toEqual([]);
    expect(DEFAULT_GEMINI_PROVIDER_SETTINGS.enabled).toBe(false);
  });

  it('round-trips provider settings through providerConfigs.gemini', () => {
    const root: Record<string, unknown> = {};
    const next = updateGeminiProviderSettings(root, {
      cliPath: '/usr/local/bin/gemini',
      enabled: true,
      environmentVariables: 'GEMINI_API_KEY=test',
      modelAliases: { 'gemini-2.5-pro': 'Gemini Pro' },
      visibleModels: ['gemini-2.5-pro'],
    });

    expect(next.enabled).toBe(true);
    expect(getGeminiProviderSettings(root).cliPath).toBe('');
    expect(getGeminiProviderSettings(root).cliPathsByHost).toEqual(expect.any(Object));
    expect(Object.values(getGeminiProviderSettings(root).cliPathsByHost)).toContain('/usr/local/bin/gemini');
    expect(getGeminiProviderSettings(root).environmentVariables).toBe('GEMINI_API_KEY=test');
    expect(getGeminiProviderSettings(root).visibleModels).toEqual(['gemini-2.5-pro']);
    expect(getGeminiProviderSettings(root).modelAliases).toEqual({ 'gemini-2.5-pro': 'Gemini Pro' });
  });

  it('normalizes visible models and prunes aliases for hidden models', () => {
    const root: Record<string, unknown> = {};

    updateGeminiProviderSettings(root, {
      modelAliases: {
        'gemini-2.5-flash': 'Flash',
        'gemini-2.5-pro': 'Pro',
      },
      visibleModels: ['gemini-2.5-pro', 'gemini-2.5-pro', '', '  gemini-2.5-flash  '],
    });

    expect(getGeminiProviderSettings(root).visibleModels).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ]);
    expect(getGeminiProviderSettings(root).modelAliases).toEqual({
      'gemini-2.5-flash': 'Flash',
      'gemini-2.5-pro': 'Pro',
    });

    updateGeminiProviderSettings(root, {
      visibleModels: ['gemini-2.5-pro'],
    });

    expect(getGeminiProviderSettings(root).modelAliases).toEqual({
      'gemini-2.5-pro': 'Pro',
    });
  });
});
