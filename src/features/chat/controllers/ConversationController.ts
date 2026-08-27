import { Menu, Notice, setIcon, setTooltip } from 'obsidian';

import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';

import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId, TitleGenerationService } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { ChatRewindMode } from '../../../core/runtime/types';
import type { ChatMessage, Conversation, ConversationMeta } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { confirm } from '../../../shared/modals/ConfirmModal';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { findRewindContext } from '../rewind';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { ExternalContextSelector, McpServerSelector } from '../ui/InputToolbar';
import type { StatusPanel } from '../ui/StatusPanel';
import { getRandomGreeting } from '../utils/greetings';

function runConversationAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

function hasStartedConversation(conversation: Conversation): boolean {
  if (conversation.messages.length > 0) {
    return true;
  }
  try {
    const historyService = ProviderRegistry.getConversationHistoryService(conversation.providerId);
    return !!historyService.resolveSessionIdForConversation?.(conversation);
  } catch {
    return !!conversation.sessionId;
  }
}

export interface ConversationCallbacks {
  onNewConversation?: () => void;
  onConversationLoaded?: () => void;
  onConversationSwitched?: () => void;
}

export interface ConversationControllerDeps {
  plugin: GrimoirePlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getHistoryDropdown: () => HTMLElement | null;
  getWelcomeEl: () => HTMLElement | null;
  setWelcomeEl: (el: HTMLElement | null) => void;
  getMessagesEl: () => HTMLElement;
  getInputEl: () => HTMLTextAreaElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => ExternalContextSelector | null;
  clearQueuedMessage: () => void;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getAgentService?: () => ChatRuntime | null;
  /**
   * This tab's end of the projection path, where it has one.
   *
   * Needed for exactly one thing: stopping a turn. The kernel owns the run, so
   * the runtime's own `cancel` acts on a run it never started and returns
   * having done nothing.
   */
  getProjectionExecution?: () => { cancel(): Promise<void> } | null;
  getActiveProviderSettings?: () => Record<string, unknown>;
  getOrchestratorMode?: () => boolean;
  ensureServiceForConversation?: (conversation: Conversation | null) => Promise<void>;
  dismissPendingInlinePrompts?: () => void;
  clearRuntimeContextActivity?: () => void;
  hydrateRuntimeContextFromMessages?: (providerId: ProviderId, messages: ChatMessage[]) => void;
}

type SaveOptions = {
  resumeAtMessageId?: string;
};

export type HistoryConversationOpenState = 'closed' | 'open' | 'current';

type HistoryRenderOptions = {
  onSelectConversation: (id: string) => Promise<void>;
  onOpenConversationInNewTab?: (id: string, activate?: boolean) => Promise<void>;
  getConversationOpenState?: (id: string) => HistoryConversationOpenState;
  onClose?: () => void;
  onRerender: () => void;
};

export class ConversationController {
  private deps: ConversationControllerDeps;
  private callbacks: ConversationCallbacks;

