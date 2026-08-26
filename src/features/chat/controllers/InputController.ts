import { Notice, setIcon } from 'obsidian';

import type { ChatTabExecution } from '../../../app/chat/ChatTabExecution';
import {
  type BuiltInCommand,
  detectBuiltInCommand,
  isBuiltInCommandSupported,
} from '../../../core/commands/builtInCommands';
import {
  isPathInExcludedFolder,
  normalizeExcludedFolders,
} from '../../../core/context/exclusions';
import { tokenizeSearchText } from '../../../core/context/text';
import type { ProjectWorkspace } from '../../../core/context/types';
import type { VaultSearchService } from '../../../core/context/VaultSearchService';
import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type InstructionRefineService,
  type ProviderCapabilities,
  type ProviderId,
  type TitleGenerationService,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import { normalizeProviderError } from '../../../core/runtime/providerError';
import {
  cloneChatTurnRequest,
  mergeQueuedChatTurns,
  type QueuedChatTurn,
} from '../../../core/runtime/QueuedTurn';
import type {
  ApprovalCallbackOptions,
  ApprovalDecisionOption,
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
} from '../../../core/runtime/types';
import { isTrustedReadOnlyMcpTool } from '../../../core/tools/mcpTrust';
import { TOOL_BASH } from '../../../core/tools/toolNames';
import type { ApprovalDecision, ChatMessage, ExitPlanModeDecision, StreamChunk } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { ResumeSessionDropdown } from '../../../shared/components/ResumeSessionDropdown';
import { InstructionModal } from '../../../shared/modals/InstructionConfirmModal';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import { formatDurationMmSs } from '../../../utils/date';
import type { EditorSelectionContext } from '../../../utils/editor';
import { splitContextPaths } from '../../../utils/externalContext';
import { appendMarkdownSnippet } from '../../../utils/markdown';
import { COMPLETION_FLAVOR_WORDS } from '../constants';
import { buildImageGenerationPrompt } from '../imageGeneration';
import { InlineAskUserQuestion } from '../rendering/InlineAskUserQuestion';
import { InlineExitPlanMode } from '../rendering/InlineExitPlanMode';
import { InlinePermissionRequest } from '../rendering/InlinePermissionRequest';
import { InlinePlanApproval,type PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { getToolSummary } from '../rendering/ToolCallRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import { TurnFeedbackMetrics } from '../services/TurnFeedbackMetrics';
import type { ChatState } from '../state/ChatState';
import type { QueuedMessage } from '../state/types';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';
import type { InstructionModeManager } from '../ui/InstructionModeManager';
import type { StatusPanel } from '../ui/StatusPanel';
import { buildAssistantResponseMetadata } from '../utils/assistantResponseMetadata';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import type { ConversationController } from './ConversationController';
import type { SelectionController } from './SelectionController';
import type { StreamController } from './StreamController';

const DEFAULT_APPROVAL_DECISION_OPTIONS: ApprovalDecisionOption[] = [
  { label: 'Allow once', value: 'Allow once', decision: 'allow' },
  { label: 'Always allow', value: 'Always allow', decision: 'allow-always' },
  { label: 'Deny', value: 'Deny', decision: 'deny' },
];

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class ProjectWorkspaceRoutingError extends Error {}

export interface InputControllerDeps {
  plugin: GrimoirePlugin;
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  conversationController: ConversationController;
  getInputEl: () => HTMLTextAreaElement;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getScrollEl?: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  getInstructionModeManager: () => InstructionModeManager | null;
  getInstructionRefineService: () => InstructionRefineService | null;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getInputContainerEl: () => HTMLElement;
  generateId: () => string;
  resetInputHeight: () => void;
  getAuxiliaryModel?: () => string | null;
  getAgentService?: () => ChatRuntime | null;
  /**
   * This tab's end of the projection execution path, where it has one.
   *
   * Read late and absent for every provider not on that path, which is what
   * makes the branch below a per-provider flip rather than a rewrite: a tab
   * without one runs the generator loop exactly as it always has.
   */
  getProjectionExecution?: () => ChatTabExecution | null;
  getSubagentManager: () => SubagentManager;
  /** Tab-level provider fallback for blank tabs (derived from draft model). */
  getTabProviderId?: () => ProviderId;
  /** Tab-level provider settings snapshot, including draft model/effort for blank tabs. */
  getActiveProviderSettings?: () => Record<string, unknown>;
  refreshPlanUsage?: () => void;
  /** Tab-level orchestrator mode toggle. */
  getOrchestratorMode?: () => boolean;
  /** Returns true if ready. */
  ensureServiceInitialized?: () => Promise<boolean>;
  openConversation?: (conversationId: string) => Promise<void>;
  onForkAll?: () => Promise<void>;
  restorePrePlanPermissionModeIfNeeded?: () => void;
  getVaultSearchService?: () => VaultSearchService | null;
  getActiveProjectWorkspace?: () => ProjectWorkspace | null;
  applyProjectWorkspaceRouting?: (routing: { providerId: ProviderId; model?: string }) => Promise<ProviderId>;
}

type ContextEngineSettings = {
  vaultSearchEnabled?: boolean;
  vaultSearchMaxResults?: number;
  vaultSearchMaxSnippetChars?: number;
};

type TurnSubmission = {
  displayContent: string;
  turnRequest: ChatTurnRequest;
};

function mergeExternalContextPaths(...pathLists: Array<string[] | undefined>): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const paths of pathLists) {
    for (const path of paths ?? []) {
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}

function mergeContextFiles(...pathLists: Array<string[] | undefined>): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const paths of pathLists) {
    for (const path of paths ?? []) {
      const normalized = path.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
    }
  }
  return merged;
}

function filterProjectWorkspace(
  workspace: ProjectWorkspace,
  excludedFolders: string[],
): ProjectWorkspace {
  if (excludedFolders.length === 0) {
    return workspace;
  }

  return {
    ...workspace,
    vaultFolders: workspace.vaultFolders.filter(
      (folder) => !isPathInExcludedFolder(folder, excludedFolders),
    ),
    vaultFiles: workspace.vaultFiles.filter(
      (file) => !isPathInExcludedFolder(file, excludedFolders),
    ),
  };
}

