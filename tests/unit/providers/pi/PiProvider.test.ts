import { discoverPiThinkingLevels, syncPiDiscovery } from '@/providers/pi/execution/PiDiscovery';
import { piProviderModule } from '@/providers/pi/PiProviderModule';
import { decodePiSettings, getPiSettings, updatePiSettings } from '@/providers/pi/settings';
import { piChatUIConfig } from '@/providers/pi/ui/PiChatUIConfig';

describe('Pi provider (#207)', () => {
  it('preserves the selected model before the first discovery after restart', () => {
    expect(piChatUIConfig.getModelOptions({ savedProviderModel: { pi: 'pi:zai/glm-4.7' } }))
      .toEqual([expect.objectContaining({ value: 'pi:zai/glm-4.7' })]);
  });
  it('is opt-in and does not claim MCP, Safe or Plan support', () => {
    expect(piProviderModule.settings.defaults().enabled).toBe(false);
    expect(piProviderModule.capabilities.mcp.sessionConfiguration).toBe('unsupported');
    expect(piProviderModule.capabilities.interactions.planMode).toBe('unsupported');
    expect(piChatUIConfig.getPermissionModeToggle?.()).toBeNull();
  });

  it('keeps the full discovered catalog separate from the shortlist and aliases', () => {
    const settings = {};
    updatePiSettings(settings, { visibleModels: ['missing/model'], modelAliases: { 'missing/model': 'Mine' } });
    syncPiDiscovery(settings, { configOptions: [{ type: 'select', id: 'model', category: 'model',
      name: 'Model', currentValue: 'zai/glm-4.7', options: [{ value: 'zai/glm-4.7', name: 'GLM' }] }] });
    expect(getPiSettings(settings).discoveredModels.map(model => model.rawId)).toEqual(['zai/glm-4.7']);
    expect(piChatUIConfig.getModelOptions(settings)).toEqual([
      expect.objectContaining({ value: 'pi:missing/model', label: 'Mine' }),
    ]);
    updatePiSettings(settings, { visibleModels: [] });
    expect(piChatUIConfig.getModelOptions(settings)[0].value).toBe('pi:zai/glm-4.7');
  });

  it('uses thinking config rather than interpreting ACP modes as permissions', () => {
    const settings = {};
    syncPiDiscovery(settings, { configOptions: [{ type: 'select', id: 'thought_level', category: 'thought_level',
      name: 'Thinking', currentValue: 'high', options: [{ value: 'off', name: 'Off' }, { value: 'high', name: 'High' }] }],
    modes: { currentModeId: 'high', availableModes: [{ id: 'high', name: 'Thinking: high' }] } });
    expect(getPiSettings(settings).thinkingLevels).toEqual(['off', 'high']);
    expect(settings).not.toHaveProperty('permissionMode');
  });

  it('discovers effort per model from accepted runtime values, preserving it across session updates', async () => {
    const settings = {};
    const session = { sessionId: 'discovery', configOptions: [
      { type: 'select' as const, id: 'model', category: 'model' as const, name: 'Model', currentValue: 'limited',
        options: [{ value: 'limited', name: 'Limited' }, { value: 'full', name: 'Full' }] },
      { type: 'select' as const, id: 'thought_level', category: 'thought_level' as const, name: 'Thinking',
        currentValue: 'high', options: ['low', 'high', 'xhigh'].map(value => ({ value, name: value })) },
    ] };
    let model = '';
    const client = { setConfigOption: jest.fn(async ({ configId, value }) => {
      if (configId === 'model') model = value;
      return { configOptions: session.configOptions.map(option => ({ ...option,
        currentValue: option.category === 'model' ? model
          : model === 'limited' && value === 'xhigh' ? 'high' : value })) };
    }) };
    const models = await discoverPiThinkingLevels(client, session, new AbortController().signal);
    updatePiSettings(settings, { discoveredModels: models });
    syncPiDiscovery(settings, session);
    expect(piChatUIConfig.getReasoningOptions('pi:limited', settings).map(option => option.value))
      .toEqual(['default', 'low', 'high']);
    expect(piChatUIConfig.getReasoningOptions('pi:full', settings).map(option => option.value))
      .toEqual(['default', 'low', 'high', 'xhigh']);
    expect(piChatUIConfig.getReasoningOptions('pi:unknown', settings).map(option => option.value))
      .toEqual(['default']);
    const abort = new AbortController(); abort.abort();
    await expect(discoverPiThinkingLevels(client, session, abort.signal)).rejects.toThrow();
  });

  it('normalizes malformed settings without enabling the provider', () => {
    expect(decodePiSettings({ enabled: 'yes', visibleModels: [' a ', 'a', 3], modelAliases: null }))
      .toEqual(expect.objectContaining({ enabled: false, visibleModels: ['a'], modelAliases: {} }));
  });
});
