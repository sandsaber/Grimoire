import type { Component, WorkspaceLeaf } from 'obsidian';

import type { ChatTabExecution } from '../../../app/chat/ChatTabExecution';
import type { ProviderAgentMentionService } from '../../../app/mentions/ProviderAgentMentionService';
import type { RelevantNotesService } from '../../../core/context/RelevantNotesService';
import type { VaultSearchService } from '../../../core/context/VaultSearchService';
import type { VaultTextIndex } from '../../../core/context/VaultTextIndex';
import type { InstructionRefineService, ProviderId, TitleGenerationService } from '../../../core/providers/types';
import type { ExecutionChatRuntimeAdapter } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { UsageInfo } from '../../../core/types';
import type { SlashCommandDropdown } from '../../../shared/components/SlashCommandDropdown';
import type { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import type { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import type { ConversationController } from '../controllers/ConversationController';
import type { InputController } from '../controllers/InputController';
import type { NavigationController } from '../controllers/NavigationController';
import type { SelectionController } from '../controllers/SelectionController';
import type { StreamController } from '../controllers/StreamController';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { BangBashModeManager } from '../ui/BangBashModeManager';
import type { RuntimeContextActivityView } from '../ui/context/RuntimeContextActivity';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type {
  ContextUsageMeter,
  ExternalContextSelector,
  McpServerSelector,
  ModelSelector,
  ModeSelector,
  OrchestratorToggle,
  PermissionToggle,
  PlanUsageBadge,
  ProjectWorkspaceSelector,
  ServiceTierToggle,
  ThinkingBudgetSelector,
} from '../ui/InputToolbar';
import type { InstructionModeManager } from '../ui/InstructionModeManager';
import type { NavigationSidebar } from '../ui/NavigationSidebar';
import type { RelevantNotesView } from '../ui/RelevantNotesView';
import type { StatusPanel } from '../ui/StatusPanel';

export {
  DEFAULT_MAX_TABS,
  MAX_TABS,
  MIN_TABS,
  normalizeMaxTabs,
} from '../../../core/types/settings';

/**
 * Minimal interface for the GrimoireView methods used by TabManager and Tab.
 * Extends Component for Obsidian integration (event handling, cleanup).
 * Avoids circular dependency by not importing GrimoireView directly.
 */
export interface TabManagerViewHost extends Component {
  /** Reference to the workspace leaf for revealing the view. */
  leaf: WorkspaceLeaf;

  /** Gets the tab manager instance (used for cross-view coordination). */
  getTabManager(): TabManagerInterface | null;
}

/**
 * Minimal interface for TabManager methods used by external code.
 * Used to break circular dependencies.
 */
export interface TabManagerInterface {
  /** Switches to a specific tab. */
  switchToTab(tabId: TabId): Promise<void>;

  /** Gets all tabs. */
  getAllTabs(): TabData[];

  /** Refreshes tab-bar titles for tabs displaying a renamed conversation. */
  notifyConversationRenamed?(conversationId: string, title: string): void;
}

/** Tab identifier type. */
export type TabId = string;

/** Keeps custom tab names readable in menus, toasts, and persisted state. */
export const MAX_TAB_TITLE_LENGTH = 100;

export type TabPanelView = 'chat' | 'sources' | 'context';

/** Generates a unique tab ID. */
export function generateTabId(): TabId {
  return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Controllers managed per-tab.
 * Each tab has its own set of controllers for independent operation.
 */
export interface TabControllers {
  selectionController: SelectionController | null;
  browserSelectionController: BrowserSelectionController | null;
  canvasSelectionController: CanvasSelectionController | null;
  conversationController: ConversationController | null;
  streamController: StreamController | null;
  inputController: InputController | null;
  navigationController: NavigationController | null;
}

/**
 * Services managed per-tab.
 */
export interface TabServices {
  /**
   * The `@agents/` list per provider this tab has shown.
   *
   * Per tab and per provider, because the mention dropdown compares the service
   * it was handed by identity: a new object on every render would close the
   * list while the user is typing into it.
   */
  agentMentionServices: Map<ProviderId, ProviderAgentMentionService>;
  subagentManager: SubagentManager;
  instructionRefineService: InstructionRefineService | null;
  titleGenerationService: TitleGenerationService | null;
  vaultTextIndex: VaultTextIndex | null;
  vaultSearchService: VaultSearchService | null;
  relevantNotesService: RelevantNotesService | null;
}

/**
 * UI components managed per-tab.
 */
export interface TabUIComponents {
  fileContextManager: FileContextManager | null;
  imageContextManager: ImageContextManager | null;
  modelSelector: ModelSelector | null;
  planUsageBadge: PlanUsageBadge | null;
  modeSelector: ModeSelector | null;
  thinkingBudgetSelector: ThinkingBudgetSelector | null;
  externalContextSelector: ExternalContextSelector | null;
  mcpServerSelector: McpServerSelector | null;
  permissionToggle: PermissionToggle | null;
  serviceTierToggle: ServiceTierToggle | null;
  orchestratorToggle: OrchestratorToggle | null;
  projectWorkspaceSelector: ProjectWorkspaceSelector | null;
  slashCommandDropdown: SlashCommandDropdown | null;
  instructionModeManager: InstructionModeManager | null;
  bangBashModeManager: BangBashModeManager | null;
  contextUsageMeter: ContextUsageMeter | null;
  runtimeContextActivity: RuntimeContextActivityView | null;
  statusPanel: StatusPanel | null;
  navigationSidebar: NavigationSidebar | null;
  relevantNotesView: RelevantNotesView | null;
}

/**
 * DOM elements managed per-tab.
 */
export interface TabDOMElements {
  contentEl: HTMLElement;

  /** Final chat-window structural handles. */
  workbenchGridEl: HTMLElement;
  contextRailEl: HTMLElement;
  contextMemoryEl: HTMLElement;
  contextRuntimeEl: HTMLElement;
  contextSummaryEl: HTMLElement;
  chatStageEl: HTMLElement;
  chatScrollEl: HTMLElement;
  sourceRailEl: HTMLElement;
  sourceCardsEl: HTMLElement;
  sourceFiltersEl: HTMLElement;
  sourceShownCountEl: HTMLElement;
  composerSurfaceEl: HTMLElement;

  /** Current-tab view tabs. */
  panelTabsEl: HTMLElement;
  chatPanelButtonEl: HTMLButtonElement;
  sourcesPanelButtonEl: HTMLButtonElement;
  contextPanelButtonEl: HTMLButtonElement;

  /** Current-tab content regions. */
  focusedMainEl: HTMLElement;
  focusedChatPanelEl: HTMLElement;
  focusedSourcesPanelEl: HTMLElement;
  focusedContextPanelEl: HTMLElement;

  boundStatusEl: HTMLElement;
  boundStatusDotEl: HTMLElement;
  boundStatusNoteEl: HTMLElement;
  boundStatusMetaEl: HTMLElement;

  messagesEl: HTMLElement;
  welcomeEl: HTMLElement | null;

  /** Container for status panel (fixed between messages and input). */
  statusPanelContainerEl: HTMLElement;

  inputContainerEl: HTMLElement;
  queueIndicatorEl: HTMLElement;
  inputWrapper: HTMLElement;
  inputEl: HTMLTextAreaElement;
  sendButtonEl: HTMLButtonElement | null;
  stopButtonEl: HTMLButtonElement | null;

  /** Context row for file chips and selection indicator (inside input wrapper). */
  contextRowEl: HTMLElement;

  selectionIndicatorEl: HTMLElement | null;
  browserIndicatorEl: HTMLElement | null;
  canvasIndicatorEl: HTMLElement | null;

  /** Cleanup functions for event listeners (prevents memory leaks). */
  eventCleanups: Array<() => void>;
}

/**
 * Tab lifecycle states:
 * - `blank`: No conversation binding, no runtime. Draft model selection only.
 * - `bound_cold`: Bound to a conversation, but runtime not started yet.
 * - `bound_active`: Bound to a conversation with a running runtime.
 * - `closing`: Tab is being torn down.
 */
export type TabLifecycleState = 'blank' | 'bound_cold' | 'bound_active' | 'closing';

/**
 * Represents a single tab in the multi-tab system.
 * Each tab is an independent chat session with its own runtime instance.
 */
export interface TabData {
  /** Unique tab identifier. */
  id: TabId;

  /** Explicit lifecycle state. */
  lifecycleState: TabLifecycleState;

  /**
   * Draft model selected in a blank tab (before first send).
   * Used to derive provider on first send. Null after binding.
   */
  draftModel: string | null;

  /**
   * Draft provider settings selected before first send.
   * Used to restore cold tabs and seed the runtime when the tab first binds.
   */
  draftSettings: Record<string, unknown> | null;

  /** Active provider for this tab's current conversation/runtime. */
  providerId: ProviderId;

  /** Conversation ID bound to this tab (null for new/empty tabs). */
  conversationId: string | null;

  /** Optional user-defined title for an unbound tab. */
  titleOverride?: string | null;

  /** Per-tab chat runtime instance for independent streaming. */
  service: ExecutionChatRuntimeAdapter | null;

  /** Whether the service has been initialized (lazy start). */
  serviceInitialized: boolean;

  /** Per-tab chat state. */
  state: ChatState;

  /** Per-tab controllers. */
  controllers: TabControllers;

  /** Per-tab services. */
  services: TabServices;

  /** Per-tab UI components. */
  ui: TabUIComponents;

  /** Per-tab DOM elements. */
  dom: TabDOMElements;

  /** Per-tab renderer. */
  renderer: MessageRenderer | null;

  /**
   * This tab's end of the projection execution path.
   *
   * `null` for every provider not on that path, which is every provider until
   * one is added to `projectionChatProviders`. A tab that has one submits its
   * turns through the coordinator and draws them from the projection; a tab
   * that does not runs on the presentation adapter exactly as before.
   */
  execution: ChatTabExecution | null;

  /** Whether this tab should ask the provider to produce parallel-worker plans. */
  orchestratorMode: boolean;

  /** Set on worker tabs: the tab ID of the orchestrator that spawned this tab. */
  orchestratorTabId?: TabId | null;

  /** Set on orchestrator tabs: IDs of all worker tabs spawned by this orchestrator. */
  workerTabIds?: TabId[];

  /** Monotonic guard for overlapping bound-session model selections. */
  modelSelectionGeneration?: number;
}

export type TabProviderContext = Pick<TabData, 'conversationId' | 'service' | 'providerId' | 'lifecycleState' | 'draftModel' | 'draftSettings'>;

/**
 * Persisted tab state for restoration on plugin reload.
 */
export interface PersistedTabState {
  tabId: TabId;
  conversationId: string | null;
  draftModel?: string | null;
  draftSettings?: Record<string, unknown> | null;
  titleOverride?: string | null;
  orchestratorMode?: boolean;
}

/** Serializable state required to restore a recently closed tab. */
export interface ClosedTabSnapshot {
  tabId: TabId;
  index: number;
  title: string;
  wasActive: boolean;
  conversationId: string | null;
  draftModel: string | null;
  draftSettings: Record<string, unknown> | null;
  titleOverride: string | null;
  orchestratorMode: boolean;
  orchestratorTabId?: TabId | null;
  workerTabIds?: TabId[];
  inputValue: string;
}

/**
 * Tab manager state persisted to data.json.
 */
export interface PersistedTabManagerState {
  openTabs: PersistedTabState[];
  activeTabId: TabId | null;
}

/**
 * Callbacks for tab state changes.
 */
export interface TabManagerCallbacks {
  /** Called when a tab is created. */
  onTabCreated?: (tab: TabData) => void;

  /** Called when switching to a different tab. */
  onTabSwitched?: (fromTabId: TabId | null, toTabId: TabId) => void;

  /** Called when a tab is closed. */
  onTabClosed?: (tabId: TabId) => void;

  /** Called when tab order changes. */
  onTabOrderChanged?: () => void;

  /** Called when tab streaming state changes. */
  onTabStreamingChanged?: (tabId: TabId, isStreaming: boolean) => void;

  /** Called when tab title changes. */
  onTabTitleChanged?: (tabId: TabId, title: string) => void;

  /** Called when tab attention state changes (approval pending, etc.). */
  onTabAttentionChanged?: (tabId: TabId, needsAttention: boolean) => void;

  /** Called when context-window usage changes. */
  onTabUsageChanged?: (tabId: TabId, usage: UsageInfo | null) => void;

  /** Called when a tab's conversation changes (loaded different conversation in same tab). */
  onTabConversationChanged?: (tabId: TabId, conversationId: string | null) => void;

  /** Called when the active provider changes within a tab (blank tab model selection). */
  onTabProviderChanged?: (tabId: TabId, providerId: ProviderId) => void;

  /** Called when draft provider settings change before a blank tab is bound to a conversation. */
  onTabDraftSettingsChanged?: (
    tabId: TabId,
    providerId: ProviderId,
    settings: Record<string, unknown>,
  ) => void;

  /** Called when a tab's orchestrator mode changes. */
  onTabOrchestratorModeChanged?: (tabId: TabId, orchestratorMode: boolean) => void;
}

/**
 * Tab bar item representation for rendering.
 */
export interface TabBarItem {
  id: TabId;
  /** 1-based index for display. */
  index: number;
  title: string;
  providerId: ProviderId;
  isActive: boolean;
  isStreaming: boolean;
  needsAttention: boolean;
  canClose: boolean;
  /** True when this tab has spawned worker tabs. */
  isOrchestrator?: boolean;
  /** True when this tab was spawned by an orchestrator tab. */
  isWorker?: boolean;
}