  constructor(deps: ConversationControllerDeps, callbacks: ConversationCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  // ============================================
  // Conversation Lifecycle
  // ============================================

  /**
   * Resets to entry point state (New Chat).
   *
   * Entry point is a blank UI state - no conversation is created until the
   * first message is sent. This prevents empty conversations cluttering history.
   */
  async createNew(options: { force?: boolean } = {}): Promise<void> {
    const { plugin, state, subagentManager } = this.deps;
    const force = !!options.force;
    if (state.isStreaming && !force) return;
    if (state.isCreatingConversation) return;
    if (state.isSwitchingConversation) return;

    // Set flag to block message sending during reset
    state.isCreatingConversation = true;

    try {
      this.deps.dismissPendingInlinePrompts?.();

      if (force && state.isStreaming) {
        state.cancelRequested = true;
        state.bumpStreamGeneration();
        // **The kernel owns the run**, so the stop goes to it. Asked of the
        // runtime instead — which is what this did — `cancel` acts on a run it
        // never started and returns having done nothing: starting a new
        // conversation over a streaming turn left that turn running, writing
        // into a conversation the tab had already left.
        const projection = this.deps.getProjectionExecution?.() ?? null;
        if (projection) {
          void projection.cancel();
        } else {
          this.getAgentService()?.cancel();
        }
      }

      // Save current conversation if it has messages
      if (state.currentConversationId && state.messages.length > 0) {
        await this.save();
      }

      subagentManager.orphanAllActive();
      subagentManager.clear();

      // Clear streaming state and related DOM references
      cleanupThinkingBlock(state.currentThinkingState);
      state.currentContentEl = null;
      state.currentTextEl = null;
      state.currentTextContent = '';
      state.currentThinkingState = null;
      state.toolCallElements.clear();
      state.writeEditStates.clear();
      state.isStreaming = false;

      // Reset to entry point state - no conversation created yet
      state.currentConversationId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.planFilePath = null;
      state.prePlanPermissionMode = null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
      state.hasPendingConversationSave = false;

      // Reset agent service session (no session ID for entry point)
      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.syncConversationState(
        null,
        plugin.settings.persistentExternalContextPaths || []
      );

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.empty();

      // Recreate welcome element first (before StatusPanel for consistent ordering)
      const welcomeEl = messagesEl.createDiv({ cls: 'grimoire-welcome' });
      welcomeEl.createDiv({ cls: 'grimoire-welcome-greeting', text: this.getGreeting() });
      this.deps.setWelcomeEl(welcomeEl);

      // Remount StatusPanel to restore state for new conversation
      this.deps.getStatusPanel()?.remount();

      this.deps.getInputEl().value = '';
      this.deps.clearRuntimeContextActivity?.();

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewConversation();
      fileCtx?.autoAttachActiveFile();

      this.deps.getImageContextManager()?.clearImages();
      this.deps.getMcpServerSelector()?.clearEnabled();
      // Pass current settings to ensure we have the most up-to-date persistent paths
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
      this.deps.clearQueuedMessage();

      this.callbacks.onNewConversation?.();
    } finally {
      state.isCreatingConversation = false;
    }
  }

  /**
   * Loads the current tab conversation, or starts at entry point if none.
   *
   * Entry point (no conversation) shows welcome screen without
   * creating a conversation. Conversation is created lazily on first message.
   */
  async loadActive(): Promise<void> {
    const { plugin, state, renderer } = this.deps;

    const conversationId = state.currentConversationId;
    const conversation = conversationId ? await plugin.getConversationById(conversationId) : null;

    // No active conversation - start at entry point
    if (!conversation) {
      state.currentConversationId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.planFilePath = null;
      state.prePlanPermissionMode = null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
      state.hasPendingConversationSave = false;

      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.syncConversationState(
        null,
        plugin.settings.persistentExternalContextPaths || []
      );

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewConversation();
      fileCtx?.autoAttachActiveFile();
      this.deps.clearRuntimeContextActivity?.();

      // Initialize external contexts with persistent paths from settings
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );

      this.deps.getMcpServerSelector()?.clearEnabled();

      const welcomeEl = renderer.renderMessages(
        [],
        () => this.getGreeting()
      );
      this.deps.setWelcomeEl(welcomeEl);
      this.updateWelcomeVisibility();

      this.callbacks.onConversationLoaded?.();
      return;
    }

    await this.deps.ensureServiceForConversation?.(conversation);
    this.restoreConversation(conversation, { autoAttachFile: true });
    this.updateWelcomeVisibility();

    this.callbacks.onConversationLoaded?.();
  }

  /** Switches to a different conversation. */
  async switchTo(id: string): Promise<void> {
    const { plugin, state, subagentManager } = this.deps;

    if (id === state.currentConversationId) return;
    if (state.isStreaming) return;
    if (state.isSwitchingConversation) return;
    if (state.isCreatingConversation) return;

    state.isSwitchingConversation = true;

    try {
      this.deps.dismissPendingInlinePrompts?.();
      await this.save();

      subagentManager.orphanAllActive();
      subagentManager.clear();

      plugin.recordDebugLog?.({
        data: {
          hasPreviousConversation: !!state.currentConversationId,
        },
        event: 'conversation.requested',
        level: 'debug',
        scope: 'chat.restore',
      });

      const conversation = await plugin.switchConversation(id);
      if (!conversation) {
        plugin.recordDebugLog?.({
          data: {
            reason: 'conversation_not_found',
          },
          event: 'conversation.missing',
          level: 'warn',
          scope: 'chat.restore',
        });
        return;
      }

      plugin.recordDebugLog?.({
        data: {
          hasSessionId: !!conversation.sessionId,
          messageCount: conversation.messages.length,
          providerId: conversation.providerId,
        },
        event: 'conversation.loaded',
        level: conversation.messages.length > 0 ? 'debug' : 'warn',
        scope: 'chat.restore',
      });

      await this.deps.ensureServiceForConversation?.(conversation);

      this.deps.getInputEl().value = '';
      this.deps.clearQueuedMessage();

      this.restoreConversation(conversation);

      this.deps.getHistoryDropdown()?.removeClass('visible');
      this.updateWelcomeVisibility();

      this.callbacks.onConversationSwitched?.();
    } catch (error) {
      plugin.recordDebugLog?.({
        data: {
          reason: 'switch_failed',
        },
        error,
        event: 'conversation.failed',
        level: 'warn',
        scope: 'chat.restore',
      });
      throw error;
    } finally {
      state.isSwitchingConversation = false;
    }
  }

