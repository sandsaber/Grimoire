import {
  DEFAULT_QWEN_PROVIDER_SETTINGS,
  getQwenProviderSettings,
  updateQwenProviderSettings,
} from '@/providers/qwen/settings';

describe('Qwen provider settings', () => {
  it('defaults the discovery fingerprint to an empty string and ignores a non-string', () => {
    expect(getQwenProviderSettings({}).discoveredModelsFingerprint).toBe('');
    expect(getQwenProviderSettings({
      providerConfigs: { qwen: { discoveredModelsFingerprint: 42 } },
    }).discoveredModelsFingerprint).toBe('');
  });

  it('round-trips the discovery fingerprint and keeps it across unrelated updates', () => {
    const settings: Record<string, unknown> = {};
    updateQwenProviderSettings(settings, { discoveredModelsFingerprint: 'abc12345' });

    expect((settings as any).providerConfigs.qwen.discoveredModelsFingerprint).toBe('abc12345');

    updateQwenProviderSettings(settings, { environmentHash: 'API_KEY=new' });

    expect(getQwenProviderSettings(settings).discoveredModelsFingerprint).toBe('abc12345');
  });

  it('is disabled by default and falls back to qwen from PATH', () => {
    const settings = getQwenProviderSettings({});

    expect(settings.enabled).toBe(false);
    expect(settings.cliPath).toBe('');
    expect(settings.cliPathsByHost).toEqual({});
    expect(settings.environmentVariables).toBe('');
    expect(settings.visibleModels).toEqual([]);
    expect(settings.modelAliases).toEqual({});
    expect(settings.discoveredModels).toEqual([]);
    expect(settings.availableModes).toEqual([]);
    expect(settings.effortLevel).toBe('high');
    expect(DEFAULT_QWEN_PROVIDER_SETTINGS.enabled).toBe(false);
  });

  it('round-trips provider settings through providerConfigs.qwen', () => {
    const root: Record<string, unknown> = {};
    const next = updateQwenProviderSettings(root, {
      cliPath: '/usr/local/bin/qwen',
      enabled: true,
      environmentVariables: 'DASHSCOPE_API_KEY=test',
      modelAliases: { 'provider/model-a': 'Qwen route A' },
      visibleModels: ['provider/model-a'],
    });

    expect(next.enabled).toBe(true);
    expect(getQwenProviderSettings(root).cliPath).toBe('');
    expect(getQwenProviderSettings(root).cliPathsByHost).toEqual(expect.any(Object));
    expect(Object.values(getQwenProviderSettings(root).cliPathsByHost)).toContain('/usr/local/bin/qwen');
    expect(getQwenProviderSettings(root).environmentVariables).toBe('DASHSCOPE_API_KEY=test');
    expect(getQwenProviderSettings(root).visibleModels).toEqual(['provider/model-a']);
    expect(getQwenProviderSettings(root).modelAliases).toEqual({ 'provider/model-a': 'Qwen route A' });
  });

  it('normalizes visible models and prunes aliases for hidden models', () => {
    const root: Record<string, unknown> = {};

    updateQwenProviderSettings(root, {
      modelAliases: {
        'qwen-2.5-flash': 'Flash',
        'qwen-2.5-pro': 'Pro',
      },
      visibleModels: ['qwen-2.5-pro', 'qwen-2.5-pro', '', '  qwen-2.5-flash  '],
    });

    expect(getQwenProviderSettings(root).visibleModels).toEqual([
      'qwen-2.5-pro',
      'qwen-2.5-flash',
    ]);
    expect(getQwenProviderSettings(root).modelAliases).toEqual({
      'qwen-2.5-flash': 'Flash',
      'qwen-2.5-pro': 'Pro',
    });

    updateQwenProviderSettings(root, {
      visibleModels: ['qwen-2.5-pro'],
    });

    expect(getQwenProviderSettings(root).modelAliases).toEqual({
      'qwen-2.5-pro': 'Pro',
    });
  });

  it('persists only Qwen native reasoning effort tiers', () => {
    const root: Record<string, unknown> = {};

    updateQwenProviderSettings(root, { effortLevel: 'xhigh' });
    expect(getQwenProviderSettings(root).effortLevel).toBe('xhigh');

    root.providerConfigs = { qwen: { effortLevel: 'unsupported' } };
    expect(getQwenProviderSettings(root).effortLevel).toBe('high');
  });
});
