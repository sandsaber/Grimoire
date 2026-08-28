// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
patchSetMaxListenersForElectron();

import './providers';

import { randomUUID } from 'node:crypto';

import type { Command, Editor, WorkspaceLeaf } from 'obsidian';
import { addIcon, MarkdownView, Notice, Plugin, setTooltip } from 'obsidian';

import { ApplicationRuntime } from './app/ApplicationRuntime';
import { shouldShowWhatsNew } from './app/changelog/display';
import { parseChangelogRelease } from './app/changelog/parser';
import { readBundledChangelog } from './app/changelog/source';
import type { ChangelogRelease } from './app/changelog/types';
import type { ChatExecutionComposition } from './app/chat/ChatExecutionComposition';
import type { AntigravityExecution } from './app/execution/antigravity/AntigravityExecutionComposition';
import type { ClaudeExecution } from './app/execution/claude/ClaudeExecutionComposition';
import type { CodexExecution } from './app/execution/codex/CodexExecutionComposition';
import type { ExecutionKernelHost } from './app/execution/ExecutionKernelHost';
import type { GeminiExecution } from './app/execution/gemini/GeminiExecutionComposition';
import type { GrokExecution } from './app/execution/grok/GrokExecutionComposition';
import type { KimicodeExecution } from './app/execution/kimicode/KimicodeExecutionComposition';
import {
  type LocalShellCommandOutcome,
} from './app/execution/local/LocalShellExecution';
import type { MimocodeExecution } from './app/execution/mimocode/MimocodeExecutionComposition';
import type { OpencodeExecution } from './app/execution/opencode/OpencodeExecutionComposition';
import type { QwenExecution } from './app/execution/qwen/QwenExecutionComposition';
import { DEFAULT_GRIMOIRE_SETTINGS } from './app/settings/defaultSettings';
import { SharedStorageService } from './app/storage/SharedStorageService';
import type { UnreadableConversation } from './core/bootstrap/SessionStorage';
import {
  applyAssistantResponseMetadataToMessages,
  applyVaultSearchContextsToMessages,
  collectAssistantResponseMetadata,
  collectVaultSearchContexts,
  CONVERSATION_METADATA_FIELDS,
  type ConversationMetadataField,
} from './core/bootstrap/SessionStorage';
import type { SharedAppStorage } from './core/bootstrap/storage';
import { ConversationAlreadyExistsError } from './core/conversations/ConversationRepository';
import { type DebugLogEvent, DebugLogService } from './core/debug/DebugLogService';
import type { LocalShellInvocation } from './core/execution/local/LocalShellBackend';
import {
  resolveSettingsProviderId,
  resolveTitleGenerationProviderId,
} from './core/providers/modelRouting';
import { providerCatalog } from './core/providers/ProviderCatalog';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from './core/providers/providerEnvironment';
import type { ProviderHistoryHydration } from './core/providers/ProviderModule';
import { ProviderRegistry } from './core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from './core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceManager } from './core/providers/ProviderWorkspaceManager';
import { ProviderWorkspaceRegistry } from './core/providers/ProviderWorkspaceRegistry';
import type { ProviderId, ProviderWorkspaceServices } from './core/providers/types';
import type { AppTabManagerState } from './core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from './core/providers/types';
import { HomeFileAdapter } from './core/storage/HomeFileAdapter';
import type {
  Conversation,
  ConversationMeta,
  GrimoireSettings,
} from './core/types';
import {
  VIEW_TYPE_GRIMOIRE,
} from './core/types';
import {
  type ChatViewPlacement,
  type EnvironmentScope,
  normalizeMaxTabs,
} from './core/types/settings';
import { GrimoireView } from './features/chat/GrimoireView';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/InlineEditModal';
import { GrimoireSettingTab } from './features/settings/GrimoireSettings';
import { setLocale, t } from './i18n/i18n';
import type { Locale } from './i18n/types';
import {
  getClaudeProviderSettings,
  getClaudeRuntimeEnvironmentText,
  snapshotClaudeCodeSettings,
  updateClaudeProviderSettings,
} from './providers/claude/settings';
import { CCSettingsStorage } from './providers/claude/storage/CCSettingsStorage';
import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from './providers/opencode/modes';
import { GRIMOIRE_APP_ICON_ID, GRIMOIRE_APP_ICON_SVG } from './shared/appIcon';
import { buildCursorContext } from './utils/editor';
import { revealWorkspaceLeaf } from './utils/obsidianCompat';
import { getVaultPath } from './utils/path';

function isGrimoireView(value: unknown): value is GrimoireView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}

function formatHistoryModelFallbackLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return 'Unknown';
  }
  if (/^gpt-/i.test(trimmed)) {
    return trimmed
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-([a-z])/gi, (_, letter: string) => ` ${letter.toUpperCase()}`);
  }
  return trimmed
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

