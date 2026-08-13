import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice } from 'obsidian';

import type { LegacyProviderTabManagerHandle } from '../../core/providers/LegacyProviderContext';
import { VIEW_TYPE_GRIMOIRE } from '../../core/types';
import type GrimoirePlugin from '../../main';

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
 * projection listener, and renders updates through ChatProjectionRenderer.
 * It never creates, queries, cancels, or disposes execution resources.
 *
 * This replaces the legacy TabManager/Tab/InputController/StreamController
 * architecture. The legacy tab state (AppTabManagerState) is migrated to
 * conversation-level projection attachments.
 */
export class GrimoireView extends ItemView {
  private plugin: GrimoirePlugin;
  private conversationId: string | null = null;
  private messageContainerEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private projectionUnsubscribe: (() => void) | null = null;
  private isActive = false;

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
    // Create or restore a conversation on first open.
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
   * Creates a new conversation if none exists, or loads the existing one.
   * The conversation is owned by the ApplicationRuntime; the view only
   * attaches a projection listener.
   */
  private async ensureConversation(): Promise<void> {
    const runtime = this.plugin.applicationRuntime;
    if (!runtime || !this.isActive) return;

    // For now, create a fresh conversation. Migration of legacy tab state
    // will restore previously open conversations by their IDs.
    if (!this.conversationId) {
      this.conversationId = `conv-${Date.now()}`;
      // TODO: The conversation needs to be created in the revisioned repository
      // through the runtime's chat coordinator. For now, the view just displays
      // an empty state until a turn is submitted.
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
    // The full ChatProjectionRenderer renders messages, turns, interactions,
    // and agent work cards. For the initial cutover, we display the conversation
    // title and message count. The renderer will be wired in the next step.
    const p = projection as { title?: string; messages?: readonly unknown[] };
    this.messageContainerEl.empty();
    if (p.title) {
      this.messageContainerEl.createDiv({
        cls: 'grimoire-conversation-title',
        text: p.title,
      });
    }
    if (p.messages) {
      for (const message of p.messages) {
        const m = message as { role?: string; content?: string };
        this.messageContainerEl.createDiv({
          cls: `grimoire-message grimoire-message--${m.role ?? 'unknown'}`,
          text: m.content ?? '',
        });
      }
    }
  }

  private async submitInput(): Promise<void> {
    if (!this.inputEl || !this.conversationId || !this.plugin.applicationRuntime) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';
    try {
      // Submit through the runtime's chat coordinator. The actual command
      // construction (backend ID, request ref, result expectation) will be
      // handled by the coordinator or a view-level adapter.
      // For the initial cutover, this is a placeholder that shows the input
      // was accepted.
      new Notice('Message queued');
    } catch (error) {
      new Notice(`Failed to send: ${String(error)}`);
    }
  }

  // Legacy compatibility stubs — main.ts calls these but they are no-ops
  // in the projection-backed architecture. Tabs are optional Obsidian views.

  showPendingWhatsNew(): void {
    // What's New card rendering will be handled through projections.
  }

  async createNewTab(): Promise<void> {
    // Opening a new view leaf replaces tab creation.
    // main.ts handles leaf management.
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
        providerId: null,
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
