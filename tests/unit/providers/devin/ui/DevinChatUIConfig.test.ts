import { updateDevinProviderSettings } from '@/providers/devin/settings';
import { devinChatUIConfig } from '@/providers/devin/ui/DevinChatUIConfig';

describe('devinChatUIConfig', () => {
  it('returns the synthetic Devin option before model discovery', () => {
    expect(devinChatUIConfig.getModelOptions({})).toEqual([
      {
        description: 'Devin CLI ACP runtime',
        label: 'Devin',
        value: 'devin',
      },
    ]);
  });

  it('shows all discovered models when the persisted visibility cache is stale', () => {
    const settings: Record<string, unknown> = {};
    updateDevinProviderSettings(settings, {
      discoveredModels: [
        { label: 'SWE-1.6 Slow', rawId: 'swe-1-6-slow' },
        { label: 'Claude Opus 5 Medium', rawId: 'claude-opus-5-medium' },
      ],
      modelAliases: { 'swe-1-6-slow': 'Slow' },
      visibleModels: ['swe-1-6-slow'],
    });

    expect(devinChatUIConfig.getModelOptions(settings)).toEqual([
      { description: 'Devin CLI ACP model', label: 'Slow', value: 'devin:swe-1-6-slow' },
      { description: 'Devin CLI ACP model', label: 'Claude Opus 5 Medium', value: 'devin:claude-opus-5-medium' },
    ]);
  });

  it('owns Devin synthetic and encoded model ids', () => {
    expect(devinChatUIConfig.ownsModel('devin', {})).toBe(true);
    expect(devinChatUIConfig.ownsModel('devin:swe-1-6-slow', {})).toBe(true);
    expect(devinChatUIConfig.ownsModel('gpt-5', {})).toBe(false);
  });

  it('offers no reasoning control', () => {
    expect(devinChatUIConfig.isAdaptiveReasoningModel('devin', {})).toBe(false);
    expect(devinChatUIConfig.getReasoningOptions('devin', {})).toEqual([{ label: 'Default', value: 'default' }]);
    expect(devinChatUIConfig.getDefaultReasoningValue('devin', {})).toBe('default');
  });

  it('reads the context window the recorded session reports by default', () => {
    expect(devinChatUIConfig.getContextWindowSize('devin:swe-1-6-slow')).toBe(200_000);
    expect(devinChatUIConfig.getContextWindowSize('devin:swe-1-6-slow', { 'devin:swe-1-6-slow': 50 })).toBe(50);
  });

  it('updates shared permission mode when applying a Devin permission selection', () => {
    const settings: Record<string, unknown> = { permissionMode: 'full_access' };

    devinChatUIConfig.applyPermissionMode?.('normal', settings);

    expect(settings.permissionMode).toBe('normal');
    expect(devinChatUIConfig.resolvePermissionMode?.(settings)).toBe('normal');
  });
});
