import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import {
  TOOL_AGENT_OUTPUT,
  TOOL_SPAWN_AGENT,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WAIT_AGENT,
} from '@/core/tools/toolNames';
import type { ChatMessage } from '@/core/types';
import { StreamController, type StreamControllerDeps } from '@/features/chat/controllers/StreamController';
import { ChatState } from '@/features/chat/state/ChatState';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';
import {
  GROK_SUBAGENT_SPAWN_TOOL,
  GROK_SUBAGENT_WAIT_TOOL,
} from '@/providers/grok/normalization/grokSubagentNormalization';

jest.mock('@/core/tools/todo', () => ({
  parseTodoInput: jest.fn(),
}));

jest.mock('@/core/tools/toolInput', () => ({
  extractResolvedAnswers: jest.fn().mockReturnValue(undefined),
  extractResolvedAnswersFromResultText: jest.fn().mockReturnValue(undefined),
}));

jest.mock('@/features/chat/rendering/SubagentRenderer', () => ({
  createSubagentBlock: jest.fn().mockReturnValue({
    info: { id: 'task-1', description: 'test', status: 'running', toolCalls: [] },
    labelEl: { setText: jest.fn() },
  }),
  finalizeSubagentBlock: jest.fn(),
}));

jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  appendThinkingContent: jest.fn(),
  createThinkingBlock: jest.fn().mockImplementation(() => ({
    container: {},
    contentEl: {},
    content: '',
    startTime: Date.now(),
  })),
  finalizeThinkingBlock: jest.fn().mockReturnValue(0),
}));

jest.mock('@/features/chat/rendering/ToolCallRenderer', () => ({
  canGroupToolCalls: jest.fn().mockImplementation((toolCalls: Array<{ name: string }>) =>
    toolCalls.length > 1 && toolCalls.every(toolCall => toolCall.name === 'Grep')
  ),
  getToolDisplayName: jest.fn().mockReturnValue('Read'),
  getToolName: jest.fn().mockReturnValue('Read'),
  getToolSummary: jest.fn().mockReturnValue('file.md'),
  isBlockedToolResult: jest.fn().mockReturnValue(false),
  renderToolCall: jest.fn(),
  renderToolCallGroup: jest.fn(),
  updateToolCallResult: jest.fn(),
}));

jest.mock('@/features/chat/rendering/WriteEditRenderer', () => ({
  createWriteEditBlock: jest.fn().mockReturnValue({}),
  finalizeWriteEditBlock: jest.fn(),
  updateWriteEditWithDiff: jest.fn(),
}));

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

const originalWindow = (globalThis as { window?: Window }).window;

function installTestWindow(): void {
  const testWindow = {
    requestAnimationFrame: (callback: FrameRequestCallback): number =>
      globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number,
    cancelAnimationFrame: (handle: number): void => {
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setTimeout: (callback: () => void, timeout: number): number =>
      globalThis.setTimeout(callback, timeout) as unknown as number,
    clearTimeout: (handle: number): void => {
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setInterval: (callback: () => void, timeout: number): number =>
      globalThis.setInterval(callback, timeout) as unknown as number,
    clearInterval: (handle: number): void => {
      globalThis.clearInterval(handle as unknown as ReturnType<typeof setInterval>);
    },
  } as Window;

  Object.defineProperty(globalThis, 'window', {
    value: testWindow,
    configurable: true,
  });
}

function restoreTestWindow(): void {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
    return;
  }

  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
  });
}

function createMockDeps(): StreamControllerDeps {
  const state = new ChatState();
  const messagesEl = createMockEl();
  const agentService = {
    getSessionId: jest.fn().mockReturnValue('session-1'),
    getCapabilities: jest.fn().mockReturnValue({
      providerId: 'claude',
      supportsPlanMode: true,
      planPathPrefix: '/.claude/plans/',
    }),
  };
  const fileContextManager = {
    markFileBeingEdited: jest.fn(),
    trackEditedFile: jest.fn(),
    getAttachedFiles: jest.fn().mockReturnValue(new Set()),
    hasFilesChanged: jest.fn().mockReturnValue(false),
  };

  return {
    plugin: {
      settings: {
        permissionMode: 'full_access',
      },
      app: {
        vault: {
          adapter: {
            basePath: '/test/vault',
          },
        },
      },
    } as any,
    state,
    renderer: {
      renderContent: jest.fn(),
      addTextCopyButton: jest.fn(),
    } as any,
    subagentManager: {
      isAsyncTask: jest.fn().mockReturnValue(false),
      isPendingAsyncTask: jest.fn().mockReturnValue(false),
      isLinkedAgentOutputTool: jest.fn().mockReturnValue(false),
      handleAgentOutputToolResult: jest.fn().mockReturnValue(undefined),
      handleAgentOutputToolUse: jest.fn(),
      handleAsyncSubagentResult: jest.fn().mockReturnValue(undefined),
      handleTaskToolUse: jest.fn().mockReturnValue({ action: 'buffered' }),
      handleTaskToolResult: jest.fn(),
      refreshAsyncSubagent: jest.fn(),
      hasPendingTask: jest.fn().mockReturnValue(false),
      renderPendingTask: jest.fn().mockReturnValue(null),
      renderPendingTaskFromTaskResult: jest.fn().mockReturnValue(null),
      getSyncSubagent: jest.fn().mockReturnValue(undefined),
      addSyncToolCall: jest.fn(),
      updateSyncToolResult: jest.fn(),
      finalizeSyncSubagent: jest.fn().mockReturnValue(null),
      resetStreamingState: jest.fn(),
      resetSpawnedCount: jest.fn(),
      subagentsSpawnedThisStream: 0,
    } as any,
    getMessagesEl: () => messagesEl,
    getFileContextManager: () => fileContextManager as any,
    updateQueueIndicator: jest.fn(),
    getAgentService: () => agentService as any,
    onSubagentActivityDetected: jest.fn(),
  };
}

function createTestMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
  };
}

function createMockUsage(overrides: Record<string, any> = {}) {
  return {
    model: 'model-a',
    inputTokens: 10,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindow: 100,
    contextTokens: 10,
    percentage: 10,
    ...overrides,
  };
}

