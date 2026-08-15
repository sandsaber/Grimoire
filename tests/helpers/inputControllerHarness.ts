import { createMockEl } from '@test/helpers/mockElement';

import type { InputControllerDeps } from '@/features/chat/controllers/InputController';
import { ChatState } from '@/features/chat/state/ChatState';
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

export function createMockDeps(overrides: Partial<InputControllerDeps> = {}): InputControllerDeps & { mockAgentService: ReturnType<typeof createMockAgentService> } {
  const state = new ChatState();
  const inputEl = createMockInputEl();
  const queueIndicatorEl = createMockEl();
  queueIndicatorEl.style.display = 'none';
  jest.spyOn(queueIndicatorEl, 'setText');
  state.queueIndicatorEl = queueIndicatorEl;

  const imageContextManager = createMockImageContextManager();
  const mockAgentService = createMockAgentService();

  return {
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
    streamController: {
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
    } as any,
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
    getSubagentManager: () => ({ resetSpawnedCount: jest.fn(), resetStreamingState: jest.fn() }) as any,
    mockAgentService,
    ...overrides,
  };
}

/**
 * Composite helper for tests that need a complete "sendable" deps setup.
 * Creates welcomeEl + fileContextManager and sets conversationId by default,
 * eliminating the repeated boilerplate in send-path tests.
 */
export function createSendableDeps(
  overrides: Partial<InputControllerDeps> = {},
  conversationId: string | null = 'conv-1',
): InputControllerDeps & { mockAgentService: ReturnType<typeof createMockAgentService> } {
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
