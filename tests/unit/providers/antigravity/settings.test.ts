import {
  DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from '@/providers/antigravity/settings';

describe('Antigravity provider settings', () => {
  it('is disabled by default and falls back to agy from PATH', () => {
    const settings = getAntigravityProviderSettings({});

    expect(settings.enabled).toBe(false);
    expect(settings.cliPath).toBe('');
    expect(settings.cliPathsByHost).toEqual({});
    expect(settings.customModels).toBe('');
    expect(settings.environmentVariables).toBe('');
    expect(settings.visibleModels).toEqual([]);
    expect(settings.modelAliases).toEqual({});
    expect(settings.discoveredModels).toEqual([]);
    expect(DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.enabled).toBe(false);
  });

  it('round-trips provider settings through providerConfigs.antigravity', () => {
    const root: Record<string, unknown> = {};
    const next = updateAntigravityProviderSettings(root, {
      cliPath: '/usr/local/bin/agy',
      customModels: 'Claude Opus 4.6 (Thinking)\ncustom-antigravity-model',
      enabled: true,
      environmentVariables: 'GOOGLE_CLOUD_PROJECT=test',
      modelAliases: { 'Claude Sonnet 4.6 (Thinking)': 'Sonnet Thinking' },
      visibleModels: ['Claude Sonnet 4.6 (Thinking)'],
    });

    expect(next.enabled).toBe(true);
    expect(getAntigravityProviderSettings(root).cliPath).toBe('');
    expect(Object.values(getAntigravityProviderSettings(root).cliPathsByHost)).toContain('/usr/local/bin/agy');
    expect(getAntigravityProviderSettings(root).environmentVariables).toBe('GOOGLE_CLOUD_PROJECT=test');
    expect(getAntigravityProviderSettings(root).customModels).toBe(
      'Claude Opus 4.6 (Thinking)\ncustom-antigravity-model',
    );
    expect(getAntigravityProviderSettings(root).visibleModels).toEqual(['Claude Sonnet 4.6 (Thinking)']);
    expect(getAntigravityProviderSettings(root).modelAliases).toEqual({
      'Claude Sonnet 4.6 (Thinking)': 'Sonnet Thinking',
    });
  });

  it('repairs tab-separated model values persisted by older discovery code', () => {
    const root: Record<string, unknown> = {};
    updateAntigravityProviderSettings(root, {
      discoveredModels: [
        {
          label: 'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
          rawId: 'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
        },
        {
          label: 'Gemini 3.6 Flash (High)',
          rawId: 'Gemini 3.6 Flash (High)',
        },
      ],
      modelAliases: {
        'gemini-3.6-flash-high\tGemini 3.6 Flash (High)': 'Flash High',
      },
      visibleModels: [
        'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
        'Gemini 3.6 Flash (High)',
      ],
    });

    expect(getAntigravityProviderSettings(root)).toEqual(expect.objectContaining({
      discoveredModels: [
        {
          label: 'Gemini 3.6 Flash (High)',
          rawId: 'Gemini 3.6 Flash (High)',
        },
      ],
      modelAliases: {
        'Gemini 3.6 Flash (High)': 'Flash High',
      },
      visibleModels: ['Gemini 3.6 Flash (High)'],
    }));
  });
});