describe('StreamController - Text Content', () => {
  let controller: StreamController;
  let deps: StreamControllerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    installTestWindow();
    deps = createMockDeps();
    controller = new StreamController(deps);
    deps.state.currentContentEl = createMockEl();
  });

  afterEach(() => {
    // Clean up any timers set by ChatState
    deps.state.resetStreamingState();
    restoreTestWindow();
    jest.useRealTimers();
  });

  describe('Turn feedback metrics', () => {
    /**
     * **The controller that draws the turn is what sees the output.** These
     * metrics were kept by `InputController` and fed from its generator loop;
     * with that loop deleted, every field but the duration was structurally
     * empty and each successful turn logged a provider that had produced
     * nothing — a diagnostic that reads as a defect in the thing it measures.
     */
    it('counts what a turn actually drew, whichever channel it arrived on', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      controller.startTurnSilenceIndicator('claude');

      // Prose reaches the column through `appendText` on the projection path,
      // and tool calls through `handleStreamChunk`. Both are the turn's output.
      await controller.appendText('an answer');
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'call-1', name: 'Bash', input: {} } as never,
        msg,
      );

      const snapshot = controller.consumeTurnFeedback();
      expect(snapshot).toMatchObject({ textUpdates: 1, toolUses: 1 });
      expect(snapshot?.firstActivityMs).not.toBeNull();
    });

    it('answers nothing when no turn has run since the last read', () => {
      // Truer than a row of zeros, which is what a turn that produced nothing
      // would report and is the thing this replaced.
      expect(controller.consumeTurnFeedback()).toBeNull();
    });

    it('gives each turn its own count', async () => {
      deps.state.currentTextEl = createMockEl();
      controller.startTurnSilenceIndicator('claude');
      await controller.appendText('first');
      controller.consumeTurnFeedback();

      controller.startTurnSilenceIndicator('claude');
      await controller.appendText('second');

      expect(controller.consumeTurnFeedback()).toMatchObject({ textUpdates: 1 });
    });
  });

  describe('Text streaming', () => {
    it('should append text content to message', async () => {
      const msg = createTestMessage();

      deps.state.currentTextEl = createMockEl();

      await controller.handleStreamChunk({ type: 'text', content: 'Hello ' }, msg);
      await controller.handleStreamChunk({ type: 'text', content: 'World' }, msg);

      expect(msg.content).toBe('Hello World');
    });

    it('should accumulate text across multiple chunks', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();

      const chunks = ['This ', 'is ', 'a ', 'test.'];
      for (const chunk of chunks) {
        await controller.handleStreamChunk({ type: 'text', content: chunk }, msg);
      }

      expect(msg.content).toBe('This is a test.');
    });

    it('should coalesce text renders until the next animation frame', async () => {
      deps.state.currentTextEl = createMockEl();

      await controller.appendText('Hello ');
      await controller.appendText('World');

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();

      jest.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        deps.state.currentTextEl,
        'Hello World'
      );
    });

    it('should defer math rendering during live text renders', async () => {
      deps.state.currentTextEl = createMockEl();

      await controller.appendText('Euler: $e^{i\\pi} + 1 = 0$');

      jest.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        deps.state.currentTextEl,
        'Euler: $e^{i\\pi} + 1 = 0$',
        { deferMath: true }
      );
    });

    it('should honor disabled deferred math rendering setting during live text renders', async () => {
      (deps.plugin.settings as any).deferMathRenderingDuringStreaming = false;
      deps.state.currentTextEl = createMockEl();

      await controller.appendText('Euler: $e^{i\\pi} + 1 = 0$');

      jest.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        deps.state.currentTextEl,
        'Euler: $e^{i\\pi} + 1 = 0$'
      );
    });

    it('should flush a pending text render before finalizing text', async () => {
      const msg = createTestMessage();

      await controller.appendText('Hello');
      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        expect.anything(),
        'Hello'
      );
      expect(deps.renderer.addTextCopyButton).toHaveBeenCalledWith(
        expect.anything(),
        'Hello'
      );
      expect(msg.contentBlocks).toContainEqual({
        type: 'text',
        content: 'Hello',
      });
    });

    it('should render original math once when finalizing a deferred text block', async () => {
      const msg = createTestMessage();

      await controller.appendText('Final $x^2$');
      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.renderContent).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        'Final $x^2$',
        { deferMath: true }
      );
      expect(deps.renderer.renderContent).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        'Final $x^2$'
      );
      expect(deps.renderer.addTextCopyButton).toHaveBeenCalledWith(
        expect.anything(),
        'Final $x^2$'
      );
    });
  });

  describe('Text block finalization', () => {
    it('should add copy button when finalizing text block with content', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      deps.state.currentTextContent = 'Hello World';

      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.addTextCopyButton).toHaveBeenCalledWith(
        expect.anything(),
        'Hello World'
      );
      expect(msg.contentBlocks).toContainEqual({
        type: 'text',
        content: 'Hello World',
      });
    });

    it('should not add copy button when no text element exists', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = null;
      deps.state.currentTextContent = 'Hello World';

      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.addTextCopyButton).not.toHaveBeenCalled();
      // Content block should still be added
      expect(msg.contentBlocks).toContainEqual({
        type: 'text',
        content: 'Hello World',
      });
    });

    it('should not add copy button when no text content exists', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      deps.state.currentTextContent = '';

      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.addTextCopyButton).not.toHaveBeenCalled();
      expect(msg.contentBlocks).toEqual([]);
    });

    it('should reset text state after finalization', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      deps.state.currentTextContent = 'Test content';

      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.state.currentTextEl).toBeNull();
      expect(deps.state.currentTextContent).toBe('');
    });
  });

  describe('Error and notice handling', () => {
    it('should append error message on error chunk', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'error', content: 'Something went wrong' },
        msg
      );

      expect(deps.state.currentTextContent).toContain('Error');
    });

    it('should append warning notice on notice chunk', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'notice', content: 'Tool was blocked', level: 'warning' },
        msg
      );

      expect(deps.state.currentTextContent).toContain('Blocked');
    });
  });

  describe('context_compacted handling', () => {
    it('should record a context_compacted block on the message', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk({ type: 'context_compacted' }, msg);

      expect(msg.contentBlocks).toContainEqual({ type: 'context_compacted' });
    });
  });

  describe('Done chunk handling', () => {
    it('ends a turn without error', async () => {
      // Asked as the render target asks it. This used to send a `done` chunk,
      // which was the legacy stream's way of saying a turn had ended; the
      // projection path calls the method, and the chunk type is deleted.
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();

      await expect(controller.finishTurn(msg)).resolves.not.toThrow();
    });

    it('detects an orchestrator plan on done when orchestrator mode is active', async () => {
      const msg = createTestMessage();
      msg.content = `\`\`\`json
{
  "type": "parallel_worker_plan",
  "tasks": [
    {
      "id": "research",
      "description": "Research the current code",
      "prompt": "Inspect the relevant files"
    },
    {
      "id": "tests",
      "description": "Write regression tests",
      "prompt": "Add focused unit tests"
    }
  ]
}
\`\`\``;
      const contentEl = createMockEl();
      const rawPayloadEl = contentEl.createDiv({ cls: 'grimoire-text-block', text: msg.content });
      rawPayloadEl.remove = jest.fn();
      deps.state.currentContentEl = contentEl;
      deps.isOrchestratorMode = jest.fn().mockReturnValue(true);
      deps.onOrchestratorPlanDetected = jest.fn();

      await controller.finishTurn(msg);

      expect(deps.onOrchestratorPlanDetected).toHaveBeenCalledWith(
        contentEl,
        expect.objectContaining({
          type: 'parallel_worker_plan',
          tasks: expect.arrayContaining([
            expect.objectContaining({ id: 'research' }),
            expect.objectContaining({ id: 'tests' }),
          ]),
        }),
      );
      expect(msg.content).toBe('');
      expect(msg.contentBlocks).toContainEqual(expect.objectContaining({
        type: 'parallel_worker_plan',
        tasks: expect.arrayContaining([
          expect.objectContaining({ id: 'research' }),
          expect.objectContaining({ id: 'tests' }),
        ]),
      }));
      expect(rawPayloadEl.remove).toHaveBeenCalled();
    });

    it('does not detect orchestrator plans when orchestrator mode is inactive', async () => {
      const msg = createTestMessage();
      msg.content = `\`\`\`json
{"type":"parallel_worker_plan","tasks":[{"id":"a","description":"Task A","prompt":"Do A"},{"id":"b","description":"Task B","prompt":"Do B"}]}
\`\`\``;
      deps.state.currentContentEl = createMockEl();
      deps.isOrchestratorMode = jest.fn().mockReturnValue(false);
      deps.onOrchestratorPlanDetected = jest.fn();

      await controller.finishTurn(msg);

      expect(deps.onOrchestratorPlanDetected).not.toHaveBeenCalled();
    });

  });

  describe('Usage handling', () => {
    it('should update usage for current session', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage();

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toEqual(usage);
    });

    it('stamps the active provider model onto usage when the provider omits it', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage({ model: undefined });
      const providerSettingsSpy = jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot');
      providerSettingsSpy.mockReturnValue({ model: DEFAULT_CODEX_PRIMARY_MODEL });
      (deps.getAgentService!() as any).providerId = 'codex';

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toEqual({ ...usage, model: DEFAULT_CODEX_PRIMARY_MODEL });

      providerSettingsSpy.mockRestore();
    });

    it('uses the active tab model instead of a conflicting provider default', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage({ model: undefined });
      deps.getActiveProviderSettings = () => ({ model: 'sonnet' });
      const providerSettingsSpy = jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot');
      providerSettingsSpy.mockReturnValue({ model: 'opus' });

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toEqual({ ...usage, model: 'sonnet' });
      expect(providerSettingsSpy).not.toHaveBeenCalled();
      providerSettingsSpy.mockRestore();
    });

    it('uses the assistant response model before the tab model for a workspace override', async () => {
      const msg = createTestMessage();
      msg.responseMetadata = { model: 'opus' };
      const usage = createMockUsage({ model: undefined });
      deps.getActiveProviderSettings = () => ({ model: 'sonnet' });

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toEqual({ ...usage, model: 'opus' });
    });

    it('should ignore usage from other sessions', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage();

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-2' }, msg);

      expect(deps.state.usage).toBeNull();
    });
  });

  describe('Tool handling', () => {
    it('should record tool_use and add to content blocks', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      deps.recordRuntimeToolCall = jest.fn();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'notes/test.md' } },
        msg
      );

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0].id).toBe('tool-1');
      expect(msg.toolCalls![0].status).toBe('running');
      expect(msg.contentBlocks).toHaveLength(1);
      expect(msg.contentBlocks![0]).toEqual({ type: 'tool_use', toolId: 'tool-1' });
      expect(deps.recordRuntimeToolCall).toHaveBeenCalledWith(msg.toolCalls![0]);
    });

    it('should update tool_result status', async () => {
      const msg = createTestMessage();
      deps.recordRuntimeToolCall = jest.fn();
      msg.toolCalls = [
        {
          id: 'tool-1',
          name: 'Read',
          input: { file_path: 'notes/test.md' },
          status: 'running',
        } as any,
      ];
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'tool-1', content: 'ok' },
        msg
      );

      expect(msg.toolCalls[0].status).toBe('completed');
      expect(msg.toolCalls[0].result).toBe('ok');
    });

    it('should add subagent entry to contentBlocks for Task tool', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      // Configure mock to return created_sync when run_in_background is known
      (deps.subagentManager.handleTaskToolUse as jest.Mock).mockReturnValueOnce({
        action: 'created_sync',
        subagentState: {
          info: { id: 'task-1', description: 'test', status: 'running', toolCalls: [] },
        },
      });

      await controller.handleStreamChunk(
        {
          type: 'tool_use',
          id: 'task-1',
          name: TOOL_TASK,
          input: { prompt: 'Do something', subagent_type: 'general-purpose', run_in_background: false },
        },
        msg
      );

      expect(msg.contentBlocks).toHaveLength(1);
      expect(msg.contentBlocks![0]).toEqual({ type: 'subagent', subagentId: 'task-1' });
      expect(msg.toolCalls).toContainEqual(
        expect.objectContaining({
          id: 'task-1',
          name: TOOL_TASK,
          subagent: expect.objectContaining({ id: 'task-1' }),
        })
      );
      expect(deps.onSubagentActivityDetected).toHaveBeenCalledTimes(1);
    });

    it('should render TodoWrite inline and update panel', async () => {
      const { parseTodoInput } = jest.requireMock('@/core/tools/todo');
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const mockTodos = [{ content: 'Task 1', status: 'pending', activeForm: 'Working on task 1' }];
      parseTodoInput.mockReturnValue(mockTodos);

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        {
          type: 'tool_use',
          id: 'todo-1',
          name: TOOL_TODO_WRITE,
          input: { todos: mockTodos },
        },
        msg
      );

      // Tool is buffered, should be in pendingTools
      expect(msg.contentBlocks).toHaveLength(1);
      expect(msg.contentBlocks![0]).toEqual({ type: 'tool_use', toolId: 'todo-1' });
      expect(deps.state.pendingTools.size).toBe(1);

      // Should update currentTodos for panel immediately (side effect)
      expect(deps.state.currentTodos).toEqual(mockTodos);

      // Flush pending tools by sending a different chunk type (text or done)
      await controller.finishTurn(msg);

      // Now renderToolCall should have been called
      expect(renderToolCall).toHaveBeenCalled();
      expect(deps.state.pendingTools.size).toBe(0);
    });

    it('should flush pending tools before rendering text content', async () => {
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);
      expect(renderToolCall).not.toHaveBeenCalled();

      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'read-1', name: 'Read' }),
        expect.any(Map)
      );
    });

    it('groups consecutive pending vault search tools before rendering text content', async () => {
      const {
        renderToolCall,
        renderToolCallGroup,
      } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'fish' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'grep-2', name: 'Grep', input: { pattern: 'fishing' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(2);

      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Found a few notes.' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCallGroup).toHaveBeenCalledWith(
        expect.anything(),
        [
          expect.objectContaining({ id: 'grep-1', name: 'Grep' }),
          expect.objectContaining({ id: 'grep-2', name: 'Grep' }),
        ],
        expect.any(Map)
      );
      expect(renderToolCall).not.toHaveBeenCalled();
    });

    it('should flush pending tools before rendering thinking content', async () => {
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'test' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);
      expect(renderToolCall).not.toHaveBeenCalled();

      await controller.handleStreamChunk({ type: 'thinking', content: 'Let me think...' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
    });

    it('should render pending tool when tool_result arrives before flush', async () => {
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);
      expect(renderToolCall).not.toHaveBeenCalled();

      // Result arrives while tool still pending - should render tool first
      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'read-1', content: 'file contents here' },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
      expect(msg.toolCalls![0].status).toBe('completed');
      expect(msg.toolCalls![0].result).toBe('file contents here');
    });

    it('should render a pending tool on tool_output and append incremental output', async () => {
      const { renderToolCall, updateToolCallResult } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'npm test' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(1);

      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'bash-1', content: 'line 1\n' },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
      expect(updateToolCallResult).not.toHaveBeenCalled();

      jest.advanceTimersByTime(16);
      await Promise.resolve();

      expect(updateToolCallResult).toHaveBeenCalledWith(
        'bash-1',
        expect.objectContaining({
          id: 'bash-1',
          status: 'running',
          result: 'line 1\n',
        }),
        expect.any(Map)
      );

      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'bash-1', content: 'line 2\n' },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('running');
      expect(msg.toolCalls![0].result).toBe('line 1\nline 2\n');
      expect(updateToolCallResult).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(16);
      await Promise.resolve();

      expect(updateToolCallResult).toHaveBeenLastCalledWith(
        'bash-1',
        expect.objectContaining({
          id: 'bash-1',
          status: 'running',
          result: 'line 1\nline 2\n',
        }),
        expect.any(Map)
      );
    });

    it('should coalesce tool_output renders until the next animation frame', async () => {
      const { updateToolCallResult } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'npm test' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'bash-1', content: 'line 1\n' },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'bash-1', content: 'line 2\n' },
        msg
      );

      expect(updateToolCallResult).not.toHaveBeenCalled();

      jest.advanceTimersByTime(16);
      await Promise.resolve();

      expect(updateToolCallResult).toHaveBeenCalledTimes(1);
      expect(updateToolCallResult).toHaveBeenCalledWith(
        'bash-1',
        expect.objectContaining({
          result: 'line 1\nline 2\n',
          status: 'running',
        }),
        expect.any(Map)
      );
    });

    it('should buffer Write tool and use createWriteEditBlock on flush', async () => {
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const { createWriteEditBlock } = jest.requireMock('@/features/chat/rendering/WriteEditRenderer');
      createWriteEditBlock.mockReturnValue({ wrapperEl: createMockEl() });

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: 'test.md', content: 'hello' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(1);
      expect(createWriteEditBlock).not.toHaveBeenCalled();
      expect(renderToolCall).not.toHaveBeenCalled();

      await controller.finishTurn(msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(createWriteEditBlock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'write-1', name: 'Write' })
      );
      // renderToolCall should NOT be called for Write/Edit tools
      expect(renderToolCall).not.toHaveBeenCalled();
    });

    it('should buffer Edit tool and use createWriteEditBlock on flush', async () => {
      const { createWriteEditBlock } = jest.requireMock('@/features/chat/rendering/WriteEditRenderer');
      createWriteEditBlock.mockReturnValue({ wrapperEl: createMockEl() });

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'test.md', old_string: 'a', new_string: 'b' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(1);
      expect(createWriteEditBlock).not.toHaveBeenCalled();

      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Done editing' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(createWriteEditBlock).toHaveBeenCalled();
    });

    it('should flush pending tools before rendering blocked message', async () => {
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'ls' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);

      await controller.handleStreamChunk({ type: 'notice', content: 'Command blocked', level: 'warning' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
    });

    it('should flush pending tools before rendering error message', async () => {
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'missing.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);

      await controller.handleStreamChunk({ type: 'error', content: 'Something went wrong' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
    });

    it('normalizes provider authentication errors before rendering them', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      deps.getAgentService = jest.fn().mockReturnValue({
        providerId: 'opencode',
        getCapabilities: jest.fn().mockReturnValue({ providerId: 'opencode' }),
      });
      controller = new StreamController(deps);
      const appendText = jest.spyOn(controller, 'appendText').mockResolvedValue(undefined);

      await controller.handleStreamChunk({ type: 'error', content: '401 Invalid API Key' }, msg);

      expect(appendText).toHaveBeenCalledWith(
        '\n\n❌ **Error:** OpenCode authentication failed: invalid or expired credentials. Log in to OpenCode again, then retry.',
      );
    });

    it('should flush pending tools before Task tool renders', async () => {
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.handleTaskToolUse as jest.Mock).mockReturnValueOnce({
        action: 'created_sync',
        subagentState: {
          info: { id: 'task-1', description: 'test', status: 'running', toolCalls: [] },
        },
      });

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);
      expect(renderToolCall).not.toHaveBeenCalled();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_TASK, input: { prompt: 'Do something', subagent_type: 'general-purpose', run_in_background: false } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
      expect(deps.subagentManager.handleTaskToolUse).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ run_in_background: false }),
        expect.anything()
      );
    });

    it('should re-parse TodoWrite on input updates when streaming completes', async () => {
      const { parseTodoInput } = jest.requireMock('@/core/tools/todo');

      const mockTodos = [
        { content: 'Task 1', status: 'pending', activeForm: 'Working on task 1' },
      ];

      // First chunk: partial input, parsing fails
      parseTodoInput.mockReturnValueOnce(null);

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        {
          type: 'tool_use',
          id: 'todo-1',
          name: TOOL_TODO_WRITE,
          input: { todos: '[' }, // Incomplete JSON
        },
        msg
      );

      // No todos yet
      expect(deps.state.currentTodos).toBeNull();

      // Second chunk: complete input, parsing succeeds
      parseTodoInput.mockReturnValueOnce(mockTodos);

      await controller.handleStreamChunk(
        {
          type: 'tool_use',
          id: 'todo-1',
          name: TOOL_TODO_WRITE,
          input: { todos: mockTodos },
        },
        msg
      );

      // Now todos should be updated
      expect(deps.state.currentTodos).toEqual(mockTodos);
    });

    it('should clear pendingTools on resetStreamingState', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.md' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-2', name: 'Read', input: { file_path: 'b.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(2);

      controller.resetStreamingState();

      expect(deps.state.pendingTools.size).toBe(0);
    });

    it('should clear responseStartTime on resetStreamingState', () => {
      deps.state.responseStartTime = 12345;
      expect(deps.state.responseStartTime).toBe(12345);

      controller.resetStreamingState();

      expect(deps.state.responseStartTime).toBeNull();
    });
  });

  describe('Timer lifecycle', () => {
    it('should create timer interval when showing thinking indicator', () => {
      deps.state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500); // Past the debounce delay

      expect(deps.state.flavorTimerInterval).not.toBeNull();
    });

    it('applies a new override to an indicator that is already showing', () => {
      deps.state.responseStartTime = performance.now();

      controller.showThinkingIndicator('Antigravity is working — 15s');
      jest.advanceTimersByTime(500);
      const label = (): string | undefined =>
        (deps.state.thinkingEl?.children[0] as HTMLElement | undefined)?.textContent ?? undefined;
      expect(label()).toBe('Antigravity is working — 15s');

      // The indicator is already up for the rest of the turn, so an override
      // that never reached it would freeze at its first value.
      controller.showThinkingIndicator('Antigravity is working — 30s');

      expect(label()).toBe('Antigravity is working — 30s');
    });

    it('should clear timer interval when hiding thinking indicator', () => {
      deps.state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);
      expect(deps.state.flavorTimerInterval).not.toBeNull();

      controller.hideThinkingIndicator();

      expect(deps.state.flavorTimerInterval).toBeNull();
    });

    it('uses the content owner window for thinking timers', () => {
      const ownerSetTimeout = jest.fn<number, [() => void, number?]>(
        (callback, timeout) => globalThis.setTimeout(callback, timeout) as unknown as number,
      );
      const ownerClearTimeout = jest.fn<void, [number]>((handle) => {
        globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
      });
      const ownerSetInterval = jest.fn<number, [() => void, number?]>(
        (callback, timeout) => globalThis.setInterval(callback, timeout) as unknown as number,
      );
      const ownerClearInterval = jest.fn<void, [number]>((handle) => {
        globalThis.clearInterval(handle as unknown as ReturnType<typeof setInterval>);
      });
      const ownerWindow = {
        ...deps.state.currentContentEl!.ownerDocument.defaultView,
        setTimeout: ownerSetTimeout,
        clearTimeout: ownerClearTimeout,
        setInterval: ownerSetInterval,
        clearInterval: ownerClearInterval,
      };
      Object.defineProperty(deps.state.currentContentEl!.ownerDocument, 'defaultView', {
        configurable: true,
        value: ownerWindow,
      });

      deps.state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      expect(ownerSetTimeout).toHaveBeenCalledWith(expect.any(Function), 400);

      controller.hideThinkingIndicator();
      expect(ownerClearTimeout).toHaveBeenCalled();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);
      expect(ownerSetInterval).toHaveBeenCalledWith(expect.any(Function), 1000);

      controller.hideThinkingIndicator();
      expect(ownerClearInterval).toHaveBeenCalled();
    });

    it('should clear timer interval in resetStreamingState', () => {
      deps.state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);
      expect(deps.state.flavorTimerInterval).not.toBeNull();

      controller.resetStreamingState();

      expect(deps.state.flavorTimerInterval).toBeNull();
    });

    it('should not create duplicate intervals on multiple showThinkingIndicator calls', () => {
      deps.state.responseStartTime = performance.now();
      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);
      const firstInterval = deps.state.flavorTimerInterval;

      // Second call while indicator exists should not create a new interval
      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);

      // Should still have the same interval (no new one created since element exists)
      expect(deps.state.flavorTimerInterval).toBe(firstInterval);

      clearIntervalSpy.mockRestore();
    });
  });

  describe('Tool handling - continued', () => {
    it('should handle multiple pending tools and flush in order', async () => {
      const { renderToolCall } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.md' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'test' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'glob-1', name: 'Glob', input: { pattern: '*.md' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(3);
      expect(renderToolCall).not.toHaveBeenCalled();

      await controller.finishTurn(msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalledTimes(3);

      // Verify tools were rendered in order (Map preserves insertion order)
      const calls = renderToolCall.mock.calls;
      expect(calls[0][1].id).toBe('read-1');
      expect(calls[1][1].id).toBe('grep-1');
      expect(calls[2][1].id).toBe('glob-1');
    });
  });

  describe('Usage handling - edge cases', () => {
    it('should skip usage when subagentsSpawnedThisStream > 0', async () => {
      const msg = createTestMessage();
      (deps.subagentManager as any).subagentsSpawnedThisStream = 1;

      const usage = createMockUsage({ inputTokens: 100, contextWindow: 200, contextTokens: 100, percentage: 50 });

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toBeNull();
    });

    it('accepts parent-only context usage when subagents ran', async () => {
      const msg = createTestMessage();
      (deps.subagentManager as any).subagentsSpawnedThisStream = 1;

      const usage = createMockUsage({
        contextWindow: 1_000_000,
        contextWindowIsAuthoritative: true,
        contextTokens: 250_000,
        inputTokens: 0,
        percentage: 25,
      });

      await controller.handleStreamChunk({
        type: 'usage',
        usage,
        usageScope: 'parent',
      } as any, msg);

      expect(deps.state.usage).toEqual(usage);
    });

    it('should skip usage when chunk has sessionId but currentSessionId is null', async () => {
      const nullSessionDeps = createMockDeps();
      nullSessionDeps.getAgentService = () => ({ getSessionId: jest.fn().mockReturnValue(null) }) as any;
      nullSessionDeps.state.currentContentEl = createMockEl();
      const nullSessionController = new StreamController(nullSessionDeps);

      const msg = createTestMessage();
      const usage = createMockUsage();

      await nullSessionController.handleStreamChunk({ type: 'usage', usage, sessionId: 'some-session' }, msg);

      expect(nullSessionDeps.state.usage).toBeNull();
    });

    it('should update usage when no sessionId on chunk', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage();

      await controller.handleStreamChunk({ type: 'usage', usage } as any, msg);

      expect(deps.state.usage).toEqual(usage);
    });

    it('uses authoritative usage chunks directly', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage({
        model: DEFAULT_CODEX_PRIMARY_MODEL,
        contextWindow: 258400,
        contextWindowIsAuthoritative: true,
        contextTokens: 129200,
        percentage: 50,
      });

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toEqual(usage);
    });

    it('should not update usage when ignoreUsageUpdates is true', async () => {
      const msg = createTestMessage();
      deps.state.ignoreUsageUpdates = true;

      const usage = createMockUsage();

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toBeNull();
    });
  });

  describe('Thinking indicator - edge cases', () => {
    it('should not show indicator when no currentContentEl', () => {
      deps.state.currentContentEl = null;

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);

      expect(deps.state.thinkingEl).toBeNull();
    });

    it('should not show indicator when currentThinkingState is active', () => {
      deps.state.currentThinkingState = { content: 'thinking...', container: {}, contentEl: {}, startTime: Date.now() } as any;

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);

      expect(deps.state.thinkingEl).toBeNull();
    });

    it('should re-append existing indicator to bottom when called again', () => {
      deps.state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);

      const thinkingEl = deps.state.thinkingEl;
      expect(thinkingEl).not.toBeNull();

      controller.showThinkingIndicator();

      expect(deps.state.thinkingEl).toBe(thinkingEl);
      expect(deps.updateQueueIndicator).toHaveBeenCalled();
    });
  });

  describe('scrollToBottom - settings', () => {
    it('should not scroll when enableAutoScroll setting is false', async () => {
      (deps.plugin.settings as any).enableAutoScroll = false;
      const messagesEl = deps.getMessagesEl();
      Object.defineProperty(messagesEl, 'scrollHeight', { value: 1000, configurable: true });
      messagesEl.scrollTop = 0;

      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);

      expect(messagesEl.scrollTop).toBe(0);
    });

    it('should not scroll when autoScrollEnabled state is false', async () => {
      deps.state.autoScrollEnabled = false;
      const messagesEl = deps.getMessagesEl();
      Object.defineProperty(messagesEl, 'scrollHeight', { value: 1000, configurable: true });
      messagesEl.scrollTop = 0;

      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);

      expect(messagesEl.scrollTop).toBe(0);
    });
  });

  describe('Subagent chunk handling', () => {
    it('should handle subagent tool_result chunk', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      const toolCall = { id: 'read-1', name: 'Read', input: {}, status: 'running' };
      (deps.subagentManager.getSyncSubagent as jest.Mock).mockReturnValueOnce({
        info: { id: 'task-1', description: 'test', status: 'running', toolCalls: [toolCall] },
      });

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'read-1', subagentId: 'task-1', content: 'file content' },
        msg
      );

      expect(deps.subagentManager.updateSyncToolResult).toHaveBeenCalledWith(
        'task-1',
        'read-1',
        expect.objectContaining({ status: 'completed', result: 'file content' })
      );
    });

    it('should handle subagent tool_use chunk', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.getSyncSubagent as jest.Mock).mockReturnValueOnce({
        info: { id: 'task-1', description: 'test', status: 'running', toolCalls: [] },
      });

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'test' }, subagentId: 'task-1' },
        msg
      );

      expect(deps.subagentManager.addSyncToolCall).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ id: 'grep-1', name: 'Grep', status: 'running' })
      );
    });

    it('should skip subagent chunk when no sync subagent found', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.getSyncSubagent as jest.Mock).mockReturnValueOnce(undefined);

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'orphan-read', name: 'Read', input: { file_path: 'test.md' }, subagentId: 'unknown-task' },
        msg
      );

      // Should not throw
      expect(msg.content).toBe('');
    });
  });

  describe('Async subagent handling', () => {
    it('should handle created_async action from Task tool use', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.handleTaskToolUse as jest.Mock).mockReturnValueOnce({
        action: 'created_async',
        info: { id: 'task-1', description: 'background task', status: 'running', toolCalls: [], mode: 'async' },
      });

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_TASK, input: { prompt: 'Do something', run_in_background: true } },
        msg
      );

      expect(msg.toolCalls).toContainEqual(
        expect.objectContaining({
          id: 'task-1',
          name: TOOL_TASK,
          subagent: expect.objectContaining({
            id: 'task-1',
            mode: 'async',
          }),
        })
      );
      expect(msg.contentBlocks).toContainEqual({ type: 'subagent', subagentId: 'task-1', mode: 'async' });
    });

    it('should handle label_updated action from Task tool use (no-op for message)', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.handleTaskToolUse as jest.Mock).mockReturnValueOnce({
        action: 'label_updated',
      });

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_TASK, input: { prompt: 'Updated' } },
        msg
      );

      expect(msg.toolCalls).toContainEqual(
        expect.objectContaining({
          id: 'task-1',
          name: TOOL_TASK,
        })
      );
      expect(msg.contentBlocks).toEqual([]);
    });
  });

  describe('onAsyncSubagentStateChange', () => {
    it('should update subagent in messages', () => {
      const subagent = { id: 'task-1', description: 'test', status: 'completed', result: 'done', toolCalls: [] } as any;
      deps.state.messages = [{
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{
          id: 'task-1',
          name: TOOL_TASK,
          input: { description: 'test' },
          status: 'running',
          subagent: { id: 'task-1', description: 'test', status: 'running', toolCalls: [] },
        }],
      }] as any;

      controller.onAsyncSubagentStateChange(subagent);

      const taskTool = deps.state.messages[0].toolCalls![0];
      expect(taskTool.status).toBe('completed');
      expect(taskTool.subagent?.status).toBe('completed');
      expect(taskTool.subagent?.result).toBe('done');
    });

    it('should not crash when subagent not found in messages', () => {
      const subagent = { id: 'unknown', description: 'test', status: 'completed', toolCalls: [] } as any;
      deps.state.messages = [{
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{
          id: 'task-1',
          name: TOOL_TASK,
          input: { description: 'test' },
          status: 'running',
        }],
      }] as any;

      expect(() => controller.onAsyncSubagentStateChange(subagent)).not.toThrow();
    });
  });

  describe('Thinking block finalization', () => {
    it('should finalize thinking block and add to contentBlocks', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      deps.state.currentThinkingState = {
        content: 'Let me think...',
        container: createMockEl(),
        contentEl: createMockEl(),
        startTime: Date.now(),
      } as any;

      await controller.finalizeCurrentThinkingBlock(msg);

      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Let me think...' })
      );
      expect(deps.state.currentThinkingState).toBeNull();
    });

    it('should not add to contentBlocks when no thinking content', async () => {
      const msg = createTestMessage();
      deps.state.currentThinkingState = {
        content: '',
        container: createMockEl(),
        contentEl: createMockEl(),
        startTime: Date.now(),
      } as any;

      await controller.finalizeCurrentThinkingBlock(msg);

      expect(msg.contentBlocks).toEqual([]);
    });

    it('should be a no-op when no thinking state', async () => {
      const msg = createTestMessage();
      deps.state.currentThinkingState = null;

      await controller.finalizeCurrentThinkingBlock(msg);

      expect(msg.contentBlocks).toEqual([]);
    });

    it('should coalesce thinking renders until the next animation frame', async () => {
      const { createThinkingBlock } = jest.requireMock('@/features/chat/rendering/ThinkingBlockRenderer');
      const msg = createTestMessage();
      const contentEl = createMockEl();
      createThinkingBlock.mockReturnValueOnce({
        wrapperEl: createMockEl(),
        contentEl,
        labelEl: createMockEl(),
        content: '',
        startTime: Date.now(),
      });

      await controller.handleStreamChunk({ type: 'thinking', content: 'Let ' }, msg);
      await controller.handleStreamChunk({ type: 'thinking', content: 'me think' }, msg);

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();

      jest.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(contentEl, 'Let me think');
    });

    it('should defer math rendering during live thinking renders', async () => {
      const { createThinkingBlock } = jest.requireMock('@/features/chat/rendering/ThinkingBlockRenderer');
      const msg = createTestMessage();
      const contentEl = createMockEl();
      createThinkingBlock.mockReturnValueOnce({
        wrapperEl: createMockEl(),
        contentEl,
        labelEl: createMockEl(),
        content: '',
        startTime: Date.now(),
      });

      await controller.handleStreamChunk({ type: 'thinking', content: 'Reasoning $x^2$' }, msg);

      jest.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        contentEl,
        'Reasoning $x^2$',
        { deferMath: true }
      );
    });

    it('should render original math once when finalizing a deferred thinking block', async () => {
      const { createThinkingBlock } = jest.requireMock('@/features/chat/rendering/ThinkingBlockRenderer');
      const msg = createTestMessage();
      const contentEl = createMockEl();
      createThinkingBlock.mockReturnValueOnce({
        wrapperEl: createMockEl(),
        contentEl,
        labelEl: createMockEl(),
        content: '',
        startTime: Date.now(),
      });

      await controller.handleStreamChunk({ type: 'thinking', content: 'Reasoning $x^2$' }, msg);
      await controller.finalizeCurrentThinkingBlock(msg);

      expect(deps.renderer.renderContent).toHaveBeenNthCalledWith(
        1,
        contentEl,
        'Reasoning $x^2$',
        { deferMath: true }
      );
      expect(deps.renderer.renderContent).toHaveBeenNthCalledWith(
        2,
        contentEl,
        'Reasoning $x^2$'
      );
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Reasoning $x^2$' })
      );
    });

    it('should flush a pending thinking render before finalizing', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk({ type: 'thinking', content: 'Reasoning' }, msg);
      await controller.finalizeCurrentThinkingBlock(msg);

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        expect.anything(),
        'Reasoning'
      );
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Reasoning' })
      );
    });
  });

  describe('Pending Task tool handling', () => {
    it('should render pending Task as sync when child chunk arrives', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      // Task without run_in_background - manager returns buffered
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_TASK, input: { prompt: 'Do something', subagent_type: 'general-purpose' } },
        msg
      );

      // Manager's handleTaskToolUse should have been called
      expect(deps.subagentManager.handleTaskToolUse).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ prompt: 'Do something' }),
        expect.anything()
      );

      // Configure manager for child chunk: pending task exists, render returns sync
      (deps.subagentManager.hasPendingTask as jest.Mock).mockReturnValueOnce(true);
      (deps.subagentManager.renderPendingTask as jest.Mock).mockReturnValueOnce({
        mode: 'sync',
        subagentState: {
          info: { id: 'task-1', description: 'Do something', status: 'running', toolCalls: [] },
        },
      });
      // Also configure getSyncSubagent for the child chunk routing
      (deps.subagentManager.getSyncSubagent as jest.Mock).mockReturnValueOnce({
        info: { id: 'task-1', description: 'Do something', status: 'running', toolCalls: [] },
      });

      // Child chunk arrives with parentToolUseId - should trigger render
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, subagentId: 'task-1' },
        msg
      );

      // Task toolCall should carry linked subagent
      expect(msg.toolCalls).toContainEqual(
        expect.objectContaining({
          id: 'task-1',
          name: TOOL_TASK,
          subagent: expect.objectContaining({ id: 'task-1' }),
        })
      );
      expect(deps.subagentManager.renderPendingTask).toHaveBeenCalledWith('task-1', deps.state.currentContentEl);
    });

    it('should not crash stream when pending Task rendering returns null via child chunk', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      // Task without run_in_background - manager returns buffered
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_TASK, input: { prompt: 'Do something', subagent_type: 'general-purpose' } },
        msg
      );

      // Configure manager: pending task exists but render returns null (error case)
      (deps.subagentManager.hasPendingTask as jest.Mock).mockReturnValueOnce(true);
      (deps.subagentManager.renderPendingTask as jest.Mock).mockReturnValueOnce(null);

      // Child chunk arrives - renderPendingTask returns null but shouldn't crash
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, subagentId: 'task-1' },
        msg
      );

      // Should not throw - manager handled errors internally
      expect(deps.subagentManager.renderPendingTask).toHaveBeenCalledWith('task-1', deps.state.currentContentEl);
    });

    it('should not crash stream when pending Task rendering returns null via tool_result', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      // Task without run_in_background - manager returns buffered
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_TASK, input: { prompt: 'Do something', subagent_type: 'general-purpose' } },
        msg
      );

      // Configure manager: pending task exists but render returns null
      (deps.subagentManager.hasPendingTask as jest.Mock).mockReturnValueOnce(true);
      (deps.subagentManager.renderPendingTaskFromTaskResult as jest.Mock).mockReturnValueOnce(null);

      // Tool result arrives - pending resolver returns null but stream should continue
      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Task completed' },
        msg
      );

      // Should not throw - manager handled errors internally
      expect(deps.subagentManager.renderPendingTaskFromTaskResult).toHaveBeenCalledWith(
        'task-1',
        'Task completed',
        false,
        deps.state.currentContentEl,
        undefined
      );
    });

    it('should resolve pending Task as async via tool_result and continue async lifecycle', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_TASK, input: { prompt: 'Do something' } },
        msg
      );

      (deps.subagentManager.hasPendingTask as jest.Mock).mockReturnValueOnce(true);
      (deps.subagentManager.renderPendingTaskFromTaskResult as jest.Mock).mockReturnValueOnce({
        mode: 'async',
        info: {
          id: 'task-1',
          description: 'Do something',
          prompt: 'Do something',
          mode: 'async',
          isExpanded: false,
          status: 'running',
          toolCalls: [],
          asyncStatus: 'pending',
        },
      });
      (deps.subagentManager.isPendingAsyncTask as jest.Mock).mockReturnValueOnce(true);

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: '{"agent_id":"agent-1"}' },
        msg
      );

      expect(deps.subagentManager.renderPendingTaskFromTaskResult).toHaveBeenCalledWith(
        'task-1',
        '{"agent_id":"agent-1"}',
        false,
        deps.state.currentContentEl,
        undefined
      );
      expect(deps.subagentManager.handleTaskToolResult).toHaveBeenCalledWith(
        'task-1',
        '{"agent_id":"agent-1"}',
        undefined,
        undefined
      );
      expect(msg.contentBlocks).toContainEqual({
        type: 'subagent',
        subagentId: 'task-1',
        mode: 'async',
      });
      expect(msg.toolCalls).toContainEqual(
        expect.objectContaining({
          id: 'task-1',
          name: TOOL_TASK,
          subagent: expect.objectContaining({ mode: 'async' }),
        })
      );
    });

    it('should pass task toolUseResult into pending Task resolver', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_TASK, input: { prompt: 'Do something' } },
        msg
      );

      const toolUseResult = { isAsync: true, status: 'async_launched', agentId: 'agent-1' };
      (deps.subagentManager.hasPendingTask as jest.Mock).mockReturnValueOnce(true);
      (deps.subagentManager.renderPendingTaskFromTaskResult as jest.Mock).mockReturnValueOnce(null);

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Launching...', toolUseResult } as any,
        msg
      );

      expect(deps.subagentManager.renderPendingTaskFromTaskResult).toHaveBeenCalledWith(
        'task-1',
        'Launching...',
        false,
        deps.state.currentContentEl,
        toolUseResult
      );
    });
  });

  describe('Text ↔ Thinking transitions', () => {
    it('text arrives while thinking state is active → finalizeCurrentThinkingBlock is called', async () => {
      const { finalizeThinkingBlock } = jest.requireMock('@/features/chat/rendering/ThinkingBlockRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      deps.state.currentThinkingState = {
        content: 'Let me think...',
        container: createMockEl(),
        contentEl: createMockEl(),
        startTime: Date.now(),
      } as any;

      await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);

      expect(finalizeThinkingBlock).toHaveBeenCalled();
      expect(deps.state.currentThinkingState).toBeNull();
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Let me think...' })
      );
    });

    it('thinking arrives while textEl exists → finalizeCurrentTextBlock is called', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      deps.state.currentTextEl = createMockEl();
      deps.state.currentTextContent = 'Some text';

      await controller.handleStreamChunk({ type: 'thinking', content: 'Hmm...' }, msg);

      expect(deps.state.currentTextEl).toBeNull();
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'text', content: 'Some text' })
      );
      expect(deps.renderer.addTextCopyButton).toHaveBeenCalledWith(
        expect.anything(),
        'Some text'
      );
    });

    it('tool_use arrives while thinking state → finalizeCurrentThinkingBlock is called', async () => {
      const { finalizeThinkingBlock } = jest.requireMock('@/features/chat/rendering/ThinkingBlockRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      deps.state.currentThinkingState = {
        content: 'Reasoning...',
        container: createMockEl(),
        contentEl: createMockEl(),
        startTime: Date.now(),
      } as any;

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' } },
        msg
      );

      expect(finalizeThinkingBlock).toHaveBeenCalled();
      expect(deps.state.currentThinkingState).toBeNull();
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Reasoning...' })
      );
    });
  });

  describe('Agent output tool use/result', () => {
    it('TOOL_AGENT_OUTPUT chunk creates tool call and delegates to subagentManager.handleAgentOutputToolUse', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'agent-out-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'task-1' } },
        msg
      );

      expect(deps.subagentManager.handleAgentOutputToolUse).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-out-1',
          name: TOOL_AGENT_OUTPUT,
          status: 'running',
        })
      );
      expect(msg.toolCalls).toEqual([]);
      expect(msg.contentBlocks).toEqual([]);
    });

    it('Agent output tool result handled via handleAgentOutputToolResult returning true', async () => {
      const { updateToolCallResult } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.isLinkedAgentOutputTool as jest.Mock).mockReturnValueOnce(true);
      (deps.subagentManager.handleAgentOutputToolResult as jest.Mock).mockReturnValueOnce({});

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'agent-out-1', content: 'agent result', toolUseResult: { foo: 'bar' } },
        msg
      );

      expect(deps.subagentManager.handleAgentOutputToolResult).toHaveBeenCalledWith(
        'agent-out-1',
        'agent result',
        false,
        { foo: 'bar' }
      );
      expect(updateToolCallResult).not.toHaveBeenCalled();
    });

  });

  describe('Tool header update on input re-dispatch', () => {
    it('second tool_use with same id updates existing tool input and header', async () => {
      const { getToolDisplayName, getToolSummary } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      // First tool_use - creates the tool call
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' } },
        msg
      );

      // Flush the tool so it transitions from pending to rendered
      await controller.finishTurn(msg);

      // Manually set up a rendered tool element with name + summary children
      // (the mock renderToolCall doesn't actually populate toolCallElements)
      const toolEl = createMockEl();
      const nameChild = toolEl.createDiv({ cls: 'grimoire-tool-name' });
      nameChild.setText('Read');
      const summaryChild = toolEl.createDiv({ cls: 'grimoire-tool-summary' });
      summaryChild.setText('test.md');
      deps.state.toolCallElements.set('read-1', toolEl);

      getToolDisplayName.mockReturnValueOnce('Read');
      getToolSummary.mockReturnValueOnce('updated.md');

      // Second tool_use with same id - should update input and header
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'updated.md' } },
        msg
      );

      // Input should be merged
      expect(msg.toolCalls![0].input).toEqual(
        expect.objectContaining({ file_path: 'updated.md' })
      );
      // getToolDisplayName/getToolSummary should have been called with updated input
      expect(getToolDisplayName).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Read',
        input: expect.objectContaining({ file_path: 'updated.md' }),
      }));
      expect(getToolSummary).toHaveBeenCalledWith('Read', expect.objectContaining({ file_path: 'updated.md' }));
      // Header texts should be updated
      expect(nameChild.textContent).toBe('Read');
      expect(summaryChild.textContent).toBe('updated.md');
    });
  });

  describe('Sync subagent finalization', () => {
    it('tool_result for a sync subagent calls finalizeSyncSubagent and updates Task toolCall', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      msg.toolCalls = [
        {
          id: 'task-1',
          name: TOOL_TASK,
          input: { description: 'Do something' },
          status: 'running',
          subagent: { id: 'task-1', description: 'Do something', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
      ];

      // getSyncSubagent returns a subagent state (indicating this is a sync subagent)
      (deps.subagentManager.getSyncSubagent as jest.Mock).mockReturnValueOnce({
        info: { id: 'task-1', description: 'Do something', status: 'running', toolCalls: [], isExpanded: false },
      });

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Task completed successfully' },
        msg
      );

      expect(deps.subagentManager.finalizeSyncSubagent).toHaveBeenCalledWith(
        'task-1',
        'Task completed successfully',
        false,
        undefined
      );

      expect(msg.toolCalls[0].status).toBe('completed');
      expect(msg.toolCalls[0].result).toBe('Task completed successfully');
      expect(msg.toolCalls[0].subagent?.status).toBe('completed');
      expect(msg.toolCalls[0].subagent?.result).toBe('Task completed successfully');
    });
  });

  describe('Codex subagent lifecycle', () => {
    it('renders prompt immediately and final result after wait_agent resolves', async () => {
      const { createSubagentBlock, finalizeSubagentBlock } = jest.requireMock('@/features/chat/rendering/SubagentRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      deps.getAgentService = () => ({
        providerId: 'codex',
        getCapabilities: jest.fn().mockReturnValue({
          providerId: 'codex',
          supportsPlanMode: true,
          planPathPrefix: '/.codex/plans/',
        }),
      }) as any;

      const subagentState = {
        info: { id: 'spawn-1', description: 'Codex subagent', prompt: '', status: 'running', toolCalls: [] },
        labelEl: { setText: jest.fn() },
      };
      createSubagentBlock.mockReturnValueOnce(subagentState);

      await controller.handleStreamChunk(
        {
          type: 'tool_use',
          id: 'spawn-1',
          name: TOOL_SPAWN_AGENT,
          input: { message: 'Inspect utils.ts and return the final patch summary.', model: 'gpt-5.4-mini' },
        },
        msg,
      );

      expect(deps.onSubagentActivityDetected).toHaveBeenCalledTimes(1);

      await controller.handleStreamChunk(
        {
          type: 'tool_result',
          id: 'spawn-1',
          content: '{"agent_id":"agent-1","nickname":"Zeno"}',
        },
        msg,
      );

      await controller.handleStreamChunk(
        {
          type: 'tool_use',
          id: 'wait-1',
          name: TOOL_WAIT_AGENT,
          input: { targets: ['agent-1'], timeout_ms: 30000 },
        },
        msg,
      );

      await controller.handleStreamChunk(
        {
          type: 'tool_result',
          id: 'wait-1',
          content: '{"status":{"agent-1":{"completed":"Patched utils.ts and verified imports."}},"timed_out":false}',
        },
        msg,
      );

      expect(createSubagentBlock).toHaveBeenCalledWith(
        expect.anything(),
        'spawn-1',
        expect.objectContaining({
          description: 'Codex subagent (gpt-5.4-mini)',
          prompt: 'Inspect utils.ts and return the final patch summary.',
        }),
      );
      expect(subagentState.info.description).toBe('Zeno (gpt-5.4-mini)');
      expect(finalizeSubagentBlock).toHaveBeenCalledWith(
        subagentState,
        'Patched utils.ts and verified imports.',
        false,
      );
    });
  });

  describe('Grok subagent lifecycle', () => {
    function useGrokProvider(): void {
      deps.getAgentService = () => ({
        providerId: 'grok',
        getCapabilities: jest.fn().mockReturnValue({ providerId: 'grok' }),
      }) as any;
    }

    it('renders one named block and completes it from the hidden multi-wait result', async () => {
      const { createSubagentBlock, finalizeSubagentBlock } = jest.requireMock('@/features/chat/rendering/SubagentRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      useGrokProvider();

      const promptTextEl = { setText: jest.fn() };
      const subagentState = {
        info: { id: 'spawn-1', description: 'Grok subagent', prompt: '', status: 'running', toolCalls: [] },
        labelEl: { setText: jest.fn() },
        promptBodyEl: { querySelector: jest.fn().mockReturnValue(promptTextEl) },
      };
      createSubagentBlock.mockReturnValueOnce(subagentState);

      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'spawn-1',
        name: GROK_SUBAGENT_SPAWN_TOOL,
        input: {
          description: 'Explore core vault notes',
          prompt: 'Inspect the vault.',
          subagent_type: 'explore',
        },
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'spawn-1',
        name: GROK_SUBAGENT_SPAWN_TOOL,
        input: {
          description: 'Explore core vault notes',
          prompt: 'Inspect the vault and report in Russian.',
          run_in_background: true,
        },
      }, msg);

      expect(createSubagentBlock).toHaveBeenCalledTimes(1);
      expect(msg.toolCalls?.filter(toolCall => toolCall.id === 'spawn-1')).toHaveLength(1);
      expect(deps.onSubagentActivityDetected).toHaveBeenCalledTimes(2);

      await controller.handleStreamChunk({
        type: 'tool_result',
        id: 'spawn-1',
        content: 'Subagent started in background.\nsubagent_id: agent-1',
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'wait-1',
        name: GROK_SUBAGENT_WAIT_TOOL,
        input: { task_ids: ['agent-1'], timeout_ms: 180_000 },
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'wait-1',
        name: GROK_SUBAGENT_WAIT_TOOL,
        input: { task_ids: ['agent-1'], timeout_ms: 180_000 },
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_result',
        id: 'wait-1',
        content: JSON.stringify({
          type: 'TaskOutput',
          MultiResult: {
            results: [{ task_id: 'agent-1', status: 'completed', output: 'Vault report' }],
          },
        }),
      }, msg);

      expect(msg.contentBlocks).toEqual([{ type: 'tool_use', toolId: 'spawn-1' }]);
      expect(msg.toolCalls?.filter(toolCall => toolCall.id === 'wait-1')).toHaveLength(1);
      expect(finalizeSubagentBlock).toHaveBeenCalledWith(subagentState, 'Vault report', false);
    });

    it('completes a running block from the xAI subagent_finished event', async () => {
      const { createSubagentBlock, finalizeSubagentBlock } = jest.requireMock('@/features/chat/rendering/SubagentRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      useGrokProvider();

      const subagentState = {
        info: { id: 'spawn-1', description: 'Explore vault', prompt: 'Inspect.', status: 'running', toolCalls: [] },
        labelEl: { setText: jest.fn() },
        promptBodyEl: { querySelector: jest.fn().mockReturnValue({ setText: jest.fn() }) },
      };
      createSubagentBlock.mockReturnValueOnce(subagentState);

      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'spawn-1',
        name: GROK_SUBAGENT_SPAWN_TOOL,
        input: { description: 'Explore vault', prompt: 'Inspect.' },
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_result',
        id: 'spawn-1',
        content: 'Subagent started in background.\nsubagent_id: agent-1',
      }, msg);
      await controller.handleStreamChunk({
        type: 'async_subagent_result',
        agentId: 'agent-1',
        status: 'completed',
        result: 'Finished report',
      }, msg);

      expect(finalizeSubagentBlock).toHaveBeenCalledWith(subagentState, 'Finished report', false);
      expect(msg.toolCalls?.[0]?.subagent).toEqual(expect.objectContaining({
        agentId: 'agent-1',
        result: 'Finished report',
        status: 'completed',
      }));
    });
  });

  describe('Async task tool result', () => {
    it('tool_result for a pending async task returns true from handleAsyncTaskToolResult', async () => {
      const { updateToolCallResult } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.isPendingAsyncTask as jest.Mock).mockReturnValueOnce(true);

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Task started in background' },
        msg
      );

      expect(deps.subagentManager.handleTaskToolResult).toHaveBeenCalledWith(
        'task-1',
        'Task started in background',
        undefined,
        undefined
      );

      expect(updateToolCallResult).not.toHaveBeenCalled();
      expect(msg.toolCalls).toEqual([]);
    });

    it('passes structured toolUseResult through to async Task result handler', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      (deps.subagentManager.isPendingAsyncTask as jest.Mock).mockReturnValueOnce(true);

      const structured = { data: { agent_id: 'agent-from-structured' } };
      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Task started', toolUseResult: structured } as any,
        msg
      );

      expect(deps.subagentManager.handleTaskToolResult).toHaveBeenCalledWith(
        'task-1',
        'Task started',
        undefined,
        structured
      );
    });

    it('normalizes structured tool_result content before storing it on tool calls', async () => {
      const { updateToolCallResult } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      const msg = createTestMessage();
      msg.toolCalls = [
        {
          id: 'mcp-1',
          name: 'mcp__stitch__create_project',
          input: {},
          status: 'running',
          isExpanded: false,
        } as any,
      ];

      await controller.handleStreamChunk(
        {
          type: 'tool_result',
          id: 'mcp-1',
          content: [{ type: 'text', text: 'Created project successfully' }],
        } as any,
        msg,
      );

      expect(msg.toolCalls[0].status).toBe('completed');
      expect(msg.toolCalls[0].result).toBe('Created project successfully');
      expect(updateToolCallResult).toHaveBeenCalled();
    });
  });

  describe('showThinkingIndicator - timer disconnection cleanup', () => {
    it('should clear interval when timerSpan becomes disconnected from DOM', () => {
      // Use a non-zero value: with fake timers, performance.now() starts at 0,
      // and !0 is truthy which would cause updateTimer to return early.
      jest.advanceTimersByTime(1);
      deps.state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500); // Past debounce delay

      expect(deps.state.flavorTimerInterval).not.toBeNull();

      const thinkingEl = deps.state.thinkingEl;
      expect(thinkingEl).not.toBeNull();

      // The timer span is the second child (first is flavor text, second is hint)
      const timerSpan = thinkingEl!.children[1];
      expect(timerSpan).toBeDefined();

      // Mock elements don't have isConnected by default (undefined = falsy),
      // so first set it to true so the timer runs normally on its first tick.
      Object.defineProperty(timerSpan, 'isConnected', { value: true, writable: true, configurable: true });

      // Advance time - interval should still run (isConnected is true)
      jest.advanceTimersByTime(1000);
      expect(deps.state.flavorTimerInterval).not.toBeNull();
      // Verify the interval callback actually ran by checking the timer text was updated
      expect((timerSpan as any).textContent).toContain('esc to interrupt');

      // Now simulate disconnection from DOM
      (timerSpan as any).isConnected = false;

      // Advance time to trigger the interval callback
      jest.advanceTimersByTime(1000);

      // Interval should have been cleared because isConnected is false
      expect(deps.state.flavorTimerInterval).toBeNull();
    });
  });

  describe('showThinkingIndicator - pre-existing interval', () => {
    it('should clear pre-existing interval before creating new one', () => {
      // Advance fake clock so performance.now() returns non-zero
      jest.advanceTimersByTime(1);
      deps.state.responseStartTime = performance.now();
      const activeWindow = deps.state.currentContentEl!.ownerDocument.defaultView!;
      const clearIntervalSpy = jest.spyOn(activeWindow, 'clearInterval');

      // Manually set a pre-existing interval
      deps.state.setFlavorTimerInterval(activeWindow.setInterval(() => {}, 9999), activeWindow);

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);

      // clearInterval should have been called for the pre-existing interval
      expect(clearIntervalSpy).toHaveBeenCalled();

      // A new interval should have been created
      expect(deps.state.flavorTimerInterval).not.toBeNull();

      clearIntervalSpy.mockRestore();
    });
  });

  describe('appendThinking - no currentContentEl', () => {
    it('should not create thinking state when currentContentEl is null', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = null;

      await controller.handleStreamChunk({ type: 'thinking', content: 'test thinking' }, msg);

      // No thinking state should be created
      expect(deps.state.currentThinkingState).toBeNull();
    });
  });

  describe('showThinkingIndicator - responseStartTime null in timer', () => {
    it('should not update timer text when responseStartTime is null', () => {
      // Advance fake clock so performance.now() returns non-zero
      jest.advanceTimersByTime(1);
      deps.state.responseStartTime = performance.now();

      controller.showThinkingIndicator();
      jest.advanceTimersByTime(500);

      expect(deps.state.thinkingEl).not.toBeNull();

      // Get timerSpan and set isConnected to true for proper timer operation
      const timerSpan = deps.state.thinkingEl!.children[1];
      Object.defineProperty(timerSpan, 'isConnected', { value: true, configurable: true });

      // Clear responseStartTime to trigger early return in updateTimer
      deps.state.responseStartTime = null;

      // Advance time to trigger timer callback - should not throw
      jest.advanceTimersByTime(1000);

      // Timer should still be set (interval not cleared by the null check)
      expect(deps.state.flavorTimerInterval).not.toBeNull();
    });
  });
});

