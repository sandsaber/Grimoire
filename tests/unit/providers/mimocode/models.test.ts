import {
  buildMimocodeBaseModels,
  decodeMimocodeModelId,
  encodeMimocodeModelId,
  isMimocodeModelSelectionId,
  MIMOCODE_SYNTHETIC_MODEL_ID,
  splitMimocodeModelLabel,
} from '../../../../src/providers/mimocode/models';
import { mimocodeChatUIConfig } from '../../../../src/providers/mimocode/ui/MimocodeChatUIConfig';

describe('MiMoCode model identity', () => {
  it('namespaces provider-owned model ids for the shared selector', () => {
    expect(encodeMimocodeModelId('anthropic/claude-sonnet-4')).toBe('mimocode:anthropic/claude-sonnet-4');
    expect(decodeMimocodeModelId('mimocode:anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    expect(decodeMimocodeModelId(MIMOCODE_SYNTHETIC_MODEL_ID)).toBeNull();
    expect(isMimocodeModelSelectionId('mimocode:anthropic/claude-sonnet-4')).toBe(true);
    expect(isMimocodeModelSelectionId('claude-sonnet-4')).toBe(false);
  });
});

describe('MiMoCode base model derivation', () => {
  const discoveredModels = [
    { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
    { label: 'Anthropic/Claude Sonnet 4 (high)', rawId: 'anthropic/claude-sonnet-4/high' },
    { label: 'Anthropic/Claude Sonnet 4 (max)', rawId: 'anthropic/claude-sonnet-4/max' },
    { label: 'Google/Gemini 2.5 Pro', rawId: 'google/gemini-2.5-pro' },
  ];

  it('collapses discovered variants into base models', () => {
    expect(buildMimocodeBaseModels(discoveredModels)).toEqual([
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
    expect(buildMimocodeBaseModels([
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

describe('MiMoCode unsupported model fallback', () => {
});

describe('mimocodeChatUIConfig', () => {
  it('keeps visible MiMoCode model order stable and appends saved variant selections only when absent', () => {
    const options = mimocodeChatUIConfig.getModelOptions({
      model: 'haiku',
      providerConfigs: {
        mimocode: {
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
        mimocode: 'mimocode:anthropic/claude-sonnet-4/high',
      },
    });

    expect(options).toEqual([
      {
        description: 'ACP runtime',
        label: 'OpenAI/GPT-5',
        value: 'mimocode:openai/gpt-5',
      },
      {
        description: 'ACP runtime',
        label: 'Anthropic/Claude Sonnet 4',
        value: 'mimocode:anthropic/claude-sonnet-4',
      },
    ]);
  });

  it('uses modelAliases to override the label in model selector options', () => {
    const options = mimocodeChatUIConfig.getModelOptions({
      providerConfigs: {
        mimocode: {
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
        value: 'mimocode:anthropic/claude-sonnet-4',
      },
      {
        description: 'ACP runtime',
        label: 'OpenAI/GPT-5',
        value: 'mimocode:openai/gpt-5',
      },
    ]);
  });

  it('shows configured base model ids even before discovery finishes', () => {
    expect(mimocodeChatUIConfig.getModelOptions({
      providerConfigs: {
        mimocode: {
          visibleModels: [
            'google/gemini-2.5-pro',
          ],
        },
      },
    })).toEqual([
      {
        description: 'Configured model',
        label: 'google/gemini-2.5-pro',
        value: 'mimocode:google/gemini-2.5-pro',
      },
    ]);
  });

  it('falls back to the synthetic entry before models are discovered', () => {
    expect(mimocodeChatUIConfig.getModelOptions({})).toEqual([
      { description: 'ACP runtime', label: 'MiMoCode', value: 'mimocode' },
    ]);
  });

  it('returns per-model thinking options from ACP thought-level discovery', () => {
    const settings = {
      model: 'mimocode:anthropic/claude-sonnet-4',
      providerConfigs: {
        mimocode: {
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

    expect(mimocodeChatUIConfig.getReasoningOptions(
      'mimocode:anthropic/claude-sonnet-4',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
    ]);
    expect(mimocodeChatUIConfig.getDefaultReasoningValue(
      'mimocode:anthropic/claude-sonnet-4',
      settings,
    )).toBe('max');
  });

  it('keeps at least three MiMoCode effort choices before thought-level discovery finishes', () => {
    const settings = {
      model: 'mimocode:minimax-token-plan/minimax-m2',
      providerConfigs: {
        mimocode: {
          discoveredModels: [
            { label: 'MiniMax Token Plan (minimax.io)/MiniMax-M2', rawId: 'minimax-token-plan/minimax-m2' },
          ],
          visibleModels: ['minimax-token-plan/minimax-m2'],
          thinkingOptionsByModel: {},
        },
      },
    };

    expect(mimocodeChatUIConfig.isAdaptiveReasoningModel(
      'mimocode:minimax-token-plan/minimax-m2',
      settings,
    )).toBe(true);
    expect(mimocodeChatUIConfig.getReasoningOptions(
      'mimocode:minimax-token-plan/minimax-m2',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ]);
    expect(mimocodeChatUIConfig.getDefaultReasoningValue(
      'mimocode:minimax-token-plan/minimax-m2',
      settings,
    )).toBe('high');
  });
});

describe('MiMoCode discovered model grouping', () => {
  it('splits provider and model labels for grouped picker rendering', () => {
    expect(splitMimocodeModelLabel('Google/Gemini 2.5 Flash')).toEqual({
      modelLabel: 'Gemini 2.5 Flash',
      providerLabel: 'Google',
    });
    expect(splitMimocodeModelLabel('standalone-model')).toEqual({
      modelLabel: 'standalone-model',
      providerLabel: 'Other',
    });
  });
});
