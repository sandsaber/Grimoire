import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { JsonRpcErrorResponse, JsonRpcTransportClosedError } from '@/providers/acp';
import { kimicodePlanUsageStore } from '@/providers/kimicode/app/KimicodePlanUsageStore';
import {
  KIMICODE_BUILD_MODE_ID,
  KIMICODE_FULL_ACCESS_MODE_ID,
  KIMICODE_SAFE_MODE_ID,
} from '@/providers/kimicode/modes';
import { KimicodeChatRuntime } from '@/providers/kimicode/runtime/KimicodeChatRuntime';
import * as launchArtifacts from '@/providers/kimicode/runtime/KimicodeLaunchArtifacts';
import { getKimicodeProviderSettings } from '@/providers/kimicode/settings';

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {},
    manifest: { version: '0.0.0-test' },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/kimicode'),
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

describe('KimicodeChatRuntime', () => {
  beforeEach(() => {
    kimicodePlanUsageStore.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('surfaces an empty completed ACP response instead of rendering a blank turn', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({ stopReason: 'end_turn' });
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('kimicode:test-model');

    await expect(collectRuntimeChunks(runtime)).resolves.toEqual([
      {
        type: 'error',
        content: 'Kimi Code completed without returning a response. Check provider credentials and logs, then retry.',
      },
      { type: 'done' },
    ]);
    expect(runtime.consumeTurnMetadata()).toEqual({ wasSent: true });
  });

  async function collectRuntimeChunks(runtime: KimicodeChatRuntime): Promise<unknown[]> {
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
    const runtime = new KimicodeChatRuntime(createMockPlugin());
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
          text: expect.stringContaining('## Grimoire Parallel Workers Mode'),
          type: 'text',
        }),
      ]),
    }));
  });

  it('retries the prompt once when the Kimi Code ACP transport closes before output', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
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
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('kimicode:test-model');

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

  it('recovers when the ACP transport closes during initial readiness', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({});
    const ensureReady = jest.spyOn(runtime, 'ensureReady')
      .mockRejectedValueOnce(new JsonRpcTransportClosedError('JSON-RPC input closed'))
      .mockResolvedValueOnce(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('kimicode:test-model');

    await expect(collectRuntimeChunks(runtime)).resolves.toEqual([{ type: 'done' }]);

    expect(ensureReady).toHaveBeenNthCalledWith(1);
    expect(ensureReady).toHaveBeenNthCalledWith(2, { force: true });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('preserves the active turn across a close-before-output restart', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
    const activeTurn = {
      lifecycleGeneration: 0,
      queue: { close: jest.fn() },
      sawOutput: false,
      sessionId: 'session-1',
    };
    (runtime as any).activeTurn = activeTurn;
    (runtime as any).sessionId = 'session-1';
    (runtime as any).connection = {};
    const shutdownProcess = jest.spyOn(runtime as any, 'shutdownProcess').mockResolvedValue(undefined);
    const ensureReady = jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);

    await expect((runtime as any).prepareClosedTransportRetry(
      new JsonRpcTransportClosedError('JSON-RPC input closed'),
      activeTurn,
      '/tmp/grimoire-test-vault',
    )).resolves.toBe(true);

    expect(shutdownProcess).toHaveBeenCalledWith({ preserveActiveTurn: true });
    expect(ensureReady).toHaveBeenCalledWith({
      allowSessionCreation: false,
      force: true,
      preserveActiveTurn: true,
    });
    expect(activeTurn.queue.close).not.toHaveBeenCalled();
  });

  it('can start cleanly after runtime cleanup without reviving the stale turn', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin({
      settings: { providerConfigs: { kimicode: { enabled: true } } },
    }));
    jest.spyOn(launchArtifacts, 'prepareKimicodeLaunchArtifacts').mockResolvedValue({
      configPath: '/tmp/grimoire-kimicode-config.json',
      configContent: '{}\n',
      databasePath: '/default/kimicode.db',
      launchKey: 'launch-key',
      systemPromptPath: '/tmp/grimoire-kimicode-system.md',
    });
    const startProcess = jest.spyOn(runtime as any, 'startProcess').mockImplementation(async () => {
      (runtime as any).ready = true;
    });
    const staleTurn = {
      lifecycleGeneration: 0,
      queue: { close: jest.fn() },
      sawOutput: false,
      sessionId: 'session-old',
    };
    (runtime as any).activeTurn = staleTurn;

    runtime.cleanup();
    await (runtime as any).cleanupPromise;

    await expect((runtime as any).prepareClosedTransportRetry(
      new JsonRpcTransportClosedError('JSON-RPC input closed'),
      staleTurn,
      '/tmp/grimoire-test-vault',
    )).resolves.toBe(false);
    expect(staleTurn.queue.close).toHaveBeenCalled();
    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);
    expect(startProcess).toHaveBeenCalledTimes(1);
    expect((runtime as any).formatRuntimeError(
      new JsonRpcTransportClosedError('JSON-RPC input closed'),
    )).toBe('Kimi connection closed unexpectedly. Please retry; Grimoire will reconnect automatically.');
  });

  it('captures available ACP commands even when no turn is active', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
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

  it('forwards ACP plan updates as user-visible progress during an active turn', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
    const push = jest.fn();
    (runtime as any).sessionId = 'session-1';
    (runtime as any).activeTurn = {
      queue: { push },
      sawOutput: false,
      sessionId: 'session-1',
    };

    await (runtime as any).handleSessionNotification({
      sessionId: 'session-1',
      update: {
        entries: [{ content: 'Inspect the workspace', priority: 'high', status: 'in_progress' }],
        sessionUpdate: 'plan',
      },
    });

    expect(push).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Inspect the workspace',
      id: 'acp:plan',
      state: 'running',
      type: 'progress',
    }));
    expect((runtime as any).activeTurn.sawOutput).toBe(true);
  });

  it('does not create a session when commands are requested before a session exists', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());

    (runtime as any).ready = true;
    (runtime as any).createSession = jest.fn();

    await expect(runtime.getSupportedCommands()).resolves.toEqual([]);
    expect((runtime as any).createSession).not.toHaveBeenCalled();
  });

  it('falls back to Kimi Code session metadata cost when ACP usage omits cost', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
    });
    const runtime = new KimicodeChatRuntime(plugin);
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
    (runtime as any).currentDatabasePath = '/tmp/kimicode.db';
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
        if (kimicodePlanUsageStore.recordSessionTotalCost(sessionId, { amount: 1.23, currency: 'USD' })) {
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
    expect(kimicodePlanUsageStore.getCachedUsage({
      plugin: {} as any,
      providerId: 'kimicode',
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
          kimicode: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    runtime.syncConversationState({
      providerState: { databasePath: '/persisted/kimicode.db' },
      sessionId: 'session-1',
    });

    jest.spyOn(launchArtifacts, 'prepareKimicodeLaunchArtifacts').mockImplementation(async (params) => {
      expect(params.runtimeEnv.KIMICODE_DB).toBe('/persisted/kimicode.db');
      return {
        configPath: '/tmp/grimoire-kimicode-config.json',
        configContent: '{}\n',
        databasePath: '/persisted/kimicode.db',
        launchKey: 'launch-key',
        systemPromptPath: '/tmp/grimoire-kimicode-system.md',
      };
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

  it('preserves the saved session binding when session/load fails transiently', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
    runtime.syncConversationState({ sessionId: 'session-1' });
    const error = new JsonRpcErrorResponse('session/load', -32000, 'Authentication failed');
    (runtime as any).connection = {
      loadSession: jest.fn().mockRejectedValue(error),
    };

    await expect((runtime as any).loadSession('session-1', '/vault')).rejects.toBe(error);

    expect(runtime.getSessionId()).toBe('session-1');
    expect(runtime.consumeSessionInvalidation()).toBe(false);
  });

  it('clears a stale database path when switching to a saved session without persisted provider state', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          kimicode: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    runtime.syncConversationState({
      providerState: { databasePath: '/persisted/kimicode.db' },
      sessionId: 'session-1',
    });
    runtime.syncConversationState({
      providerState: {},
      sessionId: 'session-2',
    });

    jest.spyOn(launchArtifacts, 'prepareKimicodeLaunchArtifacts').mockImplementation(async (params) => {
      expect(params.runtimeEnv.KIMICODE_DB).toBeUndefined();
      return {
        configPath: '/tmp/grimoire-kimicode-config.json',
        configContent: '{}\n',
        databasePath: '/default/kimicode.db',
        launchKey: 'launch-key',
        systemPromptPath: '/tmp/grimoire-kimicode-system.md',
      };
    });
    (runtime as any).startProcess = jest.fn().mockImplementation(async () => {
      (runtime as any).ready = true;
    });
    (runtime as any).loadSession = jest.fn().mockResolvedValue(true);

    await expect(runtime.ensureReady()).resolves.toBe(true);
  });

  it('honors a metadata-only database override before any session exists', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          kimicode: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    runtime.syncConversationState({
      providerState: { databasePath: ':memory:' },
      sessionId: null,
    });

    jest.spyOn(launchArtifacts, 'prepareKimicodeLaunchArtifacts').mockImplementation(async (params) => {
      expect(params.runtimeEnv.KIMICODE_DB).toBe(':memory:');
      return {
        configPath: '/tmp/grimoire-kimicode-config.json',
        configContent: '{}\n',
        databasePath: ':memory:',
        launchKey: 'launch-key',
        systemPromptPath: '/tmp/grimoire-kimicode-system.md',
      };
    });
    (runtime as any).startProcess = jest.fn().mockImplementation(async () => {
      (runtime as any).ready = true;
    });

    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);
  });

  it('restarts when the ACP transport closed even if the subprocess still looks alive', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          kimicode: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    const mockTransport = { dispose: jest.fn(), isClosed: false };
    const mockProcess = { isAlive: jest.fn().mockReturnValue(true), shutdown: jest.fn() };
    const mockConnection = { dispose: jest.fn() };

    jest.spyOn(launchArtifacts, 'prepareKimicodeLaunchArtifacts').mockResolvedValue({
      configPath: '/tmp/grimoire-kimicode-config.json',
      configContent: '{}\n',
      databasePath: '/default/kimicode.db',
      launchKey: 'launch-key',
      systemPromptPath: '/tmp/grimoire-kimicode-system.md',
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
    const runtime = new KimicodeChatRuntime(createMockPlugin());
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
      'Kimi Code wants to access a path outside the working directory.',
      {
        blockedPath: '/tmp/outside',
        decisionOptions: [
          { label: 'Allow once', presentation: 'allow', value: 'approve-now' },
          { label: 'Always allow', presentation: 'always', value: 'approve-always' },
          { label: 'Deny', presentation: 'reject', value: 'deny-now' },
        ],
        decisionReason: 'Path is outside the session working directory',
      },
    );
  });

  it('forces the Claude prompt flag while preserving the project config flag', () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin({
      settings: {
        sharedEnvironmentVariables: 'KIMICODE_DISABLE_PROJECT_CONFIG=false\nKIMICODE_DISABLE_CLAUDE_CODE_PROMPT=false',
      },
    }));

    const env = (runtime as any).buildRuntimeEnv('/usr/local/bin/kimicode', '/tmp/kimicode.db');

    expect(env.KIMICODE_DB).toBe('/tmp/kimicode.db');
    expect(env.KIMICODE_DISABLE_PROJECT_CONFIG).toBe('false');
    expect(env.KIMICODE_DISABLE_CLAUDE_CODE_PROMPT).toBe('true');
  });

  it('returns the nested ACP approval envelope for allow-always selections', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
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

  it('syncs Kimi Code session modes into provider settings without clobbering an explicit user choice', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        providerConfigs: {
          kimicode: {
            availableModes: [
              { id: 'build', name: 'Build' },
            ],
            selectedMode: 'plan',
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);

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

    expect(getKimicodeProviderSettings(plugin.settings).availableModes).toEqual([
      { id: 'build', name: 'Build' },
      { description: 'Planning-first agent', id: 'plan', name: 'Plan' },
    ]);
    expect(plugin.settings.providerConfigs.kimicode.selectedMode).toBe('plan');
    expect((runtime as any).currentSessionModeId).toBe('build');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('seeds the Kimi Code selected mode when no explicit mode has been saved yet', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          kimicode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);

    await (runtime as any).syncSessionModeState({
      currentModeId: KIMICODE_BUILD_MODE_ID,
    });

    expect(plugin.settings.providerConfigs.kimicode.selectedMode).toBe(KIMICODE_FULL_ACCESS_MODE_ID);
  });

  it('defaults Kimi Code mode selection to the managed full-access mode before ACP mode discovery finishes', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          kimicode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(KIMICODE_FULL_ACCESS_MODE_ID);
  });

  it('falls back to the managed full-access mode when a saved custom mode is not managed by Grimoire', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          kimicode: {
            availableModes: [],
            selectedMode: 'compaction',
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(KIMICODE_FULL_ACCESS_MODE_ID);
  });

  it('prefers managed full-access/safe/plan modes over auxiliary Kimi Code primary modes for the main toolbar', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          kimicode: {
            availableModes: [
              { id: KIMICODE_BUILD_MODE_ID, name: 'build' },
              { id: 'compaction', name: 'compaction' },
              { id: KIMICODE_SAFE_MODE_ID, name: 'grimoire-safe' },
              { id: 'plan', name: 'plan' },
            ],
            selectedMode: '',
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(KIMICODE_FULL_ACCESS_MODE_ID);
  });

  it('maps shared safe mode onto the managed Kimi Code safe agent', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'normal',
        providerConfigs: {
          kimicode: {
            availableModes: [
              { id: KIMICODE_FULL_ACCESS_MODE_ID, name: 'Auto-approve' },
              { id: KIMICODE_SAFE_MODE_ID, name: 'Safe' },
              { id: 'plan', name: 'Plan' },
            ],
            selectedMode: KIMICODE_FULL_ACCESS_MODE_ID,
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(KIMICODE_SAFE_MODE_ID);
  });

  it('syncs managed Kimi Code safe mode back through the permission-mode callback', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          kimicode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    const syncCallback = jest.fn();

    runtime.setPermissionModeSyncCallback(syncCallback);

    await (runtime as any).syncSessionModeState({
      currentModeId: KIMICODE_SAFE_MODE_ID,
    });

    expect(syncCallback).toHaveBeenCalledWith('normal');
  });

  it('maps the legacy build alias back through the permission-mode callback as Auto-approve', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
    const syncCallback = jest.fn();

    runtime.setPermissionModeSyncCallback(syncCallback);

    await (runtime as any).syncSessionModeState({
      currentModeId: KIMICODE_BUILD_MODE_ID,
    });

    expect(syncCallback).toHaveBeenCalledWith('full_access');
  });

  it('does not overwrite the toolbar from the default agent reported by session/new', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
    const syncCallback = jest.fn();
    runtime.setPermissionModeSyncCallback(syncCallback);
    (runtime as any).connection = {
      newSession: jest.fn().mockResolvedValue({
        modes: {
          availableModes: [
            { id: KIMICODE_BUILD_MODE_ID, name: 'build' },
            { id: KIMICODE_SAFE_MODE_ID, name: 'safe' },
          ],
          currentModeId: KIMICODE_BUILD_MODE_ID,
        },
        sessionId: 'session-1',
      }),
    };

    await expect((runtime as any).createSession('/tmp/vault')).resolves.toBe('session-1');

    expect((runtime as any).currentSessionModeId).toBe(KIMICODE_BUILD_MODE_ID);
    expect(syncCallback).not.toHaveBeenCalled();
  });

  it('summarizes workflow approval prompts with tool metadata', async () => {
    const runtime = new KimicodeChatRuntime(createMockPlugin());
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
          { label: 'Allow once', presentation: 'allow', value: 'approve-now' },
        ],
        decisionReason: 'Session-level workflow approval requested',
      },
    );
  });

  it('preserves the explicit user model selection when the session reports its current model', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        effortLevel: 'high',
        model: 'kimicode:anthropic/claude-sonnet-4',
        providerConfigs: {
          kimicode: {
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
          kimicode: 'high',
        },
        savedProviderModel: {
          kimicode: 'kimicode:anthropic/claude-sonnet-4',
        },
        settingsProvider: 'kimicode',
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('kimicode');
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

    expect(plugin.settings.providerConfigs.kimicode.preferredThinkingByModel).toEqual({
      'anthropic/claude-sonnet-4': 'high',
    });
    expect(plugin.settings.savedProviderModel.kimicode).toBe('kimicode:anthropic/claude-sonnet-4');
    expect(plugin.settings.savedProviderEffort.kimicode).toBe('high');
    expect(plugin.settings.model).toBe('kimicode:anthropic/claude-sonnet-4');
    expect(plugin.settings.effortLevel).toBe('high');
    expect((runtime as any).resolveSelectedRawModelId()).toBe('anthropic/claude-sonnet-4');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).not.toHaveBeenCalled();
  });

  it('seeds visible Kimi Code models from ACP discovery when none are configured', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'kimicode',
        providerConfigs: {
          kimicode: {
            discoveredModels: [],
            visibleModels: [],
          },
        },
        settingsProvider: 'kimicode',
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('kimicode');

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

    expect(getKimicodeProviderSettings(plugin.settings).visibleModels).toEqual([
      'anthropic/claude-sonnet-4',
      'openai/gpt-5',
    ]);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('syncs detached ACP thought-level options into Kimi Code provider state', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'kimicode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          kimicode: {
            discoveredModels: [],
            preferredThinkingByModel: {},
            visibleModels: ['deepseek/deepseek-v4-pro'],
          },
        },
        settingsProvider: 'kimicode',
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('kimicode');

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

    expect(getKimicodeProviderSettings(plugin.settings).thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Max', value: 'max' },
      ],
    });
    expect(plugin.settings.providerConfigs.kimicode.preferredThinkingByModel).toEqual({
      'deepseek/deepseek-v4-pro': 'low',
    });
    expect(plugin.settings.providerConfigs.kimicode.thinkingOptionsByModel).toEqual({
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

  it('warms selected model metadata by switching ACP model config', async () => {
    const plugin = createMockPlugin({
      settings: {
        model: 'kimicode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          kimicode: {
            discoveredModels: [
              { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
            ],
            preferredThinkingByModel: {},
            visibleModels: ['deepseek/deepseek-v4-pro'],
          },
        },
        settingsProvider: 'kimicode',
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    const setConfigOption = jest.fn().mockResolvedValue({
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
            { name: 'High', value: 'high' },
          ],
          type: 'select',
        },
      ],
    });
    (runtime as any).connection = { setConfigOption };
    (runtime as any).sessionId = 'session-1';
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('kimicode');

    await expect(runtime.warmModelMetadata('kimicode:deepseek/deepseek-v4-pro')).resolves.toBe(true);

    expect(setConfigOption).toHaveBeenCalledWith({
      configId: 'model',
      sessionId: 'session-1',
      type: 'select',
      value: 'deepseek/deepseek-v4-pro',
    });
    expect(plugin.settings.providerConfigs.kimicode.thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
      ],
    });
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps Kimi Code metadata attached to the selected model when ACP echoes a stale current model', async () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'default',
        model: 'kimicode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          kimicode: {
            discoveredModels: [
              { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
              { label: 'OpenAI/GPT-5', rawId: 'openai/gpt-5' },
            ],
            preferredThinkingByModel: {},
            visibleModels: ['deepseek/deepseek-v4-pro', 'openai/gpt-5'],
          },
        },
        savedProviderModel: {
          kimicode: 'kimicode:deepseek/deepseek-v4-pro',
        },
        settingsProvider: 'kimicode',
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
    const setConfigOption = jest.fn().mockResolvedValue({
      configOptions: [
        {
          category: 'model',
          currentValue: 'openai/gpt-5',
          id: 'model',
          name: 'Model',
          options: [
            { name: 'DeepSeek/DeepSeek V4 Pro', value: 'deepseek/deepseek-v4-pro' },
            { name: 'OpenAI/GPT-5', value: 'openai/gpt-5' },
          ],
          type: 'select',
        },
        {
          category: 'thought_level',
          currentValue: 'high',
          id: 'effort',
          name: 'Effort',
          options: [
            { name: 'Low', value: 'low' },
            { name: 'High', value: 'high' },
          ],
          type: 'select',
        },
      ],
    });
    (runtime as any).connection = { setConfigOption };
    (runtime as any).sessionId = 'session-1';
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('kimicode');

    await expect(runtime.warmModelMetadata('kimicode:deepseek/deepseek-v4-pro')).resolves.toBe(true);

    expect((runtime as any).currentSessionModelId).toBe('deepseek/deepseek-v4-pro');
    expect(plugin.settings.model).toBe('kimicode:deepseek/deepseek-v4-pro');
    expect(plugin.settings.savedProviderModel.kimicode).toBe('kimicode:deepseek/deepseek-v4-pro');
    expect(plugin.settings.providerConfigs.kimicode.thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
      ],
    });
    expect(plugin.settings.providerConfigs.kimicode.thinkingOptionsByModel['openai/gpt-5']).toBeUndefined();
  });

  it('applies selected Kimi Code effort through the detached ACP effort option', async () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'kimicode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          kimicode: {
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
        settingsProvider: 'kimicode',
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);
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

  it('exposes the active display model for auxiliary Kimi Code tasks', () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'kimicode:anthropic/claude-sonnet-4',
        providerConfigs: {
          kimicode: {
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
          kimicode: 'kimicode:anthropic/claude-sonnet-4',
        },
        settingsProvider: 'kimicode',
      },
    });
    const runtime = new KimicodeChatRuntime(plugin);

    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('kimicode');
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(runtime.getAuxiliaryModel()).toBe('kimicode:anthropic/claude-sonnet-4');
  });

  describe('resolveSessionPath workspace containment', () => {
    function createRuntimeWithPermissionMode(permissionMode: string): any {
      const plugin = createMockPlugin({ settings: { permissionMode } });
      const runtime = new KimicodeChatRuntime(plugin);
      jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);
      (runtime as any).sessionCwds.set('session-1', '/tmp/grimoire-test-vault');
      return runtime;
    }

    it('rejects an absolute path outside the workspace in safe mode', () => {
      const runtime = createRuntimeWithPermissionMode('normal');
      expect(() => (runtime).resolveSessionPath('session-1', '/etc/hosts')).toThrow(
        'File access is limited to the current workspace.',
      );
    });

    it('rejects an escaping relative path in safe mode', () => {
      const runtime = createRuntimeWithPermissionMode('normal');
      expect(() => (runtime).resolveSessionPath('session-1', '../../etc/hosts')).toThrow(
        'File access is limited to the current workspace.',
      );
    });

    it('allows a path inside the workspace in safe mode', () => {
      const runtime = createRuntimeWithPermissionMode('normal');
      expect((runtime).resolveSessionPath('session-1', 'notes/today.md')).toBe(
        '/tmp/grimoire-test-vault/notes/today.md',
      );
    });

    it('allows a path outside the workspace in active (full_access) mode', () => {
      const runtime = createRuntimeWithPermissionMode('full_access');
      expect((runtime).resolveSessionPath('session-1', '/etc/hosts')).toBe('/etc/hosts');
    });
  });

  it('answers a picked option with the option the user picked', async () => {
    // The one behavioural difference between the local mappers and the shared
    // one they duplicated: a `select-option` decision was checked last here and
    // first there. Equivalent for the three standard decisions, and not for a
    // fourth option a provider offers by name — which is the drift a copy
    // invites.
    const runtime = new KimicodeChatRuntime(createMockPlugin());
    runtime.setApprovalCallback(jest.fn().mockResolvedValue({
      type: 'select-option',
      value: 'approve-always',
    }));

    await expect((runtime as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'approve-now' },
        { kind: 'allow_always', name: 'Always allow', optionId: 'approve-always' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'other',
        rawInput: {},
        title: 'anything',
        toolCallId: 'tool-1',
      },
    })).resolves.toEqual({
      outcome: { optionId: 'approve-always', outcome: 'selected' },
    });
  });

});
