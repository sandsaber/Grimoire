import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, setIcon, setTooltip } from 'obsidian';

import type { ExecutionInteractionPresentation } from '../../app/runtime/ExecutionInteractionPresentationStore';
import type { InteractionId } from '../../core/execution/ExecutionIds';
import type { LegacyProviderTabManagerHandle } from '../../core/providers/LegacyProviderContext';
import type { ProviderCapabilities } from '../../core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../core/providers/types';
import { VIEW_TYPE_GRIMOIRE } from '../../core/types';
import type { ChatMessage } from '../../core/types/chat';
import type GrimoirePlugin from '../../main';
import { builtInProviderCatalog } from '../../providers/BuiltInProviderCatalog';
import { getVaultPath } from '../../utils/path';
import { ChatInputCommandAdapter } from './application/ChatInputCommandAdapter';
import { ChatProjectionAttachment } from './application/ChatProjectionAttachment';
import { ChatProjectionViewController } from './application/ChatProjectionViewController';
import type { ChatProjection, InteractionProjection } from './projections/ChatProjection';
import type { ChatProjectionRenderModel,ChatProjectionRenderTarget } from './rendering/ChatProjectionRenderer';
import { ChatProjectionRenderer } from './rendering/ChatProjectionRenderer';
import type { InteractionPromptModel } from './rendering/InteractionPromptRenderer';
import { InteractionPromptRenderer } from './rendering/InteractionPromptRenderer';
import { MessageRenderer } from './rendering/MessageRenderer';
import { autoResizeTextarea } from './ui/textareaResize';

/** Legacy tab identifier retained for no-op compatibility. */
type TabId = string;

/** Stub interface for legacy tab manager calls from main.ts. Always returns null. */
interface GrimoireTabManagerStub extends LegacyProviderTabManagerHandle {
  getActiveTabId(): string | null;
  getActiveTab(): GrimoireActiveTabStub | null;
  getAllTabs(): readonly GrimoireActiveTabStub[];
  getTabCount(): number;
  canCreateTab(): boolean;
  createNewConversation(): Promise<void>;
  switchToTab(_tabId: string): boolean;
  getPersistedState(): unknown;
  notifyConversationRenamed(_id: string, _title: string): void;
  primeProviderRuntime(): void;
  invalidateProviderCommandCaches(_providerIds: readonly string[]): void;
}

/** Legacy tab data stub for compatibility. */
interface GrimoireActiveTabStub {
  id: string;
  conversationId: string | null;
  providerId: string | null;
  draftModel: string | null;
  lifecycleState: string;
  service: any;
  state: any;
  ui: any;
  draftSettings: Record<string, unknown>;
  serviceInitialized?: boolean;
  controllers?: any;
  getExternalContexts?(): string[];
  orchestratorMode?: boolean;
}

/** Minimal capability descriptor used when no provider-specific one is wired. */
function getDefaultCapabilities(providerId: string): ProviderCapabilities {
  return {
    providerId: providerId,
    supportsPersistentRuntime: false,
    supportsNativeHistory: false,
    supportsPlanMode: false,
    supportsRewind: false,
    supportsFork: false,
    supportsProviderCommands: false,
    supportsImageAttachments: false,
    supportsInstructionMode: false,
    supportsMcpTools: false,
    reasoningControl: 'none',
  };
}

/**
 * Projection-backed chat view. Owns presentation only — DOM, draft, scroll,
 * selection. Execution lifecycle is owned by the ApplicationRuntime.
 *
 * The view loads the active conversation from the runtime, attaches a
 * projection listener through the ChatProjectionViewController, and renders
 * updates via the MessageRenderer. It submits turns through the controller's
 * input adapter and renders projection responses.
 */
export class GrimoireView extends ItemView implements ChatProjectionRenderTarget {
  private plugin: GrimoirePlugin;
  private conversationId: string | null = null;