describe('StreamController - silent turn heartbeat', () => {
  let controller: StreamController;
  let deps: StreamControllerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    installTestWindow();
    deps = createMockDeps();
    deps.state.currentContentEl = createMockEl();
    controller = new StreamController(deps);
  });

  afterEach(() => {
    controller.resetStreamingState();
    restoreTestWindow();
    jest.useRealTimers();
  });

  it('shows a provider-aware status after ten seconds of silence', () => {
    deps.state.thinkingEl = createMockEl();
    controller.startTurnSilenceIndicator('claude');

    jest.advanceTimersByTime(9_999);
    expect((controller as any).silentTurnStatusEl).toBeNull();

    jest.advanceTimersByTime(1);
    const status = (controller as any).silentTurnStatusEl;
    expect(status).not.toBeNull();
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.children.some((child: any) => child.getAttribute?.('data-provider') === 'claude')).toBe(true);
    expect(status.children.some((child: any) => child.textContent === 'Claude · Still working')).toBe(true);
    expect(status.children.some((child: any) => child.textContent === ' · 0:10')).toBe(true);
    expect(deps.state.thinkingEl).toBeNull();

    jest.advanceTimersByTime(4_000);
    expect((controller as any).silentTurnStatusEl).not.toBeNull();
    expect(status.children.some((child: any) => child.textContent === ' · 0:14')).toBe(true);
  });

  it('resets on activity and pauses while awaiting user attention', () => {
    controller.startTurnSilenceIndicator('claude');
    jest.advanceTimersByTime(9_000);
    controller.noteTurnActivity();
    jest.advanceTimersByTime(1_000);
    expect((controller as any).silentTurnStatusEl).toBeNull();

    controller.pauseTurnSilenceIndicator(true);
    jest.advanceTimersByTime(20_000);
    expect((controller as any).silentTurnStatusEl).toBeNull();

    controller.pauseTurnSilenceIndicator(false);
    jest.advanceTimersByTime(10_000);
    expect((controller as any).silentTurnStatusEl).not.toBeNull();
  });

  it('suppresses the status while a thinking block or progress is active', () => {
    deps.state.currentThinkingState = { content: '', contentEl: createMockEl() } as any;
    controller.startTurnSilenceIndicator('claude');
    jest.advanceTimersByTime(10_000);
    expect((controller as any).silentTurnStatusEl).toBeNull();

    deps.state.currentThinkingState = null;
    (controller as any).progressBlocks.set('completed-progress', { state: 'completed' });
    jest.advanceTimersByTime(10_000);
    expect((controller as any).silentTurnStatusEl).not.toBeNull();
    controller.noteTurnActivity();

    (controller as any).activeProgressId = 'progress-1';
    (controller as any).progressBlocks.set('progress-1', {});
    jest.advanceTimersByTime(10_000);
    expect((controller as any).silentTurnStatusEl).toBeNull();
    (controller as any).progressBlocks.clear();
  });

  it('cleans up the heartbeat when streaming resets', () => {
    controller.startTurnSilenceIndicator('claude');
    controller.resetStreamingState();

    jest.advanceTimersByTime(20_000);
    expect((controller as any).silentTurnStatusEl).toBeNull();
    expect((controller as any).silentTurnProviderId).toBeNull();
  });
});

