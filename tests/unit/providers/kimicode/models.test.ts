import {
  buildKimicodeBaseModels,
  decodeKimicodeModelId,
  encodeKimicodeModelId,
  isKimicodeModelSelectionId,
  KIMICODE_SYNTHETIC_MODEL_ID,
  splitKimicodeModelLabel,
} from '../../../../src/providers/kimicode/models';
import { kimicodeChatUIConfig } from '../../../../src/providers/kimicode/ui/KimicodeChatUIConfig';

describe('Kimi Code model identity', () => {
  it('namespaces provider-owned model ids for the shared selector', () => {
    expect(encodeKimicodeModelId('anthropic/claude-sonnet-4')).toBe('kimicode:anthropic/claude-sonnet-4');
    expect(decodeKimicodeModelId('kimicode:anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    expect(decodeKimicodeModelId(KIMICODE_SYNTHETIC_MODEL_ID)).toBeNull();
    expect(isKimicodeModelSelectionId('kimicode:anthropic/claude-sonnet-4')).toBe(true);
    expect(isKimicodeModelSelectionId('claude-sonnet-4')).toBe(false);
  });
});

describe('Kimi Code base model derivation', () => {
  const discoveredModels = [
    { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
    { label: 'Anthropic/Claude Sonnet 4 (high)', rawId: 'anthropic/claude-sonnet-4/high' },
    { label: 'Anthropic/Claude Sonnet 4 (max)', rawId: 'anthropic/claude-sonnet-4/max' },
    { label: 'Google/Gemini 2.5 Pro', rawId: 'google/gemini-2.5-pro' },
  ];

  it('collapses discovered variants into base models', () => {
    expect(buildKimicodeBaseModels(discoveredModels)).toEqual([
      {
        label: 'Anthropic/Claude Sonnet 4',
        rawId: 'anthropic/claude-sonnet-4',
        variants: [
          { label: 'High', value: 'high' },
          { label: 'Max', value: 'max' },
        ],
      },
      {
        label: 'Google/Gemini 2.5 Pro',
        rawId: 'google/gemini-2.5-pro',
        variants: [],
      },
    ]);
  });

  it('sorts thinking variants by semantic effort instead of alphabetically', () => {
    expect(buildKimicodeBaseModels([
      { label: 'OpenAI/GPT-5', rawId: 'openai/gpt-5' },
      { label: 'OpenAI/GPT-5 (xhigh)', rawId: 'openai/gpt-5/xhigh' },
      { label: 'OpenAI/GPT-5 (medium)', rawId: 'openai/gpt-5/medium' },
      { label: 'OpenAI/GPT-5 (low)', rawId: 'openai/gpt-5/low' },
      { label: 'OpenAI/GPT-5 (high)', rawId: 'openai/gpt-5/high' },
      { label: 'OpenAI/GPT-5 (max)', rawId: 'openai/gpt-5/max' },
    ])).toEqual([
      {
        label: 'OpenAI/GPT-5',
        rawId: 'openai/gpt-5',
        variants: [
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' },
          { label: 'Max', value: 'max' },
          { label: 'XHigh', value: 'xhigh' },
        ],
      },
    ]);
  });
});

describe('kimicodeChatUIConfig', () => {
  it('keeps visible Kimi Code model order stable and appends saved variant selections only when absent', () => {
    const options = kimicodeChatUIConfig.getModelOptions({
      model: 'haiku',
      providerConfigs: {
        kimicode: {
          discoveredModels: [
            { label: 'OpenAI/GPT-5', rawId: 'openai/gpt-5' },
            { label: 'OpenAI/GPT-5 (high)', rawId: 'openai/gpt-5/high' },
            { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
            { label: 'Anthropic/Claude Sonnet 4 (high)', rawId: 'anthropic/claude-sonnet-4/high' },
          ],
          visibleModels: [
            'openai/gpt-5',
          ],
          preferredThinkingByModel: {
            'anthropic/claude-sonnet-4': 'high',
          },
        },
      },
      savedProviderModel: {
        kimicode: 'kimicode:anthropic/claude-sonnet-4/high',
      },
    });

    expect(options).toEqual([
      {
        description: 'ACP runtime',
        label: 'OpenAI/GPT-5',
        value: 'kimicode:openai/gpt-5',
      },
      {
        description: 'ACP runtime',
        label: 'Anthropic/Claude Sonnet 4',
        value: 'kimicode:anthropic/claude-sonnet-4',
      },
    ]);
  });

  it('uses modelAliases to override the label in model selector options', () => {
    const options = kimicodeChatUIConfig.getModelOptions({
      providerConfigs: {
        kimicode: {
          discoveredModels: [
            { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
            { label: 'OpenAI/GPT-5', rawId: 'openai/gpt-5' },
          ],
          modelAliases: {
            'anthropic/claude-sonnet-4': 'Sonnet',
          },
          visibleModels: [
            'anthropic/claude-sonnet-4',
            'openai/gpt-5',
          ],
        },
      },
    });

    expect(options).toEqual([
      {
        description: 'ACP runtime',
        label: 'Sonnet',
        value: 'kimicode:anthropic/claude-sonnet-4',
      },
      {
        description: 'ACP runtime',
        label: 'OpenAI/GPT-5',
        value: 'kimicode:openai/gpt-5',
      },
    ]);
  });

  it('shows configured base model ids even before discovery finishes', () => {
    expect(kimicodeChatUIConfig.getModelOptions({
      providerConfigs: {
        kimicode: {
          visibleModels: [
            'google/gemini-2.5-pro',
          ],
        },
      },
    })).toEqual([
      {
        description: 'Configured model',
        label: 'google/gemini-2.5-pro',
        value: 'kimicode:google/gemini-2.5-pro',
      },
    ]);
  });

  it('falls back to the synthetic entry before models are discovered', () => {
    expect(kimicodeChatUIConfig.getModelOptions({})).toEqual([
      { description: 'ACP runtime', label: 'Kimi Code', value: 'kimicode' },
    ]);
  });

  it('returns per-model thinking options from ACP thought-level discovery', () => {
    const settings = {
      model: 'kimicode:anthropic/claude-sonnet-4',
      providerConfigs: {
        kimicode: {
          discoveredModels: [
            { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
          ],
          preferredThinkingByModel: {
            'anthropic/claude-sonnet-4': 'max',
          },
          thinkingOptionsByModel: {
            'anthropic/claude-sonnet-4': [
              { label: 'Low', value: 'low' },
              { label: 'High', value: 'high' },
              { label: 'Max', value: 'max' },
            ],
          },
        },
      },
    };

    expect(kimicodeChatUIConfig.getReasoningOptions(
      'kimicode:anthropic/claude-sonnet-4',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
    ]);
    expect(kimicodeChatUIConfig.getDefaultReasoningValue(
      'kimicode:anthropic/claude-sonnet-4',
      settings,
    )).toBe('max');
  });

  it('keeps at least three Kimi Code effort choices before thought-level discovery finishes', () => {
    const settings = {
      model: 'kimicode:minimax-token-plan/minimax-m2',
      providerConfigs: {
        kimicode: {
          discoveredModels: [
            { label: 'MiniMax Token Plan (minimax.io)/MiniMax-M2', rawId: 'minimax-token-plan/minimax-m2' },
          ],
          visibleModels: ['minimax-token-plan/minimax-m2'],
          thinkingOptionsByModel: {},
        },
      },
    };

    expect(kimicodeChatUIConfig.isAdaptiveReasoningModel(
      'kimicode:minimax-token-plan/minimax-m2',
      settings,
    )).toBe(true);
    expect(kimicodeChatUIConfig.getReasoningOptions(
      'kimicode:minimax-token-plan/minimax-m2',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ]);
    expect(kimicodeChatUIConfig.getDefaultReasoningValue(
      'kimicode:minimax-token-plan/minimax-m2',
      settings,
    )).toBe('high');
  });
});

describe('Kimi Code discovered model grouping', () => {
  it('splits provider and model labels for grouped picker rendering', () => {
    expect(splitKimicodeModelLabel('Google/Gemini 2.5 Flash')).toEqual({
      modelLabel: 'Gemini 2.5 Flash',
      providerLabel: 'Google',
    });
    expect(splitKimicodeModelLabel('standalone-model')).toEqual({
      modelLabel: 'standalone-model',
      providerLabel: 'Other',
    });
  });
});