  // DOM element refs
  private shellEl: HTMLElement | null = null;
  private sessionStripEl: HTMLElement | null = null;
  private chatScrollEl: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private messageContainerEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendButtonEl: HTMLElement | null = null;
  private providerSelectEl: HTMLSelectElement | null = null;
  private titleEl: HTMLElement | null = null;
  private newChatButtonEl: HTMLElement | null = null;

  // Rendering pipeline
  private messageRenderer: MessageRenderer | null = null;
  private projectionRenderer: ChatProjectionRenderer | null = null;
  private interactionsEl: HTMLElement | null = null;
  private interactionRenderer: InteractionPromptRenderer | null = null;
  /** Presentation lookups are content-addressed and immutable, so they cache. */
  private readonly presentationCache = new Map<string, ExecutionInteractionPresentation>();
  private renderedInteractionKey = '';
  private viewController: ChatProjectionViewController | null = null;
  private attachment: ChatProjectionAttachment | null = null;
  private unsubscribeAttachment: (() => void) | null = null;

  private isActive = false;
  private providerId: string = builtInProviderCatalog.list()[0]?.manifest.id ?? DEFAULT_CHAT_PROVIDER_ID;
  private lastRenderedMessageCount = -1;

  constructor(leaf: WorkspaceLeaf, plugin: GrimoirePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_GRIMOIRE;
  }

  getDisplayText(): string {
    return 'Grimoire';
  }

  getIcon(): string {
    return 'grimoire-app-icon';
  }

  async onOpen(): Promise<void> {
    // Temporary diagnostic — show visible Notice to confirm onOpen is called.
    new Notice(`Grimoire onOpen: contentEl=${!!this.contentEl}`, 5000);
    // Diagnostic: log that onOpen was called and whether contentEl exists.
    void this.plugin.writeDebugLog?.({
      event: 'view.onOpen.started',
      level: 'info',
      scope: 'view.open',
      data: { hasContentEl: !!this.contentEl, hasRuntime: !!this.plugin.applicationRuntime },
    });
    try {
      if (!this.contentEl) {
        void this.plugin.writeDebugLog?.({
          event: 'view.onOpen.skipped',
          level: 'warn',
          scope: 'view.open',
          data: { reason: 'missing_contentEl' },
        });
        return;
      }

      this.contentEl.empty();
      this.contentEl.addClass('grimoire-container');
      this.contentEl.addClass('grimoire-container--chat-window');

      this.buildShell();
      this.buildSessionStrip();
      this.buildChatArea();
      this.wireEventHandlers();

      void this.plugin.writeDebugLog?.({
        event: 'view.onOpen.domBuilt',
        level: 'info',
        scope: 'view.open',
        data: { childCount: this.contentEl.children.length },
      });

      this.isActive = true;
      if (!this.conversationId) {
        await this.ensureConversation();
      }

      void this.plugin.writeDebugLog?.({
        event: 'view.onOpen.finished',
        level: 'info',
        scope: 'view.open',
        data: { conversationId: this.conversationId },
      });
    } catch (error) {
      // Surface any onOpen failure so the panel is never silently empty.
      const message = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      void this.plugin.writeDebugLog?.({
        event: 'view.onOpen.failed',
        level: 'error',
        scope: 'view.open',
        data: { error: message },
      });
      try {
        this.contentEl?.empty();
        this.contentEl?.createDiv({
          cls: 'grimoire-message grimoire-message-error',
          text: `Grimoire view failed to open: ${message}`,
        });
      } catch {
        new Notice(`Grimoire view failed to open: ${message}`, 15000);
      }
    }
  }

  async onClose(): Promise<void> {
    this.isActive = false;
    this.detachProjection();
    this.messageRenderer = null;
    this.projectionRenderer = null;
    this.viewController = null;
    this.attachment = null;
    this.contentEl?.empty();
  }

  // ============================================
  // DOM Construction
  // ============================================

  private buildShell(): void {
    this.shellEl = this.contentEl.createDiv({ cls: 'grimoire-chat-window-shell' });
  }