describe('StreamController - User-facing progress', () => {
  let controller: StreamController;
  let deps: StreamControllerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    installTestWindow();
    deps = createMockDeps();
    controller = new StreamController(deps);
    deps.state.currentContentEl = createMockEl();
  });

  afterEach(() => {
    controller.resetStreamingState();
    restoreTestWindow();
    jest.useRealTimers();
  });

  it('appends summary deltas into one stable persisted progress block', async () => {
    const msg = createTestMessage();

    await controller.handleStreamChunk({
      type: 'progress',
      id: 'item-1:summary:0',
      content: 'Inspecting ',
      append: true,
    }, msg);
    await controller.handleStreamChunk({
      type: 'progress',
      id: 'item-1:summary:0',
      content: 'the workspace',
      append: true,
    }, msg);

    expect(msg.contentBlocks).toEqual([expect.objectContaining({
      type: 'progress',
      id: 'item-1:summary:0',
      content: 'Inspecting the workspace',
      state: 'running',
    })]);
  });

  it('keeps ACP plan items in one progress surface', async () => {
    const msg = createTestMessage();
    const items = [
      { content: 'Inspect files', status: 'completed' as const },
      { content: 'Run tests', status: 'in_progress' as const },
    ];

    await controller.handleStreamChunk({
      type: 'progress',
      id: 'acp:plan',
      content: 'Run tests',
      state: 'running',
      items,
    }, msg);

    expect(msg.contentBlocks?.[0]).toEqual(expect.objectContaining({ items }));
  });

  it('finalizes progress before normal assistant text', async () => {
    const msg = createTestMessage();
    await controller.handleStreamChunk({
      type: 'progress',
      id: 'phase-1',
      content: 'Checking results',
    }, msg);

    jest.advanceTimersByTime(2_000);
    await controller.handleStreamChunk({
      type: 'text',
      content: 'All checks pass.',
      phase: 'final_answer',
    }, msg);

    expect(msg.contentBlocks?.[0]).toEqual(expect.objectContaining({
      type: 'progress',
      state: 'completed',
      durationSeconds: 2,
    }));
    expect(msg.content).toBe('All checks pass.');
  });

  it('marks live progress blocked when an interrupted turn is finalized', async () => {
    const msg = createTestMessage();
    await controller.handleStreamChunk({
      type: 'progress',
      id: 'phase-1',
      content: 'Applying changes',
    }, msg);

    await controller.finalizeProgressBlocks(msg, 'blocked');

    expect(msg.contentBlocks?.[0]).toEqual(expect.objectContaining({
      type: 'progress',
      state: 'blocked',
    }));
  });

  it('marks an unfinished ACP plan as waiting when the turn ends', async () => {
    const msg = createTestMessage();
    await controller.handleStreamChunk({
      type: 'progress',
      id: 'acp:plan',
      content: 'Inspect the vault',
      state: 'running',
      items: [
        { content: 'Inspect the vault', status: 'in_progress' },
        { content: 'Write the plan', status: 'pending' },
      ],
    }, msg);

    await controller.finalizeProgressBlocks(msg);

    expect(msg.contentBlocks?.[0]).toEqual(expect.objectContaining({
      type: 'progress',
      state: 'waiting',
    }));
  });
});

