import { createMockEl } from '@test/helpers/mockElement';

import type { InputControllerDeps } from '@/features/chat/controllers/InputController';
import { ChatState } from '@/features/chat/state/ChatState';
import { buildAssistantResponseMetadata } from '@/features/chat/utils/assistantResponseMetadata';
import { encodeClaudeTurn } from '@/providers/claude/prompt/ClaudeTurnEncoder';

/**
 * Shared harness for tests that drive the real `InputController`.
 *
 * Extracted so the M0a contract-characterization suite can pin today's
 * controller-observable runtime behavior against the actual controller rather
 * than against a re-implementation of it.
 */

export function createMockInputEl() {
  return {
    value: '',
    focus: jest.fn(),
  } as unknown as HTMLTextAreaElement;
}

export function createMockWelcomeEl() {
  return createMockEl();
}

export function createMockFileContextManager() {
  return {
    startSession: jest.fn(),
    getCurrentNotePath: jest.fn().mockReturnValue(null),
    getAttachedFiles: jest.fn().mockReturnValue(new Set<string>()),
    shouldSendCurrentNote: jest.fn().mockReturnValue(false),
    markCurrentNoteSent: jest.fn(),
    transformContextMentions: jest.fn().mockImplementation((text: string) => text),
  };
}

export function createMockImageContextManager() {
  return {
    hasImages: jest.fn().mockReturnValue(false),
    getAttachedImages: jest.fn().mockReturnValue([]),
    clearImages: jest.fn(),
    setImages: jest.fn(),
  };
}