export default class GrimoirePlugin extends Plugin {
  settings!: GrimoireSettings;
  storage!: SharedAppStorage;
  private conversations: Conversation[] = [];
  /**
   * What the last hydration of each conversation reported.
   *
   * In memory only: it describes what this session found on disk, and a session
   * that starts again looks again.
   */
  private readonly historyHydration = new Map<string, ProviderHistoryHydration>();
  /**
   * Everything one load composes, owned by one object with one lifetime.
   *
   * These were eleven fields, each with a getter naming a provider. The getters
   * below still do — that is the seam the provider rows remove, since a
   * provider's registration asks the plugin for its own composition today — but
   * what they answer from is `ApplicationRuntime`, and it is what a reload
   * replaces.
   */
  private applicationRuntime: ApplicationRuntime | null = null;
  private unloading = false;
  private debugLogService: DebugLogService | null = null;
  private lastKnownTabManagerState: AppTabManagerState | null = null;
  private pendingWhatsNewRelease: ChangelogRelease | null = null;
  private pendingWhatsNewVersion = '';
  private ribbonIconEl: HTMLElement | null = null;
  private readonly shellCommands = new Map<string, Command>();
  private providerWorkspaces: ProviderWorkspaceManager<ProviderWorkspaceServices> | null = null;
  /**
   * Conversations the vault holds and this build cannot read.
   *
   * Kept beside the list rather than folded into it: they have no title, no
   * messages and no provider, and every conversation operation would have to
   * guard against that. The history surface renders them as their own row.
   */
  private unreadableConversations: readonly UnreadableConversation[] = [];