  private buildSessionStrip(): void {
    if (!this.shellEl) return;
    this.sessionStripEl = this.shellEl.createDiv({
      cls: 'grimoire-header grimoire-session-strip',
    });

    // Conversation title (shows "New Conversation" initially)
    this.titleEl = this.sessionStripEl.createDiv({
      cls: 'grimoire-session-title',
      text: 'New Conversation',
    });

    const actionsEl = this.sessionStripEl.createDiv({ cls: 'grimoire-header-actions' });

    // New chat button
    this.newChatButtonEl = actionsEl.createDiv({ cls: 'grimoire-header-btn grimoire-new-tab-btn' });
    setIcon(this.newChatButtonEl, 'plus');
    setTooltip(this.newChatButtonEl, 'New conversation');
    this.registerDomEvent(this.newChatButtonEl, 'click', () => {
      void this.startNewConversation();
    });
  }

  private buildChatArea(): void {
    if (!this.shellEl) return;
    // The tab content container is the second grid row of the shell.
    this.messageContainerEl = this.shellEl.createDiv({
      cls: 'grimoire-tab-content-container grimoire-tab-content-container--chat-window grimoire-tab-content',
    });
    // Inside it, a 3-row grid: panel tabs nav (auto) + chat scroll (fills) + composer (auto).
    const grid = this.messageContainerEl.createDiv({ cls: 'grimoire-chat-window-grid' });
    // Panel tabs nav — empty in single-panel mode but occupies grid row 1.
    grid.createDiv({ cls: 'grimoire-panel-tabs' });
    // Panel content wrapper — wraps the scrollable chat area.
    const panelContent = grid.createDiv({ cls: 'grimoire-panel-content' });
    const chatPanel = panelContent.createDiv({
      cls: 'grimoire-panel-view grimoire-chat-panel is-active',
    });
    this.chatScrollEl = chatPanel.createDiv({ cls: 'grimoire-chat-scroll' });
    const messagesWrapper = this.chatScrollEl.createDiv({ cls: 'grimoire-messages-wrapper' });
    this.messagesEl = messagesWrapper.createDiv({ cls: 'grimoire-messages' });

    // Welcome element (MessageRenderer.renderMessages will recreate this)
    const welcomeEl = this.messagesEl.createDiv({ cls: 'grimoire-welcome' });
    welcomeEl.createDiv({
      cls: 'grimoire-welcome-greeting',
      text: this.getGreeting(),
    });

    // Open interactions sit between the transcript and the composer so a
    // pending approval is visible without scrolling the transcript.
    this.interactionsEl = grid.createDiv({ cls: 'grimoire-interactions is-empty' });
    this.interactionRenderer = new InteractionPromptRenderer(this.interactionsEl, {
      onRespond: (interactionId, responseId) => {
        void this.respondToInteraction(interactionId, responseId);
      },
    });

    // Composer goes in the same grid as a third row.
    this.buildComposer(grid);
  }

