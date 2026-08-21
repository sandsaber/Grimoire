import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { setLocale } from '@/i18n/i18n';
import { JsonRpcErrorResponse, JsonRpcTransportClosedError } from '@/providers/acp';
import { mimocodePlanUsageStore } from '@/providers/mimocode/app/MimocodePlanUsageStore';
import * as sessionErrorStore from '@/providers/mimocode/history/MimocodeSessionErrorStore';
import {
  MIMOCODE_BUILD_MODE_ID,
  MIMOCODE_FULL_ACCESS_MODE_ID,
  MIMOCODE_SAFE_MODE_ID,
} from '@/providers/mimocode/modes';
import { MimocodeChatRuntime } from '@/providers/mimocode/runtime/MimocodeChatRuntime';
import * as launchArtifacts from '@/providers/mimocode/runtime/MimocodeLaunchArtifacts';
import { getMimocodeProviderSettings } from '@/providers/mimocode/settings';

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {},
    manifest: { version: '0.0.0-test' },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/mimocode'),
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

describe('MimocodeChatRuntime', () => {
  beforeEach(() => {
    mimocodePlanUsageStore.reset();
  });

  afterEach(() => {
    setLocale('en');
    jest.restoreAllMocks();
  });

  it('surfaces a stored MiMo provider error when ACP ends without output', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({ stopReason: 'end_turn' });
    jest.spyOn(sessionErrorStore, 'loadLatestMimocodeSessionError').mockResolvedValue({
      message: 'Invalid API Key: Please provide valid API Key',
      name: 'APIError',
      statusCode: 401,
    });
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('mimocode:test-model');

    await expect(collectRuntimeChunks(runtime)).resolves.toEqual([
      {
        type: 'error',
        content: 'MiMo authentication failed: Invalid API Key. Run `mimo auth login` in a terminal, then retry.',
      },
      { type: 'done' },
    ]);
    expect(runtime.consumeTurnMetadata()).toEqual({ wasSent: true });
  });

  it('switches an unsupported ultraspeed plan model to the visible base model', async () => {
    const plugin = createMockPlugin({
      settings: {
        model: 'mimocode:xiaomi/mimo-v2.5-pro-ultraspeed',
        providerConfigs: {
          mimocode: {
            visibleModels: [
              'xiaomi/mimo-v2.5-pro',
              'xiaomi/mimo-v2.5-pro-ultraspeed',
            ],
          },
        },
        savedProviderModel: {
          mimocode: 'mimocode:xiaomi/mimo-v2.5-pro-ultraspeed',
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    const prompt = jest.fn().mockResolvedValue({
      stopReason: 'end_turn',
      userMessageId: 'msg-user',
    });
    jest.spyOn(sessionErrorStore, 'loadLatestMimocodeSessionError').mockResolvedValue({
      message: 'Not supported model mimo-v2.5-pro-ultraspeed',
      name: 'APIError',
      statusCode: 400,
    });
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot')
      .mockReturnValue(plugin.settings);
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('mimocode:xiaomi/mimo-v2.5-pro-ultraspeed');

    await expect(collectRuntimeChunks(runtime)).resolves.toEqual([
      {
        type: 'error',
        content: 'MiMo does not support the selected model for this plan. Grimoire switched to xiaomi/mimo-v2.5-pro; retry the message.',
      },
      { type: 'done' },
    ]);
    expect(plugin.settings.model).toBe('mimocode:xiaomi/mimo-v2.5-pro');
    expect(plugin.settings.savedProviderModel.mimocode).toBe('mimocode:xiaomi/mimo-v2.5-pro');
    expect((runtime as any).currentSessionModelId).toBeNull();
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('does not turn an empty cancelled prompt into a generic MiMo error', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({ stopReason: 'cancelled' });
    jest.spyOn(sessionErrorStore, 'loadLatestMimocodeSessionError').mockResolvedValue(null);
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('mimocode:test-model');

    await expect(collectRuntimeChunks(runtime)).resolves.toEqual([{ type: 'done' }]);
  });

  it('localizes an empty completed prompt without a stored provider error', async () => {
    setLocale('ru');
    const runtime = new MimocodeChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({ stopReason: 'end_turn' });
    jest.spyOn(sessionErrorStore, 'loadLatestMimocodeSessionError').mockResolvedValue(null);
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('mimocode:test-model');

    await expect(collectRuntimeChunks(runtime)).resolves.toEqual([
      {
        type: 'error',
        content: 'MiMoCode завершил работу без ответа. Проверьте учётные данные и журналы провайдера, затем повторите попытку.',
      },
      { type: 'done' },
    ]);
  });

  async function collectRuntimeChunks(runtime: MimocodeChatRuntime): Promise<unknown[]> {
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
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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

  it('retries the prompt once when the MiMoCode ACP transport closes before output', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('mimocode:test-model');

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
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
    (runtime as any).getActiveDisplayModel = jest.fn().mockReturnValue('mimocode:test-model');

    await expect(collectRuntimeChunks(runtime)).resolves.toEqual([{ type: 'done' }]);

    expect(ensureReady).toHaveBeenNthCalledWith(1);
    expect(ensureReady).toHaveBeenNthCalledWith(2, { force: true });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('preserves the active turn across a close-before-output restart', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
    const runtime = new MimocodeChatRuntime(createMockPlugin({
      settings: { providerConfigs: { mimocode: { enabled: true } } },
    }));
    jest.spyOn(launchArtifacts, 'prepareMimocodeLaunchArtifacts').mockResolvedValue({
      configPath: '/tmp/grimoire-mimocode-config.json',
      configContent: '{}\n',
      databasePath: '/default/mimocode.db',
      launchKey: 'launch-key',
      systemPromptPath: '/tmp/grimoire-mimocode-system.md',
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
    )).toBe('MiMo connection closed unexpectedly. Please retry; Grimoire will reconnect automatically.');
  });

  it('captures available ACP commands even when no turn is active', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
    const runtime = new MimocodeChatRuntime(createMockPlugin());

    (runtime as any).ready = true;
    (runtime as any).createSession = jest.fn();

    await expect(runtime.getSupportedCommands()).resolves.toEqual([]);
    expect((runtime as any).createSession).not.toHaveBeenCalled();
  });

  it('falls back to MiMoCode session metadata cost when ACP usage omits cost', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
    });
    const runtime = new MimocodeChatRuntime(plugin);
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
    (runtime as any).currentDatabasePath = '/tmp/mimocode.db';
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
        if (mimocodePlanUsageStore.recordSessionTotalCost(sessionId, { amount: 1.23, currency: 'USD' })) {
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
    expect(mimocodePlanUsageStore.getCachedUsage({
      plugin: {} as any,
      providerId: 'mimocode',
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
          mimocode: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    runtime.syncConversationState({
      providerState: { databasePath: '/persisted/mimocode.db' },
      sessionId: 'session-1',
    });

    jest.spyOn(launchArtifacts, 'prepareMimocodeLaunchArtifacts').mockImplementation(async (params) => {
      expect(params.runtimeEnv.MIMOCODE_DB).toBe('/persisted/mimocode.db');
      return {
        configPath: '/tmp/grimoire-mimocode-config.json',
        configContent: '{}\n',
        databasePath: '/persisted/mimocode.db',
        launchKey: 'launch-key',
        systemPromptPath: '/tmp/grimoire-mimocode-system.md',
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
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
          mimocode: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    runtime.syncConversationState({
      providerState: { databasePath: '/persisted/mimocode.db' },
      sessionId: 'session-1',
    });
    runtime.syncConversationState({
      providerState: {},
      sessionId: 'session-2',
    });

    jest.spyOn(launchArtifacts, 'prepareMimocodeLaunchArtifacts').mockImplementation(async (params) => {
      expect(params.runtimeEnv.MIMOCODE_DB).toBeUndefined();
      return {
        configPath: '/tmp/grimoire-mimocode-config.json',
        configContent: '{}\n',
        databasePath: '/default/mimocode.db',
        launchKey: 'launch-key',
        systemPromptPath: '/tmp/grimoire-mimocode-system.md',
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
          mimocode: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    runtime.syncConversationState({
      providerState: { databasePath: ':memory:' },
      sessionId: null,
    });

    jest.spyOn(launchArtifacts, 'prepareMimocodeLaunchArtifacts').mockImplementation(async (params) => {
      expect(params.runtimeEnv.MIMOCODE_DB).toBe(':memory:');
      return {
        configPath: '/tmp/grimoire-mimocode-config.json',
        configContent: '{}\n',
        databasePath: ':memory:',
        launchKey: 'launch-key',
        systemPromptPath: '/tmp/grimoire-mimocode-system.md',
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
          mimocode: {
            enabled: true,
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    const mockTransport = { dispose: jest.fn(), isClosed: false };
    const mockProcess = { isAlive: jest.fn().mockReturnValue(true), shutdown: jest.fn() };
    const mockConnection = { dispose: jest.fn() };

    jest.spyOn(launchArtifacts, 'prepareMimocodeLaunchArtifacts').mockResolvedValue({
      configPath: '/tmp/grimoire-mimocode-config.json',
      configContent: '{}\n',
      databasePath: '/default/mimocode.db',
      launchKey: 'launch-key',
      systemPromptPath: '/tmp/grimoire-mimocode-system.md',
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
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
      'MiMoCode wants to access a path outside the working directory.',
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
    const runtime = new MimocodeChatRuntime(createMockPlugin({
      settings: {
        sharedEnvironmentVariables: 'MIMOCODE_DISABLE_PROJECT_CONFIG=false\nMIMOCODE_DISABLE_CLAUDE_CODE_PROMPT=false',
      },
    }));

    const env = (runtime as any).buildRuntimeEnv('/usr/local/bin/mimocode', '/tmp/mimocode.db');

    expect(env.MIMOCODE_DB).toBe('/tmp/mimocode.db');
    expect(env.MIMOCODE_DISABLE_PROJECT_CONFIG).toBe('false');
    expect(env.MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe('true');
  });

  it('returns the nested ACP approval envelope for allow-always selections', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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

  it('syncs MiMoCode session modes into provider settings without clobbering an explicit user choice', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        providerConfigs: {
          mimocode: {
            availableModes: [
              { id: 'build', name: 'Build' },
            ],
            selectedMode: 'plan',
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);

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

    expect(getMimocodeProviderSettings(plugin.settings).availableModes).toEqual([
      { id: 'build', name: 'Build' },
      { description: 'Planning-first agent', id: 'plan', name: 'Plan' },
    ]);
    expect(plugin.settings.providerConfigs.mimocode.selectedMode).toBe('plan');
    expect((runtime as any).currentSessionModeId).toBe('build');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('seeds the MiMoCode selected mode when no explicit mode has been saved yet', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          mimocode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);

    await (runtime as any).syncSessionModeState({
      currentModeId: MIMOCODE_BUILD_MODE_ID,
    });

    expect(plugin.settings.providerConfigs.mimocode.selectedMode).toBe(MIMOCODE_FULL_ACCESS_MODE_ID);
  });

  it('defaults MiMoCode mode selection to the managed full-access mode before ACP mode discovery finishes', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          mimocode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(MIMOCODE_FULL_ACCESS_MODE_ID);
  });

  it('falls back to the managed full-access mode when a saved custom mode is not managed by Grimoire', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          mimocode: {
            availableModes: [],
            selectedMode: 'compaction',
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(MIMOCODE_FULL_ACCESS_MODE_ID);
  });

  it('prefers managed full-access/safe/plan modes over auxiliary MiMoCode primary modes for the main toolbar', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'full_access',
        providerConfigs: {
          mimocode: {
            availableModes: [
              { id: MIMOCODE_BUILD_MODE_ID, name: 'build' },
              { id: 'compaction', name: 'compaction' },
              { id: MIMOCODE_SAFE_MODE_ID, name: 'grimoire-safe' },
              { id: 'plan', name: 'plan' },
            ],
            selectedMode: '',
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(MIMOCODE_FULL_ACCESS_MODE_ID);
  });

  it('maps shared safe mode onto the managed MiMoCode safe agent', () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'normal',
        providerConfigs: {
          mimocode: {
            availableModes: [
              { id: MIMOCODE_FULL_ACCESS_MODE_ID, name: 'Auto-approve' },
              { id: MIMOCODE_SAFE_MODE_ID, name: 'Safe' },
              { id: 'plan', name: 'Plan' },
            ],
            selectedMode: MIMOCODE_FULL_ACCESS_MODE_ID,
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect((runtime as any).resolveSelectedModeId()).toBe(MIMOCODE_SAFE_MODE_ID);
  });

  it('syncs managed MiMoCode safe mode back through the permission-mode callback', async () => {
    const plugin = createMockPlugin({
      settings: {
        providerConfigs: {
          mimocode: {
            availableModes: [],
            selectedMode: '',
          },
        },
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    const syncCallback = jest.fn();

    runtime.setPermissionModeSyncCallback(syncCallback);

    await (runtime as any).syncSessionModeState({
      currentModeId: MIMOCODE_SAFE_MODE_ID,
    });

    expect(syncCallback).toHaveBeenCalledWith('normal');
  });

  it('maps the legacy build alias back through the permission-mode callback as Auto-approve', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
    const syncCallback = jest.fn();

    runtime.setPermissionModeSyncCallback(syncCallback);

    await (runtime as any).syncSessionModeState({
      currentModeId: MIMOCODE_BUILD_MODE_ID,
    });

    expect(syncCallback).toHaveBeenCalledWith('full_access');
  });

  it('does not overwrite the toolbar from the default agent reported by session/new', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
    const syncCallback = jest.fn();
    runtime.setPermissionModeSyncCallback(syncCallback);
    (runtime as any).connection = {
      newSession: jest.fn().mockResolvedValue({
        modes: {
          availableModes: [
            { id: MIMOCODE_BUILD_MODE_ID, name: 'build' },
            { id: MIMOCODE_SAFE_MODE_ID, name: 'safe' },
          ],
          currentModeId: MIMOCODE_BUILD_MODE_ID,
        },
        sessionId: 'session-1',
      }),
    };

    await expect((runtime as any).createSession('/tmp/vault')).resolves.toBe('session-1');

    expect((runtime as any).currentSessionModeId).toBe(MIMOCODE_BUILD_MODE_ID);
    expect(syncCallback).not.toHaveBeenCalled();
  });

  it('summarizes workflow approval prompts with tool metadata', async () => {
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
        model: 'mimocode:anthropic/claude-sonnet-4',
        providerConfigs: {
          mimocode: {
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
          mimocode: 'high',
        },
        savedProviderModel: {
          mimocode: 'mimocode:anthropic/claude-sonnet-4',
        },
        settingsProvider: 'mimocode',
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('mimocode');
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

    expect(plugin.settings.providerConfigs.mimocode.preferredThinkingByModel).toEqual({
      'anthropic/claude-sonnet-4': 'high',
    });
    expect(plugin.settings.savedProviderModel.mimocode).toBe('mimocode:anthropic/claude-sonnet-4');
    expect(plugin.settings.savedProviderEffort.mimocode).toBe('high');
    expect(plugin.settings.model).toBe('mimocode:anthropic/claude-sonnet-4');
    expect(plugin.settings.effortLevel).toBe('high');
    expect((runtime as any).resolveSelectedRawModelId()).toBe('anthropic/claude-sonnet-4');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(refreshModelSelector).not.toHaveBeenCalled();
  });

  it('seeds visible MiMoCode models from ACP discovery when none are configured', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'mimocode',
        providerConfigs: {
          mimocode: {
            discoveredModels: [],
            visibleModels: [],
          },
        },
        settingsProvider: 'mimocode',
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('mimocode');

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

    expect(getMimocodeProviderSettings(plugin.settings).visibleModels).toEqual([
      'anthropic/claude-sonnet-4',
      'openai/gpt-5',
    ]);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshModelSelector).toHaveBeenCalledTimes(1);
  });

  it('syncs detached ACP thought-level options into MiMoCode provider state', async () => {
    const refreshModelSelector = jest.fn();
    const plugin = createMockPlugin({
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      settings: {
        model: 'mimocode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          mimocode: {
            discoveredModels: [],
            preferredThinkingByModel: {},
            visibleModels: ['deepseek/deepseek-v4-pro'],
          },
        },
        settingsProvider: 'mimocode',
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('mimocode');

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

    expect(getMimocodeProviderSettings(plugin.settings).thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Max', value: 'max' },
      ],
    });
    expect(plugin.settings.providerConfigs.mimocode.preferredThinkingByModel).toEqual({
      'deepseek/deepseek-v4-pro': 'low',
    });
    expect(plugin.settings.providerConfigs.mimocode.thinkingOptionsByModel).toEqual({
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
        model: 'mimocode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          mimocode: {
            discoveredModels: [
              { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
            ],
            preferredThinkingByModel: {},
            visibleModels: ['deepseek/deepseek-v4-pro'],
          },
        },
        settingsProvider: 'mimocode',
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
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
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('mimocode');

    await expect(runtime.warmModelMetadata('mimocode:deepseek/deepseek-v4-pro')).resolves.toBe(true);

    expect(setConfigOption).toHaveBeenCalledWith({
      configId: 'model',
      sessionId: 'session-1',
      type: 'select',
      value: 'deepseek/deepseek-v4-pro',
    });
    expect(plugin.settings.providerConfigs.mimocode.thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
      ],
    });
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps MiMoCode metadata attached to the selected model when ACP echoes a stale current model', async () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'default',
        model: 'mimocode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          mimocode: {
            discoveredModels: [
              { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
              { label: 'OpenAI/GPT-5', rawId: 'openai/gpt-5' },
            ],
            preferredThinkingByModel: {},
            visibleModels: ['deepseek/deepseek-v4-pro', 'openai/gpt-5'],
          },
        },
        savedProviderModel: {
          mimocode: 'mimocode:deepseek/deepseek-v4-pro',
        },
        settingsProvider: 'mimocode',
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
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
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('mimocode');

    await expect(runtime.warmModelMetadata('mimocode:deepseek/deepseek-v4-pro')).resolves.toBe(true);

    expect((runtime as any).currentSessionModelId).toBe('deepseek/deepseek-v4-pro');
    expect(plugin.settings.model).toBe('mimocode:deepseek/deepseek-v4-pro');
    expect(plugin.settings.savedProviderModel.mimocode).toBe('mimocode:deepseek/deepseek-v4-pro');
    expect(plugin.settings.providerConfigs.mimocode.thinkingOptionsByModel).toEqual({
      'deepseek/deepseek-v4-pro': [
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
      ],
    });
    expect(plugin.settings.providerConfigs.mimocode.thinkingOptionsByModel['openai/gpt-5']).toBeUndefined();
  });

  it('applies selected MiMoCode effort through the detached ACP effort option', async () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'mimocode:deepseek/deepseek-v4-pro',
        providerConfigs: {
          mimocode: {
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
        settingsProvider: 'mimocode',
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);
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

  it('exposes the active display model for auxiliary MiMoCode tasks', () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'mimocode:anthropic/claude-sonnet-4',
        providerConfigs: {
          mimocode: {
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
          mimocode: 'mimocode:anthropic/claude-sonnet-4',
        },
        settingsProvider: 'mimocode',
      },
    });
    const runtime = new MimocodeChatRuntime(plugin);

    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('mimocode');
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    expect(runtime.getAuxiliaryModel()).toBe('mimocode:anthropic/claude-sonnet-4');
  });

  describe('resolveSessionPath workspace containment', () => {
    function createRuntimeWithPermissionMode(permissionMode: string): any {
      const plugin = createMockPlugin({ settings: { permissionMode } });
      const runtime = new MimocodeChatRuntime(plugin);
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
    const runtime = new MimocodeChatRuntime(createMockPlugin());
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
