/**
 * Presentation parity manifest — the checked-in ledger of user-facing surfaces
 * and the modules that prove each one is in the shipped bundle.
 *
 * The first migration attempt replaced the composition root while every
 * automated gate stayed green, orphaning 324 modules and stubbing eleven
 * production entry points. Nothing measured the product surface, so nothing
 * complained. This ledger is that measurement, and
 * `presentationParity.test.ts` asserts it against the real import graph in both
 * directions: a wired surface that falls out of the bundle fails, and an
 * orphan that comes back without a manifest update fails too.
 *
 * Maintenance rule: when a migration milestone moves a surface, update its row
 * in the same commit. Prose elsewhere does not count; this file is the
 * authority.
 */

export type SurfaceState =
  /** Reachable from `src/main.ts` today. Every module listed must stay reachable. */
  | 'wired'
  /** Not in the bundle yet, owned by a named milestone item. Every module listed must stay unreachable. */
  | 'pending'
  /** Deliberately gone. Every module listed must stay unreachable. */
  | 'intentionally-removed';

export interface ParitySurface {
  /** Stable identifier, referenced by progress-log entries. */
  id: string;
  area: 'chat' | 'settings' | 'provider' | 'shell';
  /** What the user can do when this surface works. */
  description: string;
  state: SurfaceState;
  /** Modules whose reachability is the evidence for `state`. */
  modules: string[];
  /** Required unless the surface is wired: who owns getting it there. */
  owner?: string;
}

/**
 * Modules that are in the tree but in nobody's bundle, each with a verdict.
 *
 * An entry here is a claim that the module is dead on purpose and someone owns
 * its fate. Silence is what this list exists to prevent: on the archived
 * branch, 289 modules sat unreferenced with no record that anything was wrong.
 */
export interface OrphanRecord {
  module: string;
  /** Why it is unreferenced, with the evidence that says so. */
  reason: string;
  /** Milestone or workstream that will wire or delete it. */
  owner: string;
}

const PROVIDER_CHAT_UI_CONFIGS = [
  'src/providers/antigravity/ui/AntigravityChatUIConfig.ts',
  'src/providers/claude/ui/ClaudeChatUIConfig.ts',
  'src/providers/codex/ui/CodexChatUIConfig.ts',
  'src/providers/gemini/ui/GeminiChatUIConfig.ts',
  'src/providers/grok/ui/GrokChatUIConfig.ts',
  'src/providers/kimicode/ui/KimicodeChatUIConfig.ts',
  'src/providers/mimocode/ui/MimocodeChatUIConfig.ts',
  'src/providers/opencode/ui/OpencodeChatUIConfig.ts',
  'src/providers/qwen/ui/QwenChatUIConfig.ts',
];