  async onload() {
    try {
      await this.loadSettings();
      await this.startExecutionKernel();
      await this.startProviderWorkspaces();
      await this.writeDebugLog({
        data: {
          providerCount: providerCatalog().ids().length,
        },
        event: 'loaded',
        level: 'info',
        scope: 'plugin',
      });
      addIcon(GRIMOIRE_APP_ICON_ID, GRIMOIRE_APP_ICON_SVG);
      await this.writeDebugLog({
        event: 'icon.registered',
        level: 'info',
        scope: 'plugin.onload',
      });

      this.registerView(
        VIEW_TYPE_GRIMOIRE,
        (leaf) => new GrimoireView(leaf, this)
      );
      await this.writeDebugLog({
        event: 'view.registered',
        level: 'info',
        scope: 'plugin.onload',
      });

      this.ribbonIconEl = this.addRibbonIcon(GRIMOIRE_APP_ICON_ID, t('plugin.openRibbon'), () => {
        void this.activateView();
      }) ?? null;
      await this.writeDebugLog({
        event: 'ribbon.registered',
        level: 'info',
        scope: 'plugin.onload',
      });

      this.registerShellCommand({
        id: 'open-view',
        name: t('plugin.openChatView'),
        callback: () => {
          void this.activateView();
        },
      });

      this.registerShellCommand({
        id: 'inline-edit',
        name: t('plugin.inlineEdit'),
        editorCallback: async (editor: Editor, ctx) => {
          const view = ctx instanceof MarkdownView
            ? ctx
            : this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!view) {
            new Notice(t('plugin.inlineEditViewUnavailable'));
            return;
          }

          const selectedText = editor.getSelection();
          const notePath = view.file?.path || 'unknown';

          let editContext: InlineEditContext;
          if (selectedText.trim()) {
            editContext = { mode: 'selection', selectedText };
          } else {
            const cursor = editor.getCursor();
            const cursorContext = buildCursorContext(
              (line) => editor.getLine(line),
              editor.lineCount(),
              cursor.line,
              cursor.ch
            );
            editContext = { mode: 'cursor', cursorContext };
          }

          const modal = new InlineEditModal(
            this.app,
            this,
            editor,
            view,
            editContext,
            notePath,
            () => this.getView()?.getActiveTab()?.ui.externalContextSelector?.getExternalContexts() ?? []
          );
          const result = await modal.openAndWait();

          if (result.decision === 'accept' && result.editedText !== undefined) {
            new Notice(t(editContext.mode === 'cursor' ? 'plugin.inlineEditInserted' : 'plugin.inlineEditApplied'));
          }
        },
      });

      this.registerShellCommand({
        id: 'new-tab',
        name: t('plugin.newTab'),
        checkCallback: (checking: boolean) => {
          if (!this.canCreateNewTab()) return false;

          if (!checking) {
            void this.openNewTab();
          }
          return true;
        },
      });

      this.registerShellCommand({
        id: 'new-session',
        name: t('plugin.newSession'),
        checkCallback: (checking: boolean) => {
          const view = this.getView();
          if (!view) return false;

          const tabManager = view.getTabManager();
          if (!tabManager) return false;

          const activeTab = tabManager.getActiveTab();
          if (!activeTab) return false;

          if (activeTab.state.isStreaming) return false;

          if (!checking) {
            void tabManager.createNewConversation();
          }
          return true;
        },
      });

      this.registerShellCommand({
        id: 'close-current-tab',
        name: t('plugin.closeCurrentTab'),
        checkCallback: (checking: boolean) => {
          const view = this.getView();
          if (!view) return false;

          const tabManager = view.getTabManager();
          if (!tabManager) return false;
          if (tabManager.getTabCount() <= 1) return false;

          if (!checking) {
            const activeTabId = tabManager.getActiveTabId();
            if (activeTabId) {
              void view.requestTabClose(activeTabId);
            }
          }
          return true;
        },
      });

      for (let index = 1; index <= 9; index++) {
        this.registerShellCommand({
          id: `switch-to-tab-${index}`,
          name: t('plugin.switchToTab', { index }),
          checkCallback: (checking: boolean) => {
            const view = this.getView();
            if (!view) return false;

            const tabManager = view.getTabManager();
            if (!tabManager) return false;

            const tabs = tabManager.getAllTabs();
            if (tabs.length < index) return false;

            if (!checking) {
              void tabManager.switchToTab(tabs[index - 1].id);
            }
            return true;
          },
        });
      }
      await this.writeDebugLog({
        event: 'commands.registered',
        level: 'info',
        scope: 'plugin.onload',
      });

      this.addSettingTab(new GrimoireSettingTab(this.app, this));
      await this.writeDebugLog({
        event: 'settings-tab.registered',
        level: 'info',
        scope: 'plugin.onload',
      });
      await this.maybeShowWhatsNew();
    } catch (error) {
      await this.writeDebugLog({
        event: 'onload.failed',
        level: 'error',
        scope: 'plugin.onload',
        error,
      });
      throw error;
    }
  }

  private registerShellCommand(command: Command): void {
    const registeredCommand = this.addCommand(command);
    this.shellCommands.set(command.id, registeredCommand ?? command);
  }

  refreshShellTranslations(): void {
    if (this.ribbonIconEl) {
      setTooltip(this.ribbonIconEl, t('plugin.openRibbon'));
    }

    const updateCommandName = (id: string, name: string): void => {
      const command = this.shellCommands.get(id);
      if (command) {
        command.name = name;
      }
    };

    updateCommandName('open-view', t('plugin.openChatView'));
    updateCommandName('inline-edit', t('plugin.inlineEdit'));
    updateCommandName('new-tab', t('plugin.newTab'));
    updateCommandName('new-session', t('plugin.newSession'));
    updateCommandName('close-current-tab', t('plugin.closeCurrentTab'));
    for (let index = 1; index <= 9; index++) {
      updateCommandName(`switch-to-tab-${index}`, t('plugin.switchToTab', { index }));
    }
  }

  onunload(): void {
    // Recorded before anything else, and synchronously. `onload` is async and
    // this is not withheld until it finishes, so unload can land while settings
    // are still loading — before the kernel exists to be told. Without this the
    // load that follows would open an acceptance gate for a plugin instance
    // that is gone, and the next reload would put a second registry on the same
    // control store: the dual ownership the host exists to prevent.
    this.unloading = true;
    this.recordDebugLog({
      event: 'unload',
      level: 'info',
      scope: 'plugin',
    });
    // Not awaited, because `onunload` returns void. The kernel's contract is
    // built for exactly that: the acceptance gate closes synchronously, so
    // nothing is admitted from here on, and the bounded cancellation and
    // cleanup that follow record a checkpoint the next startup recovers from.
    // Before the kernel, because it takes down whatever prompt is on screen and
    // releases the scratch directories a turn was holding; the kernel's own
    // shutdown then cancels what is still running.
    // Before the compositions, because a workspace holds vault-facing services
    // a composition may still be reading from. Not awaited, for the same reason
    // the kernel's shutdown is not: `onunload` returns void.
    void this.providerWorkspaces?.disposeAll();
    this.providerWorkspaces = null;
    // One call, and the order inside it is the runtime's: providers release the
    // scratch a turn was holding, the chat surface detaches what is watching
    // runs, and the kernel decides last what happens to the runs themselves.
    this.applicationRuntime?.dispose();
    this.applicationRuntime = null;
    void this.persistOpenTabStates();
  }

  /**
   * The chat execution path this plugin instance owns.
   *
   * One per load, for the reason the kernel is: a reload replaces it rather
   * than sharing one with the instance it replaced. One for every tab, because
   * a conversation's projection belongs to the conversation and two tabs open
   * on one chat must see one turn rather than two.
   */
  getChatExecution(): ChatExecutionComposition {
    if (!this.applicationRuntime) {
      throw new Error('Chat execution is not available before plugin load.');
    }
    return this.applicationRuntime.chat;
  }

  /**
   * The execution kernel this plugin instance owns.
   *
   * One per load, held here rather than in a module singleton: a singleton
   * outlives the instance a reload replaces, and two registries over one
   * control store would each believe they own every run in it.
   */
  /**
   * Everything this load composed, or `null` before it has.
   *
   * The `null` is the point: a tab can be built while `loadSettings` is still
   * running, and a caller that only wants to record something in passing should
   * skip it rather than throw. The getters below that must have it still throw.
   */
  getApplicationRuntimeOrNull(): ApplicationRuntime | null {
    return this.applicationRuntime;
  }

  getExecutionKernel(): ExecutionKernelHost {
    if (!this.applicationRuntime) {
      throw new Error('Execution kernel is not available before plugin load.');
    }
    return this.applicationRuntime.kernel;
  }

  /**
   * Antigravity's chat execution, held here for the duration of one load.
   *
   * A provider name on the plugin surface is not where this belongs, and it
   * does not stay: `ApplicationRuntime` becomes the composition root at M5 and
   * takes this with it. Until then the registration needs one object per load — the
   * request store the backend and every tab runtime must share — and this is
   * the only place with that lifetime.
   */
  getAntigravityExecution(): AntigravityExecution {
    if (!this.applicationRuntime) {
      throw new Error('Antigravity execution is not available before plugin load.');
    }
    return this.applicationRuntime.antigravity;
  }

  /** The Codex execution this plugin instance owns; see the note above. */
  getCodexExecution(): CodexExecution {
    if (!this.applicationRuntime) {
      throw new Error('Codex execution is not available before plugin load.');
    }
    return this.applicationRuntime.codex;
  }

  /** The Claude execution this plugin instance owns; see the note above. */
  getClaudeExecution(): ClaudeExecution {
    if (!this.applicationRuntime) {
      throw new Error('Claude execution is not available before plugin load.');
    }
    return this.applicationRuntime.claude;
  }

  /** The OpenCode execution this plugin instance owns; see the note above. */
  getOpencodeExecution(): OpencodeExecution {
    if (!this.applicationRuntime) {
      throw new Error('OpenCode execution is not available before plugin load.');
    }
    return this.applicationRuntime.opencode;
  }

  /** The Grok execution this plugin instance owns; see the note above. */
  getGrokExecution(): GrokExecution {
    if (!this.applicationRuntime) {
      throw new Error('Grok execution is not available before plugin load.');
    }
    return this.applicationRuntime.grok;
  }

  /** The MiMoCode execution this plugin instance owns; see the note above. */
  getMimocodeExecution(): MimocodeExecution {
    if (!this.applicationRuntime) {
      throw new Error('MiMoCode execution is not available before plugin load.');
    }
    return this.applicationRuntime.mimocode;
  }

  /** The Kimi Code execution this plugin instance owns; see the note above. */
  getKimicodeExecution(): KimicodeExecution {
    if (!this.applicationRuntime) {
      throw new Error('Kimi Code execution is not available before plugin load.');
    }
    return this.applicationRuntime.kimicode;
  }

  /** The Gemini execution this plugin instance owns; see the note above. */
  getGeminiExecution(): GeminiExecution {
    if (!this.applicationRuntime) {
      throw new Error('Gemini execution is not available before plugin load.');
    }
    return this.applicationRuntime.gemini;
  }

  /** The Qwen execution this plugin instance owns; see the note above. */
  getQwenExecution(): QwenExecution {
    if (!this.applicationRuntime) {
      throw new Error('Qwen execution is not available before plugin load.');
    }
    return this.applicationRuntime.qwen;
  }

  /**
   * Brings the kernel up before anything can ask it for work.
   *
   * A kernel that cannot start must not take the plugin down with it: the
   * providers running through it are Antigravity and Codex, and every other
   * surface is unaffected. The registry refuses work it never accepted, so a
   * failed start surfaces as refused turns for those two rather than a vault
   * without Grimoire in it.
   */
  /**
   * Brings every provider's workspace services up, isolated from each other.
   *
   * Startup awaits this and cannot be taken down by it: a provider whose
   * initializer throws is recorded and left retryable, and the others are
   * unaffected. The loop this replaces awaited each provider in turn with no
   * `try`, so one failure silently cost every provider after it in the
   * iteration order its command catalog, model list, CLI resolution and
   * settings tab.
   */
  private async startProviderWorkspaces(): Promise<void> {
    if (this.unloading) {
      return;
    }
    const manager = new ProviderWorkspaceManager<ProviderWorkspaceServices>({
      contribution: providerId => ({
        initialize: () => ProviderWorkspaceRegistry.createServices(providerId, this),
        // Legacy workspace services hold no process, watcher or timer — the
        // half is declared because a provider that grows one needs somewhere to
        // release it, and because init without dispose is what the first
        // attempt shipped.
        dispose: async () => {},
      }),
      publish: (providerId, services) => {
        ProviderWorkspaceRegistry.setServices(providerId, services ?? undefined);
      },
      reportFailure: ({ providerId, phase, error }) => {
        this.recordDebugLog({
          data: { phase, providerId },
          error,
          event: 'provider.workspace.failed',
          level: 'warn',
          scope: 'plugin',
        });
      },
    });
    this.providerWorkspaces = manager;
    await manager.initializeAll(providerCatalog().ids());
  }

  private async startExecutionKernel(): Promise<void> {
    if (this.unloading) {
      // Unload won the race with settings loading. A runtime built now would
      // open a gate that the shutdown which already ran can no longer close.
      return;
    }
    this.applicationRuntime = new ApplicationRuntime({
      plugin: this,
      adapter: this.storage.getAdapter(),
      sessions: this.storage.sessions,
      defaultProviderId: DEFAULT_CHAT_PROVIDER_ID,
      report: event => this.recordDebugLog(event),
      // Read per title rather than captured: the model that decides which
      // provider writes a title is a setting the user can change with tabs
      // already open.
      resolveTitleProviderId: () => resolveTitleGenerationProviderId(this.settings),
    });
    await this.applicationRuntime.start();
  }

  async writeDebugLog(event: DebugLogEvent): Promise<void> {
    await this.debugLogService?.write(event);
  }

  recordDebugLog(event: DebugLogEvent): void {
    void this.writeDebugLog(event);
  }

  getPendingWhatsNewRelease(): ChangelogRelease | null {
    return this.pendingWhatsNewRelease;
  }

  async acknowledgePendingWhatsNew(): Promise<void> {
    if (!this.pendingWhatsNewRelease || !this.pendingWhatsNewVersion) {
      return;
    }

    const version = this.pendingWhatsNewVersion;
    this.pendingWhatsNewRelease = null;
    this.pendingWhatsNewVersion = '';
    this.settings.lastSeenChangelogVersion = version;
    await this.saveSettings();
  }

  private async maybeShowWhatsNew(): Promise<void> {
    const currentVersion = this.manifest.version?.trim() ?? '';
    if (!shouldShowWhatsNew({
      currentVersion,
      lastSeenVersion: this.settings.lastSeenChangelogVersion,
    })) {
      return;
    }

    const markdown = await readBundledChangelog(this.app.vault.adapter, this.manifest);
    if (!markdown) {
      return;
    }

    const release = parseChangelogRelease(markdown, currentVersion);
    if (!release) {
      return;
    }

    this.pendingWhatsNewRelease = release;
    this.pendingWhatsNewVersion = currentVersion;
    for (const view of this.getAllViews()) {
      view.showPendingWhatsNew();
    }
  }

  private async persistOpenTabStates(): Promise<void> {
    // Ensures state is saved even if Obsidian quits without calling onClose()
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (tabManager) {
        const state = tabManager.getPersistedState();
        await this.persistTabManagerState(state);
      }
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_GRIMOIRE)[0];

    if (!leaf) {
      const newLeaf = this.getLeafForPlacement(this.settings.chatViewPlacement);
      if (newLeaf) {
        await newLeaf.setViewState({
          type: VIEW_TYPE_GRIMOIRE,
          active: true,
        });
        leaf = newLeaf;
      }
    }

    if (leaf) {
      await revealWorkspaceLeaf(workspace, leaf);
    }
  }

  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.app;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }

  private canCreateNewTab(): boolean {
    const hasGrimoireLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRIMOIRE).length > 0;
    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }

    if (hasGrimoireLeaf) {
      return false;
    }

    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
  }

  private async ensureViewOpen(): Promise<GrimoireView | null> {
    const existingView = this.getView();
    if (existingView) {
      return existingView;
    }

    await this.activateView();
    return this.getView();
  }

  private async openNewTab(): Promise<void> {
    const existingView = this.getView();
    if (existingView) {
      await existingView.createNewTab();
      return;
    }

    const restoredTabCount = this.getLastKnownOpenTabCount();
    const view = await this.ensureViewOpen();
    if (!view) {
      return;
    }

    // A cold-open view creates its initial tab during restore. Avoid stacking
    // an extra blank tab on top when there was no prior layout to restore.
    if (restoredTabCount === 0) {
      return;
    }

    await view.createNewTab();
  }

  async loadSettings() {
    this.storage = new SharedStorageService(this);
    const { grimoire } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_GRIMOIRE_SETTINGS,
      ...grimoire,
    };
    await this.hydrateClaudeCodeProjectSettingsSnapshot();
    this.debugLogService = new DebugLogService(
      this.storage.getAdapter(),
      () => this.settings?.debugLoggingEnabled === true,
    );
    this.recordDebugLog({
      data: {
        debugLoggingEnabled: this.settings.debugLoggingEnabled === true,
      },
      event: 'settings.loaded',
      level: 'info',
      scope: 'plugin',
    });

    // Plan mode is ephemeral — normalize back to normal on load so the app
    // doesn't start stuck in plan mode after a restart (prePlanPermissionMode is lost)
    if (this.settings.permissionMode === 'plan') {
      this.settings.permissionMode = 'normal';
    }
    if (
      this.settings.savedProviderPermissionMode
      && typeof this.settings.savedProviderPermissionMode === 'object'
      && !Array.isArray(this.settings.savedProviderPermissionMode)
    ) {
      for (const [providerId, mode] of Object.entries(this.settings.savedProviderPermissionMode)) {
        if (mode === 'plan') {
          this.settings.savedProviderPermissionMode[providerId] = 'normal';
        }
      }
    }
    const opencodeConfig = this.settings.providerConfigs?.opencode;
    if (
      opencodeConfig
      && typeof opencodeConfig === 'object'
      && !Array.isArray(opencodeConfig)
      && opencodeConfig.selectedMode === OPENCODE_PLAN_MODE_ID
    ) {
      opencodeConfig.selectedMode = OPENCODE_SAFE_MODE_ID;
    }

    const didNormalizeProviderSelection = ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();

    const listing = await this.storage.sessions.listConversations();
    this.unreadableConversations = listing.unreadable;
    // The same projection the execution path applies to the one conversation a
    // turn is running on. Two copies of it means a conversation means one thing
    // to a tab and another to the turn inside it.
    this.conversations = listing.metadata.map(meta => (
      this.storage.sessions.toConversation(meta, DEFAULT_CHAT_PROVIDER_ID)
    )).sort(
      (a, b) => (b.lastResponseAt ?? b.updatedAt) - (a.lastResponseAt ?? a.updatedAt)
    );
    setLocale(this.settings.locale as Locale);

    const backfilledConversations = this.backfillConversationResponseTimestamps();

    const { changed, invalidatedConversations } = this.reconcileModelWithEnvironment();

    ProviderSettingsCoordinator.projectActiveProviderState(
      this.settings,
    );

    if (changed || didNormalizeModelVariants || didNormalizeProviderSelection) {
      await this.saveSettings();
    }

    // Two different repairs, and each writes only what it repaired: the backfill
    // sets a timestamp, and an invalidation clears the session binding. A whole
    // conversation written here would take a message appended in another window
    // with it.
    for (const conv of backfilledConversations) {
      await this.storage.sessions.updateMetadata(conv, ['lastResponseAt']);
    }
    for (const conv of invalidatedConversations) {
      await this.storage.sessions.updateMetadata(conv, SESSION_INVALIDATION_FIELDS);
    }
  }

  private async hydrateClaudeCodeProjectSettingsSnapshot(): Promise<void> {
    try {
      const claudeSettings = getClaudeProviderSettings(this.settings);
      const projectSettings = await new CCSettingsStorage(this.storage.getAdapter()).load();
      const userSettings = claudeSettings.loadUserSettings
        ? await new CCSettingsStorage(new HomeFileAdapter()).load()
        : {};
      updateClaudeProviderSettings(
        this.settings,
        {
          projectSettingsSnapshot: snapshotClaudeCodeSettings({
            includeUserSettings: claudeSettings.loadUserSettings,
            user: userSettings,
            project: projectSettings,
          }),
        },
      );
    } catch {
      updateClaudeProviderSettings(
        this.settings,
        { projectSettingsSnapshot: snapshotClaudeCodeSettings({ includeUserSettings: false }) },
      );
    }
  }

  private backfillConversationResponseTimestamps(): Conversation[] {
    const updated: Conversation[] = [];
    for (const conv of this.conversations) {
      if (conv.lastResponseAt != null) continue;
      if (!conv.messages || conv.messages.length === 0) continue;

      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (msg.role === 'assistant') {
          conv.lastResponseAt = msg.timestamp;
          updated.push(conv);
          break;
        }
      }
    }
    return updated;
  }

  normalizeModelVariantSettings(): boolean {
    return ProviderSettingsCoordinator.normalizeAllModelVariants(
      this.settings,
    );
  }

  async saveSettings() {
    ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    ProviderSettingsCoordinator.persistProjectedProviderState(
      this.settings,
    );

    await this.storage.saveGrimoireSettings(this.settings);
    this.recordDebugLog({
      data: {
        debugLoggingEnabled: this.settings.debugLoggingEnabled === true,
        settingsProvider: this.settings.settingsProvider,
      },
      event: 'settings.saved',
      level: 'debug',
      scope: 'settings',
    });
  }

  /** Updates and persists environment variables, restarting processes to apply changes. */
  async applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
    await this.applyEnvironmentVariablesBatch([{ scope, envText }]);
  }

  async applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    const settingsBag = this.settings as unknown as Record<string, unknown>;
    const nextEnvironmentByScope = new Map<EnvironmentScope, string>();
    for (const update of updates) {
      nextEnvironmentByScope.set(update.scope, update.envText);
    }

    const changedScopes: EnvironmentScope[] = [];
    for (const [scope, envText] of nextEnvironmentByScope) {
      const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
      if (currentValue !== envText) {
        changedScopes.push(scope);
      }
      setEnvironmentVariablesForScope(settingsBag, scope, envText);
    }

    if (changedScopes.length === 0) {
      await this.saveSettings();
      return;
    }

    const affectedProviderIds = this.getAffectedEnvironmentProviders(changedScopes);
    ProviderSettingsCoordinator.handleEnvironmentChange(settingsBag, affectedProviderIds);
    const { changed, invalidatedConversations } = this.reconcileModelWithEnvironment(affectedProviderIds);
    await this.saveSettings();

    if (invalidatedConversations.length > 0) {
      for (const conv of invalidatedConversations) {
        await this.storage.sessions.updateMetadata(conv, SESSION_INVALIDATION_FIELDS);
      }
    }

    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      const affectedTabs = tabManager.getAllTabs().filter((tab) => (
        affectedProviderIds.includes(tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID)
      ));
      const syncTabRuntimeState = (tab: (typeof affectedTabs)[number]): void => {
        if (!tab.service || !tab.serviceInitialized) {
          return;
        }

        const conversation = tab.conversationId
          ? this.getConversationSync(tab.conversationId)
          : null;
        const hasConversationContext = (conversation?.messages.length ?? 0) > 0;
        const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
          ?? (hasConversationContext
            ? conversation?.externalContextPaths ?? []
            : this.settings.persistentExternalContextPaths ?? []);

        tab.service.syncConversationState(conversation, externalContextPaths);
      };

      for (const tab of affectedTabs) {
        if (tab.state.isStreaming) {
          tab.controllers.inputController?.cancelStreaming();
        }
      }

      let failedTabs = 0;
      if (changed) {
        for (const tab of affectedTabs) {
          if (!tab.service || !tab.serviceInitialized) {
            continue;
          }
          try {
            syncTabRuntimeState(tab);
            tab.service.resetSession();
            await tab.service.ensureReady();
          } catch {
            failedTabs++;
          }
        }
      } else {
        for (const tab of affectedTabs) {
          if (!tab.service || !tab.serviceInitialized) {
            continue;
          }
          try {
            syncTabRuntimeState(tab);
            await tab.service.ensureReady({ force: true });
          } catch {
            failedTabs++;
          }
        }
      }
      if (failedTabs > 0) {
        new Notice(t('plugin.environmentRestartFailed', { count: failedTabs }));
      }
    }

    for (const openView of this.getAllViews()) {
      openView.invalidateProviderCommandCaches(affectedProviderIds);
      openView.refreshModelSelector();
    }

    const noticeText = changed
      ? t('plugin.environmentAppliedRebuild')
      : t('plugin.environmentApplied');
    new Notice(noticeText);
  }

  /** Returns the runtime environment variables (fixed at plugin load). */
  getActiveEnvironmentVariables(
    providerId: ProviderId = resolveSettingsProviderId(
      this.settings,
    ),
  ): string {
    if (providerId === 'claude') {
      return getClaudeRuntimeEnvironmentText(
        this.settings,
      );
    }

    return getRuntimeEnvironmentText(
      this.settings,
      providerId,
    );
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getScopedEnvironmentVariables(
      this.settings,
      scope,
    );
  }

  /**
   * Runs one shell command on the kernel.
   *
   * The bang-bash surface's only way to reach a process. It used to hold its
   * own `child_process` handle inside the chat feature, which meant a command
   * still running at unload had nobody to stop it.
   */
  async runShellCommand(invocation: LocalShellInvocation): Promise<LocalShellCommandOutcome> {
    const shell = this.applicationRuntime?.localShell;
    if (!shell) {
      throw new Error('Shell execution is not available.');
    }
    return shell.run(invocation);
  }

  getResolvedProviderCliPath(providerId: ProviderId): string | null {
    const cliResolver = ProviderWorkspaceRegistry.getCliResolver(providerId);
    if (!cliResolver) {
      return null;
    }

    return cliResolver.resolveFromSettings(this.settings);
  }

  private reconcileModelWithEnvironment(
    providerIds: readonly ProviderId[] = providerCatalog().ids(),
  ): {
    changed: boolean;
    invalidatedConversations: Conversation[];
  } {
    return ProviderSettingsCoordinator.reconcileProviders(
      this.settings,
      this.conversations,
      providerIds,
    );
  }

  private getAffectedEnvironmentProviders(scopes: EnvironmentScope[]): ProviderId[] {
    const registeredProviderIds = new Set(providerCatalog().ids());
    const affectedProviderIds = new Set<ProviderId>();

    for (const scope of scopes) {
      if (scope === 'shared') {
        for (const providerId of registeredProviderIds) {
          affectedProviderIds.add(providerId);
        }
        continue;
      }

      const providerId = scope.slice('provider:'.length);
      if (registeredProviderIds.has(providerId)) {
        affectedProviderIds.add(providerId);
      }
    }

    return Array.from(affectedProviderIds);
  }

  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDefaultTitle(): string {
    const now = new Date();
    return now.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private getConversationPreview(conv: Conversation): string {
    const firstUserMsg = conv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) {
      return 'New conversation';
    }
    return firstUserMsg.content.substring(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
  }

  private async loadSdkMessagesForConversation(conversation: Conversation): Promise<void> {
    const hydration = await ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .hydrateConversationHistory(conversation, getVaultPath(this.app));
    // Kept per conversation rather than returned, because the callers that open
    // one — `switchConversation`, `getConversationById` — hand back the
    // conversation itself and the surface asks separately. What it is for is a
    // conversation whose transcript could not be loaded: without this it looks
    // exactly like a conversation with nothing in it.
    this.historyHydration.set(conversation.id, hydration);
    applyVaultSearchContextsToMessages(
      conversation.messages,
      conversation.vaultSearchContexts,
    );
    applyAssistantResponseMetadataToMessages(
      conversation.messages,
      conversation.assistantResponseMetadata,
    );
  }

  async createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    model?: string;
  }): Promise<Conversation> {
    const providerId = options?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    const sessionId = options?.sessionId;
    const build = (id: string): Conversation => ({
      id,
      providerId,
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: sessionId ?? null,
      model: options?.model,
      messages: [],
    });

    // A conversation created from a live session is keyed by that session id,
    // which is how its transcript is found again. When the vault already holds
    // one under that id, the new chat takes an id of its own and keeps the
    // session in its `sessionId` field, so resume still works and the existing
    // conversation is left alone. Written as a refusal and a retry rather than
    // a lookup first: the store serializes per id, and a check-then-write can
    // lose the race with another window.
    let conversation = build(sessionId ?? this.generateConversationId());
    try {
      await this.storage.sessions.createMetadata(
        this.storage.sessions.toSessionMetadata(conversation)
      );
    } catch (error) {
      if (!(error instanceof ConversationAlreadyExistsError)) {
        throw error;
      }
      this.recordDebugLog({
        data: { conversationId: conversation.id },
        event: 'conversation.create.collision',
        level: 'warn',
        scope: 'plugin',
      });
      conversation = build(this.generateConversationId());
      await this.storage.sessions.createMetadata(
        this.storage.sessions.toSessionMetadata(conversation)
      );
    }

    // After the write, so a refused id never reaches the in-memory list.
    this.conversations.unshift(conversation);

    return conversation;
  }

  async switchConversation(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return null;

    await this.loadSdkMessagesForConversation(conversation);

    return conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    const index = this.conversations.findIndex(c => c.id === id);
    if (index === -1) return;

    const conversation = this.conversations[index];
    this.conversations.splice(index, 1);

    await ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .deleteConversationSession(conversation, getVaultPath(this.app));

    await this.storage.sessions.deleteMetadata(id);
    this.historyHydration.delete(id);

    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      for (const tab of tabManager.getAllTabs()) {
        if (tab.conversationId === id) {
          tab.controllers.inputController?.cancelStreaming();
          await tab.controllers.conversationController?.createNew({ force: true });
        }
      }
    }

    await this.deleteConversationControlRecords(id);
  }

  /**
   * Removes what the execution kernel recorded about a conversation (D4).
   *
   * Last, and after the tabs holding it have been moved off it. The waiting is
   * the registry's: cancelling a tab's turn is fire-and-forget and its disposal
   * is a void call on a queue, so a caller can only ask — `deleteOwnedRecords`
   * cancels and disposes what the conversation owns before removing anything.
   * Retention is tied to the conversation's lifetime and to nothing else — no
   * clock expires a run record — so this is the only thing that removes one.
   *
   * Reported rather than thrown: a conversation the user deleted is gone from
   * the vault either way, and a failure here must not leave them looking at a
   * chat that would not delete.
   */
  private async deleteConversationControlRecords(id: string): Promise<void> {
    if (!this.applicationRuntime) {
      return;
    }
    const owner = { kind: 'conversation' as const, ownerId: id };
    try {
      await this.applicationRuntime.kernel.registry.deleteOwnedRecords(owner);
    } catch (error) {
      this.recordDebugLog({
        error,
        event: 'execution.control.deleteFailed',
        level: 'warn',
        scope: 'plugin',
      });
    }
    // **Its own call, because the two stores are two domains.** The registry
    // removes sessions, runs, interactions and reconciliations and knows
    // nothing about agents, which is right; D3 keeps an agent's records until
    // its owning conversation is deleted, and this is the deletion. Attempted
    // even when the first failed: they are separate stores, and leaving one
    // full because the other would not empty helps nobody.
    try {
      await this.applicationRuntime.agents.deleteOwnedRecords(
        owner,
        `tx-${randomUUID().replaceAll('-', '')}`,
      );
    } catch (error) {
      this.recordDebugLog({
        error,
        event: 'agents.control.deleteFailed',
        level: 'warn',
        scope: 'plugin',
      });
    }
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    conversation.title = title.trim() || this.generateDefaultTitle();
    conversation.updatedAt = Date.now();

    // The title and nothing else. A rename that landed mid-stream used to write
    // the whole conversation this window was holding, which put back the
    // messages it had before the stream started.
    await this.storage.sessions.updateMetadata(conversation, ['title']);

    for (const view of this.getAllViews()) {
      view.getTabManager()?.notifyConversationRenamed?.(id, conversation.title);
    }
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    // providerId is immutable — strip it from updates to prevent accidental mutation
    const safeUpdates = { ...updates };
    delete safeUpdates.providerId;
    Object.assign(conversation, safeUpdates, { updatedAt: Date.now() });
    conversation.vaultSearchContexts = collectVaultSearchContexts(conversation.messages);
    conversation.assistantResponseMetadata = collectAssistantResponseMetadata(conversation.messages);

    // **What this caller actually set**, not everything it happens to hold. The
    // callers already speak in deltas — a status, a model, a message list — and
    // this is where that was being thrown away.
    await this.storage.sessions.updateMetadata(
      conversation,
      conversationMetadataFields(safeUpdates),
    );

    // Clear image data from memory after save (data is persisted by SDK).
    // Skip for pending forks: their deep-cloned images aren't in SDK storage yet.
    if (!ProviderRegistry.getConversationHistoryService(conversation.providerId).isPendingForkConversation(conversation)) {
      for (const msg of conversation.messages) {
        if (msg.images) {
          for (const img of msg.images) {
            img.data = '';
          }
        }
      }
    }
  }

  /**
   * What happened the last time this conversation's history was loaded.
   *
   * `undefined` before it has been opened. The surface reads this to say why a
   * transcript is short or empty, which the provider knew and nobody carried.
   */
  getHistoryHydration(conversationId: string): ProviderHistoryHydration | undefined {
    return this.historyHydration.get(conversationId);
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id) || null;

    if (conversation) {
      await this.loadSdkMessagesForConversation(conversation);
    }

    return conversation;
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversations.find(c => c.id === id) || null;
  }

  findEmptyConversation(): Conversation | null {
    return this.conversations.find(c => c.messages.length === 0) || null;
  }

  /**
   * Conversations the vault holds and this build cannot read.
   *
   * Answered separately from `getConversationList`, because they have no title,
   * no messages and no provider: folding them into that list would make every
   * consumer of it — tab titles, search, delete-all — guard against a
   * conversation that cannot be opened.
   */
  getUnreadableConversations(): readonly UnreadableConversation[] {
    return this.unreadableConversations;
  }

  getConversationList(): ConversationMeta[] {
    return this.conversations.map(c => ({
      id: c.id,
      providerId: c.providerId,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastResponseAt: c.lastResponseAt,
      messageCount: c.messages.length,
      preview: this.getConversationPreview(c),
      modelLabel: this.getConversationModelLabel(c),
      sourceCount: this.getConversationSourceCount(c),
      usagePercentage: c.usage?.percentage,
      titleGenerationStatus: c.titleGenerationStatus,
    }));
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  getView(): GrimoireView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRIMOIRE);
    return leaves.map(leaf => leaf.view).find(isGrimoireView) ?? null;
  }

  getAllViews(): GrimoireView[] {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRIMOIRE);
    return leaves.map(leaf => leaf.view).filter(isGrimoireView);
  }

  findConversationAcrossViews(conversationId: string): { view: GrimoireView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
  }

  private getLastKnownOpenTabCount(): number {
    return this.lastKnownTabManagerState?.openTabs.length ?? 0;
  }

  private getMaxTabsLimit(): number {
    return normalizeMaxTabs(this.settings.maxTabs);
  }

  private getConversationModelLabel(conversation: Conversation): string | undefined {
    const model = conversation.usage?.model?.trim();
    if (!model) {
      return providerCatalog().displayName(conversation.providerId);
    }

    const modelInfo = providerCatalog().declarations(conversation.providerId)
      .chatUI.models.options(this.settings)
      .find(option => option.value === model);
    return modelInfo?.label ?? formatHistoryModelFallbackLabel(model);
  }

  private getConversationSourceCount(conversation: Conversation): number | undefined {
    const sources = new Set<string>();

    if (conversation.currentNote) {
      sources.add(conversation.currentNote);
    }

    for (const path of conversation.externalContextPaths ?? []) {
      sources.add(path);
    }

    for (const message of conversation.messages) {
      const context = message.vaultSearchContext;
      if (!context) continue;
      for (const snippet of context.snippets) {
        sources.add(snippet.source.path);
      }
    }

    for (const entry of conversation.vaultSearchContexts ?? []) {
      for (const snippet of entry.context.snippets) {
        sources.add(snippet.source.path);
      }
    }

    return sources.size > 0 ? sources.size : undefined;
  }

}

/**
 * What an environment change clears when it invalidates a conversation.
 *
 * The reconcilers set exactly these two: the session is no longer resumable and
 * the provider's own state described a session that is gone. Everything else
 * the conversation holds is untouched, so nothing else is written.
 */
const SESSION_INVALIDATION_FIELDS: readonly ConversationMetadataField[] = [
  'sessionId',
  'providerState',
];

/**
 * The metadata fields an update actually set.
 *
 * Callers already pass deltas — `{ titleGenerationStatus }`, `{ model }`, the
 * stream's message list — and this is what keeps them deltas all the way to the
 * file. A key that is not a metadata field, or one this build does not persist,
 * is dropped rather than written.
 */
function conversationMetadataFields(
  updates: Partial<Conversation>,
): ConversationMetadataField[] {
  return CONVERSATION_METADATA_FIELDS.filter(field => field in updates);
}
