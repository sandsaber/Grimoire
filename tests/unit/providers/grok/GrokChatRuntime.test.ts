import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { JsonRpcErrorResponse, JsonRpcTransportClosedError } from '@/providers/acp';
import { grokPlanUsageStore } from '@/providers/grok/app/GrokPlanUsageStore';
import { updateGrokDiscoveryState } from '@/providers/grok/discoveryState';
import {
  GROK_BUILD_MODE_ID,
  GROK_FULL_ACCESS_MODE_ID,
  GROK_SAFE_MODE_ID,
} from '@/providers/grok/modes';
import { GrokChatRuntime } from '@/providers/grok/runtime/GrokChatRuntime';
import * as launchArtifacts from '@/providers/grok/runtime/GrokLaunchArtifacts';
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

function allPromptText(prompt: jest.Mock): string {
  return prompt.mock.calls
    .flatMap((call: any[]) => (call[0]?.prompt ?? []) as Array<{ text?: string }>)
    .map(block => block.text ?? '')
    .join('\n');
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

  it('does not replay the transcript when readiness drops the session', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    runtime.syncConversationState({ sessionId: 'session-1' });
    const prompt = jest.fn().mockResolvedValue({});

    jest.spyOn(runtime, 'ensureReady').mockImplementation(async () => {
      (runtime as any).sessionId = null;
      (runtime as any).loadedSessionId = null;
      (runtime as any).sessionInvalidated = true;
      return true;
    });
    (runtime as any).createSession = jest.fn().mockImplementation(async () => {
      (runtime as any).sessionId = 'session-2';
      return 'session-2';
    });
    (runtime as any).connection = { prompt };

    const history = [
      { id: 'user-previous', role: 'user' as const, content: 'Keep the language rich.', timestamp: 1 },
    ];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Continue the edit.' }), history)) {
      void chunk;
    }

    // Some runtimes send a settings command of their own before the turn, so
    // the assertion is about everything that reached the agent.
    const promptText = allPromptText(prompt);
    expect(promptText).toContain('Continue the edit.');
    expect(promptText).not.toContain('Keep the language rich.');
  });

  it('still withholds the transcript after the drop has survived a reload', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({});

    runtime.syncConversationState({
      providerState: { sessionDropped: true },
      sessionId: null,
    });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).createSession = jest.fn().mockImplementation(async () => {
      (runtime as any).sessionId = 'session-2';
      return 'session-2';
    });
    (runtime as any).connection = { prompt };

    const history = [
      { id: 'user-previous', role: 'user' as const, content: 'Keep the language rich.', timestamp: 1 },
    ];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Continue the edit.' }), history)) {
      void chunk;
    }

    expect(allPromptText(prompt)).not.toContain('Keep the language rich.');
  });

  it('still replays the transcript for a genuine cold resume', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({});

    runtime.syncConversationState({ sessionId: null });
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).createSession = jest.fn().mockImplementation(async () => {
      (runtime as any).sessionId = 'session-2';
      return 'session-2';
    });
    (runtime as any).connection = { prompt };

    const history = [
      { id: 'user-previous', role: 'user' as const, content: 'Keep the language rich.', timestamp: 1 },
    ];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Continue the edit.' }), history)) {
      void chunk;
    }

    expect(allPromptText(prompt)).toContain('Keep the language rich.');
  });

  it('records a dropped session on the conversation so a reload can tell it from a cold start', () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    runtime.syncConversationState({ sessionId: 'session-1' });
    (runtime as any).sessionId = null;
    (runtime as any).sessionInvalidated = true;

    const updates = runtime.buildSessionUpdates({
      conversation: {
        id: 'conv-1',
        providerId: 'grok',
        providerState: {},
        sessionId: 'session-1',
      } as any,
      sessionInvalidated: true,
    });

    expect(updates.updates.sessionId).toBeNull();
    expect((updates.updates.providerState as any)?.sessionDropped).toBe(true);
  });

  it('keeps the dropped marker across a save that no longer carries the flag', () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    (runtime as any).sessionId = null;

    // consumeSessionInvalidation() already took the in-memory answer, so this
    // save reports false; only the conversation still knows.
    const updates = runtime.buildSessionUpdates({
      conversation: {
        id: 'conv-1',
        providerId: 'grok',
        providerState: { sessionDropped: true },
        sessionId: null,
      } as any,
      sessionInvalidated: false,
    });

    expect((updates.updates.providerState as any)?.sessionDropped).toBe(true);
  });

  it('clears the dropped marker once a replacement session is persisted', () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    (runtime as any).sessionId = 'session-2';

    const updates = runtime.buildSessionUpdates({
      conversation: {
        id: 'conv-1',
        providerId: 'grok',
        providerState: { sessionDropped: true },
        sessionId: null,
      } as any,
      sessionInvalidated: false,
    });

    expect(updates.updates.sessionId).toBe('session-2');
    expect((updates.updates.providerState as any)?.sessionDropped).toBeUndefined();
  });

  it('restores a dropped session from the conversation on load', () => {
    const runtime = new GrokChatRuntime(createMockPlugin());

    runtime.syncConversationState({
      providerState: { sessionDropped: true },
      sessionId: null,
    });

    expect(runtime.consumeSessionInvalidation()).toBe(true);
  });

  it('keeps the binding when the agent still lists the session it failed to load', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    runtime.syncConversationState({ sessionId: 'session-1' });
    const error = new JsonRpcErrorResponse('session/load', -32603, 'Path not found.', {
      code: 'FS_NOT_FOUND',
    });
    (runtime as any).connection = {
      listSessions: jest.fn().mockResolvedValue({ sessions: [{ sessionId: 'session-1' }] }),
      loadSession: jest.fn().mockRejectedValue(error),
    };

    await expect((runtime as any).loadSession('session-1', '/vault')).rejects.toBe(error);

    expect(runtime.getSessionId()).toBe('session-1');
    expect(runtime.consumeSessionInvalidation()).toBe(false);
  });

  it('keeps the requested session id when the agent answers session/load without one', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    runtime.syncConversationState({ sessionId: 'session-1' });
    // Grok Build 1.0.13 answers session/load with models and _meta only - the
    // ACP response carries no top-level sessionId, and the id it echoes back
    // lives under _meta.
    (runtime as any).connection = {
      loadSession: jest.fn().mockResolvedValue({
        _meta: { sessionId: 'session-1' },
        models: {
          availableModels: [{ modelId: 'grok-4.6', name: 'Grok 4.6' }],
          currentModelId: 'grok-4.6',
        },
      }),
    };

    await expect((runtime as any).loadSession('session-1', '/vault')).resolves.toBe(true);

    expect(runtime.getSessionId()).toBe('session-1');
  });

  it('soft-fails a session the agent no longer lists, whatever the error said', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    runtime.syncConversationState({ sessionId: 'session-1' });
    (runtime as any).connection = {
      listSessions: jest.fn().mockResolvedValue({ sessions: [{ sessionId: 'session-9' }] }),
      loadSession: jest.fn().mockRejectedValue(
        // What Grok Build actually answers for a session it no longer has.
        new JsonRpcErrorResponse('session/load', -32603, 'Path not found.', {
          code: 'FS_NOT_FOUND',
        }),
      ),
    };

    await expect((runtime as any).loadSession('session-1', '/vault')).resolves.toBe(false);
  });

  it('preserves the saved session binding when the agent cannot be asked', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    runtime.syncConversationState({ sessionId: 'session-1' });
    const error = new JsonRpcErrorResponse('session/load', -32000, 'Authentication failed');
    (runtime as any).connection = {
      listSessions: jest.fn().mockRejectedValue(new Error('session/list unsupported')),
      loadSession: jest.fn().mockRejectedValue(error),
    };

    await expect((runtime as any).loadSession('session-1', '/vault')).rejects.toBe(error);

    expect(runtime.getSessionId()).toBe('session-1');
    expect(runtime.consumeSessionInvalidation()).toBe(false);
  });

  it('reports a dropped session without consuming the flag persistence needs', () => {
    const runtime = new GrokChatRuntime(createMockPlugin());

    runtime.syncConversationState({
      providerState: { sessionDropped: true },
      sessionId: null,
    });

    expect(runtime.isSessionDropped()).toBe(true);
    expect(runtime.isSessionDropped()).toBe(true);
    expect(runtime.consumeSessionInvalidation()).toBe(true);
    expect(runtime.isSessionDropped()).toBe(false);
  });

  it('persists the user question so a failed turn is not wiped on hydrate', () => {
    const runtime = new GrokChatRuntime(createMockPlugin());

    expect(runtime.prepareTurn({ text: 'Keep this question' }).persistedContent).toBe(
      'Keep this question',
    );
  });

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
          text: expect.stringContaining('## Grimoire Parallel Workers Mode'),
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

  it('queues xAI subagent completion notifications for the active turn', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const push = jest.fn();
    (runtime as any).sessionId = 'session-1';
    (runtime as any).activeTurn = {
      queue: { push },
      sawAssistantText: false,
      sawOutput: false,
      sessionId: 'session-1',
    };

    await (runtime as any).handleGrokTransportSessionNotification('x.ai/session/update', {
      sessionId: 'session-1',
      update: {
        output: 'Finished report',
        status: 'completed',
        subagent_id: 'agent-1',
        sessionUpdate: 'subagent_finished',
      },
    });

    expect(push).toHaveBeenCalledWith({
      agentId: 'agent-1',
      result: 'Finished report',
      status: 'completed',
      type: 'async_subagent_result',
    });
    expect((runtime as any).activeTurn.sawOutput).toBe(true);
  });

  it('routes assistant text from xAI session update aliases through the ACP normalizer', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const push = jest.fn();
    (runtime as any).sessionId = 'session-1';
    (runtime as any).activeTurn = {
      queue: { push },
      sawAssistantText: false,
      sawOutput: false,
      sessionId: 'session-1',
    };

    await (runtime as any).handleGrokTransportSessionNotification('x.ai/session/update', {
      sessionId: 'session-1',
      update: {
        content: { text: 'Recovered answer', type: 'text' },
        messageId: 'assistant-1',
        sessionUpdate: 'agent_message_chunk',
      },
    });

    expect(push.mock.calls.map(call => call[0])).toEqual([
      { itemId: 'assistant-1', type: 'assistant_message_start' },
      { content: 'Recovered answer', type: 'text' },
    ]);
    expect((runtime as any).activeTurn.sawAssistantText).toBe(true);
    expect((runtime as any).activeTurn.sawOutput).toBe(true);
  });

  it('unwraps wrapped xAI session notifications and suppresses their standard mirror', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const push = jest.fn();
    const notification = {
      sessionId: 'session-1',
      update: {
        content: { text: 'One answer', type: 'text' },
        messageId: 'assistant-1',
        sessionUpdate: 'agent_message_chunk',
      },
    };
    (runtime as any).sessionId = 'session-1';
    (runtime as any).activeTurn = {
      queue: { push },
      sawAssistantText: false,
      sawOutput: false,
      sessionId: 'session-1',
    };

    await (runtime as any).handleSessionNotification(notification, 'standard');
    await (runtime as any).handleGrokTransportSessionNotification(
      '_x.ai/session_notification',
      {
        method: 'x.ai/session_notification',
        params: notification,
      },
    );

    expect(push.mock.calls.map(call => call[0])).toEqual([
      { itemId: 'assistant-1', type: 'assistant_message_start' },
      { content: 'One answer', type: 'text' },
    ]);
  });

  it('surfaces an empty-response error when Grok ends after thinking without final text', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockImplementation(async () => {
      await (runtime as any).handleSessionNotification({
        sessionId: 'session-1',
        update: {
          content: { text: 'Working through the edit', type: 'text' },
          messageId: 'thought-1',
          sessionUpdate: 'agent_thought_chunk',
        },
      });
      return { stopReason: 'end_turn' };
    });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).refreshFallbackPlanUsageFromSessionCost = jest.fn().mockResolvedValue(undefined);

    const chunks = await collectRuntimeChunks(runtime);

    expect(chunks).toEqual([
      { content: 'Working through the edit', type: 'thinking' },
      expect.objectContaining({
        content: expect.stringContaining('Grok Build'),
        type: 'error',
      }),
      { type: 'done' },
    ]);
    expect(runtime.consumeTurnMetadata()).toEqual({ wasSent: true });
  });

  it('recovers an answer from the Grok session log when the turn streamed no text', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockResolvedValue({ stopReason: 'end_turn' });
    const recoverFinalAssistantMessage = jest.fn().mockResolvedValue('Recovered answer');

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).transcriptRecovery = { recoverFinalAssistantMessage };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);
    (runtime as any).refreshFallbackPlanUsageFromSessionCost = jest.fn().mockResolvedValue(undefined);

    const chunks = await collectRuntimeChunks(runtime);

    expect(recoverFinalAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      nativeSessionRef: 'session-1',
    }));
    expect(chunks).toEqual([
      { content: 'Recovered answer', type: 'text' },
      { type: 'done' },
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

  it('serializes concurrent ensureReady calls into a single process restart', async () => {
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
    // A slow start reproduces the real race: without serialization the second
    // caller evaluates restart reasons while the first restart is mid-flight,
    // shuts the fresh process down, and starts its own.
    const startProcess = jest.spyOn(runtime as any, 'startProcess').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      (runtime as any).process = { isAlive: () => true };
      (runtime as any).transport = { isClosed: false };
      (runtime as any).connection = {};
      (runtime as any).ready = true;
    });
    const shutdownProcess = jest.spyOn(runtime as any, 'shutdownProcess').mockResolvedValue(undefined);
    (runtime as any).createSession = jest.fn().mockImplementation(async () => {
      (runtime as any).sessionId = 'session-1';
      return 'session-1';
    });
    (runtime as any).loadSession = jest.fn().mockResolvedValue(true);

    const [fromSend, fromCommandCatalog] = await Promise.all([
      runtime.ensureReady({ allowSessionCreation: true }),
      runtime.ensureReady({ allowSessionCreation: false }),
    ]);

    expect(fromSend).toBe(true);
    expect(fromCommandCatalog).toBe(true);
    expect(startProcess).toHaveBeenCalledTimes(1);
    expect(shutdownProcess).toHaveBeenCalledTimes(1);
  });

  it('builds launch artifacts from the Grok-projected permission mode', async () => {
    const plugin = createMockPlugin({
      settings: {
        permissionMode: 'normal',
        providerConfigs: {
          grok: {
            enabled: true,
            selectedMode: GROK_FULL_ACCESS_MODE_ID,
          },
        },
        savedProviderPermissionMode: {
          grok: 'full_access',
        },
        settingsProvider: 'codex',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue({
      ...plugin.settings,
      permissionMode: 'full_access',
    });
    const prepareLaunchArtifacts = jest.spyOn(
      launchArtifacts,
      'prepareGrokLaunchArtifacts',
    ).mockResolvedValue({
      configContent: '# managed\n',
      grokHomePath: '/tmp/grimoire-grok-home',
      launchKey: 'launch-key',
      managedConfigPath: '/tmp/grimoire-grok-home/managed_config.toml',
      systemPromptPath: '/tmp/grimoire-grok-home/system.md',
    });
    const startProcess = jest.spyOn(runtime as any, 'startProcess').mockImplementation(async () => {
      (runtime as any).ready = true;
    });

    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);

    expect(prepareLaunchArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'always-approve',
    }));
    expect(startProcess).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'always-approve',
    }));
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
          { label: 'Allow once', presentation: 'allow', value: 'approve-now' },
          { label: 'Always allow', presentation: 'always', value: 'approve-always' },
          { label: 'Deny', presentation: 'reject', value: 'deny-now' },
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
    expect((runtime as any).currentSessionModeConfigId).toBe('session_mode');
    expect((runtime as any).currentSessionModeId).toBe('build');
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
    const runtime = new GrokChatRuntime(plugin);

    await (runtime as any).syncSessionModeState({
      currentModeId: GROK_BUILD_MODE_ID,
    });

    expect(plugin.settings.providerConfigs.grok.selectedMode).toBe('');
    expect((runtime as any).currentSessionModeId).toBe(GROK_BUILD_MODE_ID);
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

  it('applies the saved Auto-approve mode through the native ACP mode method', async () => {
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
    const setMode = jest.fn().mockResolvedValue({});
    const setConfigOption = jest.fn();
    (runtime as any).connection = { setConfigOption, setMode };
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

  it('uses launch policy when the session advertises no runtime mode control', async () => {
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
    const setMode = jest.fn();
    const setConfigOption = jest.fn();
    (runtime as any).connection = { setConfigOption, setMode };
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).applySelectedMode('session-1');

    expect(setMode).not.toHaveBeenCalled();
    expect(setConfigOption).not.toHaveBeenCalled();
  });

  it('falls back to the discovered mode config only for ACP method-not-found', async () => {
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
    const methodNotFound = new JsonRpcErrorResponse(
      'session/set_mode',
      -32601,
      'Method not found',
    );
    const setMode = jest.fn().mockRejectedValue(methodNotFound);
    const setConfigOption = jest.fn().mockResolvedValue({
      configOptions: [{
        category: 'mode',
        currentValue: GROK_FULL_ACCESS_MODE_ID,
        id: 'session_mode',
        name: 'Mode',
        options: [
          { name: 'Auto-approve', value: GROK_FULL_ACCESS_MODE_ID },
          { name: 'Safe', value: GROK_SAFE_MODE_ID },
        ],
        type: 'select',
      }],
    });
    (runtime as any).connection = { setConfigOption, setMode };
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).syncSessionModeState({
      configOptions: [{
        category: 'mode',
        currentValue: GROK_SAFE_MODE_ID,
        id: 'session_mode',
        name: 'Mode',
        options: [
          { name: 'Auto-approve', value: GROK_FULL_ACCESS_MODE_ID },
          { name: 'Safe', value: GROK_SAFE_MODE_ID },
        ],
        type: 'select',
      }],
    });
    await (runtime as any).applySelectedMode('session-1');

    expect(setConfigOption).toHaveBeenCalledWith({
      configId: 'session_mode',
      sessionId: 'session-1',
      type: 'select',
      value: GROK_FULL_ACCESS_MODE_ID,
    });
    expect((runtime as any).currentSessionModeId).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('preserves method-not-found when the session exposes no mode config fallback', async () => {
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
    const methodNotFound = new JsonRpcErrorResponse(
      'session/set_mode',
      -32601,
      'Method not found',
    );
    const setMode = jest.fn().mockRejectedValue(methodNotFound);
    const setConfigOption = jest.fn();
    (runtime as any).connection = { setConfigOption, setMode };
    (runtime as any).currentSessionModeId = GROK_SAFE_MODE_ID;
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await expect((runtime as any).applySelectedMode('session-1')).rejects.toBe(methodNotFound);

    expect(setConfigOption).not.toHaveBeenCalled();
    expect((runtime as any).currentSessionModeId).toBe(GROK_SAFE_MODE_ID);
  });

  it('rethrows real ACP mode errors without attempting a second mutation', async () => {
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
    const policyError = new JsonRpcErrorResponse(
      'session/set_mode',
      -32001,
      'Mode change rejected',
    );
    const setMode = jest.fn().mockRejectedValue(policyError);
    const setConfigOption = jest.fn();
    (runtime as any).connection = { setConfigOption, setMode };
    (runtime as any).currentSessionModeConfigId = 'session_mode';
    (runtime as any).currentSessionModeId = GROK_SAFE_MODE_ID;
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await expect((runtime as any).applySelectedMode('session-1')).rejects.toBe(policyError);

    expect(setConfigOption).not.toHaveBeenCalled();
    expect((runtime as any).currentSessionModeId).toBe(GROK_SAFE_MODE_ID);
  });

  it('does not send synthetic toolbar mode ids when Grok only reported a current native mode', async () => {
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
    const setMode = jest.fn();
    const setConfigOption = jest.fn();
    (runtime as any).connection = { setConfigOption, setMode };
    (runtime as any).currentSessionModeId = 'ask';
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await (runtime as any).applySelectedMode('session-1');

    expect(setMode).not.toHaveBeenCalled();
    expect(setConfigOption).not.toHaveBeenCalled();
    expect((runtime as any).currentSessionModeId).toBe('ask');
  });

  it('keeps the turn alive when ACP rejects a mode id with Invalid params', async () => {
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
    const setMode = jest.fn().mockRejectedValue(new JsonRpcErrorResponse(
      'session/set_mode',
      -32602,
      'Invalid params',
    ));
    const setConfigOption = jest.fn();
    (runtime as any).connection = { setConfigOption, setMode };
    (runtime as any).currentSessionModeId = GROK_SAFE_MODE_ID;
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot').mockReturnValue(plugin.settings);

    await expect((runtime as any).applySelectedMode('session-1')).resolves.toBeUndefined();

    expect(setConfigOption).not.toHaveBeenCalled();
    expect((runtime as any).currentSessionModeId).toBe(GROK_SAFE_MODE_ID);
  });

  it('does not leak CLI stderr into user-facing Invalid params errors', () => {
    const plugin = createMockPlugin({
      recordDebugLog: jest.fn(),
    });
    const runtime = new GrokChatRuntime(plugin);
    (runtime as any).process = {
      getStderrSnapshot: () => [
        'Error: Invalid params',
        "ERROR Failed to spawn MCP server 'telegram': No such file or directory (os error 2)",
      ].join('\n'),
    };

    expect((runtime as any).formatRuntimeError(
      new JsonRpcErrorResponse('session/prompt', -32602, 'Invalid params'),
    )).toEqual(expect.stringMatching(/Grok Build/));
    expect((runtime as any).formatRuntimeError(
      new JsonRpcErrorResponse('session/prompt', -32602, 'Invalid params'),
    )).not.toContain('telegram');
    expect(plugin.recordDebugLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'runtime.error.stderr',
    }));
  });

  it('recovers a completed answer when session/prompt fails with Invalid params', async () => {
    const runtime = new GrokChatRuntime(createMockPlugin());
    const prompt = jest.fn().mockRejectedValue(
      new JsonRpcErrorResponse('session/prompt', -32602, 'Invalid params'),
    );
    const recoverFinalAssistantMessage = jest.fn().mockResolvedValue('Recovered after invalid params');

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };
    (runtime as any).transcriptRecovery = { recoverFinalAssistantMessage };
    (runtime as any).applySelectedMode = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedModel = jest.fn().mockResolvedValue(undefined);
    (runtime as any).applySelectedEffort = jest.fn().mockResolvedValue(undefined);

    const chunks = await collectRuntimeChunks(runtime);

    expect(recoverFinalAssistantMessage).toHaveBeenCalled();
    expect(chunks).toEqual([
      { content: 'Recovered after invalid params', type: 'text' },
      { type: 'done' },
    ]);
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
    const runtime = new GrokChatRuntime(plugin);
    const syncCallback = jest.fn();

    runtime.setPermissionModeSyncCallback(syncCallback);

    await (runtime as any).syncSessionModeState({
      currentModeId: GROK_BUILD_MODE_ID,
    });

    expect((runtime as any).currentSessionModeId).toBe(GROK_BUILD_MODE_ID);
    expect(plugin.settings.permissionMode).toBe('normal');
    expect(plugin.settings.providerConfigs.grok.selectedMode).toBe(GROK_SAFE_MODE_ID);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
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
          { label: 'Allow once', presentation: 'allow', value: 'approve-now' },
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await (runtime as any).syncSessionModelState({
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
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(runtime as any, 'readNativeModelCatalog').mockReturnValue({
      defaultModelId: 'grok-4.6',
      models: [
        { label: 'Grok 4.6', rawId: 'grok-4.6' },
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    });
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await (runtime as any).syncSessionModelState({
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

  it('records the reasoning levels each available model reports, not only the active one', async () => {
    const plugin = createMockPlugin({
      settings: {
        model: 'grok:grok-4.6',
        providerConfigs: {
          grok: {
            discoveredModels: [],
            preferredThinkingByModel: {},
            visibleModels: [],
          },
        },
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    // Shape taken from a live session/new response: the agent states the levels
    // for every model it offers, so one session settles the whole picker.
    await (runtime as any).syncSessionModelState({
      models: {
        availableModels: [
          {
            modelId: 'grok-4.6',
            name: 'Grok 4.6',
            _meta: {
              supportsReasoningEffort: true,
              reasoningEfforts: [
                { id: 'xhigh', value: 'xhigh', label: 'Extra High Effort' },
                { id: 'high', value: 'high', label: 'High Effort' },
                { id: 'medium', value: 'medium', label: 'Medium Effort' },
                { id: 'low', value: 'low', label: 'Low Effort' },
              ],
            },
          },
          {
            modelId: 'grok-4.5',
            name: 'Grok 4.5',
            _meta: {
              supportsReasoningEffort: true,
              reasoningEfforts: [
                { id: 'high', value: 'high', label: 'High Effort' },
                { id: 'medium', value: 'medium', label: 'Medium Effort' },
                { id: 'low', value: 'low', label: 'Low Effort' },
              ],
            },
          },
        ],
        currentModelId: 'grok-4.6',
      },
    });

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
    const plugin = createMockPlugin({
      settings: {
        model: 'grok:grok-4.6',
        providerConfigs: {
          grok: {
            discoveredModels: [],
            preferredThinkingByModel: {},
            visibleModels: [],
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
      models: {
        availableModels: [
          {
            modelId: 'grok-4.6',
            name: 'Grok 4.6',
            _meta: {
              reasoningEfforts: [
                { id: 'xhigh', value: 'xhigh', label: 'Extra High Effort' },
                { id: 'high', value: 'high', label: 'High Effort' },
              ],
            },
          },
        ],
        currentModelId: 'grok-4.6',
      },
    });

    // The option describes this session as it is now, the report describes the
    // catalog, so the session wins where they disagree.
    expect(getGrokProviderSettings(plugin.settings).thinkingOptionsByModel['grok-4.6']
      .map((variant) => variant.value)).toEqual(['low', 'high']);
  });

  it('still forgets a stale level list when nothing in the session describes the model', async () => {
    const plugin = createMockPlugin({
      settings: {
        model: 'grok:grok-4.6',
        providerConfigs: {
          grok: {
            discoveredModels: [{ label: 'Grok 4.6', rawId: 'grok-4.6' }],
            preferredThinkingByModel: {},
            thinkingOptionsByModel: {
              'grok-4.6': [{ label: 'Extra high', value: 'xhigh' }],
            },
            visibleModels: ['grok-4.6'],
          },
        },
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await (runtime as any).syncSessionModelState({
      models: {
        availableModels: [{ modelId: 'grok-4.6', name: 'Grok 4.6' }],
        currentModelId: 'grok-4.6',
      },
    });

    expect(getGrokProviderSettings(plugin.settings).thinkingOptionsByModel['grok-4.6']).toBeUndefined();
  });

  it('keeps the thought-level option alive across a model switch', async () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'high',
        model: 'grok:grok-4.6',
        providerConfigs: {
          grok: { discoveredModels: [], preferredThinkingByModel: {}, visibleModels: [] },
        },
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await (runtime as any).syncSessionModelState({
      configOptions: [
        {
          category: 'thought_level',
          currentValue: 'xhigh',
          id: 'effort',
          name: 'Effort',
          options: [{ name: 'High', value: 'high' }, { name: 'Extra high', value: 'xhigh' }],
          type: 'select',
        },
      ],
      models: {
        availableModels: [
          { modelId: 'grok-4.6', name: 'Grok 4.6' },
          {
            modelId: 'grok-4.5',
            name: 'Grok 4.5',
            _meta: {
              reasoningEfforts: [
                { id: 'high', value: 'high', label: 'High Effort' },
                { id: 'low', value: 'low', label: 'Low Effort' },
              ],
            },
          },
        ],
        currentModelId: 'grok-4.6',
      },
    });
    expect((runtime as any).currentSessionEffortConfigId).toBe('effort');

    await (runtime as any).syncSessionModelState({}, { currentRawModelId: 'grok-4.5' });

    // Same session, so the option id still stands - dropping it would leave
    // applySelectedEffort with nothing to call.
    expect((runtime as any).currentSessionEffortConfigId).toBe('effort');
    // The accepted values follow the new model, and the effort must be applied
    // again because the agent reverted to that model's default.
    expect([...(runtime as any).currentSessionEffortValues]).toEqual(['low', 'high']);
    expect((runtime as any).currentSessionEffortValue).toBeNull();
  });

  it('never launches with a level the selected model does not report', () => {
    const plugin = createMockPlugin({
      settings: {
        effortLevel: 'xhigh',
        model: 'grok:grok-4.5',
        providerConfigs: {
          grok: {
            discoveredModels: [
              { label: 'Grok 4.6', rawId: 'grok-4.6' },
              { label: 'Grok 4.5', rawId: 'grok-4.5' },
            ],
            thinkingOptionsByModel: {
              'grok-4.5': [
                { label: 'Low', value: 'low' },
                { label: 'High', value: 'high' },
              ],
              'grok-4.6': [
                { label: 'High', value: 'high' },
                { label: 'Extra high', value: 'xhigh' },
              ],
            },
            visibleModels: ['grok-4.6', 'grok-4.5'],
          },
        },
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    // The settings snapshot that feeds the launch args runs effortLevel through
    // getReasoningOptions for the selected model, so a stored xhigh cannot
    // reach `--reasoning-effort` for a model that never reported it.
    expect((runtime as any).getProviderSettings().effortLevel).toBe('high');

    plugin.settings.model = 'grok:grok-4.6';
    expect((runtime as any).getProviderSettings().effortLevel).toBe('xhigh');
  });

  it('keeps the reported levels when the user switches to another model', async () => {
    const plugin = createMockPlugin({
      settings: {
        model: 'grok:grok-4.6',
        providerConfigs: {
          grok: {
            discoveredModels: [],
            preferredThinkingByModel: {},
            visibleModels: [],
          },
        },
        settingsProvider: 'grok',
      },
    });
    const runtime = new GrokChatRuntime(plugin);
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await (runtime as any).syncSessionModelState({
      models: {
        availableModels: [
          {
            modelId: 'grok-4.6',
            name: 'Grok 4.6',
            _meta: {
              reasoningEfforts: [
                { id: 'xhigh', value: 'xhigh', label: 'Extra High Effort' },
                { id: 'low', value: 'low', label: 'Low Effort' },
              ],
            },
          },
          {
            modelId: 'grok-4.5',
            name: 'Grok 4.5',
            _meta: {
              reasoningEfforts: [
                { id: 'high', value: 'high', label: 'High Effort' },
                { id: 'low', value: 'low', label: 'Low Effort' },
              ],
            },
          },
        ],
        currentModelId: 'grok-4.6',
      },
    });

    // Switching models calls in with nothing to say about levels, which must
    // not be read as "this model has none".
    await (runtime as any).syncSessionModelState({}, { currentRawModelId: 'grok-4.5' });

    const thinkingOptions = getGrokProviderSettings(plugin.settings).thinkingOptionsByModel;
    expect(thinkingOptions['grok-4.5'].map((variant) => variant.value)).toEqual(['low', 'high']);
    expect(thinkingOptions['grok-4.6'].map((variant) => variant.value)).toEqual(['low', 'xhigh']);
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

  it('does not apply a stale selected model outside the runtime discovery catalog', async () => {
    const plugin = createMockPlugin({
      settings: {
        model: 'grok:grok-composer-2.5-fast',
        providerConfigs: {
          grok: {
            visibleModels: ['grok-composer-2.5-fast'],
          },
        },
        savedProviderModel: {
          grok: 'grok:grok-composer-2.5-fast',
        },
        settingsProvider: 'grok',
      },
    });
    updateGrokDiscoveryState(plugin.settings, {
      discoveredModels: [
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    });
    const runtime = new GrokChatRuntime(plugin);
    const setModel = jest.fn();
    (runtime as any).connection = { setModel };
    (runtime as any).currentSessionModelId = 'grok-4.5';
    jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('grok');

    await (runtime as any).applySelectedModel('session-1', {
      model: 'grok:grok-composer-2.5-fast',
    });

    expect(setModel).not.toHaveBeenCalled();
    expect((runtime as any).getActiveDisplayModel({
      model: 'grok:grok-composer-2.5-fast',
    })).toBe('grok:grok-4.5');
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
});
