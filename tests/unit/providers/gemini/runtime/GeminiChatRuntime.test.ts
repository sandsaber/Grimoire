import '@/providers';

import * as fs from 'node:fs/promises';

import type { StreamChunk } from '@/core/types';
import type { AcpContentBlock } from '@/providers/acp';
import { JsonRpcErrorResponse } from '@/providers/acp';
import { GeminiChatRuntime } from '@/providers/gemini/runtime/GeminiChatRuntime';
import { getGeminiProviderSettings, updateGeminiProviderSettings } from '@/providers/gemini/settings';

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  const settings: Record<string, unknown> = {};
  updateGeminiProviderSettings(settings, { enabled: true });

  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/grimoire-gemini-test-vault',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/gemini'),
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

describe('GeminiChatRuntime', () => {
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm('/tmp/grimoire-gemini-test-vault', { force: true, recursive: true });
  });

  it('does not start when the provider is disabled', async () => {
    const settings: Record<string, unknown> = {};
    updateGeminiProviderSettings(settings, { enabled: false });
    const runtime = new GeminiChatRuntime(createMockPlugin({ settings }));

    await expect(runtime.ensureReady()).resolves.toBe(false);
    expect(runtime.isReady()).toBe(false);
  });

  it('launches Gemini in ACP mode', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    const startProcess = jest.spyOn(runtime as any, 'startProcess').mockImplementation(async () => {
      (runtime as any).ready = true;
      (runtime as any).connection = {};
    });

    await expect(runtime.ensureReady({ allowSessionCreation: false })).resolves.toBe(true);

    expect(startProcess).toHaveBeenCalledWith(expect.objectContaining({
      args: ['--acp'],
      command: '/usr/local/bin/gemini',
    }));
  });

  it('seeds visible model options from ACP discovery when none are configured', () => {
    const plugin = createMockPlugin();
    const runtime = new GeminiChatRuntime(plugin);

    (runtime as any).syncSessionDiscovery({
      models: {
        availableModels: [
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        ],
        currentModelId: 'gemini-2.5-flash',
      },
    });

    const settings = getGeminiProviderSettings(plugin.settings);
    expect(settings.discoveredModels.map((model) => model.rawId)).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ]);
    expect(settings.visibleModels).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ]);
  });

  it('replaces a stale visible model cache with the latest ACP catalog', () => {
    const plugin = createMockPlugin();
    updateGeminiProviderSettings(plugin.settings, {
      visibleModels: ['gemini-2.5-pro'],
    });
    const runtime = new GeminiChatRuntime(plugin);

    (runtime as any).syncSessionDiscovery({
      models: {
        availableModels: [
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
          { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
        ],
        currentModelId: 'gemini-3-pro',
      },
    });

    expect(getGeminiProviderSettings(plugin.settings).visibleModels).toEqual([
      'gemini-2.5-pro',
      'gemini-3-pro',
    ]);
  });

  it('streams ACP assistant chunks and done', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    const turn = runtime.prepareTurn({ text: 'Hello' });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = {
      prompt: jest.fn(async () => {
        await (runtime as any).handleSessionNotification({
          sessionId: 'session-1',
          update: {
            content: { text: 'Hi from Gemini', type: 'text' },
            messageId: 'assistant-1',
            sessionUpdate: 'agent_message_chunk',
          },
        });
        return {};
      }),
    };

    const chunks = await collect(runtime.query(turn));

    expect(chunks).toContainEqual({ itemId: 'assistant-1', type: 'assistant_message_start' });
    expect(chunks).toContainEqual({ content: 'Hi from Gemini', type: 'text' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('applies the explicit query model before prompting instead of the saved global model', async () => {
    const plugin = createMockPlugin();
    plugin.settings.savedProviderModel = { gemini: 'gemini:gemini-2.5-pro' };
    const runtime = new GeminiChatRuntime(plugin);
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
      model: 'gemini:gemini-2.5-flash',
    }));

    expect(setModel).toHaveBeenCalledWith({
      modelId: 'gemini-2.5-flash',
      sessionId: 'session-1',
    });
    expect(setModel.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]);
    expect((runtime as any).getActiveModel()).toBe('gemini:gemini-2.5-flash');
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({ model: 'gemini:gemini-2.5-flash' }),
    }));
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('does not prompt when applying the explicit query model fails', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    const setModel = jest.fn().mockRejectedValue(new Error('model unavailable'));
    const prompt = jest.fn();
    const turn = runtime.prepareTurn({ text: 'Hello' });

    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt, setModel };

    const chunks = await collect(runtime.query(turn, undefined, {
      model: 'gemini:gemini-2.5-flash',
    }));

    expect(prompt).not.toHaveBeenCalled();
    expect(chunks).toEqual([
      { type: 'error', content: 'model unavailable' },
      { type: 'done' },
    ]);
  });

  it('reapplies the selected model after a runtime restart without model discovery state', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    const turn = runtime.prepareTurn({ text: 'Hello' });
    (runtime as any).currentSessionModelId = 'gemini-2.5-pro';

    await (runtime as any).shutdownProcess();

    const setModel = jest.fn().mockResolvedValue({});
    const prompt = jest.fn().mockResolvedValue({});
    jest.spyOn(runtime, 'ensureReady').mockResolvedValue(true);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).loadedSessionId = 'session-1';
    (runtime as any).connection = { prompt, setModel };

    await collect(runtime.query(turn, undefined, {
      model: 'gemini:gemini-2.5-flash',
    }));

    expect(setModel).toHaveBeenCalledWith({
      modelId: 'gemini-2.5-flash',
      sessionId: 'session-1',
    });
    expect(setModel.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]);
  });

  it('rebuilds prior conversation context when creating a replacement ACP session', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
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

    const promptText = prompt.mock.calls[0]?.[0].prompt[0];
    expect(promptText).toMatchObject({ type: 'text' });
    expect(promptText.type === 'text' ? promptText.text : '').toContain('User: Keep the language rich.');
    expect(promptText.type === 'text' ? promptText.text : '').toContain('Assistant: I will preserve the prose voice.');
    expect(promptText.type === 'text' ? promptText.text : '').toContain('Apply that to DoorTextStyle.');
  });

  it('does not duplicate prior conversation context in an already-loaded ACP session', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
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

    const promptBlock = prompt.mock.calls[0]?.[0].prompt[0];
    expect(promptBlock).toEqual({ text: 'Continue the edit.', type: 'text' });
  });

  it('prepares vault search context in the per-turn prompt', () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
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
    const runtime = new GeminiChatRuntime(createMockPlugin());
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
    const firstPromptCall = prompt.mock.calls[0]?.[0];
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
    const runtime = new GeminiChatRuntime(createMockPlugin());
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

  it('cancels the active Gemini session', () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    const cancel = jest.fn();

    (runtime as any).sessionId = 'session-1';
    (runtime as any).connection = { cancel };

    runtime.cancel();

    expect(cancel).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });

  it('requires approval before ACP file writes while the shared Safe toggle is active', async () => {
    const plugin = createMockPlugin();
    plugin.settings.permissionMode = 'normal';
    const runtime = new GeminiChatRuntime(plugin);
    const approvalCallback = jest.fn().mockResolvedValue('deny');

    runtime.setApprovalCallback(approvalCallback);

    await expect((runtime as any).writeTextFile({
      content: 'new page',
      path: 'Notes/New.md',
      sessionId: 'session-1',
    })).rejects.toThrow('Gemini file write was not approved');

    expect(approvalCallback).toHaveBeenCalledWith(
      'write',
      expect.objectContaining({
        path: '/tmp/grimoire-gemini-test-vault/Notes/New.md',
      }),
      'Gemini wants to write Notes/New.md.',
      expect.objectContaining({
        decisionReason: 'File write permission required',
      }),
    );
    await expect(fs.stat('/tmp/grimoire-gemini-test-vault/Notes/New.md')).rejects.toThrow();
  });

  it('maps session permission requests through the approval callback', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    const approvalCallback = jest.fn().mockResolvedValue('allow');
    runtime.setApprovalCallback(approvalCallback);

    await expect((runtime as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow', optionId: 'allow-1' },
        { kind: 'reject_once', name: 'Reject', optionId: 'reject-1' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'edit',
        rawInput: { path: 'Notes/draft.md' },
        title: 'Edit draft',
        toolCallId: 'tc-1',
      },
    })).resolves.toEqual({
      outcome: { optionId: 'allow-1', outcome: 'selected' },
    });

    expect(approvalCallback).toHaveBeenCalledWith(
      'Edit draft',
      { path: 'Notes/draft.md' },
      'Edit draft requests access to Notes/draft.md.',
      expect.objectContaining({
        target: 'Notes/draft.md',
        decisionOptions: expect.arrayContaining([
          expect.objectContaining({ value: 'allow-1', presentation: 'allow' }),
        ]),
      }),
    );
  });

  it('cancels session permission requests when no approval callback is registered', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    await expect((runtime as any).handlePermissionRequest({
      options: [{ kind: 'allow_once', name: 'Allow', optionId: 'allow-1' }],
      sessionId: 'session-1',
      toolCall: {
        kind: 'edit',
        title: 'Edit draft',
        toolCallId: 'tc-1',
      },
    })).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  describe('resolveSessionPath workspace containment', () => {
    function createRuntimeWithPermissionMode(permissionMode: string): any {
      const settings: Record<string, unknown> = { permissionMode };
      updateGeminiProviderSettings(settings, { enabled: true });
      const runtime = new GeminiChatRuntime(createMockPlugin({ settings }));
      (runtime as any).sessionCwds.set('session-1', '/tmp/grimoire-gemini-test-vault');
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
        '/tmp/grimoire-gemini-test-vault/Notes/today.md',
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
    plugin.settings.savedProviderPermissionMode = { gemini: 'normal' };
    const runtime = new GeminiChatRuntime(plugin);
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
    const runtime = new GeminiChatRuntime(createMockPlugin());
    (runtime as any).connection = {
      loadSession: jest.fn().mockRejectedValue(new Error('socket hang up')),
    };

    await expect((runtime as any).loadSession('bound-id', '/tmp/grimoire-gemini-test-vault'))
      .resolves.toBe('unavailable');
  });

  it('lets go of a session the agent says is gone', async () => {
    const runtime = new GeminiChatRuntime(createMockPlugin());
    (runtime as any).connection = {
      loadSession: jest.fn().mockRejectedValue(
        new JsonRpcErrorResponse('session/load', -32603, 'Session not found'),
      ),
    };

    await expect((runtime as any).loadSession('bound-id', '/tmp/grimoire-gemini-test-vault'))
      .resolves.toBe('missing');
  });


  describe('session mode', () => {
    /**
     * The two vocabularies a Gemini session lives between.
     *
     * The toolbar writes `normal`/`full_access`/`plan` into `selectedMode`; the
     * recorded session (`gemini 0.55.1`) offers `default`, `autoEdit`, `yolo`
     * and `plan`. Neither word survives being used as the other, and both
     * directions had been forwarding rather than translating.
     */
    function createRuntimeWithSession(permissionMode: string): {
      runtime: any;
      setMode: jest.Mock;
      plugin: any;
    } {
      const plugin = createMockPlugin();
      plugin.settings.permissionMode = permissionMode;
      updateGeminiProviderSettings(plugin.settings, { selectedMode: permissionMode });
      const runtime = new GeminiChatRuntime(plugin) as any;
      const setMode = jest.fn().mockResolvedValue({});
      runtime.connection = { setMode };
      return { runtime, setMode, plugin };
    }

    it('sends the agent a mode it actually has', async () => {
      const { runtime, setMode } = createRuntimeWithSession('full_access');

      await runtime.applySelectedMode('session-1');

      // `full_access` is Grimoire's word. Sending it is a mode the agent does
      // not have, and `applySelectedMode` is awaited inside the turn's own try
      // — so the rejection ends the turn before the prompt is sent.
      expect(setMode).toHaveBeenCalledWith({ modeId: 'yolo', sessionId: 'session-1' });
    });

    it.each([
      ['normal', 'default'],
      ['plan', 'plan'],
      ['full_access', 'yolo'],
    ])('maps the %s toggle to %s', async (permissionMode, modeId) => {
      const { runtime, setMode } = createRuntimeWithSession(permissionMode);

      await runtime.applySelectedMode('session-1');

      expect(setMode).toHaveBeenCalledWith({ modeId, sessionId: 'session-1' });
    });

    it('lets a session report where it starts without moving what the user picked', async () => {
      const { runtime, setMode, plugin } = createRuntimeWithSession('plan');

      // The other door into `selectedMode`, and the one that opens first:
      // `session/new` answers with the mode the *agent* starts in, on the first
      // session a vault ever opens and on every one after. That is not a switch
      // anybody asked for, and `selectedMode` is the field the toolbar reads
      // back — and, through `resolvePermissionMode`, the field the next turn's
      // mode is resolved from. Adopting it talked a vault on Plan into Default.
      runtime.syncSessionDiscovery({
        modes: {
          availableModes: [
            { id: 'default', name: 'Default' },
            { id: 'yolo', name: 'YOLO' },
          ],
          currentModeId: 'default',
        },
      });

      expect(getGeminiProviderSettings(plugin.settings).selectedMode).toBe('plan');
      // Recorded all the same, in the agent's own vocabulary: it is what
      // `applySelectedMode` skips a redundant round trip on.
      expect(runtime.sessionConfig.sessionModeId).toBe('default');

      await runtime.applySelectedMode('session-1');

      expect(setMode).toHaveBeenCalledWith({ modeId: 'plan', sessionId: 'session-1' });
    });

    it('shows the toolbar a value it can render when the agent reports its own', async () => {
      const plugin = createMockPlugin();
      const runtime = new GeminiChatRuntime(plugin) as any;
      const synced: string[] = [];
      runtime.permissionModeSyncCallback = (mode: string) => synced.push(mode);
      runtime.sessionId = 'session-1';

      await runtime.handleSessionNotification({
        sessionId: 'session-1',
        update: { sessionUpdate: 'current_mode_update', currentModeId: 'autoEdit' },
      });

      // `autoEdit` auto-approves edits and still asks before a command, so it
      // is Safe rather than Auto-approve — and storing the raw id left the
      // toolbar showing whichever of its three values `coercePermissionMode`
      // fell back to.
      expect(synced).toEqual(['normal']);
      expect(getGeminiProviderSettings(plugin.settings).selectedMode).toBe('normal');
      // The agent's own word is what the *session* is compared against, so it
      // is kept in the agent's vocabulary here.
      expect(runtime.sessionConfig.sessionModeId).toBe('autoEdit');
    });

    it('maps the agent yolo mode back to Auto-approve', async () => {
      const plugin = createMockPlugin();
      const runtime = new GeminiChatRuntime(plugin) as any;
      const synced: string[] = [];
      runtime.permissionModeSyncCallback = (mode: string) => synced.push(mode);
      runtime.sessionId = 'session-1';

      await runtime.handleSessionNotification({
        sessionId: 'session-1',
        update: { sessionUpdate: 'current_mode_update', currentModeId: 'yolo' },
      });

      expect(synced).toEqual(['full_access']);
    });

    it('forgets the mode with the session it belonged to', async () => {
      const { runtime, setMode } = createRuntimeWithSession('plan');
      await runtime.applySelectedMode('session-1');
      expect(setMode).toHaveBeenCalledTimes(1);

      // A process restart is a new session, and the mode the old one was in
      // says nothing about it. Kept, the next turn short-circuits and the new
      // session runs in the agent's default while the toolbar says Plan.
      runtime.clearActiveSession();
      await runtime.applySelectedMode('session-2');

      expect(setMode).toHaveBeenCalledTimes(2);
      expect(setMode).toHaveBeenLastCalledWith({ modeId: 'plan', sessionId: 'session-2' });
    });

    it('forgets the mode when the tab moves to another conversation', async () => {
      const { runtime, setMode } = createRuntimeWithSession('plan');
      runtime.sessionId = 'session-1';
      await runtime.applySelectedMode('session-1');

      runtime.syncConversationState({ providerState: {}, sessionId: 'session-2' });
      await runtime.applySelectedMode('session-2');

      expect(setMode).toHaveBeenCalledTimes(2);
    });
  });

});
