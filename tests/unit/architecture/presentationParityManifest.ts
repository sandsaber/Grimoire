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
      // Claude chat execution, flipped: the composition, the backend it builds,
      // and everything a turn is composed, presented and answered from.
      'src/app/execution/claude/ClaudeExecutionComposition.ts',
      'src/providers/claude/ClaudeProviderModule.ts',
      'src/providers/claude/app/ClaudeModuleContext.ts',
      'src/providers/claude/execution/ClaudeAuxiliaryQuery.ts',
      'src/providers/claude/execution/ClaudeContentPresenter.ts',
      'src/providers/claude/execution/ClaudeExecutionBackend.ts',
      'src/providers/claude/execution/ClaudeExecutionMessageChannel.ts',
      'src/providers/claude/execution/ClaudeExecutionRequests.ts',
      'src/providers/claude/execution/ClaudeInteractionBridge.ts',
      'src/providers/claude/execution/ClaudeInteractionPresenter.ts',
      'src/providers/claude/execution/ClaudeProjectionResultSink.ts',
      'src/providers/claude/execution/ClaudeSdkExecutionAdapter.ts',
      'src/providers/claude/execution/ClaudeTaskOutputLoader.ts',
      // Codex chat execution, flipped: the composition, the backend it builds,
      // and everything the turn is composed from.
      'src/app/execution/codex/CodexExecutionComposition.ts',
      'src/app/execution/codex/NodeCodexExecutionConnectionFactory.ts',
      'src/app/execution/codex/NodeCodexExecutionProcess.ts',
      'src/providers/codex/CodexProviderModule.ts',
      'src/providers/codex/app/CodexModuleContext.ts',
      'src/providers/codex/execution/CodexContentPresenter.ts',
      'src/providers/codex/execution/CodexConversationBinding.ts',
      'src/providers/codex/execution/CodexExecutionBackend.ts',
      'src/providers/codex/execution/CodexExecutionRequests.ts',
      'src/providers/codex/execution/CodexExecutionTurnReconciler.ts',
      'src/providers/codex/execution/CodexInteractionBridge.ts',
      'src/providers/codex/execution/CodexInteractionPresenter.ts',
      'src/providers/codex/execution/CodexProjectionResultSink.ts',
      'src/providers/codex/execution/CodexTurnInput.ts',
      'src/providers/codex/execution/CodexTurnSandboxPolicy.ts',
      'src/providers/codex/runtime/CodexExecutionConnection.ts',
      'src/providers/gemini/runtime/GeminiChatRuntime.ts',
      // Grok chat execution, flipped: the second ACP provider on the kernel,
      // and the isolated session its five metadata surfaces now share.
      'src/app/execution/grok/GrokExecutionComposition.ts',
      'src/app/execution/grok/GrokMetadataSession.ts',
      'src/providers/grok/GrokProviderModule.ts',
      'src/providers/grok/app/GrokModuleContext.ts',
      'src/providers/grok/execution/GrokAcpDynamicConfig.ts',
      'src/providers/grok/execution/GrokContentPresenter.ts',
      'src/providers/grok/execution/GrokExecutionBackend.ts',
      'src/providers/grok/execution/GrokExecutionRequests.ts',
      'src/providers/grok/execution/GrokInteractionBridge.ts',
      'src/providers/grok/execution/GrokPermissionPresentation.ts',
      'src/providers/grok/execution/GrokProjectionResultSink.ts',
      'src/providers/grok/execution/GrokSessionConfigState.ts',
      // Kimi Code chat execution, flipped: the fourth ACP provider on the
      // kernel, and the third in a row to add nothing to the shared platform.
      // What is its own is the launch and its mode ids, which the CLI names
      // itself where its two siblings use Grimoire-minted ones.
      'src/app/execution/kimicode/KimicodeExecutionComposition.ts',
      'src/app/execution/kimicode/KimicodeMetadataSession.ts',
      'src/providers/kimicode/KimicodeProviderModule.ts',
      'src/providers/kimicode/app/KimicodeModuleContext.ts',
      'src/providers/kimicode/execution/KimicodeAcpDynamicConfig.ts',
      'src/providers/kimicode/execution/KimicodeAcpFileSystem.ts',
      'src/providers/kimicode/execution/KimicodeContentPresenter.ts',
      'src/providers/kimicode/execution/KimicodeExecutionBackend.ts',
      'src/providers/kimicode/execution/KimicodeExecutionRequests.ts',
      'src/providers/kimicode/execution/KimicodeInteractionBridge.ts',
      'src/providers/kimicode/execution/KimicodeInteractionPresenter.ts',
      'src/providers/kimicode/execution/KimicodePermissionPresentation.ts',
      'src/providers/kimicode/execution/KimicodeProjectionResultSink.ts',
      'src/providers/kimicode/execution/KimicodeSessionConfigState.ts',
      // MiMoCode chat execution, flipped: the third ACP provider on the kernel,
      // and the isolated session its four metadata surfaces now share. It added
      // nothing to the shared platform below — the only file here that is not a
      // name-and-launch difference is the session config state, and that is
      // MiMoCode's own settings rather than its protocol.
      'src/app/execution/mimocode/MimocodeExecutionComposition.ts',
      'src/app/execution/mimocode/MimocodeMetadataSession.ts',
      'src/providers/mimocode/MimocodeProviderModule.ts',
      'src/providers/mimocode/app/MimocodeModuleContext.ts',
      'src/providers/mimocode/execution/MimocodeAcpDynamicConfig.ts',
      'src/providers/mimocode/execution/MimocodeAcpFileSystem.ts',
      'src/providers/mimocode/execution/MimocodeContentPresenter.ts',
      'src/providers/mimocode/execution/MimocodeExecutionBackend.ts',
      'src/providers/mimocode/execution/MimocodeExecutionRequests.ts',
      'src/providers/mimocode/execution/MimocodeInteractionBridge.ts',
      'src/providers/mimocode/execution/MimocodeInteractionPresenter.ts',
      'src/providers/mimocode/execution/MimocodePermissionPresentation.ts',
      'src/providers/mimocode/execution/MimocodeProjectionResultSink.ts',
      'src/providers/mimocode/execution/MimocodeSessionConfigState.ts',
      // The shared managed-ACP platform, live since OpenCode's flip and
      // inherited by the five ACP providers that follow it — the backend
      // itself since wave 5, which found that three lines of it were ever
      // OpenCode's.
      'src/app/execution/acp/NodeManagedAcpProcessLauncher.ts',
      'src/providers/acp/execution/AcpContentPayload.ts',
      'src/providers/acp/execution/AcpManagedClientAdapter.ts',
      'src/providers/acp/execution/ManagedAcpClient.ts',
      'src/providers/acp/execution/AcpApprovalPresenter.ts',
      'src/providers/acp/execution/AcpPermissionBridge.ts',
      'src/providers/acp/execution/AcpWorkspaceFileSystem.ts',
      'src/providers/acp/execution/ManagedAcpExecutionBackend.ts',
      // OpenCode chat execution, flipped: the first ACP provider on the kernel,
      // and the isolated session the four metadata surfaces now share.
      'src/app/execution/opencode/OpencodeExecutionComposition.ts',
      'src/app/execution/opencode/OpencodeMetadataSession.ts',
      'src/providers/opencode/OpencodeProviderModule.ts',
      'src/providers/opencode/app/OpencodeModuleContext.ts',
      'src/providers/opencode/execution/OpencodeAcpDynamicConfig.ts',
      'src/providers/opencode/execution/OpencodeAcpFileSystem.ts',
      'src/providers/opencode/execution/OpencodeContentPresenter.ts',
      'src/providers/opencode/execution/OpencodeExecutionBackend.ts',
      'src/providers/opencode/execution/OpencodeExecutionRequests.ts',
      'src/providers/opencode/execution/OpencodeInteractionBridge.ts',
      'src/providers/opencode/execution/OpencodeInteractionPresenter.ts',
      'src/providers/opencode/execution/OpencodePermissionPresentation.ts',
      'src/providers/opencode/execution/OpencodeProjectionResultSink.ts',
      'src/providers/opencode/execution/OpencodeSessionConfigState.ts',
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
  // -------------------------------------------------------------------------
  // The execution kernel, in production
  //
  // Reachable from `main.ts` since the first provider flip. What lit up is the
  // platform plus exactly one provider's backend; every other provider's
  // backend stays in the pending surface below until its own flip.
  // -------------------------------------------------------------------------
  {
    id: 'execution-platform',
    area: 'shell',
    description:
      'The execution kernel, its durable control store, and the presentation adapter, constructed by the plugin at load and shut down at unload.',
    state: 'wired',
    modules: [
      'src/app/execution/ExecutionKernelHost.ts',
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
      'src/core/execution/local/LocalShellBackend.ts',
      'src/core/persistence/ControlRecordPayloadPolicy.ts',
      'src/core/persistence/DurableStorage.ts',
      'src/core/persistence/TransactionIntentCoordinator.ts',
      'src/core/persistence/VersionedRecord.ts',
      'src/core/persistence/VersionedRepository.ts',
      'src/core/providers/ProviderModule.ts',
      'src/core/runtime/execution/ExecutionChatRuntimeAdapter.ts',
    ],
  },
  {
    id: 'provider-antigravity-execution',
    area: 'provider',
    description:
      'Antigravity chat execution over the kernel: the backend, its process transport, and the composition that resolves a request reference back into an `agy --print` invocation.',
    state: 'wired',
    modules: [
      'src/app/execution/antigravity/AntigravityExecutionComposition.ts',
      'src/app/execution/antigravity/NodeAntigravityProcessTransport.ts',
      'src/providers/antigravity/AntigravityProviderModule.ts',
      'src/providers/antigravity/execution/AntigravityExecutionBackend.ts',
      'src/providers/antigravity/execution/AntigravityProjectionResultSink.ts',
      'src/providers/antigravity/execution/AntigravityRequestStore.ts',
      'src/providers/antigravity/runtime/AntigravityPrintProcessRunner.ts',
      'src/providers/antigravity/runtime/AntigravityPrintProtocol.ts',
      'src/providers/antigravity/runtime/AntigravityPromptComposer.ts',
    ],
  },
  {
    id: 'execution-run-projection',
    area: 'shell',
    description:
      'The run projection reducer: what happened to a run, derived from its accepted events.',
    state: 'pending',
    owner:
      'M5 — chat rendering moves from generator consumption to projection consumption, which is this reducer\'s first production consumer. The first flip did not light it up: the adapter renders the event stream directly.',
    modules: ['src/core/execution/RunProjection.ts'],
  },
  {
    id: 'execution-platform-dark',
    area: 'shell',
    description:
      'Provider backends built and proven ahead of their own flips, still unreachable from the running application.',
    state: 'pending',
    owner: 'M2-flips — each module becomes reachable at its own provider\'s flip.',
    modules: [
      'src/core/execution/testing/DeterministicFakeBackend.ts',
      // Still dark after wave 4: the auxiliary ACP query has no caller, because
      // titles, refinement and inline edits stay on the legacy services until
      // M5. The transport, the launcher and the client adapter beside it went
      // live with OpenCode's flip and are listed as wired.
      'src/providers/acp/execution/ManagedAcpAuxiliaryQuery.ts',
      // Wave 7's first half, built ahead of its own flip: Gemini CLI's backend
      // descriptor and the provider-owned parts around it. Not listed beside
      // them: `GeminiPermissionPresentation.ts`, which was moved out of the
      // legacy runtime rather than written beside it, and `modes.ts`, which the
      // runtime imports for the same fix.
      'src/providers/gemini/execution/GeminiAcpDynamicConfig.ts',
      'src/providers/gemini/execution/GeminiAcpFileSystem.ts',
      'src/providers/gemini/execution/GeminiExecutionBackend.ts',
      'src/providers/gemini/execution/GeminiInteractionBridge.ts',
      'src/providers/gemini/execution/GeminiProjectionResultSink.ts',
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
    module: 'src/i18n/constants.ts',
    reason:
      'Locale metadata for staged i18n work that has no production consumer on this branch.',
    owner: 'i18n foundation (`origin/pr/01-i18n-foundation`) — outside this migration.',
  },
];