  private buildComposer(parentGrid: HTMLElement): void {
    const composerSurface = parentGrid.createDiv({
      cls: 'grimoire-composer-surface grimoire-composer',
    });
    const inputContainer = composerSurface.createDiv({
      cls: 'grimoire-input-container grimoire-composer-shell',
    });
    const inputWrapper = inputContainer.createDiv({ cls: 'grimoire-input-wrapper' });

    // Provider selector row
    const toolbarEl = inputWrapper.createDiv({ cls: 'grimoire-input-toolbar' });
    const toolbarRow = toolbarEl.createDiv({
      cls: 'grimoire-input-toolbar-row grimoire-input-toolbar-model-row grimoire-input-toolbar-actions-row',
    });
    const modelStack = toolbarRow.createDiv({ cls: 'grimoire-model-context-stack' });

    this.providerSelectEl = modelStack.createEl('select', {
      cls: 'grimoire-provider-select dropdown',
    });
    for (const module of builtInProviderCatalog.list()) {
      const option = this.providerSelectEl.createEl('option', {
        value: module.manifest.id,
        text: module.manifest.displayName,
      });
      if (module.manifest.id === this.providerId) option.selected = true;
    }
    this.providerSelectEl.addEventListener('change', () => {
      this.providerId = this.providerSelectEl?.value ?? DEFAULT_CHAT_PROVIDER_ID;
    });

    // Textarea
    const inputRow = inputWrapper.createDiv({ cls: 'grimoire-input-row' });
    this.inputEl = inputRow.createEl('textarea', {
      cls: 'grimoire-input',
      attr: { placeholder: 'Send a message…', rows: '1' },
    });

    // Send button
    this.sendButtonEl = inputRow.createDiv({ cls: 'grimoire-send-button grimoire-header-btn' });
    setIcon(this.sendButtonEl, 'arrow-up');
    setTooltip(this.sendButtonEl, 'Send message');
    this.registerDomEvent(this.sendButtonEl, 'click', () => {
      void this.submitInput();
    });
  }