export const PARITY_SURFACES: ParitySurface[] = [
  // -------------------------------------------------------------------------
  // Shell
  // -------------------------------------------------------------------------
  {
    id: 'shell-plugin-entry',
    area: 'shell',
    description: 'Plugin loads, registers the view, commands, and settings.',
    state: 'wired',
    modules: ['src/main.ts', 'src/features/chat/GrimoireView.ts'],
  },
  {
    id: 'shell-provider-registration-hub',
    area: 'shell',
    description:
      'The single hub that attaches all nine providers. Deleting it without re-homing every contribution is the v1 failure.',
    state: 'wired',
    modules: [
      'src/providers/index.ts',
      'src/providers/defaultProviderConfigs.ts',
      'src/core/providers/ProviderRegistry.ts',
      'src/core/providers/ProviderWorkspaceRegistry.ts',
    ],
  },
  {
    id: 'shell-whats-new',
    area: 'shell',
    description: 'Release notes surfaced in-app from the bundled changelog.',
    state: 'wired',
    modules: ['src/shared/modals/WhatsNewModal.ts', 'src/shared/whats-new/renderWhatsNewCard.ts'],
  },

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------
  {
    id: 'chat-send-and-render',
    area: 'chat',
    description: 'Send a message and render assistant text, tools, diffs, and thinking.',
    state: 'wired',
    modules: [
      'src/features/chat/controllers/InputController.ts',
      'src/features/chat/controllers/StreamController.ts',
      'src/features/chat/controllers/ConversationController.ts',
      'src/features/chat/rendering/MessageRenderer.ts',
      'src/features/chat/rendering/ToolCallRenderer.ts',
      'src/features/chat/rendering/WriteEditRenderer.ts',
      'src/features/chat/rendering/DiffRenderer.ts',
      'src/features/chat/rendering/ThinkingBlockRenderer.ts',
      'src/features/chat/rendering/ProgressBlockRenderer.ts',
    ],
  },
  {
    id: 'chat-tabs-and-history',
    area: 'chat',
    description: 'Multi-tab conversations, tab bar, warm runtimes, rename, and session resume.',
    state: 'wired',
    modules: [
      'src/features/chat/tabs/TabManager.ts',
      'src/features/chat/tabs/Tab.ts',
      'src/features/chat/tabs/TabBar.ts',
      'src/features/chat/tabs/tabDOM.ts',
      'src/features/chat/tabs/tabScroll.ts',
      'src/features/chat/tabs/tabSettings.ts',
      'src/features/chat/tabs/WarmRuntimeLru.ts',
      'src/features/chat/ui/RenameTabModal.ts',
      'src/shared/components/ResumeSessionDropdown.ts',
    ],
  },
  {
    id: 'chat-input-toolbar',
    area: 'chat',
    description: 'Input toolbar, resize handle, and textarea sizing.',
    state: 'wired',
    modules: [
      'src/features/chat/ui/InputToolbar.ts',
      'src/features/chat/ui/inputResizeHandle.ts',
      'src/features/chat/ui/textareaResize.ts',
    ],
  },
  {
    id: 'chat-file-context',
    area: 'chat',
    description: 'Pinned file context, chips, and runtime context activity.',
    state: 'wired',
    modules: [
      'src/features/chat/ui/FileContext.ts',
      'src/features/chat/ui/file-context/state/FileContextState.ts',
      'src/features/chat/ui/file-context/view/FileChipsView.ts',
      'src/features/chat/ui/context/RuntimeContextActivity.ts',
      'src/features/chat/controllers/contextRowVisibility.ts',
    ],
  },
  {
    id: 'chat-image-context',
    area: 'chat',
    description: 'Image attachments and image generation.',
    state: 'wired',
    modules: ['src/features/chat/ui/ImageContext.ts', 'src/features/chat/imageGeneration.ts'],
  },
  {
    id: 'chat-approvals',
    area: 'chat',
    description: 'Tool permission requests answered inline.',
    state: 'wired',
    modules: ['src/features/chat/rendering/InlinePermissionRequest.ts'],
  },
  {
    id: 'chat-questions',
    area: 'chat',
    description: 'Structured provider questions with single, multi, and freeform answers.',
    state: 'wired',
    modules: ['src/features/chat/rendering/InlineAskUserQuestion.ts'],
  },
  {
    id: 'chat-plan-mode',
    area: 'chat',
    description: 'Plan mode presentation and plan approval.',
    state: 'wired',
    modules: [
      'src/features/chat/rendering/InlineExitPlanMode.ts',
      'src/features/chat/rendering/InlinePlanApproval.ts',
    ],
  },
  {
    id: 'chat-subagents',
    area: 'chat',
    description: 'Subagent lifecycle observation and rendering.',
    state: 'wired',
    modules: [
      'src/features/chat/services/SubagentManager.ts',
      'src/features/chat/rendering/SubagentRenderer.ts',
      'src/features/chat/rendering/subagentLifecycleResolution.ts',
    ],
  },
  {
    id: 'chat-todo-list',
    area: 'chat',
    description: 'Provider todo lists rendered in the transcript.',
    state: 'wired',
    modules: ['src/core/tools/todo.ts', 'src/features/chat/rendering/todoUtils.ts'],
  },
  {
    id: 'chat-orchestrator-plan',
    area: 'chat',
    description: 'Orchestrator plan parsing and inline presentation.',
    state: 'wired',
    modules: [
      'src/features/chat/rendering/InlineOrchestratorPlan.ts',
      'src/features/chat/rendering/orchestratorPlanParser.ts',
    ],
  },
  {
    id: 'chat-rewind-and-fork',
    area: 'chat',
    description: 'Rewind and fork affordances on prior turns.',
    state: 'wired',
    modules: ['src/features/chat/rewind.ts', 'src/shared/modals/ForkTargetModal.ts'],
  },
  {
    id: 'chat-usage-indicators',
    area: 'chat',
    description: 'Token, cost, and plan-limit indicators.',
    state: 'wired',
    modules: [
      'src/features/chat/utils/usageInfo.ts',
      'src/features/chat/utils/assistantResponseMetadata.ts',
      'src/core/providers/ProviderSpendUsageStore.ts',
    ],
  },
  {
    id: 'chat-reasoning-controls',
    area: 'chat',
    description: 'Reasoning-effort display and controls, one half of chatUIConfig.',
    state: 'wired',
    modules: ['src/features/chat/utils/reasoningDisplay.ts'],
  },
  {
    id: 'chat-instruction-mode',
    area: 'chat',
    description: 'Instruction mode and its confirmation.',
    state: 'wired',
    modules: [
      'src/features/chat/ui/InstructionModeManager.ts',
      'src/shared/modals/InstructionConfirmModal.ts',
    ],
  },
  {
    id: 'chat-bang-bash-mode',
    area: 'chat',
    description: 'Bang-bash shell mode.',
    state: 'wired',
    modules: [
      'src/features/chat/ui/BangBashModeManager.ts',
      'src/features/chat/services/BangBashService.ts',
    ],
  },
  {
    id: 'chat-navigation-and-status',
    area: 'chat',
    description: 'Navigation sidebar and status panel.',
    state: 'wired',
    modules: [
      'src/features/chat/ui/NavigationSidebar.ts',
      'src/features/chat/controllers/NavigationController.ts',
      'src/features/chat/ui/StatusPanel.ts',
    ],
  },
  {
    id: 'chat-selection-context',
    area: 'chat',
    description: 'Editor, browser, and canvas selection carried into the turn.',
    state: 'wired',
    modules: [
      'src/features/chat/controllers/SelectionController.ts',
      'src/features/chat/controllers/BrowserSelectionController.ts',
      'src/features/chat/controllers/CanvasSelectionController.ts',
      'src/shared/components/SelectionHighlight.ts',
    ],
  },
  {
    id: 'chat-vault-search-and-relevant-notes',
    area: 'chat',
    description: 'Vault search sources and relevant-note suggestions.',
    state: 'wired',
    modules: [
      'src/features/chat/ui/VaultSearchSources.ts',
      'src/features/chat/ui/RelevantNotesView.ts',
      'src/core/context/VaultSearchService.ts',
      'src/core/context/RelevantNotesService.ts',
    ],
  },
  {
    id: 'chat-mentions',
    area: 'chat',
    description: 'File and agent mentions in the composer.',
    state: 'wired',
    modules: [
      'src/shared/mention/MentionDropdownController.ts',
      'src/shared/mention/VaultMentionCache.ts',
      'src/shared/mention/VaultMentionDataProvider.ts',
    ],
  },
  {
    id: 'chat-slash-commands',
    area: 'chat',
    description: 'Built-in and provider slash commands in the composer.',
    state: 'wired',
    modules: [
      'src/core/commands/builtInCommands.ts',
      'src/shared/components/SlashCommandDropdown.ts',
    ],
  },
  {
    id: 'chat-greeting',
    area: 'chat',
    description: 'Blank-tab greeting.',
    state: 'wired',
    modules: ['src/features/chat/utils/greetings.ts'],
  },

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  {
    id: 'settings-shell-and-search',
    area: 'settings',
    description:
      'Settings shell through the declarative settings API, including native settings search and keyboard navigation.',
    state: 'wired',
    modules: [
      'src/features/settings/GrimoireSettings.ts',
      'src/features/settings/keyboardNavigation.ts',
    ],
  },
  {
    id: 'settings-provider-tabs',
    area: 'settings',
    description: 'Per-provider settings tabs, all nine.',
    state: 'wired',
    modules: [
      'src/providers/antigravity/ui/AntigravitySettingsTab.ts',
      'src/providers/claude/ui/ClaudeSettingsTab.ts',
      'src/providers/codex/ui/CodexSettingsTab.ts',
      'src/providers/gemini/ui/GeminiSettingsTab.ts',
      'src/providers/grok/ui/GrokSettingsTab.ts',
      'src/providers/kimicode/ui/KimicodeSettingsTab.ts',
      'src/providers/mimocode/ui/MimocodeSettingsTab.ts',
      'src/providers/opencode/ui/OpencodeSettingsTab.ts',
      'src/providers/qwen/ui/QwenSettingsTab.ts',
    ],
  },
  {
    id: 'settings-mcp-management',
    area: 'settings',
    description: 'MCP server management, testing, and Grimoire-owned MCP storage.',
    state: 'wired',
    modules: [
      'src/features/settings/ui/McpSettingsManager.ts',
      'src/features/settings/ui/McpServerModal.ts',
      'src/features/settings/ui/McpTestModal.ts',
      'src/core/mcp/McpServerManager.ts',
      'src/core/mcp/McpConfigParser.ts',
      'src/core/mcp/McpTester.ts',
    ],
  },
  {
    id: 'settings-environment',
    area: 'settings',
    description: 'Environment variables and snippet management.',
    state: 'wired',
    modules: [
      'src/features/settings/ui/EnvironmentSettingsSection.ts',
      'src/features/settings/ui/EnvSnippetManager.ts',
      'src/core/providers/providerEnvironment.ts',
    ],
  },
  {
    id: 'settings-skills',
    area: 'settings',
    description: 'Provider skill inventories.',
    state: 'wired',
    modules: ['src/features/settings/ui/ProviderSkillSettings.ts'],
  },
  {
    id: 'settings-advanced-and-notices',
    area: 'settings',
    description: 'Advanced section and the disabled-provider notice.',
    state: 'wired',
    modules: [
      'src/features/settings/ui/AdvancedSection.ts',
      'src/features/settings/ui/ProviderDisabledNotice.ts',
    ],
  },
  {
    id: 'settings-project-workspace',
    area: 'settings',
    description: 'Project workspace selection and storage.',
    state: 'wired',
    modules: [
      'src/features/settings/ProjectWorkspaceSettings.ts',
      'src/core/context/ProjectWorkspaceStore.ts',
    ],
  },

  // -------------------------------------------------------------------------
  // Provider contributions
  //
  // `chatUIConfig` is one registration field but a wide object. It is split
  // here because losing the model picker inside a "migrated" chatUIConfig is
  // exactly the v1 failure shape.
  // -------------------------------------------------------------------------
  {
    id: 'provider-model-selection',
    area: 'provider',
    description: 'Model options, model routing, refresh, and the picker, per provider.',
    state: 'wired',
    modules: [
      ...PROVIDER_CHAT_UI_CONFIGS,
      'src/providers/claude/app/ClaudeModelCatalog.ts',
      'src/core/providers/modelRouting.ts',
      'src/core/providers/ProviderModelCatalogRefreshCache.ts',
      'src/shared/components/SelectableDropdown.ts',
    ],
  },
  {
    id: 'provider-capability-gating',
    area: 'provider',
    description:
      'Static capability flags that gate plan mode, rewind, fork, images, MCP, and provider commands in the UI.',
    state: 'wired',
    modules: [
      'src/providers/antigravity/capabilities.ts',
      'src/providers/claude/capabilities.ts',
      'src/providers/codex/capabilities.ts',
      'src/providers/gemini/capabilities.ts',
      'src/providers/grok/capabilities.ts',
      'src/providers/kimicode/capabilities.ts',
      'src/providers/mimocode/capabilities.ts',
      'src/providers/opencode/capabilities.ts',
      'src/providers/qwen/capabilities.ts',
    ],
  },
  {
    id: 'provider-command-catalogs',
    area: 'provider',
    description: 'Provider-owned slash-command inventories.',
    state: 'wired',
    modules: [
      'src/providers/claude/commands/ClaudeCommandCatalog.ts',
      'src/providers/gemini/commands/GeminiCommandCatalog.ts',
      'src/providers/grok/commands/GrokCommandCatalog.ts',
      'src/providers/kimicode/commands/KimicodeCommandCatalog.ts',
      'src/providers/mimocode/commands/MimocodeCommandCatalog.ts',
      'src/providers/opencode/commands/OpencodeCommandCatalog.ts',
      'src/providers/qwen/commands/QwenCommandCatalog.ts',
    ],
  },
  {
    id: 'provider-history-services',
    area: 'provider',
    description: 'Provider-native history hydration, fork state, and session deletion.',
    state: 'wired',
    modules: [
      'src/providers/antigravity/history/AntigravityConversationHistoryService.ts',
      'src/providers/claude/history/ClaudeConversationHistoryService.ts',
      'src/providers/codex/history/CodexConversationHistoryService.ts',
      'src/providers/gemini/history/GeminiConversationHistoryService.ts',
      'src/providers/grok/history/GrokConversationHistoryService.ts',
      'src/providers/kimicode/history/KimicodeConversationHistoryService.ts',
      'src/providers/mimocode/history/MimocodeConversationHistoryService.ts',
      'src/providers/opencode/history/OpencodeConversationHistoryService.ts',
      'src/providers/qwen/history/QwenConversationHistoryService.ts',
    ],
  },
  {
    id: 'provider-cli-resolution',
    area: 'provider',
    description: 'CLI binary resolution used by launch paths and settings diagnostics.',
    state: 'wired',
    modules: [
      'src/providers/antigravity/runtime/AntigravityCliResolver.ts',
      'src/providers/claude/runtime/ClaudeCliResolver.ts',
      'src/providers/codex/runtime/CodexCliResolver.ts',
      'src/providers/gemini/runtime/GeminiCliResolver.ts',
      'src/providers/grok/runtime/GrokCliResolver.ts',
      'src/providers/kimicode/runtime/KimicodeCliResolver.ts',
      'src/providers/mimocode/runtime/MimocodeCliResolver.ts',
      'src/providers/opencode/runtime/OpencodeCliResolver.ts',
      'src/providers/qwen/runtime/QwenCliResolver.ts',
    ],
  },
  {
    id: 'provider-agent-mentions',
    area: 'provider',
    description: 'Provider agent inventories behind @-mentions.',
    state: 'wired',
    modules: [
      'src/providers/codex/agents/CodexAgentMentionProvider.ts',
      'src/providers/grok/agents/GrokAgentMentionProvider.ts',
      'src/providers/kimicode/agents/KimicodeAgentMentionProvider.ts',
      'src/providers/mimocode/agents/MimocodeAgentMentionProvider.ts',
      'src/providers/opencode/agents/OpencodeAgentMentionProvider.ts',
    ],
  },
  {
    id: 'provider-auxiliary-services',
    area: 'provider',
    description:
      'Title generation, instruction refine, and inline edit. These stay on the legacy path until M5, per the mixed-authority rule.',
    state: 'wired',
    modules: [
      'src/features/inline-edit/ui/InlineEditModal.ts',
      'src/providers/claude/auxiliary/ClaudeTitleGenerationService.ts',
      'src/providers/claude/auxiliary/ClaudeInstructionRefineService.ts',
      'src/providers/claude/auxiliary/ClaudeInlineEditService.ts',
      'src/providers/codex/auxiliary/CodexTitleGenerationService.ts',
      'src/providers/codex/auxiliary/CodexInstructionRefineService.ts',
      'src/providers/codex/auxiliary/CodexInlineEditService.ts',
      'src/providers/grok/auxiliary/GrokTitleGenerationService.ts',
      'src/providers/grok/auxiliary/GrokInstructionRefineService.ts',
      'src/providers/grok/auxiliary/GrokInlineEditService.ts',
      'src/providers/kimicode/auxiliary/KimicodeTitleGenerationService.ts',
      'src/providers/kimicode/auxiliary/KimicodeInstructionRefineService.ts',
      'src/providers/kimicode/auxiliary/KimicodeInlineEditService.ts',
      'src/providers/mimocode/auxiliary/MimocodeTitleGenerationService.ts',
      'src/providers/mimocode/auxiliary/MimocodeInstructionRefineService.ts',
      'src/providers/mimocode/auxiliary/MimocodeInlineEditService.ts',
      'src/providers/opencode/auxiliary/OpencodeTitleGenerationService.ts',
      'src/providers/opencode/auxiliary/OpencodeInstructionRefineService.ts',
      'src/providers/opencode/auxiliary/OpencodeInlineEditService.ts',
    ],
  },
  {
    id: 'provider-chat-execution',
    area: 'provider',
    description:
      'Chat execution per provider. Row 10 of the contribution inventory — the only row an M2 flip moves.',
    state: 'wired',
    modules: [
      'src/core/runtime/ChatRuntime.ts',
      'src/providers/antigravity/runtime/AntigravityChatRuntime.ts',
      'src/providers/claude/runtime/ClaudeChatRuntime.ts',
      'src/providers/codex/runtime/CodexChatRuntime.ts',
      'src/providers/gemini/runtime/GeminiChatRuntime.ts',
      'src/providers/grok/runtime/GrokChatRuntime.ts',
      'src/providers/kimicode/runtime/KimicodeChatRuntime.ts',
      'src/providers/mimocode/runtime/MimocodeChatRuntime.ts',
      'src/providers/opencode/runtime/OpencodeChatRuntime.ts',
      'src/providers/qwen/runtime/QwenChatRuntime.ts',
    ],
  },

  // -------------------------------------------------------------------------
  // Dark migration code, deliberately outside the shipped bundle
  //
  // `pending` rather than orphaned: it has an owner, a destination, and a
  // checkpoint at which it becomes reachable. Until then the gate asserts it
  // stays unreachable, which is what proves the new platform is not leaking
  // into releases while it is being built.
  // -------------------------------------------------------------------------
  {
    id: 'execution-platform-dark',
    area: 'shell',
    description:
      'Execution composition boundaries and the provider module contract, built beside the running application.',
    state: 'pending',
    owner: 'M2 — becomes reachable when the first provider flip wires the adapter over its backend.',
    modules: [
      'src/app/execution/antigravity/NodeAntigravityProcessTransport.ts',
      'src/app/execution/codex/NodeCodexExecutionProcess.ts',
      'src/app/execution/local/NodeLocalShellProcessAdapter.ts',
      'src/app/storage/VaultDurableStorage.ts',
      'src/core/execution/ExecutionBackendDescriptor.ts',
      'src/core/execution/ExecutionContracts.ts',
      'src/core/execution/ExecutionControlPaths.ts',
      'src/core/execution/ExecutionControlRecords.ts',
      'src/core/execution/ExecutionControlRepositories.ts',
      'src/core/execution/ExecutionControlSchemas.ts',
      'src/core/execution/ExecutionControlTransactionCoordinator.ts',
      'src/core/execution/ExecutionEventIngestor.ts',
      'src/core/execution/ExecutionEventQueue.ts',
      'src/core/execution/ExecutionEvents.ts',
      'src/core/execution/ExecutionIds.ts',
      'src/core/execution/ExecutionLifecycleRegistry.ts',
      'src/core/execution/ExecutionTerminalPolicy.ts',
      'src/core/execution/ResultCommit.ts',
      'src/core/execution/RunProjection.ts',
      'src/core/execution/local/LocalShellBackend.ts',
      'src/core/execution/testing/DeterministicFakeBackend.ts',
      'src/core/persistence/ControlRecordPayloadPolicy.ts',
      'src/core/persistence/DurableStorage.ts',
      'src/core/persistence/TransactionIntentCoordinator.ts',
      'src/core/persistence/VersionedRecord.ts',
      'src/core/persistence/VersionedRepository.ts',
      'src/core/providers/ProviderModule.ts',
      'src/providers/antigravity/AntigravityProviderModule.ts',
      'src/providers/antigravity/execution/AntigravityExecutionBackend.ts',
      'src/providers/antigravity/runtime/AntigravityPrintProcessRunner.ts',
      'src/providers/antigravity/runtime/AntigravityPrintProtocol.ts',
      'src/providers/antigravity/runtime/AntigravityTranscriptRecovery.ts',
      'src/providers/claude/ClaudeProviderModule.ts',
      'src/providers/claude/execution/ClaudeAuxiliaryQuery.ts',
      'src/providers/claude/execution/ClaudeExecutionBackend.ts',
      'src/providers/claude/execution/ClaudeExecutionMessageChannel.ts',
      'src/providers/claude/execution/ClaudeSdkExecutionAdapter.ts',
      'src/providers/claude/execution/ClaudeTaskOutputLoader.ts',
      'src/providers/codex/CodexProviderModule.ts',
      'src/providers/codex/execution/CodexExecutionBackend.ts',
      'src/providers/codex/execution/CodexExecutionTurnReconciler.ts',
      'src/providers/codex/runtime/CodexExecutionConnection.ts',
    ],
  },
];

