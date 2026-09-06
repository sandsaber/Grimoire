import '@/providers';

import { updateCodexModelDiscoveryState } from '@/providers/codex/modelDiscoveryState';
import { CODEX_SPARK_MODEL, DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';

describe('CodexChatUIConfig', () => {
  describe('getModelOptions', () => {
    it('should return default models when no env vars', () => {
      const options = codexChatUIConfig.getModelOptions({});
      expect(options.map(o => o.value)).toEqual([
        DEFAULT_CODEX_PRIMARY_MODEL,
        'gpt-5.4',
        'gpt-5.4-mini',
        CODEX_SPARK_MODEL,
      ]);
    });

    it('appends settings-defined custom models after the built-in options', () => {
      const options = codexChatUIConfig.getModelOptions({
        providerConfigs: {
          codex: {
            customModels: 'gpt-5.6-preview\nmy-custom-model\nmy-custom-model',
          },
        },
      });

      expect(options).toEqual([
        {
          value: DEFAULT_CODEX_PRIMARY_MODEL,
          label: 'GPT-5.5',
          description: 'Latest',
        },
        {
          value: 'gpt-5.4',
          label: 'GPT-5.4',
          description: 'Strong',
        },
        {
          value: 'gpt-5.4-mini',
          label: 'GPT-5.4 Mini',
          description: 'Fast',
        },
        {
          value: CODEX_SPARK_MODEL,
          label: 'GPT-5.3 Codex Spark',
          description: 'Ultra-fast',
        },
        {
          value: 'gpt-5.6-preview',
          label: 'GPT-5.6 Preview',
          description: 'Custom model',
        },
        {
          value: 'my-custom-model',
          label: 'my-custom-model',
          description: 'Custom model',
        },
      ]);
    });

    it('should prepend custom model from OPENAI_MODEL env var', () => {
      const options = codexChatUIConfig.getModelOptions({
        environmentVariables: 'OPENAI_MODEL=my-custom-model',
      });
      expect(options[0].value).toBe('my-custom-model');
      expect(options[0].description).toBe('Custom (env)');
      expect(options.length).toBe(5);
    });

    it('deduplicates env and settings-defined custom models', () => {
      const options = codexChatUIConfig.getModelOptions({
        providerConfigs: {
          codex: {
            customModels: 'my-custom-model\nsecond-custom-model',
            environmentVariables: 'OPENAI_MODEL=my-custom-model',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'my-custom-model',
        DEFAULT_CODEX_PRIMARY_MODEL,
        'gpt-5.4',
        'gpt-5.4-mini',
        CODEX_SPARK_MODEL,
        'second-custom-model',
      ]);
    });

    it('should not duplicate when OPENAI_MODEL matches a default model', () => {
      const options = codexChatUIConfig.getModelOptions({
        environmentVariables: `OPENAI_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}`,
      });
      expect(options.length).toBe(4);
    });

    it('uses runtime-discovered Codex models before the static fallback list', () => {
      const settings: Record<string, unknown> = {};
      updateCodexModelDiscoveryState(settings, {
        discoveredModels: [
          {
            id: 'gpt-5.5',
            label: 'GPT-5.5',
            description: 'Frontier model for complex coding.',
            isDefault: true,
          },
          {
            id: 'gpt-5.4',
            label: 'gpt-5.4',
            description: 'Strong model for everyday coding.',
          },
          {
            id: 'gpt-5.4-mini',
            label: 'GPT-5.4-Mini',
            description: 'Small and fast.',
          },
        ],
      });

      expect(codexChatUIConfig.getModelOptions(settings)).toEqual([
        {
          value: 'gpt-5.5',
          label: 'GPT-5.5',
          description: 'Frontier model for complex coding.',
        },
        {
          value: 'gpt-5.4',
          label: 'gpt-5.4',
          description: 'Strong model for everyday coding.',
        },
        {
          value: 'gpt-5.4-mini',
          label: 'GPT-5.4-Mini',
          description: 'Small and fast.',
        },
      ]);
    });

    it('deduplicates OPENAI_MODEL against runtime-discovered models', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            environmentVariables: 'OPENAI_MODEL=gpt-5.4',
          },
        },
      };
      updateCodexModelDiscoveryState(settings, {
        discoveredModels: [
          { id: 'gpt-5.5', label: 'GPT-5.5', isDefault: true },
          { id: 'gpt-5.4', label: 'gpt-5.4' },
        ],
      });

      expect(codexChatUIConfig.getModelOptions(settings).map(option => option.value)).toEqual([
        'gpt-5.5',
        'gpt-5.4',
      ]);
    });
  });

  describe('isAdaptiveReasoningModel', () => {
    it('should return true for all models', () => {
      expect(codexChatUIConfig.isAdaptiveReasoningModel(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe(true);
      expect(codexChatUIConfig.isAdaptiveReasoningModel('unknown-model', {})).toBe(true);
    });
  });

  describe('getReasoningOptions', () => {
    it('should return effort levels', () => {
      const options = codexChatUIConfig.getReasoningOptions(DEFAULT_CODEX_PRIMARY_MODEL, {});
      expect(options).toHaveLength(4);
      expect(options.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh']);
    });
  });

  describe('getDefaultReasoningValue', () => {
    it('should return medium for all models', () => {
      expect(codexChatUIConfig.getDefaultReasoningValue(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe('medium');
    });
  });

  describe('getContextWindowSize', () => {
    it('should return 200000 for all models', () => {
      expect(codexChatUIConfig.getContextWindowSize(DEFAULT_CODEX_PRIMARY_MODEL)).toBe(200_000);
    });
  });

  describe('applyModelDefaults', () => {
    it('sets reasoning summary off for GPT-5.3 Codex Spark', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      };

      codexChatUIConfig.applyModelDefaults(CODEX_SPARK_MODEL, settings);

      expect(settings).toMatchObject({
        providerConfigs: {
          codex: {
            reasoningSummary: 'none',
          },
        },
      });
    });

    it('leaves reasoning summary unchanged for other Codex models', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      };

      codexChatUIConfig.applyModelDefaults(DEFAULT_CODEX_PRIMARY_MODEL, settings);

      expect(settings).toMatchObject({
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      });
    });
  });

  describe('isDefaultModel', () => {
    it('should return true for built-in models', () => {
      expect(codexChatUIConfig.isDefaultModel(DEFAULT_CODEX_PRIMARY_MODEL)).toBe(true);
      expect(codexChatUIConfig.isDefaultModel('gpt-5.4')).toBe(true);
      expect(codexChatUIConfig.isDefaultModel('gpt-5.4-mini')).toBe(true);
      expect(codexChatUIConfig.isDefaultModel(CODEX_SPARK_MODEL)).toBe(true);
    });

    it('should return false for custom models', () => {
      expect(codexChatUIConfig.isDefaultModel('my-custom-model')).toBe(false);
    });
  });

  describe('normalizeModelVariant', () => {
    it('falls back unavailable Codex models to the current primary model', () => {
      expect(codexChatUIConfig.normalizeModelVariant('gpt-5.2', {})).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
    });

    it('keeps runtime-discovered Codex models as available selections', () => {
      const settings: Record<string, unknown> = {};
      updateCodexModelDiscoveryState(settings, {
        discoveredModels: [
          { id: 'gpt-5.5', label: 'GPT-5.5', isDefault: true },
          { id: 'gpt-5.4', label: 'gpt-5.4' },
        ],
      });

      expect(codexChatUIConfig.normalizeModelVariant('gpt-5.4', settings)).toBe('gpt-5.4');
    });

    it('keeps visible models as-is', () => {
      expect(codexChatUIConfig.normalizeModelVariant(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(codexChatUIConfig.normalizeModelVariant('custom', {
        environmentVariables: 'OPENAI_MODEL=custom',
      })).toBe('custom');
      expect(codexChatUIConfig.normalizeModelVariant('settings-custom', {
        providerConfigs: {
          codex: {
            customModels: 'settings-custom',
          },
        },
      })).toBe('settings-custom');
    });
  });

  describe('getCustomModelIds', () => {
    it('should return custom model from env', () => {
      const ids = codexChatUIConfig.getCustomModelIds({ OPENAI_MODEL: 'my-model' });
      expect(ids.has('my-model')).toBe(true);
    });

    it('should not include default models', () => {
      const ids = codexChatUIConfig.getCustomModelIds({ OPENAI_MODEL: DEFAULT_CODEX_PRIMARY_MODEL });
      expect(ids.size).toBe(0);
    });

    it('should return empty set when no OPENAI_MODEL', () => {
      const ids = codexChatUIConfig.getCustomModelIds({});
      expect(ids.size).toBe(0);
    });
  });

  describe('getPermissionModeToggle', () => {
    it('should return full-access/safe toggle config with plan mode', () => {
      const toggle = codexChatUIConfig.getPermissionModeToggle!();
      expect(toggle).toEqual({
        inactiveValue: 'normal',
        inactiveLabel: 'Safe',
        activeValue: 'full_access',
        activeLabel: 'Auto-approve',
        planValue: 'plan',
        planLabel: 'Plan',
      });
    });
  });
});
