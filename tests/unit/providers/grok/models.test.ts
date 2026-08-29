import {
  buildGrokBaseModels,
  combineGrokRawModelSelection,
  decodeGrokModelId,
  encodeGrokModelId,
  extractGrokModelVariantValue,
  getGrokModelVariants,
  GROK_DEFAULT_THINKING_LEVEL,
  GROK_SYNTHETIC_MODEL_ID,
  groupGrokDiscoveredModels,
  isGrokModelSelectionId,
  isGrokNativeModelId,
  resolveGrokBaseModelRawId,
  splitGrokModelLabel,
} from '../../../../src/providers/grok/models';
import { grokChatUIConfig } from '../../../../src/providers/grok/ui/GrokChatUIConfig';

describe('Grok Build model identity', () => {
  it('namespaces provider-owned model ids for the shared selector', () => {
    expect(encodeGrokModelId('anthropic/claude-sonnet-4')).toBe('grok:anthropic/claude-sonnet-4');
    expect(decodeGrokModelId('grok:anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    expect(decodeGrokModelId(GROK_SYNTHETIC_MODEL_ID)).toBeNull();
    expect(isGrokModelSelectionId('grok:anthropic/claude-sonnet-4')).toBe(true);
    expect(isGrokModelSelectionId('claude-sonnet-4')).toBe(false);
  });

  it('treats catalog Grok models as native xAI ids', () => {
    expect(isGrokNativeModelId('grok-4.6')).toBe(true);
    expect(isGrokNativeModelId('grok-4.5')).toBe(true);
    expect(isGrokNativeModelId('grok-build')).toBe(true);
    expect(isGrokNativeModelId('grok-composer-2.5-fast')).toBe(true);
    expect(isGrokNativeModelId('anthropic/claude-sonnet-4')).toBe(false);
    expect(isGrokNativeModelId('minimax-token-plan/minimax-m2')).toBe(false);
  });

  it('recognises a native id whatever case the catalog reports it in', () => {
    expect(isGrokNativeModelId('Grok-4.6')).toBe(true);
    expect(isGrokNativeModelId('GROK-4.6')).toBe(true);
    expect(isGrokNativeModelId('Grok')).toBe(true);
    expect(isGrokNativeModelId('Anthropic/Claude-Sonnet-4')).toBe(false);
  });
});

describe('Grok Build base model derivation', () => {
  const discoveredModels = [
    { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
    { label: 'Anthropic/Claude Sonnet 4 (high)', rawId: 'anthropic/claude-sonnet-4/high' },
    { label: 'Anthropic/Claude Sonnet 4 (max)', rawId: 'anthropic/claude-sonnet-4/max' },
    { label: 'Google/Gemini 2.5 Pro', rawId: 'google/gemini-2.5-pro' },
  ];

  it('collapses discovered variants into base models', () => {
    expect(buildGrokBaseModels(discoveredModels)).toEqual([
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
    expect(buildGrokBaseModels([
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

  it('extracts and combines thinking variants from discovered model ids', () => {
    expect(resolveGrokBaseModelRawId(
      'anthropic/claude-sonnet-4/high',
      discoveredModels,
    )).toBe('anthropic/claude-sonnet-4');
    expect(extractGrokModelVariantValue(
      'anthropic/claude-sonnet-4/high',
      discoveredModels,
    )).toBe('high');
    expect(getGrokModelVariants(
      'anthropic/claude-sonnet-4',
      discoveredModels,
    )).toEqual([
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
    ]);
    expect(combineGrokRawModelSelection(
      'anthropic/claude-sonnet-4',
      'high',
      discoveredModels,
    )).toBe('anthropic/claude-sonnet-4/high');
    expect(combineGrokRawModelSelection(
      'anthropic/claude-sonnet-4',
      GROK_DEFAULT_THINKING_LEVEL,
      discoveredModels,
    )).toBe('anthropic/claude-sonnet-4');
  });
});

describe('grokChatUIConfig', () => {
  it('keeps visible Grok Build model order stable and appends saved variant selections only when absent', () => {
    const options = grokChatUIConfig.getModelOptions({
      model: 'haiku',
      providerConfigs: {
        grok: {
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
        grok: 'grok:anthropic/claude-sonnet-4/high',
      },
    });

    expect(options).toEqual([
      {
        description: 'ACP runtime',
        label: 'OpenAI/GPT-5',
        value: 'grok:openai/gpt-5',
      },
      {
        description: 'ACP runtime',
        label: 'Anthropic/Claude Sonnet 4',
        value: 'grok:anthropic/claude-sonnet-4',
      },
    ]);
  });

  it('uses modelAliases to override the label in model selector options', () => {
    const options = grokChatUIConfig.getModelOptions({
      providerConfigs: {
        grok: {
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
        value: 'grok:anthropic/claude-sonnet-4',
      },
      {
        description: 'ACP runtime',
        label: 'OpenAI/GPT-5',
        value: 'grok:openai/gpt-5',
      },
    ]);
  });

  it('shows configured base model ids even before discovery finishes', () => {
    expect(grokChatUIConfig.getModelOptions({
      providerConfigs: {
        grok: {
          visibleModels: [
            'google/gemini-2.5-pro',
          ],
        },
      },
    })).toEqual([
      {
        description: 'Configured model',
        label: 'google/gemini-2.5-pro',
        value: 'grok:google/gemini-2.5-pro',
      },
    ]);
  });

  it('falls back to the synthetic entry before models are discovered', () => {
    expect(grokChatUIConfig.getModelOptions({})).toEqual([
      { description: 'ACP runtime', label: 'Grok Build', value: 'grok' },
    ]);
  });

  it('returns per-model thinking options from ACP thought-level discovery', () => {
    const settings = {
      model: 'grok:anthropic/claude-sonnet-4',
      providerConfigs: {
        grok: {
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

    expect(grokChatUIConfig.getReasoningOptions(
      'grok:anthropic/claude-sonnet-4',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
    ]);
    expect(grokChatUIConfig.getDefaultReasoningValue(
      'grok:anthropic/claude-sonnet-4',
      settings,
    )).toBe('max');
  });

  it('exposes launch-time effort choices for native Grok Build models', () => {
    const settings = {
      model: 'grok:grok-build',
      providerConfigs: {
        grok: {
          discoveredModels: [
            { label: 'Grok Build', rawId: 'grok-build' },
          ],
          visibleModels: ['grok-build'],
          thinkingOptionsByModel: {},
        },
      },
    };

    expect(grokChatUIConfig.isAdaptiveReasoningModel(
      'grok:grok-build',
      settings,
    )).toBe(true);
    expect(grokChatUIConfig.getReasoningOptions(
      'grok:grok-build',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
      { label: 'Extra high', value: 'xhigh' },
    ]);
    expect(grokChatUIConfig.getDefaultReasoningValue(
      'grok:grok-build',
      settings,
    )).toBe('high');
  });

  it('exposes xhigh effort for catalog Grok models such as grok-4.6', () => {
    const settings = {
      model: 'grok:grok-4.6',
      providerConfigs: {
        grok: {
          discoveredModels: [
            { label: 'Grok 4.6', rawId: 'grok-4.6' },
            { label: 'Grok 4.5', rawId: 'grok-4.5' },
          ],
          visibleModels: ['grok-4.6', 'grok-4.5'],
          thinkingOptionsByModel: {},
        },
      },
    };

    expect(grokChatUIConfig.getReasoningOptions(
      'grok:grok-4.6',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
      { label: 'Extra high', value: 'xhigh' },
    ]);
    expect(grokChatUIConfig.getReasoningOptions(
      'grok:grok-4.5',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
      { label: 'Extra high', value: 'xhigh' },
    ]);
    expect(grokChatUIConfig.getDefaultReasoningValue(
      'grok:grok-4.6',
      settings,
    )).toBe('high');
  });

  it('offers the native levels for the bare Grok Build entry on a fresh vault', () => {
    // Nothing discovered yet, so the model picker shows only the synthetic
    // `grok` option - the state where a static list is all there is.
    const settings = { model: 'grok', providerConfigs: { grok: {} } };

    expect(grokChatUIConfig.getReasoningOptions('grok', settings)
      .map((option) => option.value)).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(grokChatUIConfig.getDefaultReasoningValue('grok', settings)).toBe('high');
  });

  it('drops xhigh for a catalog model once Grok Build reports its own levels', () => {
    const settings = {
      model: 'grok:grok-4.5',
      providerConfigs: {
        grok: {
          discoveredModels: [
            { label: 'Grok 4.6', rawId: 'grok-4.6' },
            { label: 'Grok 4.5', rawId: 'grok-4.5' },
          ],
          visibleModels: ['grok-4.6', 'grok-4.5'],
          // What a live session/new reports: grok-4.5 has no xhigh, grok-4.6 does.
          thinkingOptionsByModel: {
            'grok-4.5': [
              { label: 'Low', value: 'low' },
              { label: 'Medium', value: 'medium' },
              { label: 'High', value: 'high' },
            ],
            'grok-4.6': [
              { label: 'Low', value: 'low' },
              { label: 'Medium', value: 'medium' },
              { label: 'High', value: 'high' },
              { label: 'Extra high', value: 'xhigh' },
            ],
          },
        },
      },
    };

    // The reported list wins over the static one the picker falls back to
    // before any session has run.
    expect(grokChatUIConfig.getReasoningOptions('grok:grok-4.5', settings)
      .map((option) => option.value)).toEqual(['low', 'medium', 'high']);
    expect(grokChatUIConfig.getReasoningOptions('grok:grok-4.6', settings)
      .map((option) => option.value)).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(grokChatUIConfig.getDefaultReasoningValue('grok:grok-4.5', settings)).toBe('high');
  });

  it('keeps at least three Grok Build effort choices before thought-level discovery finishes', () => {
    const settings = {
      model: 'grok:minimax-token-plan/minimax-m2',
      providerConfigs: {
        grok: {
          discoveredModels: [
            { label: 'MiniMax Token Plan (minimax.io)/MiniMax-M2', rawId: 'minimax-token-plan/minimax-m2' },
          ],
          visibleModels: ['minimax-token-plan/minimax-m2'],
          thinkingOptionsByModel: {},
        },
      },
    };

    expect(grokChatUIConfig.isAdaptiveReasoningModel(
      'grok:minimax-token-plan/minimax-m2',
      settings,
    )).toBe(true);
    expect(grokChatUIConfig.getReasoningOptions(
      'grok:minimax-token-plan/minimax-m2',
      settings,
    )).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ]);
    expect(grokChatUIConfig.getDefaultReasoningValue(
      'grok:minimax-token-plan/minimax-m2',
      settings,
    )).toBe('high');
  });
});

describe('Grok Build discovered model grouping', () => {
  it('splits provider and model labels for grouped picker rendering', () => {
    expect(splitGrokModelLabel('Google/Gemini 2.5 Flash')).toEqual({
      modelLabel: 'Gemini 2.5 Flash',
      providerLabel: 'Google',
    });
    expect(splitGrokModelLabel('standalone-model')).toEqual({
      modelLabel: 'standalone-model',
      providerLabel: 'Other',
    });
    expect(splitGrokModelLabel('Grok Build', 'grok-build')).toEqual({
      modelLabel: 'Build',
      providerLabel: 'Grok Build',
    });
    expect(splitGrokModelLabel('Grok Composer 2.5 Fast', 'grok-composer-2.5-fast')).toEqual({
      modelLabel: '2.5 Fast',
      providerLabel: 'Composer',
    });
  });

  it('groups discovered models by provider label', () => {
    expect(groupGrokDiscoveredModels([
      { label: 'Grok Build', rawId: 'grok-build' },
      { label: 'Grok Composer 2.5 Fast', rawId: 'grok-composer-2.5-fast' },
      { label: 'Google/Gemini 2.5 Flash', rawId: 'google/gemini-2.5-flash' },
      { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
      { label: 'Google/Gemini 2.5 Pro', rawId: 'google/gemini-2.5-pro' },
    ])).toEqual([
      {
        models: [
          { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
        ],
        providerKey: 'anthropic',
        providerLabel: 'Anthropic',
      },
      {
        models: [
          { label: 'Grok Composer 2.5 Fast', rawId: 'grok-composer-2.5-fast' },
        ],
        providerKey: 'composer',
        providerLabel: 'Composer',
      },
      {
        models: [
          { label: 'Google/Gemini 2.5 Flash', rawId: 'google/gemini-2.5-flash' },
          { label: 'Google/Gemini 2.5 Pro', rawId: 'google/gemini-2.5-pro' },
        ],
        providerKey: 'google',
        providerLabel: 'Google',
      },
      {
        models: [
          { label: 'Grok Build', rawId: 'grok-build' },
        ],
        providerKey: 'grok build',
        providerLabel: 'Grok Build',
      },
    ]);
  });

  it('groups slash-separated discovered models by provider label', () => {
    expect(groupGrokDiscoveredModels([
      { label: 'Google/Gemini 2.5 Flash', rawId: 'google/gemini-2.5-flash' },
      { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
      { label: 'Google/Gemini 2.5 Pro', rawId: 'google/gemini-2.5-pro' },
    ])).toEqual([
      {
        models: [
          { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
        ],
        providerKey: 'anthropic',
        providerLabel: 'Anthropic',
      },
      {
        models: [
          { label: 'Google/Gemini 2.5 Flash', rawId: 'google/gemini-2.5-flash' },
          { label: 'Google/Gemini 2.5 Pro', rawId: 'google/gemini-2.5-pro' },
        ],
        providerKey: 'google',
        providerLabel: 'Google',
      },
    ]);
  });
});
