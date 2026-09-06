import {
  normalizeGrokAcpSessionModels,
  readGrokAcpModelThinkingOptions,
} from '../../../../src/providers/grok/runtime/normalizeGrokAcpSessionState';

// Copied from a live `grok agent stdio` session/new response (Grok Build 1.0.5).
// grok-4.6 accepts xhigh, grok-4.5 does not - the difference the picker cannot
// derive from the model id.
const LIVE_SESSION_MODELS = {
  availableModels: [
    {
      modelId: 'grok-4.6',
      name: 'Grok 4.6',
      description: "SpaceXAI's latest frontier model",
      _meta: {
        totalContextTokens: 500000,
        supportsReasoningEffort: true,
        reasoningEffort: 'xhigh',
        reasoningEfforts: [
          { id: 'xhigh', value: 'xhigh', label: 'Extra High Effort', description: 'Highest effort and reasoning level', default: false },
          { id: 'high', value: 'high', label: 'High Effort', description: 'Higher implementation quality with extensive reasoning', default: true },
          { id: 'medium', value: 'medium', label: 'Medium Effort', description: 'Balanced effort with standard implementation and testing', default: false },
          { id: 'low', value: 'low', label: 'Low Effort', description: 'Quick, fast implementations', default: false },
        ],
      },
    },
    {
      modelId: 'grok-4.5',
      name: 'Grok 4.5',
      _meta: {
        totalContextTokens: 500000,
        supportsReasoningEffort: true,
        reasoningEffort: 'high',
        reasoningEfforts: [
          { id: 'high', value: 'high', label: 'High Effort', description: 'Highest implementation quality with extensive reasoning', default: true },
          { id: 'medium', value: 'medium', label: 'Medium Effort', description: 'Balanced effort with standard implementation and testing', default: false },
          { id: 'low', value: 'low', label: 'Low Effort', description: 'Quick, fast implementations', default: false },
        ],
      },
    },
  ],
  currentModelId: 'grok-4.6',
};

describe('normalizeGrokAcpSessionModels', () => {
  it('maps Grok ACP modelId fields onto the shared ACP id shape', () => {
    expect(normalizeGrokAcpSessionModels({
      availableModels: [
        { modelId: 'grok-build', name: 'Grok Build' },
        { id: 'grok-fast', name: 'Grok Fast', description: 'Fast model' },
      ],
      currentModelId: 'grok-build',
    })).toEqual({
      availableModels: [
        { id: 'grok-build', name: 'Grok Build' },
        { description: 'Fast model', id: 'grok-fast', name: 'Grok Fast' },
      ],
      currentModelId: 'grok-build',
    });
  });

  it('returns null when models are missing', () => {
    expect(normalizeGrokAcpSessionModels(null)).toBeNull();
    expect(normalizeGrokAcpSessionModels(undefined)).toBeNull();
  });

  it('normalizes older load-session model records without display names or a current model', () => {
    expect(normalizeGrokAcpSessionModels({
      availableModels: [
        { modelId: ' grok-4.5 ' },
        { id: '', name: 'Invalid model' },
      ],
    } as never)).toEqual({
      availableModels: [
        { id: 'grok-4.5', name: 'grok-4.5' },
      ],
      currentModelId: 'grok-4.5',
    });
  });
});

describe('readGrokAcpModelThinkingOptions', () => {
  it('reads the reasoning levels the agent reports for every available model', () => {
    const options = readGrokAcpModelThinkingOptions(LIVE_SESSION_MODELS);

    expect(Object.keys(options)).toEqual(['grok-4.6', 'grok-4.5']);
    // Normalized into the ascending order the picker renders, same as the
    // static list it replaces.
    expect(options['grok-4.6'].map((variant) => variant.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    // The level the picker must not offer for this model.
    expect(options['grok-4.5'].map((variant) => variant.value)).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(options['grok-4.5']).toContainEqual({
      description: 'Highest implementation quality with extensive reasoning',
      label: 'High Effort',
      value: 'high',
    });
  });

  it('skips a model that reports no reasoning levels', () => {
    expect(readGrokAcpModelThinkingOptions({
      availableModels: [
        { modelId: 'grok-4.6', name: 'Grok 4.6' },
        { modelId: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', _meta: {} },
        { modelId: 'grok-4.5', name: 'Grok 4.5', _meta: { reasoningEfforts: 'high' } },
      ],
      currentModelId: 'grok-4.6',
    } as never)).toEqual({});
  });

  it('returns nothing when the session reports no models', () => {
    expect(readGrokAcpModelThinkingOptions(null)).toEqual({});
    expect(readGrokAcpModelThinkingOptions(undefined)).toEqual({});
  });

  it('reads a level that names itself only through id', () => {
    expect(readGrokAcpModelThinkingOptions({
      availableModels: [
        {
          modelId: 'grok-4.6',
          name: 'Grok 4.6',
          _meta: {
            reasoningEfforts: [
              { id: 'high', label: 'High Effort' },
              { id: 'low', label: 'Low Effort' },
            ],
          },
        },
      ],
      currentModelId: 'grok-4.6',
    } as never)['grok-4.6'].map((variant) => variant.value)).toEqual(['low', 'high']);
  });

  it('ignores a level list from a model that says it takes no reasoning effort', () => {
    expect(readGrokAcpModelThinkingOptions({
      availableModels: [
        {
          modelId: 'grok-code-fast-1',
          name: 'Grok Code Fast 1',
          _meta: {
            supportsReasoningEffort: false,
            reasoningEfforts: [{ id: 'high', value: 'high', label: 'High Effort' }],
          },
        },
      ],
      currentModelId: 'grok-code-fast-1',
    } as never)).toEqual({});
  });

  it('refuses a model id that would reach through the prototype', () => {
    const options = readGrokAcpModelThinkingOptions({
      availableModels: [
        {
          modelId: '__proto__',
          name: 'Hostile',
          _meta: { reasoningEfforts: [{ id: 'high', value: 'high', label: 'High' }] },
        },
      ],
      currentModelId: 'grok-4.6',
    } as never);

    expect(Object.keys(options)).toEqual([]);
    expect(Object.getPrototypeOf(options)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).high).toBeUndefined();
  });
});
