import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import {
  type OpencodeSessionConfigPorts,
  OpencodeSessionConfigState,
} from '@/providers/opencode/execution/OpencodeSessionConfigState';
import {
  OPENCODE_BUILD_MODE_ID,
  OPENCODE_FULL_ACCESS_MODE_ID,
  OPENCODE_SAFE_MODE_ID,
} from '@/providers/opencode/modes';
import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {},
    manifest: { version: '0.0.0-test' },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/opencode'),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/grimoire-test-vault',
        },
      },
    },
    ...overrides,
  };
}

function createState(
  plugin: any,
  ports: Partial<OpencodeSessionConfigPorts> = {},
): OpencodeSessionConfigState {
  return new OpencodeSessionConfigState({
    settingsBag: () => plugin.settings,
    saveSettings: () => plugin.saveSettings(),
    refreshSelectors: () => {
      for (const view of plugin.getAllViews()) {
        view.refreshModelSelector();
      }
    },
    syncPermissionMode: () => undefined,
    ...ports,
  });
}

/**
 * What an OpenCode session is set to, and what the vault learns from it.
 *
 * These are the legacy runtime's own tests, moved rather than rewritten when it
 * was deleted: the behaviour they cover — seeding discovered models, the
 * per-model thinking options, the visible list, the active selection, and which
 * mode a turn runs under — did not move with the flip, only the object holding
 * it did.
 */