  async rewind(
    userMessageId: string,
    mode: ChatRewindMode = 'code-and-conversation',
  ): Promise<void> {
    const { plugin, state, renderer } = this.deps;

    const agentServiceForCheck = this.getAgentService();
    if (agentServiceForCheck && !agentServiceForCheck.getCapabilities().supportsRewind) {
      new Notice(t('chat.rewind.failed', { error: t('chat.ui.errors.rewindUnsupported') }));
      return;
    }

    if (state.isStreaming) {
      new Notice(t('chat.rewind.unavailableStreaming'));
      return;
    }

    const msgs = state.messages;
    const userIdx = msgs.findIndex(m => m.id === userMessageId);
    if (userIdx === -1) {
      new Notice(t('chat.rewind.failed', { error: t('chat.ui.errors.messageNotFound') }));
      return;
    }
    const userMsg = msgs[userIdx];
    if (!userMsg.userMessageId) {
      new Notice(t('chat.rewind.unavailableNoUuid'));
      return;
    }

    const rewindCtx = findRewindContext(msgs, userIdx);
    if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
      new Notice(t('chat.rewind.unavailableNoUuid'));
      return;
    }
    const prevAssistantUuid = rewindCtx.prevAssistantUuid;

    const confirmed = await confirm(
      plugin.app,
      mode === 'conversation'
        ? t('chat.rewind.confirmMessageConversationOnly')
        : t('chat.rewind.confirmMessage'),
      t('chat.rewind.confirmButton')
    );
    if (!confirmed) return;

    if (state.isStreaming) {
      new Notice(t('chat.rewind.unavailableStreaming'));
      return;
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      new Notice(t('chat.rewind.failed', { error: t('chat.ui.errors.agentServiceUnavailable') }));
      return;
    }

    let result;
    try {
      result = await agentService.rewind(userMsg.userMessageId, prevAssistantUuid, mode);
    } catch (e) {
      new Notice(t('chat.rewind.failed', { error: e instanceof Error ? e.message : t('chat.ui.errors.unknown') }));
      return;
    }
    if (!result.canRewind) {
      new Notice(t('chat.rewind.cannot', { error: result.error ?? t('chat.ui.errors.unknown') }));
      return;
    }

    state.truncateAt(userMessageId);

    const inputEl = this.deps.getInputEl();
    inputEl.value = userMsg.content;
    inputEl.focus();

    const welcomeEl = renderer.renderMessages(state.messages, () => this.getGreeting());
    this.deps.setWelcomeEl(welcomeEl);
    this.updateWelcomeVisibility();

    const filesChanged = result.filesChanged?.length ?? 0;
    let saveError: string | null = null;
    try {
      await this.save(false, { resumeAtMessageId: prevAssistantUuid });
    } catch (e) {
      saveError = e instanceof Error ? e.message : t('chat.ui.errors.saveFailed');
    }

    if (saveError) {
      new Notice(
        mode === 'conversation'
          ? t('chat.rewind.noticeConversationOnlySaveFailed', { error: saveError })
          : t('chat.rewind.noticeSaveFailed', { count: String(filesChanged), error: saveError })
      );
      return;
    }

