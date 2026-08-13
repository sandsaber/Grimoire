import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice } from 'obsidian';

import { executionBackendId } from '../../core/execution/ExecutionBackendDescriptor';
import type { LegacyProviderTabManagerHandle } from '../../core/providers/LegacyProviderContext';
import { VIEW_TYPE_GRIMOIRE } from '../../core/types';
import type { ChatMessage } from '../../core/types/chat';
import type GrimoirePlugin from '../../main';
import { builtInProviderCatalog } from '../../providers/BuiltInProviderCatalog';

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

/**
 * Projection-backed chat view. Owns presentation only — DOM, draft, scroll,
 * selection. Execution lifecycle is owned by the ApplicationRuntime.
 *
 * The view loads the active conversation from the runtime, attaches a
 * projection listener, and renders updates. It submits turns through the
 * runtime's chat coordinator and renders projection responses.
 */
export class GrimoireView extends ItemView {
  private plugin: GrimoirePlugin;
  private conversationId: string | null = null;
  private messageContainerEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private projectionUnsubscribe: (() => void) | null = null;
  private isActive = false;
  private readonly providerId = builtInProviderCatalog.list()[0]?.manifest.id ?? 'claude';

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
    if (!this.contentEl) return;

    this.contentEl.empty();
    this.contentEl.addClass('grimoire-container');
    this.contentEl.addClass('grimoire-container--chat-window');

    const shellEl = this.contentEl.createDiv({ cls: 'grimoire-chat-window-shell' });
    this.messageContainerEl = shellEl.createDiv({ cls: 'grimoire-tab-content-container grimoire-tab-content-container--chat-window grimoire-tab-content' });

    const inputContainer = shellEl.createDiv({ cls: 'grimoire-input-container' });
    this.inputEl = inputContainer.createEl('textarea', {
      cls: 'grimoire-input-textarea',
      attr: { placeholder: 'Send a message…', rows: '1' },
    });

    this.inputEl.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.submitInput();
      }
    });

    this.isActive = true;
    if (!this.conversationId) {
      await this.ensureConversation();
    }
  }

  async onClose(): Promise<void> {
    this.isActive = false;
    this.detachProjection();
    this.contentEl?.empty();
  }

  /**
   * Creates a new conversation in the revisioned repository through the
   * runtime, then attaches a projection listener.
   */
  private async ensureConversation(): Promise<void> {
    const lifecycle = this.plugin.applicationRuntime;
    if (!lifecycle || !this.isActive) return;

    if (!this.conversationId) {
      this.conversationId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Create the conversation in the revisioned repository so
      // loadConversation and attachConversation succeed.
      try {
        await lifecycle.composition.conversations.create({
          id: this.conversationId,
          providerId: this.providerId,
          title: 'New Conversation',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sessionId: null,
          messages: [],
        });
      } catch {
        // Conversation may already exist; that's fine.
      }
    }

    await this.attachProjection();
  }

  private async attachProjection(): Promise<void> {
    if (!this.conversationId || !this.plugin.applicationRuntime) return;
    this.detachProjection();
    try {
      const unsubscribe = await this.plugin.applicationRuntime.runtime.attachConversation(
        this.conversationId,
        projection => this.renderProjection(projection),
      );
      this.projectionUnsubscribe = unsubscribe;
    } catch {
      // Runtime may not be accepting yet; view will retry on next interaction.
    }
  }

  private detachProjection(): void {
    if (this.projectionUnsubscribe) {
      this.projectionUnsubscribe();
      this.projectionUnsubscribe = null;
    }
  }

  private renderProjection(projection: unknown): void {
    if (!this.messageContainerEl) return;
    const p = projection as { title?: string; messages?: readonly ChatMessage[] };
    this.messageContainerEl.empty();
    if (p.title) {
      this.messageContainerEl.createDiv({
        cls: 'grimoire-conversation-title',
        text: p.title,
      });
    }
    if (p.messages) {
      for (const message of p.messages) {
        this.messageContainerEl.createDiv({
          cls: `grimoire-message grimoire-message--${message.role}`,
          text: message.content ?? '',
        });
      }
    }
  }

  /**
   * Submits the current input text as a chat turn through the ApplicationRuntime.
   * The runtime persists the user message, creates the execution run, and
   * streams projection updates that this view renders.
   */
  private async submitInput(): Promise<void> {
    const lifecycle = this.plugin.applicationRuntime;
    if (!lifecycle || !this.inputEl || !this.conversationId) {
      new Notice('Runtime is not ready yet.');
      return;
    }
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';

    const composition = lifecycle.composition;
    const module = builtInProviderCatalog.list().find(m => m.manifest.id === this.providerId);
    const backendId = module?.execution.descriptor.backendId ?? executionBackendId(`provider-${this.providerId}`);
    const requestRef = composition.requests.register(`${this.providerId}-turn`, {
      startupRef: `startup-${Date.now()}`,
      restartFingerprint: `fp-${Date.now()}`,
      prompt: [{ type: 'text', text }],
    });

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    try {
      await lifecycle.runtime.submitChatTurn({
        commandId: `cmd-${Date.now()}`,
        conversationId: this.conversationId,
        backendId,
        requestRef,
        resultExpectation: 'required',
        userMessage,
      });
    } catch (error) {
      new Notice(`Failed to send: ${String(error)}`);
    }
  }

  // Legacy compatibility stubs — main.ts calls these but they are no-ops
  // in the projection-backed architecture.

  showPendingWhatsNew(): void {
    // What's New card rendering will be handled through projections.
  }

  async createNewTab(): Promise<void> {
    // Opening a new view leaf replaces tab creation.
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