describe('StreamController - Plan Mode', () => {
  let controller: StreamController;
  let deps: StreamControllerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    installTestWindow();
    deps = createMockDeps();
    controller = new StreamController(deps);
    deps.state.currentContentEl = createMockEl();
  });

  afterEach(() => {
    deps.state.resetStreamingState();
    restoreTestWindow();
    jest.useRealTimers();
  });

  describe('capturePlanFilePath', () => {
    it('should capture plan file path from Write tool_use', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: '/home/user/.claude/plans/plan.md' } },
        msg
      );

      expect(deps.state.planFilePath).toBe('/home/user/.claude/plans/plan.md');
    });

    it('should capture plan file path with Windows backslashes', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: 'C:\\.claude\\plans\\plan.md' } },
        msg
      );

      expect(deps.state.planFilePath).toBe('C:\\.claude\\plans\\plan.md');
    });

    it('should not capture non-plan Write paths', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: '/home/user/notes/todo.md' } },
        msg
      );

      expect(deps.state.planFilePath).toBeNull();
    });

    it('should not capture plan path from non-Write tools', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/home/user/.claude/plans/plan.md' } },
        msg
      );

      expect(deps.state.planFilePath).toBeNull();
    });

    it('should capture plan file path on subsequent tool_use input update', async () => {
      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'write-1',
        name: 'Write',
        input: { content: 'plan content' },
        status: 'running',
      }];

      // Second tool_use chunk with same ID updates the input (file_path arrives later)
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: '/home/user/.claude/plans/plan.md' } },
        msg
      );

      expect(deps.state.planFilePath).toBe('/home/user/.claude/plans/plan.md');
    });
  });

  describe('blocked detection bypass', () => {
    it('should hydrate AskUserQuestion resolvedAnswers from result text fallback', async () => {
      const coreTools = jest.requireMock('@/core/tools/toolInput');
      (coreTools.extractResolvedAnswers as jest.Mock).mockReturnValueOnce(undefined);
      (coreTools.extractResolvedAnswersFromResultText as jest.Mock).mockReturnValueOnce({
        'Color?': 'Blue',
      });

      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'ask-1',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Color?' }] },
        status: 'running',
      }];

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'ask-1', content: '"Color?"="Blue"' },
        msg
      );

      expect(msg.toolCalls[0].resolvedAnswers).toEqual({ 'Color?': 'Blue' });
    });

    it('should not mark AskUserQuestion as blocked even when result looks blocked', async () => {
      const { isBlockedToolResult } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      (isBlockedToolResult as jest.Mock).mockReturnValueOnce(true);

      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'ask-1',
        name: 'AskUserQuestion',
        input: {},
        status: 'running',
      }];

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'ask-1', content: 'User denied this action.' },
        msg
      );

      expect(msg.toolCalls[0].status).toBe('completed');
    });

    it('should not mark ExitPlanMode as blocked even when result looks blocked', async () => {
      const { isBlockedToolResult } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      (isBlockedToolResult as jest.Mock).mockReturnValueOnce(true);

      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'exit-1',
        name: 'ExitPlanMode',
        input: {},
        status: 'running',
      }];

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'exit-1', content: 'User denied.' },
        msg
      );

      expect(msg.toolCalls[0].status).toBe('completed');
    });

    it('should mark regular tool as blocked when result is blocked', async () => {
      const { isBlockedToolResult } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
      (isBlockedToolResult as jest.Mock).mockReturnValueOnce(true);

      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'bash-1',
        name: 'Bash',
        input: { command: 'rm -rf /' },
        status: 'running',
      }];

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'bash-1', content: 'Access denied by user approval' },
        msg
      );

      expect(msg.toolCalls[0].status).toBe('blocked');
    });
  });
});