  private wireEventHandlers(): void {
    if (!this.inputEl) return;

    // Enter to send, Shift+Enter for newline
    this.registerDomEvent(this.inputEl, 'keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.submitInput();
      }
    });

    // Auto-resize textarea
    this.registerDomEvent(this.inputEl, 'input', () => {
      autoResizeTextarea(this.inputEl!);
      this.attachment?.setDraft(this.inputEl!.value);
    });
  }

  // ============================================
  // Conversation lifecycle
  // ============================================

  /**
   * Creates a new conversation in the revisioned repository through the
   * runtime, then attaches a projection listener.
   */
  private async ensureConversation(): Promise<void> {
    const lifecycle = this.plugin.applicationRuntime;
    if (!lifecycle) {
      this.renderError('Grimoire runtime is not available. Check the startup error and reload the plugin.');
      return;
    }
    if (!this.isActive) return;

    if (!this.conversationId) {
      this.conversationId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await lifecycle.runtime.createConversation({
          conversationId: this.conversationId,
          providerId: this.providerId,
          title: 'New Conversation',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exist/i.test(message)) {
          this.renderError(`Failed to start conversation: ${message}`);
          return;
        }
      }
    }

    await this.attachProjection();
  }

  private async startNewConversation(): Promise<void> {
    this.detachProjection();
    this.conversationId = null;
    this.lastRenderedMessageCount = -1;
    if (this.titleEl) this.titleEl.textContent = 'New conversation';
    await this.ensureConversation();
  }

  private async attachProjection(): Promise<void> {
    const lifecycle = this.plugin.applicationRuntime;
    if (!this.conversationId || !lifecycle || !this.messagesEl) return;

    this.detachProjection();

    const runtime = lifecycle.runtime;

    // Instantiate the rendering pipeline.
    if (!this.messageRenderer) {
      this.messageRenderer = new MessageRenderer(
        this.plugin,
        this,
        this.messagesEl,
        undefined, // rewindCallback — not wired in projection-backed mode yet
        undefined, // forkCallback
        () => getDefaultCapabilities(this.providerId),
        { getScrollEl: () => this.chatScrollEl ?? this.messagesEl! },
      );
    }

    if (!this.projectionRenderer) {
      this.projectionRenderer = new ChatProjectionRenderer(this);
    }

    // Build the attachment and view controller for this conversation.
    // ApplicationRuntime has attachConversation(); ChatProjectionSource needs attach().
    const projectionSource = {
      attach: (conversationId: string, listener: (projection: ChatProjection) => void) =>
        runtime.attachConversation(conversationId, listener),
    };
    this.attachment = new ChatProjectionAttachment(projectionSource, this.conversationId);

    const inputAdapter = new ChatInputCommandAdapter(
      { submitTurn: runtime.submitChatTurn.bind(runtime) },
      () => `cmd-${Date.now()}`,
    );

    this.viewController = new ChatProjectionViewController(
      {
        runtime,
        conversationId: this.conversationId,
        inputAdapter,
        renderer: this.projectionRenderer,
      },
      this.attachment,
    );

    // Subscribe to attachment state changes for draft/scroll sync.
    this.unsubscribeAttachment = this.attachment.subscribe(state => {
      // Title comes from the projection, not the attachment state.
      if (state.projection?.title && this.titleEl) {
        this.titleEl.textContent = state.projection.title;
      }
    });

    try {
      await this.viewController.attach();

      // Load the initial projection and render it.
      const projection = await this.viewController.load();
      this.viewController.render(projection);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.renderError(`Failed to attach conversation: ${message}`);
    }
  }

  private detachProjection(): void {
    if (this.unsubscribeAttachment) {
      this.unsubscribeAttachment();
      this.unsubscribeAttachment = null;
    }
    this.viewController?.detach();
    this.viewController = null;
    this.attachment = null;
  }

  // ============================================
  // ChatProjectionRenderTarget implementation
  // ============================================

  replace(model: ChatProjectionRenderModel): void {
    if (!this.messageRenderer) return;

    // Update title
    if (model.title && this.titleEl) {
      this.titleEl.textContent = model.title;
    }

    // Interactions render independently of the transcript: an open approval
    // must appear even when the message list is unchanged.
    this.renderInteractions(model.interactions);

    const messages = [...model.messages];

    // Full re-render when message count changes (new message added)
    // or on first render. This is the simplest correct approach —
    // MessageRenderer.renderMessages clears and rebuilds everything.
    if (messages.length !== this.lastRenderedMessageCount) {
      this.messageRenderer.renderMessages(messages, () => this.getGreeting());
      this.lastRenderedMessageCount = messages.length;
      return;
    }

    // Same message count but content may have changed (streaming).
    // Do a full re-render for now — incremental updates can be optimized later.
    this.messageRenderer.renderMessages(messages, () => this.getGreeting());
  }

  // ============================================
  // Interactions
  // ============================================

  /**
   * Renders the interactions the user can still act on. Presentation content is
   * fetched asynchronously; refs already in the cache render immediately, and a
   * missing one triggers one fetch followed by a re-render.
   */
  private renderInteractions(interactions: readonly InteractionProjection[]): void {
    if (!this.interactionRenderer) return;

    const visible = interactions.filter(
      interaction => interaction.status !== 'resolved'
        && interaction.status !== 'cancelled'
        && interaction.status !== 'expired',
    );

    const missing = visible
      .map(interaction => interaction.presentationRef)
      .filter(ref => !this.presentationCache.has(ref));
    if (missing.length > 0) {
      void this.loadPresentations(missing, interactions);
    }

    const models = visible.flatMap<InteractionPromptModel>(interaction => {
      const presentation = this.presentationCache.get(interaction.presentationRef);
      return presentation ? [{ interaction, presentation }] : [];
    });

    // Re-rendering unconditionally would drop focus while the user is choosing.
    const key = models
      .map(model => `${model.interaction.interactionId}:${model.interaction.status}`
        + `:${model.interaction.selectedResponseId ?? ''}`)
      .join('|');
    if (key === this.renderedInteractionKey) return;
    this.renderedInteractionKey = key;
    this.interactionRenderer.render(models);
  }

  private async loadPresentations(
    refs: readonly string[],
    interactions: readonly InteractionProjection[],
  ): Promise<void> {
    const lifecycle = this.plugin.applicationRuntime;
    if (!lifecycle) return;

    let loaded = false;
    for (const ref of new Set(refs)) {
      try {
        const presentation = await lifecycle.runtime.readInteractionPresentation(ref);
        if (presentation) {
          this.presentationCache.set(ref, presentation);
          loaded = true;
        }
      } catch (error) {
        // A prompt that cannot be read must not take the transcript down with
        // it; the interaction stays open and the next projection retries.
        void this.plugin.writeDebugLog?.({
          event: 'view.interaction.presentationFailed',
          level: 'warn',
          scope: 'view.interaction',
          data: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    if (loaded && this.isActive) {
      this.renderedInteractionKey = '';
      this.renderInteractions(interactions);
    }
  }

  private async respondToInteraction(interactionId: string, responseId: string): Promise<void> {
    const lifecycle = this.plugin.applicationRuntime;
    if (!lifecycle) return;
    try {
      await lifecycle.runtime.resolveInteraction({
        interactionId: interactionId as InteractionId,
        responseId,
        resolvedAt: Date.now(),
      });
    } catch (error) {
      new Notice(
        `Failed to answer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getGreeting(): string {
    return 'How can I help you today?';
  }

  private renderError(message: string): void {
    if (!this.messagesEl) return;
    this.messagesEl.empty();
    const errorEl = this.messagesEl.createDiv({
      cls: 'grimoire-message grimoire-message-error',
    });
    errorEl.createDiv({
      cls: 'grimoire-message-content',
      text: message,
    });
  }

  // ============================================
  // Submission
  // ============================================

  /**
   * Submits the current input text as a chat turn through the view controller.
   * The controller routes through the input adapter to the runtime's chat
   * coordinator, which persists the user message, creates the execution run,
   * and streams projection updates.
   */
  private async submitInput(): Promise<void> {
    const lifecycle = this.plugin.applicationRuntime;
    if (!lifecycle || !this.inputEl || !this.conversationId || !this.viewController) {
      new Notice('Runtime is not ready yet.');
      return;
    }
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';
    autoResizeTextarea(this.inputEl);

    const runtime = lifecycle.runtime;
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    try {
      // Launch resolution is provider-owned. The view supplies the prompt and
      // workspace root and receives an opaque request reference; it never
      // builds a launch specification.
      const prepared = await runtime.prepareChatTurn(this.providerId, {
        conversationId: this.conversationId,
        prompt: text,
        cwd: getVaultPath(this.app) ?? '',
        settings: this.plugin.settings,
      });

      await this.viewController.submitTurn({
        backendId: prepared.backendId,
        requestRef: prepared.requestRef,
        resultExpectation: 'required',
        userMessage,
      });
    } catch (error) {
      // Restore the draft so a failed send does not lose the user's message.
      if (this.inputEl && !this.inputEl.value) {
        this.inputEl.value = text;
        autoResizeTextarea(this.inputEl);
      }
      new Notice(`Failed to send: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ============================================
  // Legacy compatibility stubs
  // ============================================

  showPendingWhatsNew(): void {
    // What's New card rendering will be handled through projections.
  }

  async createNewTab(): Promise<void> {
    await this.startNewConversation();
  }

  requestTabClose(_tabId: TabId): void {
    // No-op: tabs are Obsidian view leaves now.
  }

  /** Legacy tab manager interface stub — returns null in the projection-backed architecture. */
  getTabManager(): GrimoireTabManagerStub | null {
    return null;
  }

  /**
   * Returns the active conversation context for legacy compatibility.
   * InlineEditModal and settings call this to resolve the current provider/model.
   */
  getActiveTab(): GrimoireActiveTabStub | null {
    return this.conversationId
      ? {
        conversationId: this.conversationId,
        providerId: this.providerId,
        draftModel: null,
        id: 'active',
        lifecycleState: 'bound_active',
        service: null,
        state: {},
        ui: {},
        draftSettings: {},
      }
      : null;
  }

  // Legacy compatibility stubs called by settings and inline edit.
  refreshModelSelector(): void { /* no-op */ }
  refreshTabControls(): void { /* no-op */ }
  updateLayoutForPosition(): void { /* no-op */ }
  updateHiddenProviderCommands(): void { /* no-op */ }
  invalidateProviderCommandCaches(_providerIds?: readonly string[]): void { /* no-op */ }
}