    new Notice(
      mode === 'conversation'
        ? t('chat.rewind.noticeConversationOnly')
        : t('chat.rewind.notice', { count: String(filesChanged) })
    );
  }

  /**
   * Saves the current conversation.
   *
   * If we're at an entry point (no conversation yet) and have messages,
   * creates a new conversation first (lazy creation).
   *
   * For native sessions (new conversations with sessionId from SDK),
   * only metadata is saved - the SDK handles message persistence.
   */
  async save(updateLastResponse = false, options?: SaveOptions): Promise<void> {
    const { plugin, state } = this.deps;

    // Entry point with no messages - nothing to save
    if (!state.currentConversationId && state.messages.length === 0) {
      return;
    }

    const agentService = this.getAgentService();
    const sessionInvalidated = agentService?.consumeSessionInvalidation?.() ?? false;

    // Entry point with messages - create conversation lazily
    // New conversations always use SDK-native storage.
    if (!state.currentConversationId && state.messages.length > 0) {
      const initialSessionId = agentService?.getSessionId() ?? undefined;
      const conversation = await plugin.createConversation({
        providerId: agentService?.providerId,
        sessionId: initialSessionId,
        model: typeof this.deps.getActiveProviderSettings?.().model === 'string'
          ? this.deps.getActiveProviderSettings?.().model as string
          : undefined,
      });
      state.currentConversationId = conversation.id;
    }

    const fileCtx = this.deps.getFileContextManager();
    const currentNote = fileCtx?.getCurrentNotePath() || undefined;
    const externalContextSelector = this.deps.getExternalContextSelector();
    const externalContextPaths = externalContextSelector?.getExternalContexts() ?? [];
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const enabledMcpServers = mcpServerSelector ? Array.from(mcpServerSelector.getEnabledServers()) : [];

    const conversation = plugin.getConversationSync(state.currentConversationId!);

    const { updates: sessionUpdates } = agentService
      ? agentService.buildSessionUpdates({ conversation, sessionInvalidated })
      : { updates: {} };

    const updates: Partial<Conversation> = {
      ...sessionUpdates,
      messages: state.messages,
      currentNote: currentNote,
      externalContextPaths: externalContextPaths.length > 0 ? externalContextPaths : undefined,
      usage: state.usage ?? undefined,
      enabledMcpServers: enabledMcpServers.length > 0 ? enabledMcpServers : undefined,
      orchestratorMode: this.deps.getOrchestratorMode?.() === true ? true : undefined,
      model: typeof this.deps.getActiveProviderSettings?.().model === 'string'
        ? this.deps.getActiveProviderSettings?.().model as string
        : undefined,
    };

    if (updateLastResponse) {
      updates.lastResponseAt = Date.now();
    }

    if (options) {
      updates.resumeAtMessageId = options.resumeAtMessageId;
    }

    await plugin.updateConversation(state.currentConversationId!, updates);
    state.hasPendingConversationSave = false;
  }

  /**
   * Shared logic for restoring a conversation into the current tab.
   * Used by both loadActive() and switchTo() to avoid duplication.
   */
  private restoreConversation(
    conversation: Conversation,
    options?: { autoAttachFile?: boolean }
  ): void {
    const { plugin, state, renderer } = this.deps;

    state.currentConversationId = conversation.id;
    state.messages = [...conversation.messages];
    state.usage = conversation.usage ?? null;
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
    state.hasPendingConversationSave = false;

    // Clear status panels (auto-hide: panels reappear when agent creates new todos)
    state.currentTodos = null;
    this.deps.clearRuntimeContextActivity?.();
    this.deps.hydrateRuntimeContextFromMessages?.(conversation.providerId, state.messages);

    const hasMessages = state.messages.length > 0;
    const hasStartedSession = hasMessages || hasStartedConversation(conversation);

    // Determine external context paths for this session.
    // Brand-new sessions use persistent paths; restored provider sessions use saved paths.
    const externalContextPaths = hasStartedSession
      ? conversation.externalContextPaths || []
      : plugin.settings.persistentExternalContextPaths || [];

    this.getAgentService()?.syncConversationState(conversation, externalContextPaths);

    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForLoadedConversation(hasStartedSession);

    if (conversation.currentNote) {
      fileCtx?.setCurrentNote(conversation.currentNote);
    } else if (!hasStartedSession && options?.autoAttachFile) {
      fileCtx?.autoAttachActiveFile();
    }

    this.restoreExternalContextPaths(conversation.externalContextPaths, !hasStartedSession);

    const mcpServerSelector = this.deps.getMcpServerSelector();
    if (conversation.enabledMcpServers && conversation.enabledMcpServers.length > 0) {
      mcpServerSelector?.setEnabledServers(conversation.enabledMcpServers);
    } else {
      mcpServerSelector?.clearEnabled();
    }

    const welcomeEl = renderer.renderMessages(
      state.messages,
      () => this.getGreeting(),
      // What the provider found when this conversation's history was loaded. A
      // transcript shorter than the conversation says so here rather than
      // looking like a conversation that was always this short.
      plugin.getHistoryHydration(conversation.id),
    );
    this.deps.setWelcomeEl(welcomeEl);
  }

  /**
   * Restores external context paths based on session state.
   * New or empty sessions get current persistent paths from settings.
   * Sessions with messages restore exactly what was saved.
   */
  private restoreExternalContextPaths(
    savedPaths: string[] | undefined,
    isEmptySession: boolean
  ): void {
    const { plugin } = this.deps;
    const externalContextSelector = this.deps.getExternalContextSelector();
    if (!externalContextSelector) {
      return;
    }

    if (isEmptySession) {
      // Empty session: use current persistent paths from settings
      externalContextSelector.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
    } else {
      // Session with messages: restore exactly what was saved
      externalContextSelector.setExternalContexts(savedPaths || []);
    }
  }

  // ============================================
  // History Dropdown
  // ============================================

  toggleHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    const isVisible = dropdown.hasClass('visible');
    if (isVisible) {
      dropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      dropdown.addClass('visible');
    }
  }

  updateHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    this.renderHistoryItems(dropdown, {
      onSelectConversation: (id) => this.switchTo(id),
      onClose: () => dropdown.removeClass('visible'),
      onRerender: () => this.updateHistoryDropdown(),
    });
  }

  /**
   * Renders history dropdown items to a container.
   * Shared implementation for updateHistoryDropdown() and renderHistoryDropdown().
   */
  private renderHistoryItems(
    container: HTMLElement,
    options: HistoryRenderOptions
  ): void {
    const { plugin, state } = this.deps;

    container.empty();
    const allConversations = plugin.getConversationList();

    const dropdownHeader = container.createDiv({ cls: 'grimoire-history-header' });
    dropdownHeader.createEl('strong', { cls: 'grimoire-history-title', text: t('chat.ui.history.title') });
    dropdownHeader.createSpan({
      cls: 'grimoire-history-count',
      text: String(allConversations.length),
    });
    const deleteAllBtn = dropdownHeader.createEl('button', {
      cls: 'grimoire-history-delete-all',
      text: t('chat.history.deleteAll'),
      attr: {
        type: 'button',
        'aria-label': t('chat.history.deleteAllAriaLabel'),
      },
    });
    deleteAllBtn.disabled = allConversations.length === 0;
    deleteAllBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.deleteAllHistory(allConversations, options).catch(() => {
        new Notice(t('chat.history.deleteAllFailed'));
      });
    });
    dropdownHeader.createSpan({ cls: 'grimoire-history-header-spacer' });
    const closeBtn = dropdownHeader.createEl('button', {
      cls: 'grimoire-history-close',
      attr: {
        type: 'button',
        'aria-label': t('chat.ui.history.close'),
      },
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      options.onClose?.();
    });

    const searchRow = container.createDiv({ cls: 'grimoire-history-search' });
    const searchIcon = searchRow.createSpan({ cls: 'grimoire-history-search-icon' });
    setIcon(searchIcon, 'search');
    const searchInput = searchRow.createEl('input', {
      cls: 'grimoire-history-search-input',
      attr: {
        type: 'search',
        placeholder: t('chat.ui.history.searchPlaceholder'),
        autocomplete: 'off',
      },
    });
    this.renderUnreadableConversations(container);
    const list = container.createDiv({ cls: 'grimoire-history-list' });

    const renderList = (rawQuery = ''): void => {
      list.empty();

      if (allConversations.length === 0) {
        list.createDiv({ cls: 'grimoire-history-empty', text: t('chat.ui.history.empty') });
        return;
      }

      const query = rawQuery.trim().toLowerCase();
      const conversations = [...allConversations]
        .filter((conv) => this.matchesHistorySearch(conv, query))
        .sort((a, b) => this.getHistoryTimestamp(b) - this.getHistoryTimestamp(a));

      if (conversations.length === 0) {
        list.createDiv({ cls: 'grimoire-history-empty', text: t('chat.ui.history.noMatches') });
        return;
      }

      for (const group of this.groupHistoryConversations(conversations)) {
        const groupEl = list.createDiv({ cls: 'grimoire-history-group' });
        groupEl.createDiv({ cls: 'grimoire-history-group-label', text: this.getHistoryGroupDisplayLabel(group.label) });

        for (const conv of group.conversations) {
          this.renderHistoryConversationRow(groupEl, conv, options, state.currentConversationId);
        }
      }
    };

    searchInput.addEventListener('input', (event) => {
      renderList((event.currentTarget as HTMLInputElement).value);
    });

    renderList();
  }

  private async deleteAllHistory(
    conversations: ConversationMeta[],
    options: HistoryRenderOptions,
  ): Promise<void> {
    const { plugin } = this.deps;
    const confirmed = await confirm(
      plugin.app,
      t('chat.history.deleteAllConfirm', { count: conversations.length }),
      t('chat.history.deleteAll'),
    );
    if (!confirmed) return;

    for (const conversation of conversations) {
      await plugin.deleteConversation(conversation.id);
    }

    options.onClose?.();
  }

  /**
   * The conversations the vault holds and this build cannot read.
   *
   * Their own block, above the list and outside the search: they have no
   * title to match, no timestamp to group by, and nothing to open. Shown at
   * all because the file is still there — a conversation that simply vanishes
   * from the list is indistinguishable from one the user deleted, which is the
   * silence typed hydration removed from the transcript and this removes from
   * the list.
   */
  private renderUnreadableConversations(container: HTMLElement): void {
    const unreadable = this.deps.plugin.getUnreadableConversations?.() ?? [];
    if (unreadable.length === 0) {
      return;
    }

    const block = container.createDiv({ cls: 'grimoire-history-unreadable' });
    for (const entry of unreadable) {
      const item = block.createDiv({ cls: 'grimoire-history-unreadable-item' });
      item.setAttribute('data-conversation-id', entry.id);
      const title = item.createDiv({
        cls: 'grimoire-history-unreadable-title',
        text: t('chat.ui.history.unreadableTitle'),
      });
      title.setAttribute('title', entry.id);
      item.createDiv({
        cls: 'grimoire-history-unreadable-reason',
        text: entry.reason === 'future'
          ? t('chat.ui.history.unreadableFuture')
          : t('chat.ui.history.unreadableCorrupt'),
      });
    }
  }

  private renderHistoryConversationRow(
    container: HTMLElement,
    conv: ConversationMeta,
    options: HistoryRenderOptions,
    currentConversationId: string | null,
  ): void {
    const isCurrent = conv.id === currentConversationId;
    const openState = options.getConversationOpenState?.(conv.id) ?? (isCurrent ? 'current' : 'closed');
    const item = container.createDiv({
      cls: [
        'grimoire-history-item',
        isCurrent ? 'active' : '',
        openState === 'open' ? 'is-open' : '',
      ].filter(Boolean).join(' '),
    });
    item.setAttribute('data-conversation-id', conv.id);
    item.setAttribute('tabindex', isCurrent ? '-1' : '0');

    const providerDot = item.createSpan({ cls: 'grimoire-history-provider-dot' });
    (providerDot.style as CSSStyleDeclaration & Record<string, string>)['--grimoire-history-provider-color'] =
      this.getHistoryProviderColor(conv.providerId);

    const content = item.createDiv({ cls: 'grimoire-history-item-content' });
    const titleEl = content.createDiv({ cls: 'grimoire-history-item-title', text: conv.title });
    titleEl.setAttribute('title', conv.title);
    content.createDiv({
      cls: 'grimoire-history-item-meta',
      text: this.formatHistoryMeta(conv),
    });

    item.createSpan({
      cls: 'grimoire-history-item-time',
      text: isCurrent ? t('chat.ui.history.current') : this.formatRelativeTime(this.getHistoryTimestamp(conv)),
    });

    const canOpenInNewTab = !!options.onOpenConversationInNewTab;
    const openInNewTab = () => this.runHistoryAction(
      () => options.onOpenConversationInNewTab?.(conv.id, true),
      t('chat.ui.errors.loadConversationFailed'),
    );

    if (!isCurrent) {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isHistoryNewTabModifierClick(e) && options.onOpenConversationInNewTab) {
          e.preventDefault();
          runConversationAction(
            () => this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conv.id, true),
              t('chat.ui.errors.loadConversationFailed'),
            ),
            t('chat.ui.errors.loadConversationFailed'),
          );
          return;
        }

        runConversationAction(
          () => this.runHistoryAction(
            () => options.onSelectConversation(conv.id),
            t('chat.ui.errors.loadConversationFailed'),
          ),
          t('chat.ui.errors.loadConversationFailed'),
        );
      });

      if (options.onOpenConversationInNewTab) {
        item.addEventListener('auxclick', (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          runConversationAction(
            () => this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conv.id, true),
              t('chat.ui.errors.loadConversationFailed'),
            ),
            t('chat.ui.errors.loadConversationFailed'),
          );
        });
      }
    }

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showHistoryContextMenu(item, conv, isCurrent, options, e);
    });

    const actions = item.createDiv({ cls: 'grimoire-history-item-actions' });

    if (canOpenInNewTab) {
      const openBtn = actions.createEl('button', {
        cls: 'grimoire-action-btn grimoire-history-new-tab-btn',
        attr: { type: 'button' },
      });
      setIcon(openBtn, 'external-link');
      openBtn.setAttribute('aria-label', t('chat.ui.history.openNewTab'));
      setTooltip(openBtn, t('chat.ui.history.openNewTab'), { placement: 'top' });
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        runConversationAction(openInNewTab, t('chat.ui.errors.loadConversationFailed'));
      });
    }

    if (conv.titleGenerationStatus === 'pending') {
      const loadingEl = actions.createSpan({ cls: 'grimoire-action-btn grimoire-action-loading' });
      setIcon(loadingEl, 'loader-2');
      loadingEl.setAttribute('aria-label', t('chat.ui.history.generatingTitle'));
    } else if (conv.titleGenerationStatus === 'failed') {
      const regenerateBtn = actions.createEl('button', { cls: 'grimoire-action-btn grimoire-history-regenerate-btn' });
      setIcon(regenerateBtn, 'refresh-cw');
      regenerateBtn.setAttribute('aria-label', t('chat.ui.history.regenerateTitle'));
      regenerateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        runConversationAction(
          () => this.regenerateTitle(conv.id),
          t('chat.ui.errors.regenerateFailed'),
        );
      });
    }

    const renameBtn = actions.createEl('button', {
      cls: 'grimoire-action-btn grimoire-history-rename-btn',
    });
    setIcon(renameBtn, 'pencil');
    renameBtn.setAttribute('aria-label', t('chat.ui.history.rename'));
    renameBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showRenameInput(item, conv.id, conv.title, options);
    });

    const deleteBtn = actions.createEl('button', { cls: 'grimoire-action-btn grimoire-delete-btn' });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.setAttribute('aria-label', t('common.delete'));
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runConversationAction(
        () => this.runHistoryAction(
          () => this.deleteHistoryConversation(conv.id, options),
          t('chat.ui.errors.deleteConversationFailed'),
        ),
        t('chat.ui.errors.deleteConversationFailed'),
      );
    });
  }

  private matchesHistorySearch(conv: ConversationMeta, query: string): boolean {
    if (!query) return true;
    return `${conv.title} ${conv.preview ?? ''} ${conv.modelLabel ?? ''}`.toLowerCase().includes(query);
  }

  private getHistoryTimestamp(conv: ConversationMeta): number {
    return conv.lastResponseAt ?? conv.createdAt;
  }

  private groupHistoryConversations(conversations: ConversationMeta[]): Array<{
    label: 'Today' | 'Yesterday' | 'Earlier';
    conversations: ConversationMeta[];
  }> {
    const groups: Array<{
      label: 'Today' | 'Yesterday' | 'Earlier';
      conversations: ConversationMeta[];
    }> = [];

    for (const conversation of conversations) {
      const label = this.getHistoryGroupLabel(this.getHistoryTimestamp(conversation));
      let group = groups.find(entry => entry.label === label);
      if (!group) {
        group = { label, conversations: [] };
        groups.push(group);
      }
      group.conversations.push(conversation);
    }

    return groups;
  }

  private getHistoryGroupLabel(timestamp: number): 'Today' | 'Yesterday' | 'Earlier' {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const date = new Date(timestamp);

    if (date >= today) return 'Today';
    if (date >= yesterday) return 'Yesterday';
    return 'Earlier';
  }

  private getHistoryGroupDisplayLabel(label: 'Today' | 'Yesterday' | 'Earlier'): string {
    if (label === 'Today') return t('chat.ui.history.today');
    if (label === 'Yesterday') return t('chat.ui.history.yesterday');
    return t('chat.ui.history.earlier');
  }

  private formatHistoryMeta(conv: ConversationMeta): string {
    const parts: string[] = [];
    const modelLabel = conv.modelLabel?.trim();
    const preview = conv.preview?.trim();
    const sourceCount = Number.isFinite(conv.sourceCount) ? Math.max(0, Math.round(conv.sourceCount ?? 0)) : 0;
    const usagePercentage = Number.isFinite(conv.usagePercentage)
      ? Math.max(0, Math.min(100, Math.round(conv.usagePercentage ?? 0)))
      : null;

    if (modelLabel) {
      parts.push(modelLabel);
    }
    if (preview) {
      parts.push(preview);
    }
    if (sourceCount > 0) {
      parts.push(t('chat.ui.history.sourceCount', { count: sourceCount }));
    }
    if (usagePercentage !== null) {
      parts.push(`${usagePercentage}%`);
    }

    return parts.join(' · ');
  }

  private getHistoryProviderColor(providerId: string | undefined): string {
    // The product default, not one provider's colour picked out of the list: a
    // conversation whose provider is not registered was showing Claude's dot,
    // which reads as a claim about which provider it belongs to.
    const resolvedProviderId = providerId && providerCatalog().has(providerId)
      ? providerId
      : DEFAULT_CHAT_PROVIDER_ID;
    return `var(--grimoire-provider-${resolvedProviderId})`;
  }

  private formatRelativeTime(timestamp: number): string {
    const diffMs = Math.max(0, Date.now() - timestamp);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;

    if (diffMs < minuteMs) return t('chat.ui.history.now');
    if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)}m`;
    if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h`;
    if (diffMs < 7 * dayMs) return `${Math.floor(diffMs / dayMs)}d`;
    return this.formatDate(timestamp);
  }

  private isHistoryNewTabModifierClick(event: MouseEvent): boolean {
    return !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey);
  }

  private async runHistoryAction(
    action: () => Promise<void> | void,
    errorMessage: string,
  ): Promise<void> {
    try {
      await action();
    } catch {
      new Notice(errorMessage);
    }
  }

  private showHistoryContextMenu(
    item: HTMLElement,
    conv: ConversationMeta,
    isCurrent: boolean,
    options: HistoryRenderOptions,
    event: MouseEvent,
  ): void {
    const menu = new Menu();
    const conversationId = conv.id;
    const openState = options.getConversationOpenState?.(conversationId) ?? (isCurrent ? 'current' : 'closed');

    if (!isCurrent) {
      if (openState === 'closed' && options.onOpenConversationInNewTab) {
        menu.addItem((menuItem) => menuItem
          .setTitle(t('chat.ui.history.openNewTab'))
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conversationId, true),
              t('chat.ui.errors.loadConversationFailed'),
            );
          }));
        menu.addItem((menuItem) => menuItem
          .setTitle(t('chat.ui.history.openBackgroundTab'))
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conversationId, false),
              t('chat.ui.errors.loadConversationFailed'),
            );
          }));
      } else if (openState === 'open') {
        menu.addItem((menuItem) => menuItem
          .setTitle(t('chat.ui.history.switchOpenSession'))
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onSelectConversation(conversationId),
              t('chat.ui.errors.loadConversationFailed'),
            );
          }));
      }
    }

    if (conv.titleGenerationStatus === 'failed') {
      menu.addItem((menuItem) => menuItem
        .setTitle(t('chat.ui.history.regenerateTitle'))
        .onClick(() => {
          runConversationAction(
            () => this.regenerateTitle(conv.id),
            t('chat.ui.errors.regenerateFailed'),
          );
        }));
    }

    menu.addItem((menuItem) => menuItem
      .setTitle(t('chat.ui.history.rename'))
      .onClick(() => {
        this.showRenameInput(item, conversationId, conv.title, options);
      }));
    menu.addItem((menuItem) => menuItem
      .setTitle(t('common.delete'))
      .onClick(() => {
        void this.runHistoryAction(
          () => this.deleteHistoryConversation(conversationId, options),
          t('chat.ui.errors.deleteConversationFailed'),
        );
      }));

    menu.showAtMouseEvent(event);
  }

  private async deleteHistoryConversation(
    conversationId: string,
    options: HistoryRenderOptions,
  ): Promise<void> {
    const { plugin, state } = this.deps;
    if (state.isStreaming) return;

    await plugin.deleteConversation(conversationId);
    options.onRerender();

    if (conversationId === state.currentConversationId) {
      await this.loadActive();
    }
  }

  /** Shows inline rename input for a conversation. */
  private showRenameInput(
    item: HTMLElement,
    convId: string,
    currentTitle: string,
    options: HistoryRenderOptions,
  ): void {
    const titleEl = item.querySelector('.grimoire-history-item-title') as HTMLElement;
    if (!titleEl) return;

    const input = item.createEl('input');
    input.type = 'text';
    input.className = 'grimoire-rename-input';
    input.value = currentTitle;

    titleEl.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener('click', (event) => event.stopPropagation());

    let settled = false;
    let cancelled = false;
    const finishRename = async () => {
      if (settled) return;
      settled = true;

      if (cancelled) {
        options.onRerender();
        return;
      }

      const newTitle = input.value.trim() || currentTitle;
      try {
        await this.deps.plugin.renameConversation(convId, newTitle);
      } finally {
        options.onRerender();
      }
    };

    input.addEventListener('blur', () => {
      runConversationAction(finishRename, t('chat.ui.errors.renameConversationFailed'));
    });
    input.addEventListener('keydown', (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.isComposing) {
        input.blur();
      } else if (e.key === 'Escape' && !e.isComposing) {
        cancelled = true;
        input.blur();
      }
    });
  }

  // ============================================
  // Welcome & Greeting
  // ============================================

  /** Generates a dynamic greeting based on time/day. */
  getGreeting(): string {
    const now = new Date();
    return getRandomGreeting({
      day: now.getDay(),
      hour: now.getHours(),
      name: this.deps.plugin.settings.userName,
    });
  }

  /** Updates welcome element visibility based on message count. */
  updateWelcomeVisibility(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    if (this.deps.state.messages.length === 0) {
      welcomeEl.removeClass('grimoire-hidden');
    } else {
      welcomeEl.addClass('grimoire-hidden');
    }
  }

  /**
   * Initializes the welcome greeting for a new tab without a conversation.
   * Called when a new tab is activated and has no conversation loaded.
   */
  initializeWelcome(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    // Initialize file context to auto-attach the currently focused note
    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForNewConversation();
    fileCtx?.autoAttachActiveFile();

    // Only add greeting if not already present
    if (!welcomeEl.querySelector('.grimoire-welcome-greeting')) {
      welcomeEl.createDiv({ cls: 'grimoire-welcome-greeting', text: this.getGreeting() });
    }

    this.updateWelcomeVisibility();
  }

  // ============================================
  // Utilities
  // ============================================

  /** Generates a fallback title from the first message (used when AI fails). */
  generateFallbackTitle(firstMessage: string): string {
    const firstSentence = firstMessage.split(/[.!?\n]/)[0].trim();
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? '...' : '';
    return `${autoTitle}${suffix}`;
  }

  /** Regenerates AI title for a conversation. */
  async regenerateTitle(conversationId: string): Promise<void> {
    const { plugin } = this.deps;
    if (!plugin.settings.enableAutoTitleGeneration) return;

    // Title generation is delegated to the active provider service
    const fullConv = await plugin.getConversationById(conversationId);
    if (!fullConv || fullConv.messages.length < 1) return;

    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) return;

    // Find first user message by role (not by index)
    const firstUserMsg = fullConv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return;

    const userContent = firstUserMsg.displayContent || firstUserMsg.content;

    // Store current title to check if user renames during generation
    const expectedTitle = fullConv.title;

    // Set pending status before starting generation
    await plugin.updateConversation(conversationId, { titleGenerationStatus: 'pending' });
    this.updateHistoryDropdown();

    // Fire async AI title generation
    await titleService.generateTitle(
      conversationId,
      userContent,
      async (convId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(convId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches expected)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(convId, result.title);
          await plugin.updateConversation(convId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep existing title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(convId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(convId, { titleGenerationStatus: undefined });
        }
        this.updateHistoryDropdown();
      }
    );
  }

  /** Formats a timestamp for display. */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ============================================
  // History Dropdown Rendering (for GrimoireView)
  // ============================================

  /**
   * Renders the history dropdown content to a provided container.
   * Used by GrimoireView to render the dropdown with custom selection callback.
   */
  renderHistoryDropdown(
    container: HTMLElement,
    options: Omit<HistoryRenderOptions, 'onRerender'>,
  ): void {
    this.renderHistoryItems(container, {
      ...options,
      onRerender: () => this.renderHistoryDropdown(container, options),
    });
  }
}
