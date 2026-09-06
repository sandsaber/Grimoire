import '@/providers';

import * as modelRouting from '@/core/providers/modelRouting';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import {
  type GrokSessionConfigPorts,
  GrokSessionConfigState,
} from '@/providers/grok/execution/GrokSessionConfigState';
import {
  GROK_BUILD_MODE_ID,
  GROK_FULL_ACCESS_MODE_ID,
  GROK_SAFE_MODE_ID,
} from '@/providers/grok/modes';
import { getGrokProviderSettings } from '@/providers/grok/settings';

jest.mock('@/providers/grok/runtime/GrokModelsCache', () => {
  const actual = jest.requireActual('@/providers/grok/runtime/GrokModelsCache');
  return {
    ...actual,
    readGrokNativeModelCatalog: jest.fn(() => ({ defaultModelId: null, models: [] })),
  };
});

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {},
    manifest: { version: '0.0.0-test' },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/grok'),
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
  ports: Partial<GrokSessionConfigPorts> = {},
): GrokSessionConfigState {
  return new GrokSessionConfigState({
    settingsBag: () => plugin.settings,
    saveSettings: () => plugin.saveSettings(),
    refreshSelectors: () => {
      for (const view of plugin.getAllViews()) {
        view.refreshModelSelector();
      }
    },
    workspaceRoot: () => plugin.app.vault.adapter.basePath,
    cliPath: () => plugin.getResolvedProviderCliPath('grok'),
    recordDebug: () => undefined,
    ...ports,
  });
}

/**
 * What a Grok session is set to, and what the vault learns from it.
 *
 * These are the legacy runtime's own tests, moved rather than rewritten when it
 * was deleted: the behaviour they cover — which mode a turn runs under, the
 * discovered models, the per-model thinking options, the visible list and the
 * active selection — did not move with the flip, only the object holding it did.
 */