function normalizeWorkspaceSetting(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export class InputController {
  private deps: InputControllerDeps;
  private pendingApprovalInline: InlineAskUserQuestion | InlinePermissionRequest | null = null;
  private pendingAskInline: InlineAskUserQuestion | null = null;
  private pendingExitPlanModeInline: InlineExitPlanMode | null = null;
  private pendingPlanApproval: InlinePlanApproval | null = null;
  private pendingPlanApprovalInvalidated = false;
  private activeResumeDropdown: ResumeSessionDropdown | null = null;
  private inputContainerHideDepth = 0;
  private steerInFlight = false;
  private pendingSteerMessage: QueuedMessage | null = null;
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  private pendingProviderUserMessages: Array<{
    displayContent: string;
    persistedContent?: string;
    currentNote?: string;
    images?: ChatMessage['images'];
    vaultSearchContext?: ChatMessage['vaultSearchContext'];
  }> = [];
  private sawInitialProviderUserMessage = false;
  private awaitingProviderAssistantStart = false;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  private getAuxiliaryModel(): string | null {
    return this.deps.getAuxiliaryModel?.()
      ?? this.getAgentService()?.getAuxiliaryModel?.()
      ?? null;
  }

  private syncInstructionRefineModelOverride(
    instructionRefineService: InstructionRefineService,
  ): void {
    instructionRefineService.setModelOverride?.(this.getAuxiliaryModel() ?? undefined);
  }

  private getActiveProviderId(): ProviderId {
    const agentService = this.getAgentService();
    const conversationId = this.deps.state.currentConversationId;
    if (!conversationId) {
      return this.deps.getTabProviderId?.() ?? agentService?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    }

    if (agentService?.providerId) {
      return agentService.providerId;
    }

    return this.deps.plugin.getConversationSync(conversationId)?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
  }

  private getActiveCapabilities(): ProviderCapabilities {
    const providerId = this.getActiveProviderId();
    const agentService = this.getAgentService();
    if (agentService?.providerId === providerId) {
      return agentService.getCapabilities();
    }

    return providerCatalog().capabilities(providerId);
  }

  private isResumeSessionAtStillNeeded(resumeUuid: string, previousMessages: ChatMessage[]): boolean {
    for (let i = previousMessages.length - 1; i >= 0; i--) {
      if (previousMessages[i].role === 'assistant' && previousMessages[i].assistantMessageId === resumeUuid) {
        // Still needed only if no messages follow the resume point
        return i === previousMessages.length - 1;
      }
    }
    return false;
  }

  // ============================================
  // Message Sending
  // ============================================

  async sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
    content?: string;
    displayContentOverride?: string;
    images?: ChatMessage['images'];
    skipBuiltInCommandDetection?: boolean;
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<void> {
    const {
      plugin,
      state,
      renderer,
      streamController,
      selectionController,
      browserSelectionController,
      canvasSelectionController,
      conversationController
    } = this.deps;

    // During conversation creation/switching, don't send - input is preserved so user can retry
    if (state.isCreatingConversation || state.isSwitchingConversation) return;

    const inputEl = this.deps.getInputEl();
    const imageContextManager = this.deps.getImageContextManager();
    const fileContextManager = this.deps.getFileContextManager();

    const contentOverride = options?.content;
    const shouldUseInput = contentOverride === undefined;
    const content = (contentOverride ?? inputEl.value).trim();
    const displayContentOverride = options?.displayContentOverride?.trim();
    const imageOverride = options?.images;
    const hasImages = imageOverride !== undefined
      ? imageOverride.length > 0
      : (imageContextManager?.hasImages() ?? false);
    if (!content && !hasImages) return;

    plugin.recordDebugLog?.({
      data: {
        hasImages,
        isProgrammatic: !shouldUseInput,
        providerId: this.getActiveProviderId(),
        state: state.isStreaming ? 'streaming' : 'idle',
      },
      event: 'send.requested',
      level: 'debug',
      scope: 'chat',
    });

    // Check for built-in commands first (e.g., /clear, /new, /add-dir)
    const builtInCmd = options?.skipBuiltInCommandDetection
      ? null
      : detectBuiltInCommand(content);
    if (builtInCmd) {
      if (shouldUseInput) {
        inputEl.value = '';
        this.deps.resetInputHeight();
      }
      await this.executeBuiltInCommand(builtInCmd.command, builtInCmd.args);
      return;
    }

    // If agent is working, queue the message instead of dropping it
    if (state.isStreaming) {
      const images = hasImages
        ? [...(imageOverride ?? imageContextManager?.getAttachedImages() ?? [])]
        : undefined;
      const editorContext = selectionController.getContext();
      const browserContext = browserSelectionController?.getContext() ?? null;
      const canvasContext = canvasSelectionController.getContext();
      const queuedTurnSubmission = this.buildTurnSubmission({
        content,
        images,
        displayContentOverride,
        editorContextOverride: editorContext,
        browserContextOverride: browserContext,
        canvasContextOverride: canvasContext,
      });
      const { displayContent, turnRequest } = queuedTurnSubmission instanceof Promise
        ? await queuedTurnSubmission
        : queuedTurnSubmission;
      state.queuedMessage = this.mergeQueuedMessages(
        state.queuedMessage,
        this.createQueuedMessage(displayContent, turnRequest),
      );
      plugin.recordDebugLog?.({
        data: {
          hasImages,
          providerId: this.getActiveProviderId(),
        },
        event: 'send.queued',
        level: 'debug',
        scope: 'chat',
      });

      if (shouldUseInput) {
        inputEl.value = '';
        this.deps.resetInputHeight();
      }
      if (shouldUseInput) {
        imageContextManager?.clearImages();
      }
      this.updateQueueIndicator();
      return;
    }

    if (shouldUseInput) {
      inputEl.value = '';
      this.deps.resetInputHeight();
    }
    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false; // Allow usage updates for new query
    this.deps.getSubagentManager().resetSpawnedCount();
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true; // Reset auto-scroll based on setting
    const streamGeneration = state.bumpStreamGeneration();

    // Hide welcome message when sending first message
    const welcomeEl = this.deps.getWelcomeEl();
    if (welcomeEl) {
      welcomeEl.addClass('grimoire-hidden');
    }

    fileContextManager?.startSession();

    // Slash commands are passed directly to SDK for handling
    // SDK handles expansion, $ARGUMENTS, @file references, and frontmatter options
    const images = imageOverride ?? imageContextManager?.getAttachedImages() ?? [];
    const imagesForMessage = images.length > 0 ? [...images] : undefined;
    const isCompact = /^\/compact(\s|$)/i.test(content);
    plugin.recordDebugLog?.({
      data: {
        imageCount: images.length,
        mode: isCompact ? 'compact' : 'turn',
        providerId: this.getActiveProviderId(),
      },
      event: 'send.started',
      level: 'info',
      scope: 'chat',
    });

    // Only clear images if we consumed user input (not for programmatic content override)
    if (shouldUseInput) {
      imageContextManager?.clearImages();
    }

    let turnSubmission: TurnSubmission;
    let queryOptions: ChatRuntimeQueryOptions | undefined;
    try {
      const turnSubmissionResult = options?.turnRequestOverride
        ? {
          displayContent: content,
          turnRequest: cloneChatTurnRequest(options.turnRequestOverride),
        }
        : this.buildTurnSubmission({
          content,
          images: imagesForMessage,
          displayContentOverride,
          editorContextOverride: options?.editorContextOverride,
          browserContextOverride: options?.browserContextOverride,
          canvasContextOverride: options?.canvasContextOverride,
        });
      turnSubmission = turnSubmissionResult instanceof Promise
        ? await turnSubmissionResult
        : turnSubmissionResult;
      const queryOptionsResult = this.resolveProjectWorkspaceQueryOptions(turnSubmission.turnRequest);
      const workspaceQueryOptions = queryOptionsResult instanceof Promise
        ? await queryOptionsResult
        : queryOptionsResult;
      const activeModel = this.deps.getActiveProviderSettings?.().model;
      queryOptions = {
        ...workspaceQueryOptions,
        model: workspaceQueryOptions?.model ?? (typeof activeModel === 'string' ? activeModel : undefined),
      };
    } catch (error) {
      state.isStreaming = false;
      if (shouldUseInput) {
        inputEl.value = content;
        this.deps.resetInputHeight();
        imageContextManager?.setImages(imagesForMessage ?? []);
      }
      if (error instanceof ProjectWorkspaceRoutingError) {
        new Notice(error.message);
        return;
      }
      throw error;
    }
    const { displayContent, turnRequest } = turnSubmission;

    fileContextManager?.markCurrentNoteSent();

    const userCompletedAt = Date.now();
    // Reassigned on the projection path once the turn is durable, so the block
    // that runs after a turn ends writes to the messages that are on screen and
    // in the vault rather than to the copies this method built.
    let userMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'user',
      content: displayContent,
      displayContent,                // Original user input (for UI display)
      timestamp: userCompletedAt,
      completedAt: userCompletedAt,
      images: imagesForMessage,
      vaultSearchContext: turnRequest.vaultSearchContext,
    };
    const projection = this.deps.getProjectionExecution?.() ?? null;
    if (!projection) {
      state.addMessage(userMsg);
      renderer.addMessage(userMsg);
    }
    state.hasPendingConversationSave = true;

    await this.triggerTitleGeneration(projection ? userMsg : undefined);

    let assistantMsg = this.createAssistantMessage(queryOptions);
    if (!projection) {
      // On the projection path both messages arrive from the projection: the
      // question when the coordinator has made it durable, and the answer as a
      // turn the target opens. Adding them here would draw each of them twice —
      // and the question would be drawn before it was recorded, which is the
      // one thing the barrier exists to stop being possible.
      state.addMessage(assistantMsg);
      this.activeStreamingAssistantMessage = assistantMsg;
      this.activateStreamingAssistantMessage(assistantMsg);
    }
    this.pendingProviderUserMessages = [{
      displayContent,
      images: imagesForMessage,
      vaultSearchContext: turnRequest.vaultSearchContext,
    }];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = true;

    streamController.showThinkingIndicator(
      isCompact ? 'Compacting...' : undefined,
      isCompact ? 'grimoire-thinking--compact' : undefined,
    );
    state.responseStartTime = performance.now();
    const feedbackMetrics = new TurnFeedbackMetrics(state.responseStartTime);

    let wasInterrupted = false;
    let wasInvalidated = false;
    let didEnqueueToSdk = false;
    let planCompleted = false;

    // Lazy initialization: ensure service is ready before first query
    if (this.deps.ensureServiceInitialized) {
      const ready = await this.deps.ensureServiceInitialized();
      if (!ready) {
        new Notice(t('chat.ui.errors.initializeAgentFailed'));
        streamController.hideThinkingIndicator();
        streamController.stopTurnSilenceIndicator();
        state.isStreaming = false;
        this.activeStreamingAssistantMessage = null;
        this.resetProviderMessageBoundaryState();
        return;
      }
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      new Notice(t('chat.ui.errors.agentUnavailable'));
      streamController.hideThinkingIndicator();
      streamController.stopTurnSilenceIndicator();
      state.isStreaming = false;
      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
      return;
    }

    // Restore pendingResumeAt from persisted conversation state (survives plugin reload)
    const conversationIdForSend = state.currentConversationId;
    // What this turn continues, for the path that has to pass it rather than
    // leave it on the runtime's session. Read from the same conversation the
    // legacy path reads, so the two cannot answer differently.
    let resumeCheckpoint: string | undefined;
    let nativeSessionRef: string | undefined;
    if (conversationIdForSend) {
      const conv = plugin.getConversationSync(conversationIdForSend);
      nativeSessionRef = conv?.sessionId ?? undefined;
      if (conv?.resumeAtMessageId) {
        // Whether the checkpoint still names something in the transcript, read
        // from the transcript that *has* it. `state.messages` is the surface's,
        // and on the projection path the surface has not drawn this turn's
        // messages yet — so reading it there answers "no" for every checkpoint
        // and clears one that was perfectly good.
        const transcript = projection ? conv.messages ?? [] : state.messages.slice(0, -2);
        if (this.isResumeSessionAtStillNeeded(conv.resumeAtMessageId, transcript)) {
          resumeCheckpoint = conv.resumeAtMessageId;
          agentService.setResumeCheckpoint(conv.resumeAtMessageId);
        } else {
          try {
            await plugin.updateConversation(conversationIdForSend, { resumeAtMessageId: undefined });
          } catch {
            // Best-effort — don't block send
          }
        }
      }
    }

    streamController.startTurnSilenceIndicator(this.getActiveProviderId());

    try {
      if (projection) {
        // The turn goes to the kernel and comes back as a projection: the
        // coordinator makes the question durable, dispatches the run, and the
        // attachment draws every part of it. What is awaited here is the turn
        // being *finished*, which is what the block below this one is written
        // against — everything it does after a turn ends still applies.
        // The session this conversation continues and the checkpoint this turn
        // resumes at both travel with the command. On the legacy path they are
        // held on the runtime's own session, which this path does not go
        // through — so a turn sent without them opens a *new* provider session
        // and abandons the conversation's thread.
        const submitted = await projection.send(turnRequest, userMsg, {
          queryOptions,
          ...(nativeSessionRef ? { nativeSessionRef } : {}),
          ...(resumeCheckpoint ? { resumeCheckpoint } : {}),
        });
        userMsg.content = submitted.userMessage.content;
        userMsg.currentNote = submitted.userMessage.currentNote;
        const completed = await submitted.ticket.completion;
        didEnqueueToSdk = completed.terminal.kind !== 'invalidated';
        wasInterrupted = completed.terminal.kind === 'cancelled';
        planCompleted = completed.planCompleted === true;
        // The messages the projection drew and the barrier stored are the ones
        // everything after a turn writes to: the native identities a rewind
        // addresses, the completion time, the duration footer. Written to the
        // copies this method built, all of that would be thrown away with them.
        userMsg = findMessage(state.messages, userMsg.id) ?? userMsg;
        assistantMsg = findMessage(state.messages, completed.assistantMessageId) ?? assistantMsg;
        this.activeStreamingAssistantMessage = assistantMsg;
        return;
      }
      const preparedTurn = agentService.prepareTurn(turnRequest);
      userMsg.content = preparedTurn.persistedContent;
      userMsg.currentNote = preparedTurn.isCompact
        ? undefined
        : preparedTurn.request.currentNotePath;

      // Pass history WITHOUT current turn (userMsg + assistantMsg we just added)
      // This prevents duplication when rebuilding context for new sessions
      const previousMessages = state.messages.slice(0, -2);
      for await (const chunk of agentService.query(preparedTurn, previousMessages, queryOptions)) {
        streamController.noteTurnActivity();
        if (state.streamGeneration !== streamGeneration) {
          wasInvalidated = true;
          break;
        }
        if (state.cancelRequested) {
          wasInterrupted = true;
          break;
        }

        feedbackMetrics.observe(chunk, performance.now());

        if (await this.handleProviderMessageBoundaryChunk(chunk)) {
          continue;
        }

        await streamController.handleStreamChunk(
          chunk,
          this.activeStreamingAssistantMessage ?? assistantMsg,
        );
      }
    } catch (error) {
      plugin.recordDebugLog?.({
        data: {
          providerId: this.getActiveProviderId(),
        },
        error,
        event: 'send.failed',
        level: 'warn',
        scope: 'chat',
      });
      const rawErrorMessage = error instanceof Error ? error.message : 'Unknown error';
      const providerId = this.getActiveProviderId();
      const errorMsg = normalizeProviderError(
        rawErrorMessage,
        providerCatalog().displayName(providerId),
      ).message;
      await streamController.appendText(
        `\n\n**${t('chat.ui.messages.errorLabel')}:** ${errorMsg}`,
      );
    } finally {
      streamController.stopTurnSilenceIndicator();
      const finalAssistantMsg = this.activeStreamingAssistantMessage ?? assistantMsg;
      const turnMetadata = agentService.consumeTurnMetadata();
      userMsg.userMessageId = turnMetadata.userMessageId ?? userMsg.userMessageId;
      finalAssistantMsg.assistantMessageId = turnMetadata.assistantMessageId ?? finalAssistantMsg.assistantMessageId;
      didEnqueueToSdk = didEnqueueToSdk || turnMetadata.wasSent === true;
      planCompleted = planCompleted || turnMetadata.planCompleted === true;
      plugin.recordDebugLog?.({
        data: {
          didEnqueueToSdk,
          planCompleted,
          providerId: this.getActiveProviderId(),
          wasInterrupted,
          wasInvalidated,
        },
        event: 'send.finished',
        level: 'debug',
        scope: 'chat',
      });
      plugin.recordDebugLog?.({
        data: {
          providerId: this.getActiveProviderId(),
          ...feedbackMetrics.finish(performance.now()),
        },
        event: 'turn.feedback_metrics',
        level: 'debug',
        scope: 'chat.feedback',
      });

      // ALWAYS clear the timer interval, even on stream invalidation (prevents memory leaks)
      state.clearFlavorTimerInterval();

      // Skip remaining cleanup if stream was invalidated (tab closed or conversation switched)
      if (!wasInvalidated && state.streamGeneration === streamGeneration) {
        const didCancelThisTurn = wasInterrupted || state.cancelRequested;
        if (didCancelThisTurn) {
          await streamController.appendText(
            `\n\n<span class="grimoire-interrupted">${t('chat.ui.messages.interrupted')}</span> `
            + `<span class="grimoire-interrupted-hint">${t('chat.ui.messages.interruptedHint')}</span>`,
          );
        }
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        state.cancelRequested = false;
        this.restorePendingSteerMessageToQueue();

        // Capture response duration before resetting state (skip for interrupted responses and compaction)
        const hasCompactBoundary = finalAssistantMsg.contentBlocks?.some(b => b.type === 'context_compacted');
        if (!didCancelThisTurn && !hasCompactBoundary) {
          const durationSeconds = state.responseStartTime
            ? Math.floor((performance.now() - state.responseStartTime) / 1000)
            : 0;
          if (durationSeconds > 0) {
            const flavorWord =
              COMPLETION_FLAVOR_WORDS[Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)];
            finalAssistantMsg.durationSeconds = durationSeconds;
            finalAssistantMsg.durationFlavorWord = flavorWord;
            // Add footer to live message in DOM
            if (state.currentContentEl) {
              const footerEl = state.currentContentEl.createDiv({ cls: 'grimoire-response-footer' });
              footerEl.createSpan({
                text: `* ${flavorWord} for ${formatDurationMmSs(durationSeconds)}`,
                cls: 'grimoire-baked-duration',
              });
            }
          }
        }

        await streamController.finalizeProgressBlocks(
          finalAssistantMsg,
          didCancelThisTurn ? 'blocked' : 'completed',
        );
        await streamController.finalizeCurrentThinkingBlock(finalAssistantMsg);
        await streamController.finalizeCurrentTextBlock(finalAssistantMsg);
        finalAssistantMsg.completedAt = Date.now();
        renderer.updateMessageCompletionTime(finalAssistantMsg);
        state.currentContentEl = null;
        this.deps.getSubagentManager().resetStreamingState();

        // Auto-hide completed todo panel on response end
        // Panel reappears only when new TodoWrite tool is called
        if (state.currentTodos && state.currentTodos.every(t => t.status === 'completed')) {
          state.currentTodos = null;
        }
        this.syncScrollToBottomAfterRenderUpdates();

        // Provider-agnostic post-plan approval: show UI and await decision before save/auto-send
        let planAutoSendContent: string | null = null;
        let planApprovalInvalidated = false;
        let shouldProcessQueuedMessage = true;
        if (planCompleted && !didCancelThisTurn) {
          const { decision, invalidated } = await this.showPlanApproval();

          // Re-check invalidation after async approval prompt
          if (state.streamGeneration !== streamGeneration || invalidated) {
            planApprovalInvalidated = true;
          } else if (decision?.type === 'implement') {
            this.deps.restorePrePlanPermissionModeIfNeeded?.();
            planAutoSendContent = 'Implement the plan.';
          } else if (decision?.type === 'revise') {
            // Keep plan mode active, populate input with feedback text
            this.deps.getInputEl().value = decision.text;
            shouldProcessQueuedMessage = false;
          } else {
            // cancel or null (dismissed)
            this.deps.restorePrePlanPermissionModeIfNeeded?.();
          }
        }

        if (!planApprovalInvalidated) {
          // Only clear resumeAtMessageId if enqueue succeeded; preserve checkpoint on failure for retry
          const saveExtras = didEnqueueToSdk ? { resumeAtMessageId: undefined } : undefined;
          await conversationController.save(true, saveExtras);
          this.deps.refreshPlanUsage?.();

          const userMsgIndex = state.messages.indexOf(userMsg);
          renderer.refreshActionButtons(userMsg, state.messages, userMsgIndex >= 0 ? userMsgIndex : undefined);

          // Auto-implement takes precedence over queued input
          if (planAutoSendContent) {
            this.deps.getInputEl().value = planAutoSendContent;
            this.sendMessage().catch(() => {});
          } else {
            if (shouldProcessQueuedMessage) {
              this.processQueuedMessage();
            }
          }
        }
      }

      if (wasInvalidated) {
        this.clearPendingSteerState();
        this.updateQueueIndicator();
      }

      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
    }
  }

  // ============================================
  // Queue Management
  // ============================================

  updateQueueIndicator(): void {
    const { state } = this.deps;
    const indicatorEl = state.queueIndicatorEl;
    if (!indicatorEl) return;

    indicatorEl.empty();

    const visibleQueuedMessage = state.queuedMessage ?? this.pendingSteerMessage;
    if (visibleQueuedMessage) {
      const isPendingSteerOnly = !state.queuedMessage && !!this.pendingSteerMessage;
      indicatorEl.createSpan({
        cls: 'grimoire-queue-indicator-text',
        text: `⌙ ${isPendingSteerOnly
          ? t('chat.ui.messages.steeringPrefix')
          : t('chat.ui.messages.queuedPrefix')}: ${this.getQueuedMessageDisplay(visibleQueuedMessage)}`,
      });

      if (state.queuedMessage) {
        const actionsEl = indicatorEl.createDiv({ cls: 'grimoire-queue-indicator-actions' });

        if (this.canSteerQueuedMessage()) {
          const steerButton = actionsEl.createEl('button', {
            cls: 'grimoire-queue-indicator-action',
            text: this.steerInFlight ? t('chat.ui.queue.steering') : t('chat.ui.queue.steerNow'),
          });
          steerButton.setAttribute('type', 'button');
          if (this.steerInFlight) {
            steerButton.setAttribute('disabled', 'true');
          } else {
            steerButton.addEventListener('click', (event) => {
              event.stopPropagation();
              void this.steerQueuedMessage();
            });
          }
        }

        const editButton = this.createQueueIconButton(
          actionsEl,
          'pencil',
          'Edit queued message',
        );
        editButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.withdrawQueuedMessageToComposer();
        });

        const discardButton = this.createQueueIconButton(
          actionsEl,
          'trash-2',
          'Discard queued message',
        );
        discardButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.clearQueuedMessage();
        });
      }

      indicatorEl.addClass('grimoire-visible-flex');
      indicatorEl.removeClass('grimoire-hidden');
      return;
    }

    indicatorEl.removeClass('grimoire-visible-flex');
    indicatorEl.addClass('grimoire-hidden');
  }

  clearQueuedMessage(): void {
    const { state } = this.deps;
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  withdrawQueuedMessageToComposer(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.restoreMessageToInput(queuedMessage, { mergeWithComposer: true });
    this.updateQueueIndicator();
  }

  private restoreMessageToInput(
    message: QueuedMessage | null,
    options: { mergeWithComposer?: boolean } = {},
  ): void {
    if (!message) return;

    const { content, images } = message;
    const inputEl = this.deps.getInputEl();
    const currentContent = options.mergeWithComposer ? inputEl.value.trim() : '';
    inputEl.value = currentContent
      ? appendMarkdownSnippet(content, currentContent)
      : content;

    const imageContextManager = this.deps.getImageContextManager();
    const currentImages = options.mergeWithComposer
      ? (imageContextManager?.getAttachedImages() ?? [])
      : [];
    const restoredImages = [...(images ?? []), ...currentImages];
    if (restoredImages.length > 0) {
      imageContextManager?.setImages(restoredImages);
    }
    this.deps.resetInputHeight();
    inputEl.focus();
  }

  private restorePendingMessagesToInput(): void {
    const { state } = this.deps;
    const combinedMessage = this.mergePendingMessages(
      this.pendingSteerMessage,
      state.queuedMessage,
    );
    this.restoreMessageToInput(combinedMessage, { mergeWithComposer: true });
    state.queuedMessage = null;
    this.clearPendingSteerState();
    this.updateQueueIndicator();
  }

  private processQueuedMessage(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.updateQueueIndicator();
    const streamGeneration = state.streamGeneration;

    window.setTimeout(
      () => {
        if (
          state.streamGeneration !== streamGeneration
          || state.isCreatingConversation
          || state.isSwitchingConversation
          || state.isStreaming
        ) {
          return;
        }
        void this.sendMessage({
          content: queuedMessage.content,
          images: queuedMessage.images,
          skipBuiltInCommandDetection: queuedMessage.turnRequest !== undefined,
          turnRequestOverride: this.toQueuedChatTurn(queuedMessage).request,
        });
      },
      0
    );
  }

  private buildTurnSubmission(options: {
    content: string;
    displayContentOverride?: string;
    images?: ChatMessage['images'];
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
  }): TurnSubmission | Promise<TurnSubmission> {
    const {
      selectionController,
      browserSelectionController,
      canvasSelectionController,
    } = this.deps;

    const fileContextManager = this.deps.getFileContextManager();
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const externalContextSelector = this.deps.getExternalContextSelector();

    const currentNotePath = fileContextManager?.getCurrentNotePath() || null;
    const shouldSendCurrentNote = fileContextManager?.shouldSendCurrentNote(currentNotePath) ?? false;

    const editorContext = options.editorContextOverride !== undefined
      ? options.editorContextOverride
      : selectionController.getContext();
    const browserContext = options.browserContextOverride !== undefined
      ? options.browserContextOverride
      : (browserSelectionController?.getContext() ?? null);
    const canvasContext = options.canvasContextOverride !== undefined
      ? options.canvasContextOverride
      : canvasSelectionController.getContext();

    const externalContextPaths = externalContextSelector?.getExternalContexts();
    const isCompact = /^\/compact(\s|$)/i.test(options.content);
    const excludedFolders = isCompact
      ? []
      : normalizeExcludedFolders(this.deps.plugin.settings.excludedFolders ?? []);
    const filteredEditorContext = editorContext
      && isPathInExcludedFolder(editorContext.notePath, excludedFolders)
      ? null
      : editorContext;
    const filteredCanvasContext = canvasContext
      && isPathInExcludedFolder(canvasContext.canvasPath, excludedFolders)
      ? null
      : canvasContext;
    const transformedText = !isCompact && fileContextManager
      ? fileContextManager.transformContextMentions(options.content)
      : options.content;
    const enabledMcpServers = mcpServerSelector?.getEnabledServers();
    const orchestratorMode = this.deps.getOrchestratorMode?.() === true;
    const vaultSearchContext = this.buildVaultSearchContext(transformedText, isCompact);
    const activeProjectWorkspace = isCompact
      ? null
      : (this.deps.getActiveProjectWorkspace?.() ?? null);
    const filteredProjectWorkspace = activeProjectWorkspace
      ? filterProjectWorkspace(activeProjectWorkspace, excludedFolders)
      : null;
    const mergedExternalContextPaths = mergeExternalContextPaths(
      externalContextPaths,
      activeProjectWorkspace?.externalContextPaths,
    );
    const splitExternalContexts = mergedExternalContextPaths.length === 0
      ? { directories: [], files: [] }
      : splitContextPaths(mergedExternalContextPaths);
    const pinnedVaultFiles = Array.from(
      typeof fileContextManager?.getAttachedFiles === 'function'
        ? fileContextManager.getAttachedFiles()
        : [],
    )
      .filter(filePath => filePath !== currentNotePath);
    const contextFiles = mergeContextFiles(
      pinnedVaultFiles,
      splitExternalContexts.files,
    );

    const buildSubmission = (
      resolvedVaultSearchContext: ChatTurnRequest['vaultSearchContext'] | undefined,
    ): TurnSubmission => ({
      displayContent: options.displayContentOverride ?? options.content,
      turnRequest: {
        text: transformedText,
        images: options.images,
        currentNotePath: shouldSendCurrentNote
          && currentNotePath
          && !isPathInExcludedFolder(currentNotePath, excludedFolders)
          ? currentNotePath
          : undefined,
        editorSelection: filteredEditorContext,
        browserSelection: browserContext,
        canvasSelection: filteredCanvasContext,
        externalContextPaths: splitExternalContexts.directories,
        contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
        excludedFolders: excludedFolders.length > 0 ? excludedFolders : undefined,
        enabledMcpServers: enabledMcpServers && enabledMcpServers.size > 0
          ? enabledMcpServers
          : undefined,
        orchestratorMode: orchestratorMode ? true : undefined,
        vaultSearchContext: resolvedVaultSearchContext,
        projectWorkspaceContext: filteredProjectWorkspace
          ? { workspace: filteredProjectWorkspace }
          : undefined,
      },
    });

    return vaultSearchContext instanceof Promise
      ? vaultSearchContext.then(buildSubmission)
      : buildSubmission(vaultSearchContext);
  }

  private buildVaultSearchContext(
    transformedText: string,
    isCompact: boolean,
  ): ChatTurnRequest['vaultSearchContext'] | undefined | Promise<ChatTurnRequest['vaultSearchContext'] | undefined> {
    if (isCompact) {
      return undefined;
    }

    const settings = this.deps.plugin.settings as typeof this.deps.plugin.settings & {
      contextEngine?: ContextEngineSettings;
    };
    const contextEngine = settings.contextEngine;
    if (contextEngine?.vaultSearchEnabled === false) {
      return undefined;
    }

    const vaultSearchService = this.deps.getVaultSearchService?.() ?? null;
    if (!vaultSearchService) {
      return undefined;
    }

    const queryText = vaultSearchService.extractVaultQuery(transformedText);
    if (queryText === null || queryText === undefined) {
      return undefined;
    }
    const trimmedQueryText = queryText.trim();
    if (trimmedQueryText.length === 0) {
      return undefined;
    }

    return vaultSearchService.search({
        raw: trimmedQueryText,
        terms: tokenizeSearchText(trimmedQueryText),
        maxResults: contextEngine?.vaultSearchMaxResults ?? 8,
        maxSnippetChars: contextEngine?.vaultSearchMaxSnippetChars ?? 700,
        excludedTags: settings.excludedTags,
        excludedFolders: settings.excludedFolders,
      })
      .then((result) => result.snippets.length > 0
        ? { query: trimmedQueryText, snippets: result.snippets }
        : undefined)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(t('chat.vaultSearch.failed', { message }));
        throw error;
      });
  }

  private resolveProjectWorkspaceQueryOptions(
    request: ChatTurnRequest,
  ): ChatRuntimeQueryOptions | undefined | Promise<ChatRuntimeQueryOptions | undefined> {
    const workspace = request.projectWorkspaceContext?.workspace;
    if (!workspace) {
      return undefined;
    }

    const requestedProviderId = normalizeWorkspaceSetting(workspace.providerId);
    const requestedModel = normalizeWorkspaceSetting(workspace.model);
    if (!requestedProviderId && !requestedModel) {
      return undefined;
    }

    const settings = this.deps.plugin.settings as unknown as Record<string, unknown>;
    let targetProviderId = this.getActiveProviderId();

    if (requestedProviderId) {
      if (
        !providerCatalog().ids().includes(requestedProviderId)
        || !providerCatalog().isEnabled(settings, requestedProviderId)
      ) {
        throw new ProjectWorkspaceRoutingError(
          `Project workspace provider "${requestedProviderId}" is not enabled.`,
        );
      }
      targetProviderId = requestedProviderId;
    }

    if (requestedModel) {
      const modelProviderId = ProviderRegistry.resolveProviderForModel(requestedModel, settings, {
        onlyEnabledProviders: true,
        fallbackProviderId: targetProviderId,
      });
      if (requestedProviderId && modelProviderId !== targetProviderId) {
        throw new ProjectWorkspaceRoutingError(
          `Project workspace model "${requestedModel}" belongs to ${providerCatalog().displayName(modelProviderId)}, not ${providerCatalog().displayName(targetProviderId)}.`,
        );
      }
      targetProviderId = requestedProviderId ?? modelProviderId;
    }

    const activeProviderId = this.getActiveProviderId();
    if (targetProviderId !== activeProviderId) {
      const canRouteBlankTab = !this.deps.state.currentConversationId
        && this.deps.state.messages.length === 0
        && this.deps.applyProjectWorkspaceRouting;
      if (canRouteBlankTab) {
        return this.deps.applyProjectWorkspaceRouting!({
          providerId: targetProviderId,
          ...(requestedModel ? { model: requestedModel } : {}),
        }).then((appliedProviderId) => {
          if (appliedProviderId === targetProviderId) {
            return requestedModel ? { model: requestedModel } : undefined;
          }
          throw new ProjectWorkspaceRoutingError(
            `Project workspace uses ${providerCatalog().displayName(targetProviderId)}, but this session is bound to ${providerCatalog().displayName(activeProviderId)}. Start a new session or choose a matching workspace provider.`,
          );
        });
      }

      throw new ProjectWorkspaceRoutingError(
        `Project workspace uses ${providerCatalog().displayName(targetProviderId)}, but this session is bound to ${providerCatalog().displayName(activeProviderId)}. Start a new session or choose a matching workspace provider.`,
      );
    }

    return requestedModel ? { model: requestedModel } : undefined;
  }

  private getQueuedMessageDisplay(message: QueuedMessage | null): string {
    if (!message) {
      return '';
    }

    const rawContent = message.content.trim();
    const preview = rawContent.length > 40
      ? rawContent.slice(0, 40) + '...'
      : rawContent;
    const hasImages = (message.images?.length ?? 0) > 0;

    if (hasImages) {
      return preview ? `${preview} [images]` : '[images]';
    }

    return preview;
  }

  private createQueueIconButton(
    parentEl: HTMLElement,
    icon: string,
    label: string,
  ): HTMLElement {
    const button = parentEl.createEl('button', {
      cls: 'grimoire-queue-indicator-icon-action',
      attr: {
        'aria-label': label,
        title: label,
        type: 'button',
      },
    });
    setIcon(button, icon);
    return button;
  }

  private canSteerQueuedMessage(): boolean {
    const agentService = this.getAgentService();
    return this.deps.state.isStreaming
      && this.getActiveCapabilities().supportsTurnSteer === true
      && typeof agentService?.steer === 'function';
  }

  private cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
    return {
      ...message,
      images: message.images ? [...message.images] : undefined,
      turnRequest: message.turnRequest
        ? cloneChatTurnRequest(message.turnRequest)
        : undefined,
    };
  }

  private createQueuedMessage(displayContent: string, turnRequest: ChatTurnRequest): QueuedMessage {
    const request = cloneChatTurnRequest(turnRequest);
    return {
      content: displayContent,
      images: request.images,
      editorContext: request.editorSelection ?? null,
      browserContext: request.browserSelection ?? null,
      canvasContext: request.canvasSelection ?? null,
      turnRequest: request,
    };
  }

  private toQueuedChatTurn(message: QueuedMessage): QueuedChatTurn {
    if (message.turnRequest) {
      return {
        displayContent: message.content,
        request: cloneChatTurnRequest(message.turnRequest),
      };
    }

    return {
      displayContent: message.content,
      request: {
        text: message.content,
        images: message.images ? [...message.images] : undefined,
        editorSelection: message.editorContext,
        browserSelection: message.browserContext ?? null,
        canvasSelection: message.canvasContext,
      },
    };
  }

  private mergePendingMessages(
    first: QueuedMessage | null,
    second: QueuedMessage | null,
  ): QueuedMessage | null {
    if (first && second) {
      return this.mergeQueuedMessages(first, second);
    }

    if (first) {
      return this.cloneQueuedMessage(first);
    }

    if (second) {
      return this.cloneQueuedMessage(second);
    }

    return null;
  }

  private clearPendingSteerState(): void {
    this.pendingSteerMessage = null;
    this.steerInFlight = false;
  }

  private restorePendingSteerMessageToQueue(): void {
    if (!this.pendingSteerMessage) {
      return;
    }

    const { state } = this.deps;
    const pendingSteerMessage = this.cloneQueuedMessage(this.pendingSteerMessage);
    this.clearPendingSteerState();
    state.queuedMessage = state.queuedMessage
      ? this.mergeQueuedMessages(pendingSteerMessage, state.queuedMessage)
      : pendingSteerMessage;
    this.updateQueueIndicator();
  }

  private mergeQueuedMessages(
    existing: QueuedMessage | null,
    incoming: QueuedMessage,
  ): QueuedMessage {
    if (!existing) {
      return this.cloneQueuedMessage(incoming);
    }

    const mergedTurn = mergeQueuedChatTurns(
      this.toQueuedChatTurn(existing),
      this.toQueuedChatTurn(incoming),
    );
    return this.createQueuedMessage(mergedTurn.displayContent, mergedTurn.request);
  }

  private async steerQueuedMessage(): Promise<void> {
    if (this.steerInFlight) {
      return;
    }

    const { state } = this.deps;
    const agentService = this.getAgentService();
    if (!state.queuedMessage || !this.canSteerQueuedMessage() || !agentService?.steer) {
      return;
    }

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.pendingSteerMessage = queuedMessage;
    this.steerInFlight = true;
    this.updateQueueIndicator();

    try {
      const { displayContent, request } = this.toQueuedChatTurn(queuedMessage);

      const preparedTurn = agentService.prepareTurn(request);
      const accepted = await agentService.steer(preparedTurn);
      if (state.cancelRequested || !this.pendingSteerMessage) {
        return;
      }
      if (!accepted) {
        this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
        return;
      }

      this.deps.getFileContextManager()?.markCurrentNoteSent();

      this.pendingProviderUserMessages.push({
        displayContent,
        persistedContent: preparedTurn.persistedContent,
        currentNote: preparedTurn.isCompact
          ? undefined
          : preparedTurn.request.currentNotePath,
        images: request.images,
        vaultSearchContext: request.vaultSearchContext,
      });
    } catch {
      this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
      new Notice(t('chat.ui.queue.steerFailed'));
    }
  }

  private restoreQueuedMessageAfterSteerFailure(
    message: QueuedMessage,
  ): void {
    const { state } = this.deps;
    this.clearPendingSteerState();
    if (state.cancelRequested) {
      this.updateQueueIndicator();
      return;
    }

    if (state.isStreaming) {
      state.queuedMessage = state.queuedMessage
        ? this.mergeQueuedMessages(message, state.queuedMessage)
        : message;
      this.updateQueueIndicator();
      return;
    }

    this.restoreMessageToInput(message, { mergeWithComposer: true });
    this.updateQueueIndicator();
  }

  private activateStreamingAssistantMessage(message: ChatMessage): void {
    const { state, renderer } = this.deps;
    const msgEl = renderer.addMessage(message);
    const contentEl = msgEl.querySelector<HTMLElement>('.grimoire-message-content');

    if (!contentEl) {
      return;
    }

    if (!state.currentContentEl) {
      state.toolCallElements.clear();
    }

    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  private createAssistantMessage(queryOptions?: ChatRuntimeQueryOptions): ChatMessage {
    const settings = this.deps.getActiveProviderSettings?.()
      ?? this.deps.plugin.settings;
    return {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
      responseMetadata: buildAssistantResponseMetadata(
        this.getActiveProviderId(),
        settings,
        { model: queryOptions?.model },
      ),
    };
  }

  private resetProviderMessageBoundaryState(): void {
    this.pendingProviderUserMessages = [];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = false;
  }

  private async handleProviderMessageBoundaryChunk(chunk: StreamChunk): Promise<boolean> {
    switch (chunk.type) {
      case 'user_message_start':
        await this.handleProviderUserMessageStart(chunk);
        return true;
      case 'assistant_message_start':
        await this.handleProviderAssistantMessageStart();
        return true;
      default:
        return false;
    }
  }

  private async handleProviderUserMessageStart(
    chunk: Extract<StreamChunk, { type: 'user_message_start' }>,
  ): Promise<void> {
    const expected = this.pendingProviderUserMessages.shift();
    if (!this.sawInitialProviderUserMessage) {
      this.sawInitialProviderUserMessage = true;
      return;
    }

    this.clearPendingSteerState();
    this.updateQueueIndicator();

    const previousAssistant = this.activeStreamingAssistantMessage;
    const shouldDiscardPlaceholder = this.shouldDiscardPendingAssistantPlaceholder(previousAssistant);
    if (previousAssistant) {
      if (shouldDiscardPlaceholder) {
        this.discardStreamingAssistantMessage(previousAssistant.id);
      } else {
        await this.deps.streamController.finalizeProgressBlocks(previousAssistant);
        await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
        await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
        previousAssistant.completedAt = Date.now();
        this.deps.renderer.updateMessageCompletionTime(previousAssistant);
      }
    }
    this.deps.streamController.hideThinkingIndicator();

    const displayContent = expected?.displayContent ?? chunk.content;
    const persistedContent = expected?.persistedContent ?? displayContent;
    const images = expected?.images;
    if (displayContent || (images?.length ?? 0) > 0) {
      const userCompletedAt = Date.now();
      const userMessage: ChatMessage = {
        id: this.deps.generateId(),
        role: 'user',
        content: persistedContent,
        displayContent,
        timestamp: userCompletedAt,
        completedAt: userCompletedAt,
        currentNote: expected?.currentNote,
        images,
        vaultSearchContext: expected?.vaultSearchContext,
      };
      this.deps.state.addMessage(userMessage);
      this.deps.renderer.addMessage(userMessage);
    }

    const assistantMessage = this.createAssistantMessage();
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
    this.deps.state.responseStartTime = performance.now();
    this.awaitingProviderAssistantStart = true;
  }

  private async handleProviderAssistantMessageStart(): Promise<void> {
    if (this.awaitingProviderAssistantStart) {
      this.awaitingProviderAssistantStart = false;
      return;
    }

    const previousAssistant = this.activeStreamingAssistantMessage;
    if (previousAssistant) {
      await this.deps.streamController.finalizeProgressBlocks(previousAssistant);
      await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
      await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
      previousAssistant.completedAt = Date.now();
      this.deps.renderer.updateMessageCompletionTime(previousAssistant);
    }

    const assistantMessage = this.createAssistantMessage();
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
  }

  private shouldDiscardPendingAssistantPlaceholder(message: ChatMessage | null): boolean {
    return this.awaitingProviderAssistantStart
      && !!message
      && !message.content.trim()
      && (message.toolCalls?.length ?? 0) === 0
      && (message.contentBlocks?.length ?? 0) === 0;
  }

  private discardStreamingAssistantMessage(messageId: string): void {
    const { state, renderer } = this.deps;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    renderer.removeMessage(messageId);
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  // ============================================
  // Title Generation
  // ============================================

  /**
   * Triggers AI title generation after first user message.
   * Handles setting fallback title, firing async generation, and updating UI.
   */
  private async triggerTitleGeneration(pendingUserMessage?: ChatMessage): Promise<void> {
    const { plugin, state, conversationController } = this.deps;

    // The first turn of a conversation, whichever path is drawing it. On the
    // legacy path the message is already in state by now; on the projection
    // path it is not, because the projection draws it once the coordinator has
    // made it durable — so the caller hands it over and the count that means
    // "first turn" is one lower. Without this a conversation started on that
    // path never gets a title at all.
    if (state.messages.length !== (pendingUserMessage ? 0 : 1)) {
      return;
    }

    if (!state.currentConversationId) {
      const sessionId = this.getAgentService()?.getSessionId() ?? undefined;
      const conversation = await plugin.createConversation({
        providerId: this.getActiveProviderId(),
        sessionId,
        model: typeof this.deps.getActiveProviderSettings?.().model === 'string'
          ? this.deps.getActiveProviderSettings?.().model as string
          : undefined,
      });
      state.currentConversationId = conversation.id;
    }

    // Find first user message by role (not by index)
    const firstUserMsg = pendingUserMessage ?? state.messages.find(m => m.role === 'user');

    if (!firstUserMsg) {
      return;
    }

    const userContent = firstUserMsg.displayContent || firstUserMsg.content;

    // Set immediate fallback title
    const fallbackTitle = conversationController.generateFallbackTitle(userContent);
    await plugin.renameConversation(state.currentConversationId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    // Fire async AI title generation only if service available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      // No titleService, just keep the fallback title with no status
      return;
    }

    // Mark as pending only when we're actually starting generation
    await plugin.updateConversation(state.currentConversationId, { titleGenerationStatus: 'pending' });
    conversationController.updateHistoryDropdown();

    const convId = state.currentConversationId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    titleService.generateTitle(
      convId,
      userContent,
      async (conversationId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(conversationId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches fallback)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(conversationId, result.title);
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep fallback title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: undefined });
        }
        conversationController.updateHistoryDropdown();
      }
    ).catch(() => {
      // Silently ignore title generation errors
    });
  }

  // ============================================
  // Streaming Control
  // ============================================

  cancelStreaming(): void {
    const { state, streamController } = this.deps;
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    // Restore queued message to input instead of discarding
    this.restorePendingMessagesToInput();
    const projection = this.deps.getProjectionExecution?.() ?? null;
    if (projection) {
      // The kernel owns the run, so the stop request goes to it and the turn
      // ends when the provider says it did — or when recovery establishes that
      // it cannot say. Cancelling the runtime here as well would be a second
      // opinion about a run this tab no longer drives.
      void projection.cancel();
    } else {
      this.getAgentService()?.cancel();
    }
    streamController.hideThinkingIndicator();
    streamController.stopTurnSilenceIndicator();
  }

  private syncScrollToBottomAfterRenderUpdates(): void {
    const { plugin, state } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    window.requestAnimationFrame(() => {
      if (!(this.deps.plugin.settings.enableAutoScroll ?? true)) return;
      if (!this.deps.state.autoScrollEnabled) return;

      const scrollEl = this.deps.getScrollEl?.() ?? this.deps.getMessagesEl();
      scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  // ============================================
  // Instruction Mode
  // ============================================

  async handleInstructionSubmit(rawInstruction: string): Promise<void> {
    const { plugin } = this.deps;

    const instructionRefineService = this.deps.getInstructionRefineService();
    const instructionModeManager = this.deps.getInstructionModeManager();

    if (!instructionRefineService) return;

    const existingPrompt = plugin.settings.systemPrompt;
    let modal: InstructionModal | null = null;
    let wasCancelled = false;

    try {
      modal = new InstructionModal(
        plugin.app,
        rawInstruction,
        {
          onAccept: (finalInstruction) => {
            void (async (): Promise<void> => {
              const currentPrompt = plugin.settings.systemPrompt;
              plugin.settings.systemPrompt = appendMarkdownSnippet(currentPrompt, finalInstruction);
              await plugin.saveSettings();

              new Notice(t('chat.ui.instructions.added'));
              instructionModeManager?.clear();
            })();
          },
          onReject: () => {
            wasCancelled = true;
            instructionRefineService.cancel();
            instructionModeManager?.clear();
          },
          onClarificationSubmit: async (response) => {
            this.syncInstructionRefineModelOverride(instructionRefineService);
            const result = await instructionRefineService.continueConversation(response);

            if (wasCancelled) {
              return;
            }

            if (!result.success) {
              if (result.error === 'Cancelled') {
                return;
              }
              new Notice(result.error || t('chat.ui.instructions.processFailed'));
              modal?.showError(result.error || t('chat.ui.instructions.processFailed'));
              return;
            }

            if (result.clarification) {
              modal?.showClarification(result.clarification);
            } else if (result.refinedInstruction) {
              modal?.showConfirmation(result.refinedInstruction);
            }
          }
        }
      );
      modal.open();

      this.syncInstructionRefineModelOverride(instructionRefineService);
      instructionRefineService.resetConversation();
      const result = await instructionRefineService.refineInstruction(
        rawInstruction,
        existingPrompt
      );

      if (wasCancelled) {
        return;
      }

      if (!result.success) {
        if (result.error === 'Cancelled') {
          instructionModeManager?.clear();
          return;
        }
        new Notice(result.error || t('chat.ui.instructions.refineFailed'));
        modal.showError(result.error || t('chat.ui.instructions.refineFailed'));
        instructionModeManager?.clear();
        return;
      }

      if (result.clarification) {
        modal.showClarification(result.clarification);
      } else if (result.refinedInstruction) {
        modal.showConfirmation(result.refinedInstruction);
      } else {
        new Notice(t('chat.ui.instructions.noneReceived'));
        modal.showError(t('chat.ui.instructions.noneReceived'));
        instructionModeManager?.clear();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      new Notice(t('chat.ui.errors.generic', { message: errorMsg }));
      modal?.showError(errorMsg);
      instructionModeManager?.clear();
    }
  }

  // ============================================
  // Approval Dialogs
  // ============================================

  async handleApprovalRequest(
    toolName: string,
    input: Record<string, unknown>,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
  ): Promise<ApprovalDecision> {
    if (this.deps.plugin.settings.permissionMode === 'normal' && isTrustedReadOnlyMcpTool(toolName)) {
      return 'allow';
    }

    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    const decisionOptions = approvalOptions?.decisionOptions ?? DEFAULT_APPROVAL_DECISION_OPTIONS;
    const optionDecisionMap = new Map<string, ApprovalDecision>();
    const normalizedOptions = decisionOptions.map((option, index) => {
      const value = option.value || `approval-option-${index}`;
      if (option.decision) {
        optionDecisionMap.set(value, option.decision);
      }
      return {
        ...option,
        label: option.label,
        description: option.description ?? '',
        value,
      };
    });

    this.deps.streamController.flushPendingToolsForPermission();
    this.deps.streamController.hideThinkingIndicator();
    this.deps.streamController.pauseTurnSilenceIndicator(true);
    const restoreAwaitingTool = this.markToolAwaitingPermission(toolName, input);
    const restoreComposer = this.lockComposerForPermission(inputContainerEl, parentEl);

    const result = await new Promise<string | null>((resolve, reject) => {
      const inline = new InlinePermissionRequest(parentEl, {
        toolName,
        input,
        description,
        decisionOptions: normalizedOptions,
        decisionReason: approvalOptions?.decisionReason,
        blockedPath: approvalOptions?.blockedPath,
        target: approvalOptions?.target,
        agentID: approvalOptions?.agentID,
        resolve: (value: string | null) => {
          this.pendingApprovalInline = null;
          restoreAwaitingTool();
          restoreComposer();
          this.deps.streamController.pauseTurnSilenceIndicator(false);
          resolve(value);
        },
      });
      this.pendingApprovalInline = inline;

      try {
        inline.render();
      } catch (err) {
        this.pendingApprovalInline = null;
        restoreAwaitingTool();
        restoreComposer();
        this.deps.streamController.pauseTurnSilenceIndicator(false);
        reject(toError(err));
      }
    });

    if (!result) return 'cancel';
    const decision = optionDecisionMap.get(result);
    if (decision) {
      return decision;
    }

    return {
      type: 'select-option',
      value: result,
    };
  }

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const composerSurfaceEl = inputContainerEl.parentElement;
    if (!composerSurfaceEl) {
      throw new Error('Input container is detached from DOM');
    }

    this.deps.streamController.hideThinkingIndicator();
    this.deps.streamController.pauseTurnSilenceIndicator(true);
    composerSurfaceEl.addClass('grimoire-asking');

    return new Promise<Record<string, string | string[]> | null>((resolve, reject) => {
      const inline = new InlineAskUserQuestion(
        composerSurfaceEl,
        input,
        (result: Record<string, string | string[]> | null) => {
          this.pendingAskInline = null;
          composerSurfaceEl.removeClass('grimoire-asking');
          this.deps.streamController.pauseTurnSilenceIndicator(false);
          resolve(result);
        },
        signal,
      );
      this.pendingAskInline = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingAskInline = null;
        composerSurfaceEl.removeClass('grimoire-asking');
        this.deps.streamController.pauseTurnSilenceIndicator(false);
        reject(toError(err));
      }
    });
  }

  async handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    const { state, streamController } = this.deps;
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    streamController.hideThinkingIndicator();
    streamController.pauseTurnSilenceIndicator(true);
    this.hideInputContainer(inputContainerEl);

    const enrichedInput = state.planFilePath
      ? { ...input, planFilePath: state.planFilePath }
      : input;

    const renderContent = (el: HTMLElement, markdown: string) =>
      this.deps.renderer.renderContent(el, markdown);

    const planPathPrefix = this.getActiveCapabilities().planPathPrefix;

    return new Promise<ExitPlanModeDecision | null>((resolve, reject) => {
      const inline = new InlineExitPlanMode(
        parentEl,
        enrichedInput,
        (decision: ExitPlanModeDecision | null) => {
          this.pendingExitPlanModeInline = null;
          this.restoreInputContainer(inputContainerEl);
          streamController.pauseTurnSilenceIndicator(false);
          resolve(decision);
        },
        signal,
        renderContent,
        planPathPrefix,
      );
      this.pendingExitPlanModeInline = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingExitPlanModeInline = null;
        this.restoreInputContainer(inputContainerEl);
        streamController.pauseTurnSilenceIndicator(false);
        reject(toError(err));
      }
    });
  }

  dismissPendingApprovalPrompt(): void {
    if (this.pendingApprovalInline) {
      this.pendingApprovalInline.destroy();
      this.pendingApprovalInline = null;
    }
  }

  dismissPendingApproval(): void {
    this.dismissPendingApprovalPrompt();
    if (this.pendingAskInline) {
      this.pendingAskInline.destroy();
      this.pendingAskInline = null;
    }
    if (this.pendingExitPlanModeInline) {
      this.pendingExitPlanModeInline.destroy();
      this.pendingExitPlanModeInline = null;
    }
    this.dismissPendingPlanApproval(true);
    this.resetInputContainerVisibility();
    this.clearAskingState();
  }

  private showPlanApproval(): Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      return Promise.resolve({ decision: null, invalidated: false });
    }

    this.hideInputContainer(inputContainerEl);
    this.deps.streamController.pauseTurnSilenceIndicator(true);
    this.pendingPlanApprovalInvalidated = false;

    return new Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }>((resolve, reject) => {
      const inline = new InlinePlanApproval(
        parentEl,
        (decision: PlanApprovalDecision | null) => {
          const invalidated = this.pendingPlanApprovalInvalidated;
          this.pendingPlanApprovalInvalidated = false;
          this.pendingPlanApproval = null;
          this.restoreInputContainer(inputContainerEl);
          this.deps.streamController.pauseTurnSilenceIndicator(false);
          resolve({ decision, invalidated });
        },
      );
      this.pendingPlanApproval = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingPlanApproval = null;
        this.pendingPlanApprovalInvalidated = false;
        this.restoreInputContainer(inputContainerEl);
        this.deps.streamController.pauseTurnSilenceIndicator(false);
        reject(toError(err));
      }
    });
  }

  private dismissPendingPlanApproval(invalidated: boolean): void {
    if (!this.pendingPlanApproval) {
      return;
    }

    if (invalidated) {
      this.pendingPlanApprovalInvalidated = true;
    }
    this.pendingPlanApproval.destroy();
    this.pendingPlanApproval = null;
  }

  private markToolAwaitingPermission(
    toolName: string,
    input: Record<string, unknown>,
  ): () => void {
    const normalizedToolName = toolName.toLowerCase() === 'bash' ? TOOL_BASH : toolName;
    const expectedSummary = getToolSummary(normalizedToolName, input);
    const toolEl = Array
      .from(this.deps.state.toolCallElements.values())
      .reverse()
      .find((candidate) => {
        if (!expectedSummary) return true;
        const summaryEl = candidate.querySelector('.grimoire-tool-summary');
        return summaryEl?.textContent === expectedSummary;
      });

    if (!toolEl) return () => undefined;

    const resultEl = toolEl.querySelector('.grimoire-tool-result');
    const previousResult = resultEl?.textContent ?? '';
    toolEl.addClass('is-awaiting');
    resultEl?.setText(t('chat.ui.messages.awaitingYou'));

    return () => {
      toolEl.removeClass('is-awaiting');
      resultEl?.setText(previousResult);
    };
  }

  private lockComposerForPermission(
    inputContainerEl: HTMLElement,
    composerEl: HTMLElement,
  ): () => void {
    const inputEl = this.deps.getInputEl();
    const previousPlaceholder = inputEl.placeholder;
    const previousDisabled = inputEl.disabled;
    const sendButtonEl = composerEl.querySelector('.grimoire-send-button');
    const previousSendDisabled = sendButtonEl?.getAttribute('disabled') ?? null;

    composerEl.addClass('grimoire-composer--asking');
    inputContainerEl.addClass('grimoire-input-container--permission-locked');
    inputEl.disabled = true;
    inputEl.placeholder = 'Resolve the request to continue...';
    sendButtonEl?.setAttribute('disabled', 'true');

    return () => {
      composerEl.removeClass('grimoire-composer--asking');
      inputContainerEl.removeClass('grimoire-input-container--permission-locked');
      inputEl.disabled = previousDisabled;
      inputEl.placeholder = previousPlaceholder;

      if (!sendButtonEl) return;
      if (previousSendDisabled === null) {
        sendButtonEl.removeAttribute('disabled');
      } else {
        sendButtonEl.setAttribute('disabled', previousSendDisabled);
      }
    };
  }

  private hideInputContainer(inputContainerEl: HTMLElement): void {
    this.inputContainerHideDepth++;
    inputContainerEl.addClass('grimoire-hidden');
  }

  private restoreInputContainer(inputContainerEl: HTMLElement): void {
    if (this.inputContainerHideDepth <= 0) return;
    this.inputContainerHideDepth--;
    if (this.inputContainerHideDepth === 0) {
      inputContainerEl.removeClass('grimoire-hidden');
    }
  }

  private resetInputContainerVisibility(): void {
    if (this.inputContainerHideDepth > 0) {
      this.inputContainerHideDepth = 0;
      this.deps.getInputContainerEl().removeClass('grimoire-hidden');
    }
  }

  private clearAskingState(): void {
    const inputContainerEl = this.deps.getInputContainerEl();
    inputContainerEl.parentElement?.removeClass('grimoire-asking');
  }

  // ============================================
  // Built-in Commands
  // ============================================

  private async executeBuiltInCommand(command: BuiltInCommand, args: string): Promise<void> {
    const { conversationController } = this.deps;
    const capabilities = this.getActiveCapabilities();

    if (!isBuiltInCommandSupported(command, capabilities)) {
      new Notice(t('chat.ui.errors.commandUnsupported', { command: command.name }));
      return;
    }

    switch (command.action) {
      case 'clear':
        await conversationController.createNew();
        break;
      case 'add-dir': {
        const externalContextSelector = this.deps.getExternalContextSelector();
        if (!externalContextSelector) {
          new Notice(t('chat.ui.errors.externalContextUnavailable'));
          return;
        }
        const result = externalContextSelector.addExternalContext(args);
        if (result.success) {
          new Notice(t('chat.ui.errors.externalContextAdded', { path: result.normalizedPath }));
        } else {
          new Notice(result.error);
        }
        break;
      }
      case 'resume':
        this.showResumeDropdown();
        break;
      case 'fork': {
        if (!this.getActiveCapabilities().supportsFork) {
          new Notice(t('chat.ui.errors.forkUnsupported'));
          return;
        }
        if (!this.deps.onForkAll) {
          new Notice(t('chat.ui.errors.forkUnavailable'));
          return;
        }
        await this.deps.onForkAll();
        break;
      }
      case 'image': {
        const prompt = args.trim();
        if (!prompt) {
          new Notice(t('chat.ui.commands.imageUsage'));
          return;
        }
        await this.sendMessage({
          content: buildImageGenerationPrompt({
            prompt,
            mediaFolder: typeof this.deps.plugin.settings.mediaFolder === 'string'
              ? this.deps.plugin.settings.mediaFolder
              : '',
          }),
          displayContentOverride: `/image ${prompt}`,
          skipBuiltInCommandDetection: true,
        });
        break;
      }
      default: {
        // Unknown command - notify user
        const unknownAction = typeof (command as { action?: unknown }).action === 'string'
          ? (command as { action: string }).action
          : 'unknown';
        new Notice(t('chat.ui.errors.unknownCommand', { command: unknownAction }));
        break;
      }
    }
  }

  // ============================================
  // Resume Session Dropdown
  // ============================================

  handleResumeKeydown(e: KeyboardEvent): boolean {
    if (!this.activeResumeDropdown?.isVisible()) return false;
    return this.activeResumeDropdown.handleKeydown(e);
  }

  isResumeDropdownVisible(): boolean {
    return this.activeResumeDropdown?.isVisible() ?? false;
  }

  destroyResumeDropdown(): void {
    if (this.activeResumeDropdown) {
      this.activeResumeDropdown.destroy();
      this.activeResumeDropdown = null;
    }
  }

  private showResumeDropdown(): void {
    const { plugin, state, conversationController } = this.deps;

    // Clean up any existing dropdown
    this.destroyResumeDropdown();

    const conversations = plugin.getConversationList();
    if (conversations.length === 0) {
      new Notice(t('chat.ui.history.noneToResume'));
      return;
    }

    const openConversation = this.deps.openConversation
      ?? ((id: string) => conversationController.switchTo(id));

    this.activeResumeDropdown = new ResumeSessionDropdown(
      this.deps.getInputContainerEl(),
      this.deps.getInputEl(),
      conversations,
      state.currentConversationId,
      {
        onSelect: (id) => {
          this.destroyResumeDropdown();
          openConversation(id).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(t('chat.ui.errors.openConversationFailed', { message: msg }));
          });
        },
        onDismiss: () => {
          this.destroyResumeDropdown();
        },
      }
    );
  }
}

/** The message a turn actually wrote, by the id it was written under. */
function findMessage(messages: ChatMessage[], id: string | undefined): ChatMessage | undefined {
  return id ? messages.find(message => message.id === id) : undefined;
}
