import '@/providers';

import * as fs from 'node:fs/promises';

import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { StreamChunk } from '@/core/types';
import type { AcpContentBlock } from '@/providers/acp';
import { JsonRpcErrorResponse } from '@/providers/acp';
import { QwenChatRuntime } from '@/providers/qwen/runtime/QwenChatRuntime';
import { getQwenProviderSettings, updateQwenProviderSettings } from '@/providers/qwen/settings';

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  const settings: Record<string, unknown> = {};
  updateQwenProviderSettings(settings, { enabled: true });

  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/grimoire-qwen-test-vault',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/qwen'),
    manifest: { version: '0.0.0-test' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    settings,
    ...overrides,
  };
}

async function collect(generator: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('QwenChatRuntime', () => {
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm('/tmp/grimoire-qwen-test-vault', { force: true, recursive: true });
  });

  it('does not start when the provider is disabled', async () => {
    const settings: Record<string, unknown> = {};
    updateQwenProviderSettings(settings, { enabled: false });
    const runtime = new QwenChatRuntime(createMockPlugin({ settings }));

    await expect(runtime.ensureReady()).resolves.toBe(false);
    expect(runtime.isReady()).toBe(false);
  });

  it('recycles the ACP process after managed workspace resources change', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const shutdown = jest.spyOn(runtime as any, 'shutdownProcess').mockResolvedValue(undefined);

    await runtime.reloadWorkspaceResources();

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('launches Qwen in ACP mode', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const startProcess = jest.spyOn(runtime as any, 'startProcess').mockImplementation(async () => {
      (runtime as any).ready = true;
      (runtime as any).connection = {};
    });

    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);

    expect(startProcess).toHaveBeenCalledWith(expect.objectContaining({
      args: ['--acp'],
      command: '/usr/local/bin/qwen',
    }));
  });

  it('seeds visible model options from ACP discovery when none are configured', () => {
    const plugin = createMockPlugin();
    const runtime = new QwenChatRuntime(plugin);

    (runtime as any).syncSessionDiscovery({
      models: {
        availableModels: [
          { id: 'qwen-2.5-pro', name: 'Qwen 2.5 Pro' },
          { id: 'qwen-2.5-flash', name: 'Qwen 2.5 Flash' },
        ],
        currentModelId: 'qwen-2.5-flash',
      },
    });

    const settings = getQwenProviderSettings(plugin.settings);
    expect(settings.discoveredModels.map((model) => model.rawId)).toEqual([
      'qwen-2.5-pro',
      'qwen-2.5-flash',
    ]);
    expect(settings.visibleModels).toEqual([
      'qwen-2.5-pro',
      'qwen-2.5-flash',
    ]);
  });

  it('replaces a stale visible model cache with the latest ACP catalog', () => {
    const plugin = createMockPlugin();
    updateQwenProviderSettings(plugin.settings, {
      visibleModels: ['qwen-2.5-pro'],
    });
    const runtime = new QwenChatRuntime(plugin);

    (runtime as any).syncSessionDiscovery({
      models: {
        availableModels: [
          { id: 'qwen-2.5-pro', name: 'Qwen 2.5 Pro' },
          { id: 'qwen-3-max', name: 'Qwen 3 Max' },
        ],
        currentModelId: 'qwen-3-max',
      },
    });

    expect(getQwenProviderSettings(plugin.settings).visibleModels).toEqual([
      'qwen-2.5-pro',
      'qwen-3-max',
    ]);
  });

  it('streams ACP assistant chunks and done', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const turn = runtime.prepareTurn({ text: 'Hello' });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = {
      prompt: jest.fn(async () => {
        await (runtime as any).handleSessionNotification({
          sessionId: 'session-1',
          update: {
            content: { text: 'Hi from Qwen', type: 'text' },
            messageId: 'assistant-1',
            sessionUpdate: 'agent_message_chunk',
          },
        });
        return {};
      }),
    };

    const chunks = await collect(runtime.query(turn));

    expect(chunks).toContainEqual({ itemId: 'assistant-1', type: 'assistant_message_start' });
    expect(chunks).toContainEqual({ content: 'Hi from Qwen', type: 'text' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('keeps nested Qwen subagent activity out of the parent transcript', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const turn = runtime.prepareTurn({ text: 'Research this' });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = {
      prompt: jest.fn(async () => {
        const subagentMeta = {
          parentToolCallId: 'agent-call-1',
          subagentType: 'Explore',
        };
        await (runtime as any).handleSessionNotification({
          sessionId: 'session-1',
          update: {
            _meta: subagentMeta,
            content: { text: 'private reasoning', type: 'text' },
            sessionUpdate: 'agent_thought_chunk',
          },
        });
        await (runtime as any).handleSessionNotification({
          sessionId: 'session-1',
          update: {
            _meta: subagentMeta,
            content: { text: 'private subagent answer', type: 'text' },
            sessionUpdate: 'agent_message_chunk',
          },
        });
        await (runtime as any).handleSessionNotification({
          sessionId: 'session-1',
          update: {
            _meta: subagentMeta,
            rawInput: { path: 'Notes' },
            sessionUpdate: 'tool_call',
            status: 'in_progress',
            title: 'List files',
            toolCallId: 'nested-tool-1',
          },
        });
        await (runtime as any).handleSessionNotification({
          sessionId: 'session-1',
          update: {
            content: { text: 'Parent answer', type: 'text' },
            messageId: 'assistant-1',
            sessionUpdate: 'agent_message_chunk',
          },
        });
        return {};
      }),
    };

    const chunks = await collect(runtime.query(turn));

    expect(chunks).toEqual([
      { itemId: 'assistant-1', type: 'assistant_message_start' },
      { content: 'Parent answer', type: 'text' },
      { type: 'done' },
    ]);
  });

  it('loads authoritative parent context usage from the Qwen ACP extension', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const turn = runtime.prepareTurn({ text: 'Hello' });
    const request = jest.fn().mockResolvedValue({
      usage: {
        contextWindowSize: 1_000_000,
        totalTokens: 250_000,
      },
    });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).transport = { request };
    (runtime as any).connection = {
      prompt: jest.fn().mockResolvedValue({}),
    };

    const chunks = await collect(runtime.query(turn));

    expect(request).toHaveBeenCalledWith(
      'qwen/status/session/context_usage',
      { detail: false, sessionId: 'session-1' },
      { timeoutMs: 3_000 },
    );
    expect(chunks).toContainEqual({
      sessionId: 'session-1',
      type: 'usage',
      usage: {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextTokens: 250_000,
        contextWindow: 1_000_000,
        contextWindowIsAuthoritative: true,
        inputTokens: 0,
        model: 'qwen',
        percentage: 25,
      },
      usageScope: 'parent',
    });
  });

  it('sets the mapped Qwen mode before prompting', async () => {
    const plugin = createMockPlugin();
    plugin.settings.permissionMode = 'plan';
    const runtime = new QwenChatRuntime(plugin);
    const setMode = jest.fn().mockResolvedValue({});
    const prompt = jest.fn().mockResolvedValue({});
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).connection = { prompt, setMode };

    await collect(runtime.query(runtime.prepareTurn({ text: 'Plan this' })));

    expect(setMode).toHaveBeenCalledWith({ modeId: 'plan', sessionId: 'session-1' });
    expect(setMode.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]);
  });

  it('applies Qwen effort internally after model and mode before the user prompt', async () => {
    const plugin = createMockPlugin();
    updateQwenProviderSettings(plugin.settings, {
      effortLevel: 'xhigh',
      visibleModels: ['qwen-2.5-pro'],
    });
    const runtime = new QwenChatRuntime(plugin);
    const setModel = jest.fn().mockResolvedValue({});
    const setMode = jest.fn().mockResolvedValue({});
    const prompt = jest.fn().mockResolvedValue({});
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt, setModel, setMode };

    const chunks = await collect(runtime.query(runtime.prepareTurn({ text: 'Hello' })));

    expect(prompt).toHaveBeenNthCalledWith(1, {
      prompt: [{ text: '/effort xhigh', type: 'text' }],
      sessionId: 'session-1',
    });
    expect(prompt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: [{ text: 'Hello', type: 'text' }],
      sessionId: 'session-1',
    }));
    expect(setModel.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]);
    expect(setMode.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]);
    expect(prompt.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[1]);
    expect(chunks).not.toContainEqual(expect.objectContaining({ content: '/effort xhigh' }));
  });

  it('does not repeat unchanged Qwen effort but reapplies it after selection and session changes', async () => {
    const plugin = createMockPlugin();
    const runtime = new QwenChatRuntime(plugin);
    const prompt = jest.fn().mockResolvedValue({});
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };

    await collect(runtime.query(runtime.prepareTurn({ text: 'First' })));
    await collect(runtime.query(runtime.prepareTurn({ text: 'Second' })));
    updateQwenProviderSettings(plugin.settings, { effortLevel: 'max' });
    await collect(runtime.query(runtime.prepareTurn({ text: 'Third' })));
    runtime.resetSession();
    (runtime as any).sessionId = 'session-2';
    (runtime as any).loadedSessionId = 'session-2';
    await collect(runtime.query(runtime.prepareTurn({ text: 'Fourth' })));

    expect(prompt.mock.calls.map(([request]) => request.prompt[0])).toEqual([
      { text: '/effort high', type: 'text' },
      { text: 'First', type: 'text' },
      { text: 'Second', type: 'text' },
      { text: '/effort max', type: 'text' },
      { text: 'Third', type: 'text' },
      { text: '/effort max', type: 'text' },
      { text: 'Fourth', type: 'text' },
    ]);
  });

  it('does not send the user prompt when applying Qwen effort fails', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const prompt = jest.fn()
      .mockRejectedValueOnce(new Error('effort unavailable'));
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };

    const chunks = await collect(runtime.query(runtime.prepareTurn({ text: 'Hello' })));

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([
      { type: 'error', content: 'effort unavailable' },
      { type: 'done' },
    ]);
  });

  it('retains the requested session id when ACP load omits it', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    (runtime as any).connection = {
      loadSession: jest.fn().mockResolvedValue({ models: null, modes: null }),
    };

    await expect((runtime as any).loadSession('requested-id', '/tmp/grimoire-qwen-test-vault'))
      .resolves.toBe('loaded');
    expect(runtime.getSessionId()).toBe('requested-id');
  });

  it('passes enabled Grimoire-managed MCP servers into ACP sessions', async () => {
    jest.spyOn(ProviderWorkspaceRegistry, 'getMcpServerManager').mockReturnValue({
      getServers: () => [{
        name: 'vault-search',
        config: { command: 'node', args: ['server.js'], env: { TOKEN: 'secret' } },
        contextSaving: false,
        enabled: true,
      }],
    } as any);
    const runtime = new QwenChatRuntime(createMockPlugin());
    const newSession = jest.fn().mockResolvedValue({
      configOptions: null,
      models: null,
      modes: null,
      sessionId: 'session-mcp',
    });
    (runtime as any).connection = { newSession };

    await expect((runtime as any).createSession('/tmp/grimoire-qwen-test-vault'))
      .resolves.toBe('session-mcp');

    expect(newSession).toHaveBeenCalledWith({
      cwd: '/tmp/grimoire-qwen-test-vault',
      mcpServers: [{
        args: ['server.js'],
        command: 'node',
        env: [{ name: 'TOKEN', value: 'secret' }],
        name: 'vault-search',
      }],
    });
  });

  it('maps ACP approval decisions to the supplied option ids', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    runtime.setApprovalCallback(jest.fn().mockResolvedValue('allow-always'));

    await expect((runtime as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'once' },
        { kind: 'allow_always', name: 'Always allow', optionId: 'always' },
      ],
      sessionId: 'session-1',
      toolCall: { kind: 'edit', rawInput: { path: 'Notes/Qwen.md' }, title: 'Edit file' },
    })).resolves.toEqual({ outcome: { optionId: 'always', outcome: 'selected' } });
  });

  it('preserves duplicate ACP persistence kinds and exposes a location-only target', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const approval = jest.fn().mockResolvedValue({
      type: 'select-option' as const,
      value: 'always-user',
    });
    runtime.setApprovalCallback(approval);

    await expect((runtime as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'once' },
        { kind: 'allow_always', name: 'Always allow for project', optionId: 'always-project' },
        { kind: 'allow_always', name: 'Always allow for user', optionId: 'always-user' },
        { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'edit',
        locations: [{ path: 'Notes/From Location.md' }],
        rawInput: {},
        title: 'Edit file',
      },
    })).resolves.toEqual({ outcome: { optionId: 'always-user', outcome: 'selected' } });

    expect(approval).toHaveBeenCalledWith(
      'Edit file',
      {},
      'Edit file requests access to Notes/From Location.md.',
      {
        decisionOptions: [
          { label: 'Allow once', presentation: 'allow', value: 'once' },
          { label: 'Always allow for project', presentation: 'always', value: 'always-project' },
          { label: 'Always allow for user', presentation: 'always', value: 'always-user' },
          { label: 'Reject', presentation: 'reject', value: 'reject' },
        ],
        target: 'Notes/From Location.md',
      },
    );
  });

  it('bridges Qwen 0.21 ask_user_question permission metadata to the chat callback', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const askUserQuestion = jest.fn().mockResolvedValue({
      'Что именно улучшить в заметке о Гольфстриме?': ['Содержание', 'ASCII-схема'],
    });
    const approval = jest.fn();
    runtime.setApprovalCallback(approval);
    runtime.setAskUserQuestionCallback(askUserQuestion);

    await expect((runtime as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Submit', optionId: 'proceed_once' },
        { kind: 'reject_once', name: 'Cancel', optionId: 'cancel' },
      ],
      sessionId: 'session-1',
      toolCall: {
        _meta: {
          qwenInteractionKind: 'user_question',
          qwenQuestions: [],
          toolName: 'ask_user_question',
        },
        rawInput: {
          questions: [
            {
              header: 'Направление',
              multiSelect: true,
              options: [
                { description: 'Добавить научные детали и расширить разделы', label: 'Содержание' },
                { description: 'Перерисовать диаграмму течения', label: 'ASCII-схема' },
              ],
              question: 'Что именно улучшить в заметке о Гольфстриме?',
            },
          ],
        },
        title: 'Ask user 1 question',
        toolCallId: 'call-1',
      },
    })).resolves.toEqual({
      answers: { '0': 'Содержание, ASCII-схема' },
      outcome: { optionId: 'proceed_once', outcome: 'selected' },
    });

    expect(askUserQuestion).toHaveBeenCalledWith({
      questions: [
        {
          header: 'Направление',
          multiSelect: true,
          options: [
            { description: 'Добавить научные детали и расширить разделы', label: 'Содержание' },
            { description: 'Перерисовать диаграмму течения', label: 'ASCII-схема' },
          ],
          question: 'Что именно улучшить в заметке о Гольфстриме?',
        },
      ],
    });
    expect(approval).not.toHaveBeenCalled();
  });

  it('uses Qwen metadata questions as a fallback and maps answers by stable id', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    runtime.setAskUserQuestionCallback(jest.fn().mockResolvedValue({ focus: 'Content' }));

    await expect((runtime as any).handlePermissionRequest({
      options: [{ kind: 'allow_once', name: 'Submit', optionId: 'proceed_once' }],
      sessionId: 'session-1',
      toolCall: {
        _meta: {
          qwenInteractionKind: 'user_question',
          qwenQuestions: [{
            header: 'Focus',
            id: 'focus',
            options: [{ label: 'Content' }],
            question: 'What should change?',
          }],
          toolName: 'ask_user_question',
        },
        title: 'Ask user 1 question',
        toolCallId: 'call-1',
      },
    })).resolves.toEqual({
      answers: { '0': 'Content' },
      outcome: { optionId: 'proceed_once', outcome: 'selected' },
    });
  });

  it('cancels Qwen ask_user_question permissions without an answer callback or after cancellation', async () => {
    const request = {
      options: [{ kind: 'allow_once', name: 'Allow once', optionId: 'allow-once' }],
      sessionId: 'session-1',
      toolCall: {
        _meta: { toolName: 'ask_user_question' },
        rawInput: { questions: [{ question: 'Continue?', options: ['Yes'] }] },
        title: 'Ask user 1 question',
        toolCallId: 'call-1',
      },
    };
    const runtime = new QwenChatRuntime(createMockPlugin());

    await expect((runtime as any).handlePermissionRequest(request)).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });

    runtime.setAskUserQuestionCallback(jest.fn().mockResolvedValue(null));
    await expect((runtime as any).handlePermissionRequest(request)).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it('keeps non-Qwen-question permission requests on the generic approval path', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const approval = jest.fn().mockResolvedValue('allow');
    const askUserQuestion = jest.fn();
    runtime.setApprovalCallback(approval);
    runtime.setAskUserQuestionCallback(askUserQuestion);

    await expect((runtime as any).handlePermissionRequest({
      options: [{ kind: 'allow_once', name: 'Allow once', optionId: 'allow-once' }],
      sessionId: 'session-1',
      toolCall: {
        rawInput: { questions: [{ question: 'Not an interaction question' }] },
        title: 'Run command',
        toolCallId: 'call-1',
      },
    })).resolves.toEqual({ outcome: { optionId: 'allow-once', outcome: 'selected' } });

    expect(approval).toHaveBeenCalled();
    expect(askUserQuestion).not.toHaveBeenCalled();
  });

  it('syncs Qwen current mode updates into conservative Grimoire state', async () => {
    const plugin = createMockPlugin();
    const runtime = new QwenChatRuntime(plugin);
    const modeSync = jest.fn();
    runtime.setPermissionModeSyncCallback(modeSync);
    (runtime as any).sessionId = 'session-1';

    await (runtime as any).handleSessionNotification({
      sessionId: 'session-1',
      update: {
        currentModeId: 'auto-edit',
        sessionUpdate: 'current_mode_update',
      },
    });

    expect(getQwenProviderSettings(plugin.settings).selectedMode).toBe('normal');
    // This asserted `'auto-edit'` — the agent's own id — which is what the
    // runtime was sending while writing the *translated* value into the vault.
    // `Tab.ts` says what it expects of every ACP provider: "already-normalized
    // Grimoire modes (full_access / plan / normal). Unknown values stay Safe."
    // Two of this CLI's four ids only survived that by accident.
    expect(modeSync).toHaveBeenCalledWith('normal');
  });

  it('clears mode and command state when switching conversations', () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    (runtime as any).sessionId = 'session-1';
    (runtime as any).sessionConfig.markApplied({ modeId: 'plan', effortLevel: 'max' });
    (runtime as any).supportedCommands = [{ id: 'acp:compact', name: 'compact', source: 'sdk' }];

    runtime.syncConversationState({ sessionId: 'session-2' });

    expect((runtime as any).sessionConfig.sessionModeId).toBeNull();
    // The effort goes with it, and forgetting it matters more than the other
    // two: it is applied by sending a whole prompt, so a level kept across a
    // session change is a turn the new session never received.
    expect((runtime as any).sessionConfig.sessionEffortLevel).toBeNull();
    expect((runtime as any).supportedCommands).toEqual([]);
  });

  it('does not adopt the mode a session reports when it opens', () => {
    // The fifth review's G1, which this provider carried in a worse form than
    // Gemini did: the reported mode was written into `selectedMode` *and*
    // pushed at the toolbar, where `updatePlanModeUI` commits it. A vault on
    // Plan, opening a session that reports `default`, was switched to Safe and
    // had it saved.
    const plugin = createMockPlugin();
    plugin.settings.permissionMode = 'plan';
    updateQwenProviderSettings(plugin.settings, { selectedMode: 'plan' });
    const runtime = new QwenChatRuntime(plugin);
    const modeSync = jest.fn();
    runtime.setPermissionModeSyncCallback(modeSync);

    (runtime as any).syncSessionDiscovery({
      modes: {
        availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }],
        currentModeId: 'default',
      },
    });

    expect(getQwenProviderSettings(plugin.settings).selectedMode).toBe('plan');
    expect(modeSync).not.toHaveBeenCalled();
    // Recorded all the same, in the agent's vocabulary: it is what a redundant
    // `set_mode` is skipped on.
    expect((runtime as any).sessionConfig.sessionModeId).toBe('default');
  });

  it('applies the explicit query model before prompting instead of the saved global model', async () => {
    const plugin = createMockPlugin();
    plugin.settings.savedProviderModel = { qwen: 'qwen:qwen-2.5-pro' };
    const runtime = new QwenChatRuntime(plugin);
    const setModel = jest.fn().mockResolvedValue({});
    const prompt = jest.fn().mockResolvedValue({
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });
    const turn = runtime.prepareTurn({ text: 'Hello' });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt, setModel };

    const chunks = await collect(runtime.query(turn, undefined, {
      model: 'qwen:qwen-2.5-flash',
    }));

    expect(setModel).toHaveBeenCalledWith({
      modelId: 'qwen-2.5-flash',
      sessionId: 'session-1',
    });
    expect(setModel.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]);
    expect((runtime as any).getActiveModel()).toBe('qwen:qwen-2.5-flash');
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({ model: 'qwen:qwen-2.5-flash' }),
    }));
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('does not prompt when applying the explicit query model fails', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const setModel = jest.fn().mockRejectedValue(new Error('model unavailable'));
    const prompt = jest.fn();
    const turn = runtime.prepareTurn({ text: 'Hello' });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt, setModel };

    const chunks = await collect(runtime.query(turn, undefined, {
      model: 'qwen:qwen-2.5-flash',
    }));

    expect(prompt).not.toHaveBeenCalled();
    expect(chunks).toEqual([
      { type: 'error', content: 'model unavailable' },
      { type: 'done' },
    ]);
  });

  it('reapplies the selected model after a runtime restart without model discovery state', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const turn = runtime.prepareTurn({ text: 'Hello' });
    (runtime as any).currentSessionModelId = 'qwen-2.5-pro';

    await (runtime as any).shutdownProcess();

    const setModel = jest.fn().mockResolvedValue({});
    const prompt = jest.fn().mockResolvedValue({});
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt, setModel };

    await collect(runtime.query(turn, undefined, {
      model: 'qwen:qwen-2.5-flash',
    }));

    expect(setModel).toHaveBeenCalledWith({
      modelId: 'qwen-2.5-flash',
      sessionId: 'session-1',
    });
    expect(setModel.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]);
  });

  it('rebuilds prior conversation context when creating a replacement ACP session', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const prompt = jest.fn<Promise<object>, [{ prompt: AcpContentBlock[]; sessionId: string }]>(
      async () => ({}),
    );
    const turn = runtime.prepareTurn({ text: 'Apply that to DoorTextStyle.' });
    const history = [
      { id: 'user-previous', role: 'user' as const, content: 'Keep the language rich.', timestamp: 1 },
      { id: 'assistant-previous', role: 'assistant' as const, content: 'I will preserve the prose voice.', timestamp: 2 },
    ];

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    jest.spyOn(runtime as any, 'createSession').mockImplementation(async () => {
      (runtime as any).sessionId = 'session-replacement';
      (runtime as any).loadedSessionId = 'session-replacement';
      return 'session-replacement';
    });
    (runtime as any).connection = { prompt };

    await collect(runtime.query(turn, history));

    const promptText = prompt.mock.calls[1]?.[0].prompt[0];
    expect(promptText).toMatchObject({ type: 'text' });
    expect(promptText.type === 'text' ? promptText.text : '').toContain('User: Keep the language rich.');
    expect(promptText.type === 'text' ? promptText.text : '').toContain('Assistant: I will preserve the prose voice.');
    expect(promptText.type === 'text' ? promptText.text : '').toContain('Apply that to DoorTextStyle.');
  });

  it('does not duplicate prior conversation context in an already-loaded ACP session', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const prompt = jest.fn<Promise<object>, [{ prompt: AcpContentBlock[]; sessionId: string }]>(
      async () => ({}),
    );
    const turn = runtime.prepareTurn({ text: 'Continue the edit.' });
    const history = [
      { id: 'user-previous', role: 'user' as const, content: 'First request', timestamp: 1 },
      { id: 'assistant-previous', role: 'assistant' as const, content: 'First response', timestamp: 2 },
    ];

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-loaded';
    (runtime as any).loadedSessionId = 'session-loaded';
    (runtime as any).connection = { prompt };

    await collect(runtime.query(turn, history));

    const promptBlock = prompt.mock.calls[1]?.[0].prompt[0];
    expect(promptBlock).toEqual({ text: 'Continue the edit.', type: 'text' });
  });

  it('prepares vault search context in the per-turn prompt', () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const turn = runtime.prepareTurn({
      text: 'Hello',
      vaultSearchContext: {
        query: 'roadmap',
        snippets: [{
          source: { id: 'v1', kind: 'vault-note', path: 'notes/Roadmap.md', title: 'Roadmap' },
          text: 'Launch plan',
          score: 1,
          matchedTerms: ['roadmap'],
        }],
      },
    });

    expect(turn.prompt).toContain('<vault_search query="roadmap">');
    expect(turn.prompt).toContain('Launch plan');
    expect(turn.persistedContent).toContain('<vault_search query="roadmap">');
    expect(turn.persistedContent).toContain('Launch plan');
  });

  it('includes Grimoire note and selection context in the persisted and ACP prompts', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const prompt = jest.fn<Promise<object>, [{ prompt: AcpContentBlock[]; sessionId: string }]>(
      async () => ({})
    );

    const turn = runtime.prepareTurn({
      browserSelection: {
        selectedText: 'Browser quote',
        source: 'browser:https://example.com',
        title: 'Example',
        url: 'https://example.com',
      },
      canvasSelection: {
        canvasPath: 'boards/Artic Ocean.canvas',
        nodeIds: ['node-1', 'node-2'],
      },
      contextFiles: ['notes/instructions.md'],
      currentNotePath: 'notes/Artic Ocean.md',
      excludedFolders: ['Climate'],
      editorSelection: {
        mode: 'selection',
        notePath: 'notes/Artic Ocean.md',
        selectedText: 'Selected text',
        startLine: 4,
        lineCount: 2,
      },
      text: 'Summarize this',
    });

    expect(turn.persistedContent).toContain('<current_note>');
    expect(turn.persistedContent).toContain('notes/Artic Ocean.md');
    expect(turn.persistedContent).toContain('<context_files>');
    expect(turn.persistedContent).toContain('notes/instructions.md');
    expect(turn.persistedContent).toContain('<excluded_folders>');
    expect(turn.persistedContent).toContain('<folder>Climate</folder>');
    expect(turn.persistedContent).toContain('<editor_selection path="notes/Artic Ocean.md" lines="4-5">');
    expect(turn.persistedContent).toContain('Selected text');
    expect(turn.persistedContent).toContain('<browser_selection source="browser:https://example.com" title="Example" url="https://example.com">');
    expect(turn.persistedContent).toContain('<canvas_selection path="boards/Artic Ocean.canvas">');

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };

    await collect(runtime.query(turn));

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('<current_note>'),
          type: 'text',
        }),
      ]),
    }));
    const firstPromptCall = prompt.mock.calls[1]?.[0];
    expect(firstPromptCall).toBeDefined();
    const firstPromptBlock = firstPromptCall?.prompt[0];
    expect(firstPromptBlock).toMatchObject({ type: 'text' });
    const promptText = firstPromptBlock?.type === 'text' ? firstPromptBlock.text : '';
    expect(promptText).toContain('notes/Artic Ocean.md');
    expect(promptText).toContain('notes/instructions.md');
    expect(promptText).toContain('<folder>Climate</folder>');
    expect(promptText).toContain('<editor_selection path="notes/Artic Ocean.md" lines="4-5">');
    expect(promptText).toContain('<browser_selection source="browser:https://example.com" title="Example" url="https://example.com">');
    expect(promptText).toContain('<canvas_selection path="boards/Artic Ocean.canvas">');
  });

  it('sends orchestrator instructions in the per-turn ACP prompt when active', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const turn = runtime.prepareTurn({ text: 'Plan this work' });
    const prompt = jest.fn(async () => ({}));

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt };

    await collect(runtime.query(
      turn,
      undefined,
      { orchestratorMode: true },
    ));

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('## Grimoire Parallel Workers Mode'),
          type: 'text',
        }),
      ]),
    }));
  });

  it('cancels the active Qwen session', () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    const cancel = jest.fn();

    (runtime as any).sessionId = 'session-1';
    (runtime as any).connection = { cancel };

    runtime.cancel();

    expect(cancel).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });

  it('requires approval before ACP file writes while the shared Safe toggle is active', async () => {
    const plugin = createMockPlugin();
    plugin.settings.permissionMode = 'normal';
    const runtime = new QwenChatRuntime(plugin);
    const approvalCallback = jest.fn().mockResolvedValue('deny');

    runtime.setApprovalCallback(approvalCallback);

    await expect((runtime as any).writeTextFile({
      content: 'new page',
      path: 'Notes/New.md',
      sessionId: 'session-1',
    })).rejects.toThrow('Qwen file write was not approved');

    expect(approvalCallback).toHaveBeenCalledWith(
      'write',
      expect.objectContaining({
        path: '/tmp/grimoire-qwen-test-vault/Notes/New.md',
      }),
      'Qwen wants to write Notes/New.md.',
      expect.objectContaining({
        decisionReason: 'File write permission required',
      }),
    );
    await expect(fs.stat('/tmp/grimoire-qwen-test-vault/Notes/New.md')).rejects.toThrow();
  });

  describe('resolveSessionPath workspace containment', () => {
    function createRuntimeWithPermissionMode(permissionMode: string): any {
      const settings: Record<string, unknown> = { permissionMode };
      updateQwenProviderSettings(settings, { enabled: true });
      const runtime = new QwenChatRuntime(createMockPlugin({ settings }));
      (runtime as any).sessionCwds.set('session-1', '/tmp/grimoire-qwen-test-vault');
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
      expect((runtime).resolveSessionPath('session-1', 'Notes/today.md')).toBe(
        '/tmp/grimoire-qwen-test-vault/Notes/today.md',
      );
    });

    it('allows a path outside the workspace in active (full_access) mode', () => {
      const runtime = createRuntimeWithPermissionMode('full_access');
      expect((runtime).resolveSessionPath('session-1', '/etc/hosts')).toBe('/etc/hosts');
    });
  });

  it('reads its own permission mode, not whichever provider was toggled last', async () => {
    // `settings.permissionMode` is a shared field the settings coordinator
    // projects the active provider's value into. Reading it directly answered
    // for whoever was toggled most recently, so another provider's Auto-approve
    // switched off *this* provider's containment and skipped its write
    // approvals. Here the shared field says full access and this provider's own
    // saved mode says Safe.
    const plugin = createMockPlugin();
    plugin.settings.permissionMode = 'full_access';
    plugin.settings.savedProviderPermissionMode = { qwen: 'normal' };
    const runtime = new QwenChatRuntime(plugin);
    const approvalCallback = jest.fn().mockResolvedValue('deny');
    runtime.setApprovalCallback(approvalCallback);

    await expect((runtime as any).writeTextFile({
      content: 'new page',
      path: 'Notes/Contaminated.md',
      sessionId: 'session-1',
    })).rejects.toThrow(/was not approved/);

    expect(approvalCallback).toHaveBeenCalled();
  });

  it('keeps a valid session binding when a load fails for any other reason', async () => {
    // Erasing the binding on every failure meant a timeout or a dead transport
    // silently started a new conversation and left the old one unreachable. The
    // shared policy exists to tell a missing session from a transient one.
    const runtime = new QwenChatRuntime(createMockPlugin());
    (runtime as any).connection = {
      loadSession: jest.fn().mockRejectedValue(new Error('socket hang up')),
    };

    await expect((runtime as any).loadSession('bound-id', '/tmp/grimoire-qwen-test-vault'))
      .resolves.toBe('unavailable');
  });

  it('lets go of a session the agent says is gone', async () => {
    const runtime = new QwenChatRuntime(createMockPlugin());
    (runtime as any).connection = {
      loadSession: jest.fn().mockRejectedValue(
        new JsonRpcErrorResponse('session/load', -32603, 'Session not found'),
      ),
    };

    await expect((runtime as any).loadSession('bound-id', '/tmp/grimoire-qwen-test-vault'))
      .resolves.toBe('missing');
  });

});
