import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { JsonRpcTransportClosedError } from '@/providers/acp';
import '@/providers';
import { grokPlanUsageStore } from '@/providers/grok/app/GrokPlanUsageStore';
import {
  GROK_BUILD_MODE_ID,
  GROK_FULL_ACCESS_MODE_ID,
  GROK_SAFE_MODE_ID,
} from '@/providers/grok/modes';
import { GrokChatRuntime } from '@/providers/grok/runtime/GrokChatRuntime';
import * as launchArtifacts from '@/providers/grok/runtime/GrokLaunchArtifacts';
import { getGrokProviderSettings } from '@/providers/grok/settings';

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

describe('GrokChatRuntime', () => {
  beforeEach(() => {
    grokPlanUsageStore.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function collectRuntimeChunks(runtime: GrokChatRuntime): Promise<unknown[]> {
    const chunks: unknown[] = [];
    for await (const chunk of runtime.query(
      runtime.prepareTurn({ text: 'Plan this work' }),
      undefined,
      { orchestratorMode: true },
    )) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it('sends orchestrator instructions in the per-turn ACP prompt when active', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({});

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);

    await collectRuntimeChunks(runtime);

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('## Grimoire Orchestrator Mode'),
          type: 'text',
        }),
      ]),
    }));
  });

  it('retries the prompt once when the Grok Build ACP transport closes before output', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const prompt = jest.fn()
      .mockRejectedValueOnce(new JsonRpcTransportClosedError('JSON-RPC input closed'))
      .mockResolvedValueOnce({});

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    jest.spyOn(runtime as any, 'prepareClosedTransportRetry').mockImplementation(async () => {
      (runtime as any).sessionId = 'session-2';
      (runtime as any).loadedSessionId = 'session-2';
      return true;
    });
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('grok:test-model');

    const history = [
      { id: 'user-previous', role: 'user' as const, content: 'Keep the language rich.', timestamp: 1 },
      { id: 'assistant-previous', role: 'assistant' as const, content: 'I will preserve the prose voice.', timestamp: 2 },
    ];
    const chunks: unknown[] = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Continue the edit.' }), history)) {
      chunks.push(chunk);
    }

    expect(prompt).toHaveBeenCalledTimes(2);
    const retryText = prompt.mock.calls[1][0].prompt[0].text;
    expect(retryText).toContain('User: Keep the language rich.');
    expect(retryText).toContain('Assistant: I will preserve the prose voice.');
    expect(chunks).toEqual([{ type: 'done' }]);
  });

  it('captures available ACP commands even when no turn is active', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    runtime.syncConversationState({ providerState: {}, sessionId: 'session-1' });

    (runtime as any).loadedSessionId = 'session-1';

    const commandsPromise = runtime.getSupportedCommands();

    await (runtime as any).handleSessionNotification({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'review', description: 'Review changes' },
          { name: 'fix', description: 'Fix the issue' },
        ],
      },
    });

    await expect(commandsPromise).resolves.toEqual([
      {
        id: 'acp:review',
        name: 'review',
        description: 'Review changes',
        content: '',
        source: 'sdk',
      },
      {
        id: 'acp:fix',
        name: 'fix',
        description: 'Fix the issue',
        content: '',
        source: 'sdk',
      },
    ]);
  });

  it('does not create a session when commands are requested before a session exists', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());

    (runtime as any).ready = true;
    (runtime as any).createSession = jest.fn();

    await expect(runtime.getSupportedCommands()).resolves.toEqual([]);
    expect((runtime as any).createSession).not.toHaveBeenCalled();
  });

  it('falls back to Grok Build session metadata cost when ACP usage omits cost', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
    });
    const runtime = new GrokChatRuntime(plugin);
    const prompt = jest.fn().mockResolvedValue({
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
    });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).currentDatabasePath = '/tmp/grok.db';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);
    const fallbackSpy = jest.spyOn(runtime as any, 'refreshFallbackPlanUsageFromSessionCost')
      .mockImplementation(async (sessionId: unknown) => {
        if (typeof sessionId !== 'string') {
          return;
        }
        if (grokPlanUsageStore.recordSessionTotalCost(sessionId, { amount: 1.23, currency: 'USD' })) {
          (runtime as any).refreshModelSelectors();
        }
      });

    const chunks = await collectRuntimeChunks(runtime);

    expect(prompt).toHaveBeenCalled();
    expect(chunks).toEqual([
      expect.objectContaining({ type: 'usage' }),
      { type: 'done' },
    ]);
    expect(fallbackSpy).toHaveBeenCalledWith('session-1');
    expect(grokPlanUsageStore.getCachedUsage({
      plugin: {} as any,
      providerId: 'grok',
      settings: {},
    })).toEqual({
      plan: 'API keys',
      spend: '$1.23 this month',
      note: 'Pay per token across vendors · no cap set.',
    });
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('marks missing saved sessions invalidated without creating a replacement command session', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          grok: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    runtime.syncConversationState({
      providerState: {
        sessionDirPath: '/persisted/grok/session-1',
        workspacePath: '/vault',
      },
      sessionId: 'session-1',
    });

    jest.spyOn(launchArtifacts, 'prepareGrokLaunchArtifacts').mockResolvedValue({
      configContent: '# managed\n',
      grokHomePath: '/tmp/grimoire-grok',
      launchKey: 'launch-key',
      managedConfigPath: '/tmp/grimoire-grok/managed_config.toml',
      systemPromptPath: '/tmp/grimoire-grok/system.md',
    });
    (runtime as any).startProcess = jest.fn().mockImplementation(async () => {
      (runtime as any).ready = true;
    });
    (runtime as any).loadSession = jest.fn().mockResolvedValue(false);
    (runtime as any).createSession = jest.fn().mockResolvedValue('session-2');

    await expect(runtime.ensureReady()).resolves.toBe(true);
    await expect(runtime.getSupportedCommands()).resolves.toEqual([]);
    expect((runtime as any).createSession).not.toHaveBeenCalled();
    expect(runtime.getSessionId()).toBeNull();
    expect(runtime.consumeSessionInvalidation()).toBe(true);
    expect(runtime.consumeSessionInvalidation()).toBe(false);
  });

  it('reuses launch artifacts when switching to a saved session without persisted provider state', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          grok: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    runtime.syncConversationState({
      providerState: {
        sessionDirPath: '/persisted/grok/session-1',
        workspacePath: '/vault',
      },
      sessionId: 'session-1',
    });
    runtime.syncConversationState({
      providerState: {},
      sessionId: 'session-2',
    });

    jest.spyOn(launchArtifacts, 'prepareGrokLaunchArtifacts').mockResolvedValue({
      configContent: '# managed\n',
      grokHomePath: '/tmp/grimoire-grok',
      launchKey: 'launch-key',
      managedConfigPath: '/tmp/grimoire-grok/managed_config.toml',
      systemPromptPath: '/tmp/grimoire-grok/system.md',
    });
    (runtime as any).startProcess = jest.fn().mockImplementation(async () => {
      (runtime as any).ready = true;
    });
    (runtime as any).loadSession = jest.fn().mockResolvedValue(true);

    await expect(runtime.ensureReady()).resolves.toBe(true);
  });

  it('passes GROK_HOME from launch artifacts into the runtime process env', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          grok: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new GrokChatRuntime(plugin);

    jest.spyOn(launchArtifacts, 'prepareGrokLaunchArtifacts').mockResolvedValue({
      configContent: '# managed\n',
      grokHomePath: '/tmp/grimoire-grok-home',
      launchKey: 'launch-key',
      managedConfigPath: '/tmp/grimoire-grok-home/managed_config.toml',
      systemPromptPath: '/tmp/grimoire-grok-home/system.md',
    });
    const startProcess = jest.spyOn(runtime as any, 'startProcess').mockImplementation(async (...args: unknown[]) => {
      const params = args[0] as { runtimeEnv: NodeJS.ProcessEnv };
      expect(params.runtimeEnv.GROK_HOME).toBe('/tmp/grimoire-grok-home');
      (runtime as any).ready = true;
    });

    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);
    expect(startProcess).toHaveBeenCalled();
  });

  it('restarts when the ACP transport closed even if the subprocess still looks alive', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          grok: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const mockTransport = { dispose: jest.fn(), isClosed: false };
    const mockProcess = { isAlive: jest.fn().mockReturnValue(true), shutdown: jest.fn() };
    const mockConnection = { dispose: jest.fn() };

    jest.spyOn(launchArtifacts, 'prepareGrokLaunchArtifacts').mockResolvedValue({
      configContent: '# managed\n',
      grokHomePath: '/tmp/grimoire-grok',
      launchKey: 'launch-key',
      managedConfigPath: '/tmp/grimoire-grok/managed_config.toml',
      systemPromptPath: '/tmp/grimoire-grok/system.md',
    });
    const shutdownProcess = jest.spyOn(runtime as any, 'shutdownProcess').mockResolvedValue(undefined);
    const startProcess = jest.spyOn(runtime as any, 'startProcess').mockImplementation(async () => {
      (runtime as any).connection = mockConnection;
      (runtime as any).process = mockProcess;
      (runtime as any).transport = mockTransport;
    });

    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);
    mockTransport.isClosed = true;
    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);

    expect(shutdownProcess).toHaveBeenCalledTimes(2);
    expect(startProcess).toHaveBeenCalledTimes(2);
  });

  it('maps ACP permission options through the shared approval UI', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const approvalCallback = jest.fn().mockResolvedValue('allow');

    runtime.setApprovalCallback(approvalCallback);

    await expect((runtime as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'approve-now' },
        { kind: 'allow_always', name: 'Always allow', optionId: 'approve-always' },
        { kind: 'reject_once', name: 'Deny', optionId: 'deny-now' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'other',
        rawInput: { filepath: '/tmp/outside', parentDir: '/tmp' },
        title: 'external_directory',
        toolCallId: 'tool-1',
      },
    })).resolves.toEqual({
      outcome: {
        optionId: 'approve-now',
        outcome: 'selected',
      },
    });

    expect(approvalCallback).toHaveBeenCalledWith(
      'External Directory',
      { filepath: '/tmp/outside', parentDir: '/tmp' },
      'Grok Build wants to access a path outside the working directory.',
      {
        blockedPath: '/tmp/outside',
        decisionOptions: [
          { decision: 'allow', label: 'Allow once', value: 'approve-now' },
          { decision: 'allow-always', label: 'Always allow', value: 'approve-always' },
          { label: 'Deny', value: 'deny-now' },
        ],
        decisionReason: 'Path is outside the session working directory',
      },
    );
  });

  it('passes GROK_HOME and provider env vars into the runtime process env', () => {
    const runtime = new GrokChatRuntime(createMockPlugin({
      settings: {
        providerConfigs: {
          grok: {
            environmentVariables: 'XAI_API_KEY=test-key',
          },
        },
      },
    }));

    const env = (runtime as any).buildRuntimeEnv('/usr/local/bin/grok', '/tmp/grimoire-grok-home');

    expect(env.GROK_HOME).toBe('/tmp/grimoire-grok-home');
    expect(env.GROK_AUTH_PATH).toEqual(expect.stringMatching(/\/\.grok\/auth\.json$/));
    expect(env.XAI_API_KEY).toBe('test-key');
  });

  it('does not override an explicit GROK_AUTH_PATH from provider env vars', () => {
    const runtime = new GrokChatRuntime(createMockPlugin({
      settings: {
        providerConfigs: {
          grok: {
            environmentVariables: 'GROK_AUTH_PATH=/custom/auth.json',
          },
        },
      },
    }));

    const env = (runtime as any).buildRuntimeEnv('/usr/local/bin/grok', '/tmp/grimoire-grok-home');

    expect(env.GROK_AUTH_PATH).toBe('/custom/auth.json');
  });

  it('returns the nested ACP approval envelope for allow-always selections', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    runtime.setApprovalCallback(jest.fn().mockResolvedValue('allow-always'));

    await expect((runtime as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'approve-now' },
        { kind: 'allow_always', name: 'Always allow', optionId: 'approve-always' },
        { kind: 'reject_once', name: 'Reject', optionId: 'deny-now' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'other',
        rawInput: { filepath: '/tmp/outside', parentDir: '/tmp' },
        title: 'external_directory',
        toolCallId: 'tool-1',
      },
    })).resolves.toEqual({
      outcome: {
        optionId: 'approve-always',
        outcome: 'selected',
      },
    });
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
    const runtime = new GrokChatRuntime(plugin);

    await (runtime as any).syncSessionModeState({
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

    expect(getGrokProviderSettings(plugin.settings).availableModes).toEqual([
      { id: 'build', name: 'Build' },
      { description: 'Planning-first agent', id: 'plan', name: 'Plan' },
    ]);
    expect(plugin.settings.providerConfigs.grok.selectedMode).toBe('plan');
    expect((runtime as any).currentSessionModeId).toBe('build');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('seeds the Grok Build selected mode when no explicit mode has been saved yet', async () => {
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
    const runtime = new GrokChatRuntime(plugin);

    await (runtime as any).syncSessionModeState({
      currentModeId: GROK_BUILD_MODE_ID,
    });

    expect(plugin.settings.providerConfigs.grok.selectedMode).toBe(GROK_FULL_ACCESS_MODE_ID);
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(GROK_FULL_ACCESS_MODE_ID);
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(GROK_FULL_ACCESS_MODE_ID);
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(GROK_FULL_ACCESS_MODE_ID);
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(GROK_SAFE_MODE_ID);
  });

  it('syncs managed Grok Build safe mode back through the permission-mode callback', async () => {
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
    const runtime = new GrokChatRuntime(plugin);
    const syncCallback = jest.fn();

    runtime.setPermissionModeSyncCallback(syncCallback);

    await (runtime as any).syncSessionModeState({
      currentModeId: GROK_SAFE_MODE_ID,
    });

    expect(syncCallback).toHaveBeenCalledWith('normal');
  });

  it('maps the legacy build alias back through the permission-mode callback as Auto-approve', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const syncCallback = jest.fn();

    runtime.setPermissionModeSyncCallback(syncCallback);

    await (runtime as any).syncSessionModeState({
      currentModeId: GROK_BUILD_MODE_ID,
    });

    expect(syncCallback).toHaveBeenCalledWith('full_access');
  });

  it('applies the selected Auto-approve mode through session/set_mode before prompting', async () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
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
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const setMode = jest.fn().mockResolvedValue({});
    const setConfigOption = jest.fn();
    (runtime as any).connection = { setMode, setConfigOption };
    (runtime as any).currentSessionModeId = GROK_SAFE_MODE_ID;
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).applySelectedMode('session-1');

    expect(setMode).toHaveBeenCalledWith({
      modeId: GROK_FULL_ACCESS_MODE_ID,
      sessionId: 'session-1',
    });
    expect(setConfigOption).not.toHaveBeenCalled();
    expect((runtime as any).currentSessionModeId).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('falls back to the mode config select when session/set_mode is unavailable', async () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          grok: {
            availableModes: [
              { id: GROK_FULL_ACCESS_MODE_ID, name: 'Auto-approve' },
              { id: GROK_SAFE_MODE_ID, name: 'Safe' },
            ],
            selectedMode: GROK_FULL_ACCESS_MODE_ID,
          },
        },
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const setMode = jest.fn().mockRejectedValue(new Error('Method not found'));
    const setConfigOption = jest.fn().mockResolvedValue({
      configOptions: [{
        currentValue: GROK_FULL_ACCESS_MODE_ID,
        id: 'mode',
        name: 'Mode',
        options: [
          { name: 'Auto-approve', value: GROK_FULL_ACCESS_MODE_ID },
          { name: 'Safe', value: GROK_SAFE_MODE_ID },
        ],
        type: 'select',
      }],
    });
    (runtime as any).connection = { setMode, setConfigOption };
    (runtime as any).currentSessionModeId = GROK_SAFE_MODE_ID;
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).applySelectedMode('session-1');

    expect(setMode).toHaveBeenCalledWith({
      modeId: GROK_FULL_ACCESS_MODE_ID,
      sessionId: 'session-1',
    });
    expect(setConfigOption).toHaveBeenCalledWith({
      configId: 'mode',
      sessionId: 'session-1',
      type: 'select',
      value: GROK_FULL_ACCESS_MODE_ID,
    });
    expect((runtime as any).currentSessionModeId).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('does not clobber Auto-approve when the session still reports safe mode', async () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          grok: {
            availableModes: [
              { id: GROK_FULL_ACCESS_MODE_ID, name: 'Auto-approve' },
              { id: GROK_SAFE_MODE_ID, name: 'Safe' },
            ],
            selectedMode: GROK_FULL_ACCESS_MODE_ID,
          },
        },
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const syncCallback = jest.fn();
    runtime.setPermissionModeSyncCallback(syncCallback);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).syncSessionModeState({
      currentModeId: GROK_SAFE_MODE_ID,
    });

    expect((runtime as any).currentSessionModeId).toBe(GROK_SAFE_MODE_ID);
    expect(syncCallback).not.toHaveBeenCalled();
    expect(plugin.settings.permissionMode).toBe('full_access');
    expect(plugin.settings.providerConfigs.grok.selectedMode).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('still mirrors agent-driven plan mode and slash-command Auto-approve upgrades', async () => {
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
            selectedMode: GROK_SAFE_MODE_ID,
          },
        },
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const syncCallback = jest.fn();
    runtime.setPermissionModeSyncCallback(syncCallback);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).syncSessionModeState({
      currentModeId: 'plan',
    });
    expect(syncCallback).toHaveBeenCalledWith('plan');

    syncCallback.mockClear();
    await (runtime as any).syncSessionModeState({
      currentModeId: GROK_FULL_ACCESS_MODE_ID,
    });
    expect(syncCallback).toHaveBeenCalledWith('full_access');
  });

  it('does not push session mode into the permission toggle during create/load discovery', async () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          grok: {
            availableModes: [],
            selectedMode: GROK_FULL_ACCESS_MODE_ID,
          },
        },
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const syncCallback = jest.fn();
    runtime.setPermissionModeSyncCallback(syncCallback);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).syncSessionModeState({
      currentModeId: GROK_SAFE_MODE_ID,
    }, {
      syncPermissionToggle: false,
    });

    expect((runtime as any).currentSessionModeId).toBe(GROK_SAFE_MODE_ID);
    expect(syncCallback).not.toHaveBeenCalled();
  });

  it('summarizes workflow approval prompts with tool metadata', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const approvalCallback = jest.fn().mockResolvedValue('allow');

    runtime.setApprovalCallback(approvalCallback);

    await (runtime as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'approve-now' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'other',
        rawInput: {
          tools: [
            { name: 'bash', args: JSON.stringify({ title: 'npm test' }) },
            { name: 'edit', args: JSON.stringify({ title: 'src/app.ts' }) },
            { name: 'read', args: '{}' },
            { name: 'glob', args: '{}' },
          ],
        },
        title: 'workflow_tool_approval',
        toolCallId: 'tool-2',
      },
    });

    expect(approvalCallback).toHaveBeenCalledWith(
      'Workflow Approval',
      {
        tools: [
          { args: JSON.stringify({ title: 'npm test' }), name: 'bash' },
          { args: JSON.stringify({ title: 'src/app.ts' }), name: 'edit' },
          { args: '{}', name: 'read' },
          { args: '{}', name: 'glob' },
        ],
      },
      'Pre-approve workflow tools for this session: bash: npm test, edit: src/app.ts, read +1 more.',
      {
        decisionOptions: [
          { decision: 'allow', label: 'Allow once', value: 'approve-now' },
        ],
        decisionReason: 'Session-level workflow approval requested',
      },
    );
  });

  it('normalizes verbose execute permission titles as shell commands', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const approvalCallback = jest.fn().mockResolvedValue('allow');
    runtime.setApprovalCallback(approvalCallback);
    const command = 'python3 .grimoire/generate_data.py 2>&1 | tail -5 && wc -l vault-data.js';

    await (runtime as any).handlePermissionRequest({
      options: [{ kind: 'allow_once', name: 'Allow once', optionId: 'approve-now' }],
      sessionId: 'session-1',
      toolCall: {
        kind: 'execute',
        rawInput: { command },
        title: `Execute \`${command}\``,
        toolCallId: 'tool-execute',
      },
    });

    expect(approvalCallback).toHaveBeenCalledWith(
      'bash',
      { command },
      'Grok Build wants to run a shell command.',
      expect.objectContaining({
        decisionReason: 'Command execution permission required',
      }),
    );
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).syncSessionModelState({
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
    expect((runtime as any).resolveSelectedRawModelId()).toBe('anthropic/claude-sonnet-4');
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await (runtime as any).syncSessionModelState({
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await (runtime as any).syncSessionModelState({
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

  it('warms selected model metadata through Grok session/set_model', async () => {
    const plugin = createMockPlugin({
      settings: {
        model: 'grok:grok-build',
        providerConfigs: {
          grok: {
            discoveredModels: [
              { label: 'Grok Build', rawId: 'grok-build' },
            ],
            preferredThinkingByModel: {},
            visibleModels: ['grok-build'],
          },
        },
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const setModel = jest.fn().mockResolvedValue({
      _meta: { model: { Ok: 'grok-build' } },
    });
    (runtime as any).connection = { setModel };
    (runtime as any).sessionId = 'session-1';
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await expect(runtime.warmModelMetadata('grok:grok-build')).resolves.toBe(true);

    expect(setModel).toHaveBeenCalledWith({
      modelId: 'grok-build',
      sessionId: 'session-1',
    });
    expect((runtime as any).currentSessionModelId).toBe('grok-build');
  });

  it('applies the selected Grok model through session/set_model before prompting', async () => {
    const plugin = createMockPlugin({
      settings: {
        model: 'grok:grok-composer-2.5-fast',
        providerConfigs: {
          grok: {
            discoveredModels: [
              { label: 'Grok Build', rawId: 'grok-build' },
              { label: 'Grok Composer 2.5 Fast', rawId: 'grok-composer-2.5-fast' },
            ],
            visibleModels: ['grok-build', 'grok-composer-2.5-fast'],
          },
        },
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const setModel = jest.fn().mockResolvedValue({
      _meta: { model: { Ok: 'grok-composer-2.5-fast' } },
    });
    (runtime as any).connection = { setModel };
    (runtime as any).currentSessionModelId = 'grok-build';
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).applySelectedModel('session-1');

    expect(setModel).toHaveBeenCalledWith({
      modelId: 'grok-composer-2.5-fast',
      sessionId: 'session-1',
    });
    expect((runtime as any).currentSessionModelId).toBe('grok-composer-2.5-fast');
  });

  it('applies selected Grok Build effort through the detached ACP effort option', async () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'grok:deepseek/deepseek-v4-pro',
        providerConfigs: {
          grok: {
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
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    const setConfigOption = jest.fn().mockResolvedValue({
      configOptions: [{
        category: 'thought_level',
        currentValue: 'high',
        id: 'effort',
        name: 'Effort',
        options: [
          { name: 'Low', value: 'low' },
          { name: 'High', value: 'high' },
        ],
        type: 'select',
      }],
    });
    (runtime as any).connection = { setConfigOption };
    (runtime as any).currentSessionEffortConfigId = 'effort';
    (runtime as any).currentSessionEffortValue = 'low';
    (runtime as any).currentSessionEffortValues = new Set(['low', 'high']);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).applySelectedEffort('session-1');

    expect(setConfigOption).toHaveBeenCalledWith({
      configId: 'effort',
      sessionId: 'session-1',
      type: 'select',
      value: 'high',
    });
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
    const runtime = new GrokChatRuntime(plugin);

    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(runtime.getAuxiliaryModel()).toBe('grok:anthropic/claude-sonnet-4');
  });

  it('answers Grok ask_user_question server requests through the chat callback', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const askUserQuestion = jest.fn().mockResolvedValue({
      'What do you want to do?': 'notes',
    });
    runtime.setAskUserQuestionCallback(askUserQuestion);

    await expect((runtime as any).handleAskUserQuestionRequest({
      questions: [{
        multiSelect: false,
        options: [
          { description: 'Notes', label: 'notes' },
          { description: 'Code', label: 'code' },
        ],
        question: 'What do you want to do?',
      }],
      sessionId: 'session-1',
      toolCallId: 'call-1',
    })).resolves.toEqual({
      annotations: {},
      answers: {
        'What do you want to do?': 'notes',
      },
      outcome: 'accepted',
    });

    expect(askUserQuestion).toHaveBeenCalledWith(
      {
        questions: [{
          multiSelect: false,
          options: [
            { description: 'Notes', label: 'notes' },
            { description: 'Code', label: 'code' },
          ],
          question: 'What do you want to do?',
        }],
      },
      expect.any(AbortSignal),
    );
  });

  describe('resolveSessionPath workspace containment', () => {
    function createRuntimeWithPermissionMode(permissionMode: string): any {
      const plugin = createMockPlugin({ settings: { permissionMode } });
      const runtime = new GrokChatRuntime(plugin);
      jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);
      (runtime as any).sessionCwds.set('session-1', '/tmp/grimoire-test-vault');
      return runtime;
    }

    it('rejects an absolute path outside the workspace in safe mode', () => {
      const runtime = createRuntimeWithPermissionMode('normal');
      expect(() => (runtime as any).resolveSessionPath('session-1', '/etc/hosts')).toThrow(
        'File access is limited to the current workspace.',
      );
    });

    it('rejects an escaping relative path in safe mode', () => {
      const runtime = createRuntimeWithPermissionMode('normal');
      expect(() => (runtime as any).resolveSessionPath('session-1', '../../etc/hosts')).toThrow(
        'File access is limited to the current workspace.',
      );
    });

    it('allows a path inside the workspace in safe mode', () => {
      const runtime = createRuntimeWithPermissionMode('normal');
      expect((runtime as any).resolveSessionPath('session-1', 'notes/today.md')).toBe(
        '/tmp/grimoire-test-vault/notes/today.md',
      );
    });

    it('allows a path outside the workspace in active (full_access) mode', () => {
      const runtime = createRuntimeWithPermissionMode('full_access');
      expect((runtime as any).resolveSessionPath('session-1', '/etc/hosts')).toBe('/etc/hosts');
    });
  });
});