describe('Grok session configuration state', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('syncs Grok Build session modes into provider settings without clobbering an explicit user choice', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        providerConfigs: {
          grok: {
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
        category: 'mode',
        currentValue: 'build',
        id: 'session_mode',
        name: 'Mode',
        options: [
          { name: 'Build', value: 'build' },
          { description: 'Planning-first agent', name: 'Plan', value: 'plan' },
        ],
        type: 'select',
      }],
    });

    expect(getGrokProviderSettings(plugin.settings).availableModes).toEqual([
      { id: 'build', name: 'Build' },
      { description: 'Planning-first agent', id: 'plan', name: 'Plan' },
    ]);
    expect(plugin.settings.providerConfigs.grok.selectedMode).toBe('plan');
    expect(state.sessionModeConfigId).toBe('session_mode');
    expect(state.sessionModeId).toBe('build');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('does not derive a saved permission choice from provider-reported session state', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          grok: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const state = createState(plugin);

    await state.syncSessionModeState({
      currentModeId: GROK_BUILD_MODE_ID,
    });

    expect(plugin.settings.providerConfigs.grok.selectedMode).toBe('');
    expect(state.sessionModeId).toBe(GROK_BUILD_MODE_ID);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('defaults Grok Build mode selection to the managed full-access mode before ACP mode discovery finishes', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          grok: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.resolveSelectedModeId()).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('falls back to the managed full-access mode when a saved custom mode is not managed by Grimoire', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          grok: {
            availableModes: [],
            selectedMode: 'compaction',
          },
        },
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.resolveSelectedModeId()).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('prefers managed full-access/safe/plan modes over auxiliary Grok Build primary modes for the main toolbar', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          grok: {
            availableModes: [
              { id: GROK_BUILD_MODE_ID, name: 'build' },
              { id: 'compaction', name: 'compaction' },
              { id: GROK_SAFE_MODE_ID, name: 'grimoire-safe' },
              { id: 'plan', name: 'plan' },
            ],
            selectedMode: '',
          },
        },
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.resolveSelectedModeId()).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('maps shared safe mode onto the managed Grok Build safe agent', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'normal',
        providerConfigs: {
          grok: {
            availableModes: [
              { id: GROK_FULL_ACCESS_MODE_ID, name: 'Auto-approve' },
              { id: GROK_SAFE_MODE_ID, name: 'Safe' },
              { id: 'plan', name: 'Plan' },
            ],
            selectedMode: GROK_FULL_ACCESS_MODE_ID,
          },
        },
      },
    });
    const state = createState(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(state.resolveSelectedModeId()).toBe(GROK_SAFE_MODE_ID);
  });

  it('keeps provider-reported modes observational instead of persisting authorization', async () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'normal',
        providerConfigs: {
          grok: {
            availableModes: [],
            selectedMode: GROK_SAFE_MODE_ID,
          },
        },
      },
    });
    const state = createState(plugin);

    await state.syncSessionModeState({
      currentModeId: GROK_BUILD_MODE_ID,
    });

    expect(state.sessionModeId).toBe(GROK_BUILD_MODE_ID);
    expect(plugin.settings.permissionMode).toBe('normal');
    expect(plugin.settings.providerConfigs.grok.selectedMode).toBe(GROK_SAFE_MODE_ID);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('preserves the explicit user model selection when the session reports its current model', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        effortLevel: 'high',
        model: 'grok:anthropic/claude-sonnet-4',
        providerConfigs: {
          grok: {
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
          grok: 'high',
        },
        savedProviderModel: {
          grok: 'grok:anthropic/claude-sonnet-4',
        },
        settingsProvider: 'grok',
      },
    });
    const state = createState(plugin);
    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');
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

    expect(plugin.settings.providerConfigs.grok.preferredThinkingByModel).toEqual({
      'anthropic/claude-sonnet-4': 'high',
    });
    expect(plugin.settings.savedProviderModel.grok).toBe('grok:anthropic/claude-sonnet-4');
    expect(plugin.settings.savedProviderEffort.grok).toBe('high');
    expect(plugin.settings.model).toBe('grok:anthropic/claude-sonnet-4');
    expect(plugin.settings.effortLevel).toBe('high');
    expect(state.resolveSelectedRawModelId()).toBe('anthropic/claude-sonnet-4');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).not.toHaveBeenCalled();
  });

  it('seeds visible Grok Build models from ACP discovery when none are configured', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'grok',
        providerConfigs: {
          grok: {
            discoveredModels: [],
            visibleModels: [],
          },
        },
        settingsProvider: 'grok',
      },
    });
    const state = createState(plugin);
    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');

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

    expect(getGrokProviderSettings(plugin.settings).visibleModels).toEqual([
      'anthropic/claude-sonnet-4',
      'openai/gpt-5',
    ]);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('retargets stale Grok model selections to the current authoritative ACP model', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        effortLevel: 'high',
        model: 'grok:grok-composer-2.5-fast',
        providerConfigs: {
          grok: {
            discoveredModels: [
              { label: 'Grok Build', rawId: 'grok-build' },
              { label: 'Grok Composer 2.5 Fast', rawId: 'grok-composer-2.5-fast' },
            ],
            preferredThinkingByModel: {
              'grok-composer-2.5-fast': 'high',
            },
            visibleModels: ['grok-build', 'grok-composer-2.5-fast'],
          },
        },
        savedProviderEffort: {
          grok: 'high',
        },
        savedProviderModel: {
          grok: 'grok:grok-composer-2.5-fast',
        },
        settingsProvider: 'grok',
      },
    });
    const state = createState(plugin);
    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');

    await state.syncSessionModelState({
      models: {
        availableModels: [
          { id: 'grok-4.5', name: 'Grok 4.5' },
        ],
        currentModelId: 'grok-4.5',
      },
    });

    expect(getGrokProviderSettings(plugin.settings).discoveredModels).toEqual([
      { label: 'Grok 4.5', rawId: 'grok-4.5' },
    ]);
    expect(plugin.settings.providerConfigs.grok.visibleModels).toEqual(['grok-4.5']);
    expect(plugin.settings.savedProviderModel.grok).toBe('grok:grok-4.5');
    expect(plugin.settings.model).toBe('grok:grok-4.5');
    expect(plugin.settings.savedProviderEffort.grok).toBe('default');
    expect(plugin.settings.effortLevel).toBe('default');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('keeps Grok 4.6 visible and selected when ACP only reports a seeded 4.5 session', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'grok:grok-4.5',
        providerConfigs: {
          grok: {
            visibleModels: ['grok-4.5'],
          },
        },
        savedProviderModel: {
          grok: 'grok:grok-4.5',
        },
        settingsProvider: 'grok',
      },
    });
    const state = createState(plugin);
    jest.spyOn(state, 'readNativeModelCatalog').mockReturnValue({
      defaultModelId: 'grok-4.6',
      models: [
        { label: 'Grok 4.6', rawId: 'grok-4.6' },
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    });
    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');

    await state.syncSessionModelState({
      models: {
        availableModels: [
          { id: 'grok-4.5', name: 'Grok 4.5' },
        ],
        currentModelId: 'grok-4.5',
      },
    });

    expect(getGrokProviderSettings(plugin.settings).discoveredModels).toEqual([
      { label: 'Grok 4.6', rawId: 'grok-4.6' },
      { label: 'Grok 4.5', rawId: 'grok-4.5' },
    ]);
    expect(plugin.settings.providerConfigs.grok.visibleModels).toEqual([
      'grok-4.5',
      'grok-4.6',
    ]);
    expect(plugin.settings.savedProviderModel.grok).toBe('grok:grok-4.6');
    expect(plugin.settings.model).toBe('grok:grok-4.6');
  });

  /**
   * Shape taken from a live `session/new` response: Grok Build states the levels
   * for every model it offers, in each model's `_meta`, and grok-4.5's list is
   * one level shorter than grok-4.6's.
   */
  const LIVE_SESSION_MODELS = {
    availableModels: [
      {
        modelId: 'grok-4.6',
        name: 'Grok 4.6',
        _meta: {
          supportsReasoningEffort: true,
          reasoningEffort: 'xhigh',
          reasoningEfforts: [
            { id: 'xhigh', value: 'xhigh', label: 'Extra High Effort', default: false },
            { id: 'high', value: 'high', label: 'High Effort', default: true },
            { id: 'medium', value: 'medium', label: 'Medium Effort', default: false },
            { id: 'low', value: 'low', label: 'Low Effort', default: false },
          ],
        },
      },
      {
        modelId: 'grok-4.5',
        name: 'Grok 4.5',
        _meta: {
          supportsReasoningEffort: true,
          reasoningEffort: 'high',
          reasoningEfforts: [
            { id: 'high', value: 'high', label: 'High Effort', default: true },
            { id: 'medium', value: 'medium', label: 'Medium Effort', default: false },
            { id: 'low', value: 'low', label: 'Low Effort', default: false },
          ],
        },
      },
    ],
    currentModelId: 'grok-4.6',
  };

  function createModelReportingPlugin(grokConfig: Record<string, unknown> = {}): any {
    return createMockPlugin({
      settings: {
        model: 'grok:grok-4.6',
        providerConfigs: {
          grok: {
            discoveredModels: [],
            preferredThinkingByModel: {},
            visibleModels: [],
            ...grokConfig,
          },
        },
        settingsProvider: 'grok',
      },
    });
  }

  it('records the reasoning levels each available model reports, not only the active one', async () => {
    // `thought_level` speaks for the active model alone, so a picker fed only by
    // it has to guess every other model from its id - and the guess is wrong
    // whenever two native models differ.
    const plugin = createModelReportingPlugin();
    const state = createState(plugin);
    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');

    await state.syncSessionModelState({ models: LIVE_SESSION_MODELS });

    const thinkingOptions = getGrokProviderSettings(plugin.settings).thinkingOptionsByModel;
    expect(thinkingOptions['grok-4.6'].map((variant) => variant.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    // grok-4.5 was never the active model, and it must still not be offered a
    // level Grok Build refuses for it.
    expect(thinkingOptions['grok-4.5'].map((variant) => variant.value)).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('lets the live thought-level option override the reported levels for the active model', async () => {
    const plugin = createModelReportingPlugin();
    const state = createState(plugin);
    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');

    await state.syncSessionModelState({
      configOptions: [
        {
          category: 'thought_level',
          currentValue: 'high',
          id: 'effort',
          name: 'Effort',
          options: [
            { name: 'High', value: 'high' },
            { name: 'Low', value: 'low' },
          ],
          type: 'select',
        },
      ],
      models: LIVE_SESSION_MODELS,
    });

    // The option describes this session as it is now, the report describes the
    // catalog, so the session wins where they disagree.
    expect(getGrokProviderSettings(plugin.settings).thinkingOptionsByModel['grok-4.6']
      .map((variant) => variant.value)).toEqual(['low', 'high']);
    // A model the option says nothing about keeps what the session reported.
    expect(getGrokProviderSettings(plugin.settings).thinkingOptionsByModel['grok-4.5']
      .map((variant) => variant.value)).toEqual(['low', 'medium', 'high']);
  });

  it('still forgets a stale level list when nothing in the session describes the model', async () => {
    const plugin = createModelReportingPlugin({
      discoveredModels: [{ label: 'Grok 4.6', rawId: 'grok-4.6' }],
      thinkingOptionsByModel: { 'grok-4.6': [{ label: 'Extra high', value: 'xhigh' }] },
      visibleModels: ['grok-4.6'],
    });
    const state = createState(plugin);
    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');

    // No `_meta` and no thought_level option: nothing here describes the model,
    // which is the case the stale list still has to be dropped in.
    await state.syncSessionModelState({
      models: { availableModels: [{ modelId: 'grok-4.6', name: 'Grok 4.6' }], currentModelId: 'grok-4.6' },
    });

    expect(getGrokProviderSettings(plugin.settings).thinkingOptionsByModel['grok-4.6']).toBeUndefined();
  });

  it('syncs detached ACP thought-level options into Grok Build provider state', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'grok:deepseek/deepseek-v4-pro',
        providerConfigs: {
          grok: {
            discoveredModels: [],
            preferredThinkingByModel: {},
            visibleModels: ['deepseek/deepseek-v4-pro'],
          },
        },
        settingsProvider: 'grok',
      },
    });
    const state = createState(plugin);
    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');

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

    expect(getGrokProviderSettings(plugin.settings).thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Max', value: 'max' },
      ],
    });
    expect(plugin.settings.providerConfigs.grok.preferredThinkingByModel).toEqual({
      'deepseek/deepseek-v4-pro': 'low',
    });
    expect(plugin.settings.providerConfigs.grok.thinkingOptionsByModel).toEqual({
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

  it('exposes the active display model for auxiliary Grok Build tasks', () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'grok:anthropic/claude-sonnet-4',
        providerConfigs: {
          grok: {
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
          grok: 'grok:anthropic/claude-sonnet-4',
        },
        settingsProvider: 'grok',
      },
    });
    const state = createState(plugin);

    jest.spyOn(modelRouting, 'resolveSettingsProviderId').mockReturnValue('grok');
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    // What an auxiliary Grok task is labelled with, which the runtime answered
    // from this same reading.
    expect(state.getActiveDisplayModel()).toBe('grok:anthropic/claude-sonnet-4');
  });
});
