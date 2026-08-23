import { normalizeGrokAcpSessionModels } from '../../../../src/providers/grok/runtime/normalizeGrokAcpSessionState';

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