describe('OpenCode session configuration state', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('syncs OpenCode session modes into provider settings without clobbering an explicit user choice', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        providerConfigs: {
          opencode: {
            availableModes: [
              { id: 'build', name: 'Build' },
            ],
            selectedMode: 'plan',
          },
        },
      },
    });
    const state = createState(plugin);

    await state.syncSessionModeState({
      configOptions: [{
        currentValue: 'build',
        id: 'mode',
        name: 'Mode',
        options: [
          { name: 'Build', value: 'build' },
          { description: 'Planning-first agent', name: 'Plan', value: 'plan' },
        ],
        type: 'select',
      }],
    });

    expect(getOpencodeProviderSettings(plugin.settings).availableModes).toEqual([
      { id: 'build', name: 'Build' },
      { description: 'Planning-first agent', id: 'plan', name: 'Plan' },
    ]);
    expect(plugin.settings.providerConfigs.opencode.selectedMode).toBe('plan');
    expect(state.sessionModeId).toBe('build');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('seeds the OpenCode selected mode when no explicit mode has been saved yet', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          opencode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const state = createState(plugin);

    await state.syncSessionModeState({
      currentModeId: OPENCODE_BUILD_MODE_ID,
    });

    expect(plugin.settings.providerConfigs.opencode.selectedMode).toBe(OPENCODE_FULL_ACCESS_MODE_ID);
  });

  it('defaults OpenCode mode selection to the managed full-access mode before ACP mode discovery finishes', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          opencode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.resolveSelectedModeId()).toBe(OPENCODE_FULL_ACCESS_MODE_ID);
  });

  it('falls back to the managed full-access mode when a saved custom mode is not managed by Grimoire', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          opencode: {
            availableModes: [],
            selectedMode: 'compaction',
          },
        },
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.resolveSelectedModeId()).toBe(OPENCODE_FULL_ACCESS_MODE_ID);
  });

  it('prefers managed full-access/safe/plan modes over auxiliary OpenCode primary modes for the main toolbar', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          opencode: {
            availableModes: [
              { id: OPENCODE_BUILD_MODE_ID, name: 'build' },
              { id: 'compaction', name: 'compaction' },
              { id: OPENCODE_SAFE_MODE_ID, name: 'grimoire-safe' },
              { id: 'plan', name: 'plan' },
            ],
            selectedMode: '',
          },
        },
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.resolveSelectedModeId()).toBe(OPENCODE_FULL_ACCESS_MODE_ID);
  });

  it('maps shared safe mode onto the managed OpenCode safe agent', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'normal',
        providerConfigs: {
          opencode: {
            availableModes: [
              { id: OPENCODE_FULL_ACCESS_MODE_ID, name: 'Auto-approve' },
              { id: OPENCODE_SAFE_MODE_ID, name: 'Safe' },
              { id: 'plan', name: 'Plan' },
            ],
            selectedMode: OPENCODE_FULL_ACCESS_MODE_ID,
          },
        },
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.resolveSelectedModeId()).toBe(OPENCODE_SAFE_MODE_ID);
  });

  it('syncs managed OpenCode safe mode back through the permission-mode callback', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          opencode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const syncCallback = jest.fn();
    const state = createState(plugin, { syncPermissionMode: syncCallback });

    await state.syncSessionModeState({
      currentModeId: OPENCODE_SAFE_MODE_ID,
    });

    expect(syncCallback).toHaveBeenCalledWith('normal');
  });

  it('maps the legacy build alias back through the permission-mode callback as Auto-approve', async () => {
    const syncCallback = jest.fn();
    const state = createState(createMockPlugin(), { syncPermissionMode: syncCallback });

    await state.syncSessionModeState({
      currentModeId: OPENCODE_BUILD_MODE_ID,
    });

    expect(syncCallback).toHaveBeenCalledWith('full_access');
  });

  it('preserves the explicit user model selection when the session reports its current model', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        effortLevel: 'high',
        model: 'opencode:anthropic/claude-sonnet-4',
        providerConfigs: {
          opencode: {
            discoveredModels: [
              { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
              { label: 'Anthropic/Claude Sonnet 4 (high)', rawId: 'anthropic/claude-sonnet-4/high' },
            ],
            preferredThinkingByModel: {
              'anthropic/claude-sonnet-4': 'high',
            },
            visibleModels: ['anthropic/claude-sonnet-4'],
          },
        },
        savedProviderEffort: {
          opencode: 'high',
        },
        savedProviderModel: {
          opencode: 'opencode:anthropic/claude-sonnet-4',
        },
        settingsProvider: 'opencode',
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('opencode');
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await state.syncSessionModelState({
      configOptions: [{
        currentValue: 'anthropic/claude-sonnet-4',
        id: 'model',
        name: 'Model',
        options: [
          { name: 'Anthropic/Claude Sonnet 4', value: 'anthropic/claude-sonnet-4' },
          { name: 'Anthropic/Claude Sonnet 4 (high)', value: 'anthropic/claude-sonnet-4/high' },
        ],
        type: 'select',
      }],
    });

    expect(plugin.settings.providerConfigs.opencode.preferredThinkingByModel).toEqual({
      'anthropic/claude-sonnet-4': 'high',
    });
    expect(plugin.settings.savedProviderModel.opencode).toBe('opencode:anthropic/claude-sonnet-4');
    expect(plugin.settings.savedProviderEffort.opencode).toBe('high');
    expect(plugin.settings.model).toBe('opencode:anthropic/claude-sonnet-4');
    expect(plugin.settings.effortLevel).toBe('high');
    expect(state.resolveSelectedRawModelId()).toBe('anthropic/claude-sonnet-4');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).not.toHaveBeenCalled();
  });

  it('seeds visible OpenCode models from ACP discovery when none are configured', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'opencode',
        providerConfigs: {
          opencode: {
            discoveredModels: [],
            visibleModels: [],
          },
        },
        settingsProvider: 'opencode',
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('opencode');

    await state.syncSessionModelState({
      configOptions: [{
        category: 'model',
        currentValue: 'openai/gpt-5',
        id: 'model',
        name: 'Model',
        options: [
          { name: 'OpenAI/GPT-5', value: 'openai/gpt-5' },
          { name: 'Anthropic/Claude Sonnet 4', value: 'anthropic/claude-sonnet-4' },
        ],
        type: 'select',
      }],
    });

    expect(getOpencodeProviderSettings(plugin.settings).visibleModels).toEqual([
      'anthropic/claude-sonnet-4',
      'openai/gpt-5',
    ]);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('syncs detached ACP thought-level options into OpenCode provider state', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'opencode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          opencode: {
            discoveredModels: [],
            preferredThinkingByModel: {},
            visibleModels: ['deepseek/deepseek-v4-pro'],
          },
        },
        settingsProvider: 'opencode',
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('opencode');

    await state.syncSessionModelState({
      configOptions: [
        {
          category: 'model',
          currentValue: 'deepseek/deepseek-v4-pro',
          id: 'model',
          name: 'Model',
          options: [
            { name: 'DeepSeek/DeepSeek V4 Pro', value: 'deepseek/deepseek-v4-pro' },
          ],
          type: 'select',
        },
        {
          category: 'thought_level',
          currentValue: 'low',
          id: 'effort',
          name: 'Effort',
          options: [
            { name: 'Low', value: 'low' },
            { name: 'Medium', value: 'medium' },
            { name: 'High', value: 'high' },
            { name: 'Max', value: 'max' },
          ],
          type: 'select',
        },
      ],
    });

    expect(getOpencodeProviderSettings(plugin.settings).thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Max', value: 'max' },
      ],
    });
    expect(plugin.settings.providerConfigs.opencode.preferredThinkingByModel).toEqual({
      'deepseek/deepseek-v4-pro': 'low',
    });
    expect(plugin.settings.providerConfigs.opencode.thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Max', value: 'max' },
      ],
    });
    expect(plugin.settings.effortLevel).toBe('low');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('applies selected OpenCode effort through the detached ACP effort option', async () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'opencode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          opencode: {
            discoveredModels: [
              { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
            ],
            thinkingOptionsByModel: {
              'deepseek/deepseek-v4-pro': [
                { label: 'Low', value: 'low' },
                { label: 'High', value: 'high' },
              ],
            },
            visibleModels: ['deepseek/deepseek-v4-pro'],
          },
        },
        settingsProvider: 'opencode',
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);
    // The session is told what its thinking levels are the way it is told in
    // production: by the reply that reports them.
    await state.syncSessionModelState({
      configOptions: [{
        category: 'thought_level',
        currentValue: 'low',
        id: 'effort',
        name: 'Effort',
        options: [
          { name: 'Low', value: 'low' },
          { name: 'High', value: 'high' },
        ],
        type: 'select',
      }],
    });

    // What a turn asks the session to be set to, which the applier sends as a
    // `setConfigOption` under the id the session named.
    expect(state.effortConfigId).toBe('effort');
    expect(state.resolveSelectedEffortValue()).toBe('high');
  });

  it('exposes the active display model for auxiliary OpenCode tasks', () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'opencode:anthropic/claude-sonnet-4',
        providerConfigs: {
          opencode: {
            discoveredModels: [
              { label: 'Anthropic/Claude Sonnet 4', rawId: 'anthropic/claude-sonnet-4' },
              { label: 'Anthropic/Claude Sonnet 4 (high)', rawId: 'anthropic/claude-sonnet-4/high' },
            ],
            preferredThinkingByModel: {
              'anthropic/claude-sonnet-4': 'high',
            },
            visibleModels: ['anthropic/claude-sonnet-4'],
          },
        },
        savedProviderModel: {
          opencode: 'opencode:anthropic/claude-sonnet-4',
        },
        settingsProvider: 'opencode',
      },
    });
    const state = createState(plugin);

    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('opencode');
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.getActiveDisplayModel()).toBe('opencode:anthropic/claude-sonnet-4');
  });
});