export const ORPHANED_MODULES: OrphanRecord[] = [
  {
    module: 'src/providers/acp/history/sqliteModule.ts',
    reason:
      'Injectable `node:sqlite` loader with no caller: the reachable AcpSqliteReader.ts inlines `require("node:sqlite")` at line 13 instead. An abandoned testability refactor, not a lost feature.',
    owner: 'M2 managed-ACP wave — wire it into AcpSqliteReader or delete both it and its test.',
  },
  {
    module: 'src/core/context/ContextIngestionService.ts',
    reason:
      'Document ingestion (markdown, PDF) with no consumer anywhere in src. Its DocumentIngestor contract in core/context/types.ts is referenced only by this file.',
    owner: 'Product decision — never wired; keep or delete outside the migration.',
  },
  {
    module: 'src/providers/codex/runtime/CodexSessionFileTail.ts',
    reason:
      'Legacy Codex session-JSONL tail parser, 792 lines, superseded by the app-server notification stream in CodexNotificationRouter.ts, which is where token usage and context windows come from today.',
    owner: 'M2-flips (Codex) — deleted with the legacy Codex chat runtime.',
  },
  {
    module: 'src/i18n/constants.ts',
    reason:
      'Locale metadata for staged i18n work that has no production consumer on this branch.',
    owner: 'i18n foundation (`origin/pr/01-i18n-foundation`) — outside this migration.',
  },
];
