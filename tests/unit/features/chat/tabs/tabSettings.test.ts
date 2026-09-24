import '@/providers';

import {
  createDraftSettingsSnapshot,
  mergeDraftSettingsSnapshot,
} from '@/features/chat/tabs/tabSettings';
import { getMimocodeProviderSettings } from '@/providers/mimocode/settings';
import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

describe('draft settings', () => {
  it.each([
    { model: 'opus', effortLevel: 'low', permissionMode: 'normal' },
    { permissionMode: 'normal' },
  ])('keeps turn options instead of resetting them to model defaults: %j', (draft) => {
    const base = {
      model: 'sonnet', effortLevel: 'low', thinkingBudget: 'off', serviceTier: 'default',
      permissionMode: 'full_access', providerConfigs: { claude: { enabled: true } },
    };
    const merged = mergeDraftSettingsSnapshot(base, draft, 'claude');

    expect(merged).toMatchObject({
      model: draft.model ?? 'sonnet', effortLevel: 'low', permissionMode: 'normal',
    });
    expect(base.permissionMode).toBe('full_access');
  });

  it.each(['opencode', 'mimocode'] as const)(
    'preserves %s turn options while reading refreshed provider settings',
    (providerId) => {
      const model = `${providerId}:openai/gpt-5`;
      const discoveredModels = [
        { rawId: 'openai/gpt-5', label: 'GPT-5' },
        { rawId: 'openai/gpt-5/high', label: 'GPT-5 (high)' },
        { rawId: 'openai/gpt-6', label: 'GPT-6' },
      ];
      const base = {
        model, effortLevel: 'default', thinkingBudget: 'off', serviceTier: 'default',
        permissionMode: 'full_access',
        providerConfigs: {
          [providerId]: {
            enabled: true,
            discoveredModels,
            selectedMode: 'grimoire-full-access',
            environmentVariables: 'TEST_CONFIG=new',
            preferredThinkingByModel: {},
          },
        },
      };
      const draft = {
        model, effortLevel: 'high', permissionMode: 'normal',
        providerConfigs: {
          [providerId]: { discoveredModels: [], environmentVariables: 'TEST_CONFIG=old' },
        },
      };

      const merged = mergeDraftSettingsSnapshot(base, draft, providerId);
      const config = providerId === 'opencode'
        ? getOpencodeProviderSettings(merged)
        : getMimocodeProviderSettings(merged);

      expect(config.discoveredModels).toEqual(discoveredModels);
      expect(config.environmentVariables).toBe('TEST_CONFIG=new');
      expect(config.selectedMode).toBe('grimoire-safe');
      expect(config.preferredThinkingByModel).toEqual({ 'openai/gpt-5': 'high' });
      expect(base.providerConfigs[providerId].selectedMode).toBe('grimoire-full-access');
      expect(base.providerConfigs[providerId].preferredThinkingByModel).toEqual({});
      expect(createDraftSettingsSnapshot(merged)).toEqual({
        model, effortLevel: 'high', thinkingBudget: 'off', serviceTier: 'default',
        permissionMode: 'normal',
      });
    },
  );
});