export async function* createMockStream(chunks: any[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

const mockMcpForEncoder = {
  extractMentions: jest.fn().mockReturnValue(new Set<string>()),
  transformMentions: jest.fn().mockImplementation((text: string) => text),
};

export function createMockAgentService() {
  return {
    providerId: 'claude',
    getCapabilities: jest.fn().mockReturnValue({
      providerId: 'claude',
      supportsPersistentRuntime: true,
      supportsNativeHistory: true,
      supportsPlanMode: true,
      supportsRewind: true,
      supportsFork: true,
      supportsProviderCommands: true,
      supportsTurnSteer: false,
      reasoningControl: 'effort',
    }),
    prepareTurn: jest.fn().mockImplementation((request: any) =>
      encodeClaudeTurn(request, mockMcpForEncoder),
    ),
    query: jest.fn(),
    steer: jest.fn().mockResolvedValue(true),
    cancel: jest.fn(),
    resetSession: jest.fn(),
    setResumeCheckpoint: jest.fn(),
    setApprovedPlanContent: jest.fn(),
    setCurrentPlanFilePath: jest.fn(),
    getApprovedPlanContent: jest.fn().mockReturnValue(null),
    clearApprovedPlanContent: jest.fn(),
    ensureReady: jest.fn().mockResolvedValue(true),
    getSessionId: jest.fn().mockReturnValue(null),
    getAuxiliaryModel: jest.fn().mockReturnValue(null),
    consumeTurnMetadata: jest.fn().mockReturnValue({}),
  };
}

export function createMockInstructionRefineService(overrides: Record<string, jest.Mock> = {}) {
  return {
    refineInstruction: jest.fn().mockResolvedValue({ success: true }),
    resetConversation: jest.fn(),
    continueConversation: jest.fn(),
    cancel: jest.fn(),
    setModelOverride: jest.fn(),
    ...overrides,
  };
}

export function createMockInstructionModeManager() {
  return { clear: jest.fn() };
}

/**
 * The tab's end of the projection path, as `InputController` needs it.
 *
 * **A stub of the collaborator, not a stand-in for the renderer.** Every
 * provider is on the projection path, so a controller with no projection
 * refuses to send at all — which would make every send test in this repository
 * assert the refusal. What this gives back is the seam: it prepares the turn
 * and calls `query` on the same mock agent the suite already configures, so the
 * assertions those tests make — about MCP options, workspace context, the model
 * override, the persisted content — keep meaning what they meant.
 *
 * It draws nothing. What a turn looks like on screen is the render target's to
 * prove, over a real coordinator, and the live harnesses'; a double that also
 * drew would be a test measuring itself.
 */
export function createMockProjectionExecution(
  agentService: () => ReturnType<typeof createMockAgentService>,
  state: { messages: any[]; addMessage(message: any): void },
  streamController: { handleStreamChunk(chunk: any, message: any): Promise<void> },
  settings: () => Record<string, unknown>,
  providerId: () => string = () => 'claude',
) {
  let assistantOrdinal = 0;
  return {
    get providerId() {
      return providerId();
    },
    conversationId: 'conv-1',
    settled: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    detach: jest.fn(),
    open: jest.fn().mockResolvedValue(undefined),
    steer: jest.fn().mockResolvedValue(true),
    send: jest.fn(async (request: any, userMessage: any, options: any = {}) => {
      const service = agentService();
      const prepared = service.prepareTurn(request);
      const persisted = { ...userMessage, content: prepared.persistedContent,
        ...(prepared.isCompact || !prepared.request?.currentNotePath
          ? {}
          : { currentNote: prepared.request.currentNotePath }) };
      state.addMessage(persisted);
      const assistantMessage = {
        id: `assistant-${++assistantOrdinal}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [],
        contentBlocks: [],
        // The same helper `tabProjectionExecution` builds it with, because the
        // metadata a surface attaches to an answer is production's, not this
        // file's.
        responseMetadata: buildAssistantResponseMetadata(providerId(), settings(), {
          model: options.queryOptions?.model,
        }),
      };
      state.addMessage(assistantMessage);
      // The history a request is encoded from excludes the turn being sent,
      // which is what the composition does by reading the conversation before
      // the coordinator appends anything.
      const history = state.messages.slice(0, -2);
      for await (const chunk of service.query(prepared, history, options.queryOptions)) {
        await streamController.handleStreamChunk(chunk, assistantMessage);
      }
      return {
        userMessage: persisted,
        ticket: {
          started: Promise.resolve({ runId: `run-${assistantOrdinal}` }),
          completion: Promise.resolve({
            assistantMessageId: assistantMessage.id,
            terminal: { kind: 'succeeded', reason: 'completed' },
          }),
        },
      };
    }),
  };
}

export function createMockDeps(overrides: Partial<InputControllerDeps> = {}): InputControllerDeps
  & { mockAgentService: ReturnType<typeof createMockAgentService> }
  & { mockProjection: ReturnType<typeof createMockProjectionExecution> } {
  const state = new ChatState();
  const inputEl = createMockInputEl();
  const queueIndicatorEl = createMockEl();
  queueIndicatorEl.style.display = 'none';
  jest.spyOn(queueIndicatorEl, 'setText');
  state.queueIndicatorEl = queueIndicatorEl;

  const imageContextManager = createMockImageContextManager();
  const mockAgentService = createMockAgentService();
  const streamController = {
    showThinkingIndicator: jest.fn(),
    hideThinkingIndicator: jest.fn(),
    flushPendingToolsForPermission: jest.fn(),
    handleStreamChunk: jest.fn(),
    finalizeProgressBlocks: jest.fn(),
    finalizeCurrentTextBlock: jest.fn(),
    finalizeCurrentThinkingBlock: jest.fn(),
    appendText: jest.fn(),
    startTurnSilenceIndicator: jest.fn(),
    noteTurnActivity: jest.fn(),
    pauseTurnSilenceIndicator: jest.fn(),
    stopTurnSilenceIndicator: jest.fn(),
  };
  // Built after the deps exist, and reading through them: a suite that
  // overrides `getAgentService` — several do, to watch a *different* mock —
  // would otherwise be sending its turns to the one captured here.
  const projection = createMockProjectionExecution(
    () => (result.getAgentService?.() ?? mockAgentService) as ReturnType<typeof createMockAgentService>,
    state,
    streamController,
    () => (result.getActiveProviderSettings?.() ?? result.plugin.settings) as Record<string, unknown>,
    () => (result.getAgentService?.()?.providerId as string) ?? 'claude',
  );

  const result: any = {
    plugin: {
      saveSettings: jest.fn(),
      settings: {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: true },
        },
        permissionMode: 'full_access',
        enableAutoTitleGeneration: true,
      },
      mcpManager: {
        extractMentions: jest.fn().mockReturnValue(new Set()),
        transformMentions: jest.fn().mockImplementation((text: string) => text),
      },
      renameConversation: jest.fn(),
      updateConversation: jest.fn(),
      getConversationSync: jest.fn().mockReturnValue(null),
      getConversationById: jest.fn().mockResolvedValue(null),
      createConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    } as any,
    state,
    renderer: {
      addMessage: jest.fn().mockReturnValue({
        querySelector: jest.fn().mockReturnValue(createMockEl()),
      }),
      refreshActionButtons: jest.fn(),
      removeMessage: jest.fn(),
      updateLiveUserMessage: jest.fn(),
      updateMessageCompletionTime: jest.fn(),
    } as any,
    streamController: streamController as any,
    selectionController: {
      getContext: jest.fn().mockReturnValue(null),
    } as any,
    canvasSelectionController: {
      getContext: jest.fn().mockReturnValue(null),
    } as any,
    conversationController: {
      save: jest.fn(),
      generateFallbackTitle: jest.fn().mockReturnValue('Test Title'),
      updateHistoryDropdown: jest.fn(),
      clearTerminalSubagentsFromMessages: jest.fn(),
    } as any,
    getInputEl: () => inputEl,
    getInputContainerEl: () => createMockEl(),
    getWelcomeEl: () => null,
    getMessagesEl: () => createMockEl(),
    getFileContextManager: () => ({
      startSession: jest.fn(),
      getCurrentNotePath: jest.fn().mockReturnValue(null),
      getAttachedFiles: jest.fn().mockReturnValue(new Set<string>()),
      shouldSendCurrentNote: jest.fn().mockReturnValue(false),
      markCurrentNoteSent: jest.fn(),
      transformContextMentions: jest.fn().mockImplementation((text: string) => text),
    }) as any,
    getImageContextManager: () => imageContextManager as any,
    getMcpServerSelector: () => null,
    getExternalContextSelector: () => null,
    getInstructionModeManager: () => null,
    getInstructionRefineService: () => null,
    getTitleGenerationService: () => null,
    getStatusPanel: () => null,
    generateId: () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    resetInputHeight: jest.fn(),
    getAgentService: () => mockAgentService as any,
    getProjectionExecution: () => projection as any,
    getSubagentManager: () => ({ resetSpawnedCount: jest.fn(), resetStreamingState: jest.fn() }) as any,
    mockAgentService,
    mockProjection: projection,
    ...overrides,
  };
  return result;
}

/**
 * Composite helper for tests that need a complete "sendable" deps setup.
 * Creates welcomeEl + fileContextManager and sets conversationId by default,
 * eliminating the repeated boilerplate in send-path tests.
 */
export function createSendableDeps(
  overrides: Partial<InputControllerDeps> = {},
  conversationId: string | null = 'conv-1',
): InputControllerDeps
  & { mockAgentService: ReturnType<typeof createMockAgentService> }
  & { mockProjection: ReturnType<typeof createMockProjectionExecution> } {
  const welcomeEl = createMockWelcomeEl();
  const fileContextManager = createMockFileContextManager();
  const result = createMockDeps({
    getWelcomeEl: () => welcomeEl,
    getFileContextManager: () => fileContextManager as any,
    ...overrides,
  });
  if (conversationId !== null) {
    result.state.currentConversationId = conversationId;
  }
  return result;
}
