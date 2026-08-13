/**
 * Presentation and control-plane parity manifest.
 *
 * The Phase 9 cutover deleted the provider registration hub and re-homed one of
 * the thirteen contributions it carried. Everything else lost its only caller,
 * so 322 modules stayed in the tree while dropping out of the shipped bundle.
 * Every automated gate stayed green because unit tests import modules directly
 * rather than through the production entry point.
 *
 * This manifest is the ledger of that damage. Each entry names one product
 * surface, the exact modules that implement it, and the state those modules are
 * expected to be in. `presentationParity.test.ts` asserts the manifest against
 * the real import graph in both directions.
 *
 * Narrative context: `docs/provider-execution-presentation-parity.md`.
 * Remediation phases: `docs/provider-execution-migration-plan.md`, Phase 12.
 */

export type ParitySurfaceState =
  /** Reachable from `src/main.ts`; the surface ships. */
  | 'wired'
  /** Present in the tree but orphaned by the cutover; owned by a Phase 12 item. */
  | 'pending'
  /** Deliberately dropped from the product; no module may remain. */
  | 'intentionally-removed';

export type ParityArea =
  | 'chat'
  | 'settings'
  | 'provider-services'
  | 'core-services'
  | 'shared';

export interface ParitySurface {
  readonly id: string;
  readonly title: string;
  readonly area: ParityArea;
  readonly state: ParitySurfaceState;
  /** Exact repository-relative module paths owned by this surface. */
  readonly modules: readonly string[];
  /** Owning Phase 12 item. Required while the surface is `pending`. */
  readonly phase?: '12B' | '12C' | '12D' | '12E';
  readonly note?: string;
}

export const PRESENTATION_PARITY_MANIFEST: readonly ParitySurface[] = [
  {
    id: 'provider-launch-pipeline',
    title: 'Provider turn preparation and process launch',
    area: 'provider-services',
    state: 'wired',
    modules: [
      'src/core/prompt/mainAgent.ts',
      'src/core/providers/ChatTurnRequestPreparer.ts',
      'src/app/runtime/ChatTurnPreparerComposition.ts',
      'src/providers/acp/app/AcpMcpServerSource.ts',
      'src/providers/acp/app/ManagedAcpTurnRequestPreparer.ts',
      'src/providers/acp/mcp/AcpMcpStorage.ts',
      'src/providers/acp/mcp/toAcpMcpServers.ts',
      'src/providers/claude/app/ClaudeTurnRequestPreparer.ts',
      'src/providers/codex/app/CodexTurnRequestPreparer.ts',
      'src/providers/claude/cli/findClaudeCLIPath.ts',
      'src/providers/claude/runtime/ClaudeCliResolver.ts',
      'src/providers/claude/runtime/ClaudeUserMessageFactory.ts',
      'src/providers/claude/runtime/types.ts',
      'src/providers/grok/app/GrokTurnRequestPreparer.ts',
      'src/providers/grok/runtime/GrokCliResolver.ts',
      'src/providers/grok/runtime/GrokLaunchArgs.ts',
      'src/providers/grok/runtime/GrokLaunchArtifacts.ts',
      'src/providers/grok/runtime/GrokRuntimeEnvironment.ts',
      'src/providers/gemini/runtime/GeminiCliResolver.ts',
      'src/providers/gemini/runtime/GeminiRuntimeEnvironment.ts',
      'src/providers/qwen/runtime/QwenCliResolver.ts',
      'src/providers/qwen/runtime/QwenRuntimeEnvironment.ts',
      'src/providers/kimicode/runtime/KimicodeCliResolver.ts',
      'src/providers/kimicode/runtime/KimicodeLaunchArtifacts.ts',
      'src/providers/kimicode/runtime/KimicodeRuntimeEnvironment.ts',
      'src/providers/mimocode/runtime/MimocodeCliResolver.ts',
      'src/providers/mimocode/runtime/MimocodeLaunchArtifacts.ts',
      'src/providers/mimocode/runtime/MimocodeRuntimeEnvironment.ts',
      'src/providers/opencode/runtime/OpencodeCliResolver.ts',
      'src/providers/opencode/runtime/OpencodeLaunchArtifacts.ts',
      'src/providers/opencode/runtime/OpencodeRuntimeEnvironment.ts',
      'src/utils/resolveCliExecutable.ts',
    ],
    note: 'Phase 12B. The view asks the runtime to prepare a turn; the provider resolves its '
      + 'CLI, writes launch artifacts, and registers both the managed-ACP launch specification '
      + 'and the execution invocation with the request broker. restartFingerprint is the '
      + 'artifacts launchKey, so a managed client is reused until a launch input changes. '
      + 'OpenCode, MiMoCode, Kimi Code, Gemini, and Qwen compose one shared preparer; every '
      + 'provider-specific decision arrives as an option rather than through inheritance. '
      + 'Gemini and Qwen generate no config file, so they have no launch artifacts and their '
      + 'fingerprint is derived from executable, arguments, cwd, and environment instead. '
      + 'Grok keeps its own preparer: its artifacts are built before the environment, which '
      + 'needs the generated Grok home, and its arguments come from the configured permission '
      + 'mode and reasoning effort. Claude has its own too: its startup reference resolves to '
      + 'SDK options rather than a launch specification, and it is deliberately conservative '
      + 'until workspace services return, so it starts without MCP servers, plugins, hooks, or '
      + 'setting sources. Codex needs no startup reference at all: its app-server launch '
      + 'specification is supplied once at composition time, so a turn only names the thread '
      + 'and input. Antigravity is the last provider without a preparer and fails closed by '
      + 'name.',
  },
  {
    id: 'interaction-prompts',
    title: 'Answering open execution interactions',
    area: 'chat',
    state: 'wired',
    modules: [
      'src/features/chat/rendering/InteractionPromptRenderer.ts',
    ],
    note: 'Restored in Phase 12D against the provider-neutral '
      + 'ExecutionInteractionPresentation contract rather than by reviving the legacy '
      + 'renderers, which expect provider-shaped input the presentation bridges normalize '
      + 'away. See the inline-interactions entry for the detail that is still missing.',
  },
  {
    id: 'mcp-management-ui',
    title: 'MCP server management UI',
    area: 'settings',
    state: 'pending',
    phase: '12C',
    modules: [
      'src/core/mcp/McpConfigParser.ts',
      'src/core/mcp/McpTester.ts',
      'src/core/tools/mcpTrust.ts',
      'src/features/settings/ui/McpServerModal.ts',
      'src/features/settings/ui/McpSettingsManager.ts',
      'src/features/settings/ui/McpTestModal.ts',
      'src/providers/claude/storage/McpStorage.ts',
    ],
    note: 'Reading Grimoire-owned ACP MCP servers is restored — the six managed-ACP providers '
      + 'now carry them into their sessions. What remains orphaned is the UI for editing that '
      + 'configuration and Claude-side MCP, which needs workspace services.',
  },
  {
    id: 'provider-agent-settings',
    title: 'Provider agent definition settings',
    area: 'settings',
    state: 'pending',
    phase: '12C',
    modules: [
      'src/providers/claude/ui/AgentSettings.ts',
      'src/providers/gemini/ui/GeminiAgentSettings.ts',
      'src/providers/grok/ui/GrokAgentSettings.ts',
      'src/providers/kimicode/ui/KimicodeAgentSettings.ts',
      'src/providers/mimocode/ui/MimocodeAgentSettings.ts',
      'src/providers/opencode/ui/OpencodeAgentSettings.ts',
      'src/providers/qwen/ui/QwenAgentSettings.ts',
    ],
  },
  {
    id: 'provider-chat-ui-config',
    title: 'Provider chat UI configuration: models, reasoning, context window',
    area: 'settings',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/providers/antigravity/ui/AntigravityChatUIConfig.ts',
      'src/providers/claude/app/ClaudeModelCatalog.ts',
      'src/providers/claude/modelLabels.ts',
      'src/providers/claude/modelOptions.ts',
      'src/providers/claude/ui/ClaudeChatUIConfig.ts',
      'src/providers/codex/modelOptions.ts',
      'src/providers/codex/ui/CodexChatUIConfig.ts',
      'src/providers/gemini/ui/GeminiChatUIConfig.ts',
      'src/providers/grok/ui/GrokChatUIConfig.ts',
      'src/providers/kimicode/ui/KimicodeChatUIConfig.ts',
      'src/providers/mimocode/ui/MimocodeChatUIConfig.ts',
      'src/providers/opencode/ui/OpencodeChatUIConfig.ts',
      'src/providers/qwen/modes.ts',
      'src/providers/qwen/ui/QwenChatUIConfig.ts',
    ],
    note: 'Replaced by STUB_CHAT_UI_CONFIG, which reports zero models and a zero context '
      + 'window.',
  },
  {
    id: 'provider-command-and-skill-settings',
    title: 'Provider command, skill, and subagent settings',
    area: 'settings',
    state: 'pending',
    phase: '12C',
    modules: [
      'src/features/settings/ui/ProviderSkillSettings.ts',
      'src/providers/claude/ui/SlashCommandSettings.ts',
      'src/providers/codex/ui/CodexSkillSettings.ts',
      'src/providers/codex/ui/CodexSubagentSettings.ts',
      'src/providers/gemini/ui/GeminiCommandSettings.ts',
      'src/providers/qwen/ui/QwenCommandSettings.ts',
    ],
  },
  {
    id: 'provider-disabled-notice',
    title: 'Provider disabled notice',
    area: 'settings',
    state: 'pending',
    phase: '12C',
    modules: [
      'src/features/settings/ui/ProviderDisabledNotice.ts',
    ],
  },
  {
    id: 'provider-settings-tabs',
    title: 'Per-provider settings tabs',
    area: 'settings',
    state: 'pending',
    phase: '12C',
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
    note: 'ProviderModule has no settingsTabRenderer slot; GrimoireSettings returns null.',
  },
  {
    id: 'agent-work-ui',
    title: 'Durable agent work cards and projections',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/core/agents/AgentFidelity.ts',
      'src/features/chat/application/AgentProjectionCoordinator.ts',
      'src/features/chat/application/AgentWorkCommandAdapter.ts',
      'src/features/chat/projections/AgentProjection.ts',
      'src/features/chat/rendering/AgentWorkCard.ts',
      'src/features/chat/rendering/TodoListRenderer.ts',
    ],
  },
  {
    id: 'chat-context-attachments',
    title: 'File and image context',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/core/context/ContextIngestionService.ts',
      'src/core/context/RelevantNotesService.ts',
      'src/core/context/VaultSearchService.ts',
      'src/core/context/VaultTextIndex.ts',
      'src/features/chat/imageGeneration.ts',
      'src/features/chat/ui/FileContext.ts',
      'src/features/chat/ui/ImageContext.ts',
      'src/features/chat/ui/file-context/state/FileContextState.ts',
      'src/features/chat/ui/file-context/view/FileChipsView.ts',
    ],
  },
  {
    id: 'chat-editor-selection',
    title: 'Editor and canvas selection context',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/features/chat/controllers/BrowserSelectionController.ts',
      'src/features/chat/controllers/CanvasSelectionController.ts',
      'src/features/chat/controllers/SelectionController.ts',
      'src/features/chat/controllers/contextRowVisibility.ts',
    ],
  },
  {
    id: 'chat-input-toolbar',
    title: 'Input toolbar, instruction mode, bang-bash mode',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/features/chat/ui/BangBashModeManager.ts',
      'src/features/chat/ui/InputToolbar.ts',
      'src/features/chat/ui/InstructionModeManager.ts',
      'src/features/chat/ui/inputResizeHandle.ts',
      'src/shared/modals/InstructionConfirmModal.ts',
    ],
  },
  {
    id: 'chat-presentation-utilities',
    title: 'Greetings, usage display, feedback metrics, what is new',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/features/chat/constants.ts',
      'src/features/chat/services/TurnFeedbackMetrics.ts',
      'src/features/chat/utils/greetings.ts',
      'src/features/chat/utils/usageInfo.ts',
      'src/shared/whats-new/renderWhatsNewCard.ts',
    ],
  },
  {
    id: 'chat-side-panels',
    title: 'Navigation sidebar, status panel, relevant notes',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/features/chat/controllers/NavigationController.ts',
      'src/features/chat/ui/NavigationSidebar.ts',
      'src/features/chat/ui/RelevantNotesView.ts',
      'src/features/chat/ui/StatusPanel.ts',
      'src/features/chat/ui/context/RuntimeContextActivity.ts',
    ],
  },
  {
    id: 'inline-interactions',
    title: 'Rich detail in permission, question, and plan-exit prompts',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/core/security/ApprovalManager.ts',
      'src/features/chat/rendering/InlineAskUserQuestion.ts',
      'src/features/chat/rendering/InlineExitPlanMode.ts',
      'src/features/chat/rendering/InlinePermissionRequest.ts',
      'src/features/chat/rendering/InlinePlanApproval.ts',
    ],
    note: 'No longer blocking: interaction-prompts made interactions answerable. What is '
      + 'still missing is the detail these renderers show — command summaries, tool input, '
      + 'blocked paths, diff previews. They cannot simply be rewired: they expect '
      + 'provider-shaped input, while ExecutionInteractionPresentation carries only title, '
      + 'description, and options. Restoring the detail requires deciding which additional '
      + 'fields a presentation may carry without persisting raw protocol payloads, which the '
      + 'plan forbids. Until that decision, these stay orphaned.',
  },
  {
    id: 'orchestrator-work-graphs',
    title: 'Orchestrator plans and work graphs',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/features/chat/application/OrchestratorWorkGraphCoordinator.ts',
    ],
  },
  {
    id: 'session-history-affordances',
    title: 'Resume, fork, and rewind affordances',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [
      'src/core/persistence/HistoryOutcomes.ts',
      'src/shared/components/ResumeSessionDropdown.ts',
      'src/shared/modals/ForkTargetModal.ts',
    ],
  },
  {
    id: 'provider-agent-inventory',
    title: 'Provider agent storage, managers, and mentions',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/providers/claude/agents/AgentManager.ts',
      'src/providers/claude/agents/AgentStorage.ts',
      'src/providers/claude/hooks/SubagentHooks.ts',
      'src/providers/claude/plugins/PluginManager.ts',
      'src/providers/claude/storage/AgentVaultStorage.ts',
      'src/providers/claude/types/agent.ts',
      'src/providers/claude/types/plugins.ts',
      'src/providers/codex/agents/CodexAgentMentionProvider.ts',
      'src/providers/gemini/storage/GeminiAgentStorage.ts',
      'src/providers/gemini/types/agent.ts',
      'src/providers/grok/agents/GrokAgentMentionProvider.ts',
      'src/providers/grok/storage/GrokAgentStorage.ts',
      'src/providers/grok/types/agent.ts',
      'src/providers/kimicode/agents/KimicodeAgentMentionProvider.ts',
      'src/providers/kimicode/storage/KimicodeAgentStorage.ts',
      'src/providers/kimicode/types/agent.ts',
      'src/providers/mimocode/agents/MimocodeAgentMentionProvider.ts',
      'src/providers/mimocode/storage/MimocodeAgentStorage.ts',
      'src/providers/mimocode/types/agent.ts',
      'src/providers/opencode/agents/OpencodeAgentMentionProvider.ts',
      'src/providers/opencode/storage/OpencodeAgentStorage.ts',
      'src/providers/opencode/types/agent.ts',
      'src/providers/qwen/storage/QwenAgentStorage.ts',
      'src/providers/qwen/types/agent.ts',
      'src/utils/agent.ts',
    ],
  },
  {
    id: 'provider-auxiliary-services',
    title: 'Title generation, instruction refine, inline edit',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/core/auxiliary/AuxQueryRunner.ts',
      'src/core/auxiliary/QueryBackedInlineEditService.ts',
      'src/core/auxiliary/QueryBackedInstructionRefineService.ts',
      'src/core/auxiliary/QueryBackedTitleGenerationService.ts',
      'src/core/prompt/inlineEdit.ts',
      'src/core/prompt/instructionRefine.ts',
      'src/core/prompt/titleGeneration.ts',
      'src/providers/antigravity/auxiliary/AntigravityNoopServices.ts',
      'src/providers/claude/auxiliary/ClaudeInlineEditService.ts',
      'src/providers/claude/auxiliary/ClaudeInstructionRefineService.ts',
      'src/providers/claude/auxiliary/ClaudeTitleGenerationService.ts',
      'src/providers/claude/auxiliary/extractAssistantText.ts',
      'src/providers/codex/auxiliary/CodexInlineEditService.ts',
      'src/providers/codex/auxiliary/CodexInstructionRefineService.ts',
      'src/providers/codex/auxiliary/CodexTaskResultInterpreter.ts',
      'src/providers/codex/auxiliary/CodexTitleGenerationService.ts',
      'src/providers/codex/runtime/CodexAuxQueryRunner.ts',
      'src/providers/gemini/auxiliary/GeminiNoopServices.ts',
      'src/providers/grok/auxiliary/GrokInlineEditService.ts',
      'src/providers/grok/auxiliary/GrokInstructionRefineService.ts',
      'src/providers/grok/auxiliary/GrokTaskResultInterpreter.ts',
      'src/providers/grok/auxiliary/GrokTitleGenerationService.ts',
      'src/providers/grok/runtime/GrokAuxQueryRunner.ts',
      'src/providers/kimicode/auxiliary/KimicodeInlineEditService.ts',
      'src/providers/kimicode/auxiliary/KimicodeInstructionRefineService.ts',
      'src/providers/kimicode/auxiliary/KimicodeTaskResultInterpreter.ts',
      'src/providers/kimicode/auxiliary/KimicodeTitleGenerationService.ts',
      'src/providers/kimicode/runtime/KimicodeAuxQueryRunner.ts',
      'src/providers/mimocode/auxiliary/MimocodeInlineEditService.ts',
      'src/providers/mimocode/auxiliary/MimocodeInstructionRefineService.ts',
      'src/providers/mimocode/auxiliary/MimocodeTaskResultInterpreter.ts',
      'src/providers/mimocode/auxiliary/MimocodeTitleGenerationService.ts',
      'src/providers/mimocode/runtime/MimocodeAuxQueryRunner.ts',
      'src/providers/opencode/auxiliary/OpencodeInlineEditService.ts',
      'src/providers/opencode/auxiliary/OpencodeInstructionRefineService.ts',
      'src/providers/opencode/auxiliary/OpencodeTaskResultInterpreter.ts',
      'src/providers/opencode/auxiliary/OpencodeTitleGenerationService.ts',
      'src/providers/opencode/runtime/OpencodeAuxQueryRunner.ts',
      'src/providers/qwen/auxiliary/QwenNoopServices.ts',
    ],
    note: 'The inline-edit command ships but its service is an always-failing literal.',
  },
  {
    id: 'provider-capabilities',
    title: 'Provider capability descriptors',
    area: 'provider-services',
    state: 'pending',
    phase: '12C',
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
    note: 'GrimoireView.getDefaultCapabilities reports every capability false for every '
      + 'provider.',
  },
  {
    id: 'provider-cli-resolution',
    title: 'Provider CLI resolution',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/providers/antigravity/runtime/AntigravityCliResolver.ts',
      'src/providers/codex/runtime/CodexBinaryLocator.ts',
      'src/providers/codex/runtime/CodexCliResolver.ts',
    ],
  },
  {
    id: 'provider-command-discovery',
    title: 'Provider command catalogs and runtime command loading',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/core/providers/commands/VaultSkillCommandCatalog.ts',
      'src/providers/claude/commands/ClaudeCommandCatalog.ts',
      'src/providers/claude/commands/probeRuntimeCommands.ts',
      'src/providers/claude/commands/probeRuntimeModels.ts',
      'src/providers/gemini/commands/GeminiCommandCatalog.ts',
      'src/providers/grok/app/GrokRuntimeCommandLoader.ts',
      'src/providers/grok/commands/GrokCommandCatalog.ts',
      'src/providers/kimicode/app/KimicodeRuntimeCommandLoader.ts',
      'src/providers/kimicode/commands/KimicodeCommandCatalog.ts',
      'src/providers/mimocode/app/MimocodeRuntimeCommandLoader.ts',
      'src/providers/mimocode/commands/MimocodeCommandCatalog.ts',
      'src/providers/opencode/app/OpencodeRuntimeCommandLoader.ts',
      'src/providers/opencode/commands/OpencodeCommandCatalog.ts',
      'src/providers/qwen/commands/QwenCommandCatalog.ts',
    ],
  },
  {
    id: 'provider-native-history',
    title: 'Provider-native history services',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/providers/acp/history/sqliteModule.ts',
      'src/providers/antigravity/history/AntigravityConversationHistoryService.ts',
      'src/providers/claude/history/ClaudeConversationHistoryService.ts',
      'src/providers/claude/history/ClaudeHistoryStore.ts',
      'src/providers/claude/history/sdkAsyncSubagent.ts',
      'src/providers/claude/history/sdkBranchFilter.ts',
      'src/providers/claude/history/sdkHistoryTypes.ts',
      'src/providers/claude/history/sdkMessageParsing.ts',
      'src/providers/claude/history/sdkSessionPaths.ts',
      'src/providers/claude/history/sdkSubagentSidecar.ts',
      'src/providers/codex/history/CodexConversationHistoryService.ts',
      'src/providers/grok/history/GrokConversationHistoryService.ts',
      'src/providers/grok/history/GrokUsageMetadataStore.ts',
      'src/providers/kimicode/history/KimicodeConversationHistoryService.ts',
      'src/providers/kimicode/history/KimicodeUsageMetadataStore.ts',
      'src/providers/mimocode/history/MimocodeConversationHistoryService.ts',
      'src/providers/mimocode/history/MimocodeUsageMetadataStore.ts',
      'src/providers/opencode/history/OpencodeConversationHistoryService.ts',
      'src/providers/opencode/history/OpencodeUsageMetadataStore.ts',
      'src/utils/session.ts',
      'src/utils/subagentJsonl.ts',
    ],
  },
  {
    id: 'provider-runtime-primitives',
    title: 'Provider protocol, launch, and normalization primitives',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/core/providers/ProviderModelCatalogRefreshCache.ts',
      'src/core/providers/getOpaqueProviderState.ts',
      'src/core/providers/modelRouting.ts',
      'src/providers/antigravity/runtime/AntigravityModelDiscovery.ts',
      'src/providers/claude/execution/ClaudeAuxiliaryQuery.ts',
      'src/providers/claude/execution/ClaudeTaskOutputLoader.ts',
      'src/providers/claude/prompt/ClaudeTurnEncoder.ts',
      'src/providers/claude/runtime/ClaudeApprovalHandler.ts',
      'src/providers/claude/runtime/ClaudeDynamicUpdates.ts',
      'src/providers/claude/runtime/ClaudeMessageChannel.ts',
      'src/providers/claude/runtime/ClaudeQueryOptionsBuilder.ts',
      'src/providers/claude/runtime/ClaudeRewindService.ts',
      'src/providers/claude/runtime/ClaudeSessionManager.ts',
      'src/providers/claude/runtime/ClaudeTaskResultInterpreter.ts',
      'src/providers/claude/runtime/claudeColdStartQuery.ts',
      'src/providers/claude/runtime/customSpawn.ts',
      'src/providers/claude/sdk/messages.ts',
      'src/providers/claude/sdk/toolResultContent.ts',
      'src/providers/claude/sdk/typeGuards.ts',
      'src/providers/claude/sdk/types.ts',
      'src/providers/claude/security/ClaudePermissionUpdates.ts',
      'src/providers/claude/stream/toolInputStreamState.ts',
      'src/providers/claude/stream/transformClaudeMessage.ts',
      'src/providers/claude/types/providerState.ts',
      'src/providers/codex/normalization/codexSubagentNormalization.ts',
      'src/providers/codex/prompt/encodeCodexTurn.ts',
      'src/providers/codex/runtime/CodexModelListingService.ts',
      'src/providers/codex/runtime/CodexNotificationRouter.ts',
      'src/providers/codex/runtime/CodexServerRequestRouter.ts',
      'src/providers/codex/runtime/CodexSessionFileTail.ts',
      'src/providers/codex/runtime/CodexSessionManager.ts',
      'src/providers/codex/types/index.ts',
      'src/providers/codex/types/subagent.ts',
      'src/providers/gemini/execution/GeminiAcpFileSystem.ts',
      'src/providers/gemini/execution/GeminiHistoryReplayFence.ts',
      'src/providers/gemini/execution/GeminiNativeHistoryReplayResolver.ts',
      'src/providers/gemini/types/index.ts',
      'src/providers/grok/execution/GrokAcpFileSystem.ts',
      'src/providers/grok/runtime/buildGrokPrompt.ts',
      'src/providers/grok/runtime/formatGrokAskUserQuestionResponse.ts',
      'src/providers/grok/runtime/grokDebugLog.ts',
      'src/providers/grok/runtime/normalizeGrokAcpSessionState.ts',
      'src/providers/kimicode/execution/KimicodeAcpFileSystem.ts',
      'src/providers/kimicode/runtime/buildKimicodePrompt.ts',
      'src/providers/mimocode/execution/MimocodeAcpFileSystem.ts',
      'src/providers/mimocode/execution/MimocodeStoredErrorPolicy.ts',
      'src/providers/mimocode/runtime/buildMimocodePrompt.ts',
      'src/providers/opencode/execution/OpencodeAcpFileSystem.ts',
      'src/providers/opencode/runtime/buildOpencodePrompt.ts',
      'src/providers/qwen/execution/QwenAcpFileSystem.ts',
      'src/providers/qwen/execution/QwenStructuredQuestions.ts',
      'src/providers/qwen/types/index.ts',
    ],
    note: 'Reachable only through the deleted ChatRuntime path. Some are superseded by the '
      + 'new execution backends and should be deleted rather than rewired; each needs a '
      + 'per-file decision.',
  },
  {
    id: 'provider-settings-reconcilers',
    title: 'Provider settings reconcilers and runtime environment',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/providers/antigravity/env/AntigravitySettingsReconciler.ts',
      'src/providers/antigravity/runtime/AntigravityRuntimeEnvironment.ts',
      'src/providers/claude/config/ClaudeConfigDir.ts',
      'src/providers/claude/env/ClaudeSettingsReconciler.ts',
      'src/providers/claude/env/claudeModelEnv.ts',
      'src/providers/codex/env/CodexSettingsReconciler.ts',
      'src/providers/gemini/env/GeminiSettingsReconciler.ts',
      'src/providers/grok/env/GrokSettingsReconciler.ts',
      'src/providers/kimicode/env/KimicodeSettingsReconciler.ts',
      'src/providers/mimocode/env/MimocodeSettingsReconciler.ts',
      'src/providers/opencode/env/OpencodeSettingsReconciler.ts',
      'src/providers/qwen/env/QwenSettingsReconciler.ts',
    ],
  },
  {
    id: 'provider-usage-and-billing',
    title: 'Provider usage, billing, and plan limits',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/providers/antigravity/app/AntigravityPlanUsageStore.ts',
      'src/providers/claude/app/ClaudePlanUsageStore.ts',
      'src/providers/claude/app/ClaudeStatusLineUsageSnapshot.ts',
      'src/providers/codex/app/CodexPlanUsageStore.ts',
      'src/providers/grok/app/GrokBillingFetcher.ts',
      'src/providers/grok/app/GrokPlanUsageStore.ts',
      'src/providers/kimicode/app/KimicodePlanUsageStore.ts',
      'src/providers/mimocode/app/MimocodePlanUsageStore.ts',
      'src/providers/opencode/app/OpencodePlanUsageStore.ts',
    ],
  },
  {
    id: 'provider-workspace-services',
    title: 'Provider workspace services and storage',
    area: 'provider-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/providers/antigravity/app/AntigravityWorkspaceServices.ts',
      'src/providers/claude/app/ClaudeWorkspaceServices.ts',
      'src/providers/claude/storage/GrimoireSettingsStorage.ts',
      'src/providers/claude/storage/SessionStorage.ts',
      'src/providers/claude/storage/SkillStorage.ts',
      'src/providers/claude/storage/SlashCommandStorage.ts',
      'src/providers/claude/storage/StorageService.ts',
      'src/providers/codex/app/CodexWorkspaceServices.ts',
      'src/providers/codex/storage/CodexSubagentStorage.ts',
      'src/providers/gemini/app/GeminiWorkspaceServices.ts',
      'src/providers/grok/app/GrokWorkspaceServices.ts',
      'src/providers/kimicode/app/KimicodeWorkspaceServices.ts',
      'src/providers/mimocode/app/MimocodeWorkspaceServices.ts',
      'src/providers/opencode/app/OpencodeWorkspaceServices.ts',
      'src/providers/qwen/app/QwenWorkspaceServices.ts',
    ],
  },
  {
    id: 'core-provider-support',
    title: 'Core provider support orphaned by the registry deletion',
    area: 'core-services',
    state: 'pending',
    phase: '12B',
    modules: [
      'src/app/ApplicationServices.ts',
      'src/core/runtime/QueuedTurn.ts',
      'src/core/runtime/providerError.ts',
    ],
  },
  {
    id: 'execution-testing-support',
    title: 'Execution support and test doubles',
    area: 'core-services',
    state: 'pending',
    phase: '12E',
    modules: [
      'src/app/execution/local/EphemeralLocalShellRequestStore.ts',
      'src/app/runtime/LifecycleAgentExecutionBridge.ts',
      'src/app/storage/NodeBoundedVaultTextReader.ts',
      'src/core/execution/testing/DeterministicFakeBackend.ts',
    ],
    note: 'Test-only or superseded infrastructure. Each needs a keep-or-delete decision; '
      + 'production code must not stay unreachable.',
  },
  {
    id: 'shared-utilities',
    title: 'Shared utilities orphaned with their callers',
    area: 'shared',
    state: 'pending',
    phase: '12E',
    modules: [
      'src/i18n/constants.ts',
      'src/utils/interrupt.ts',
      'src/utils/markdown.ts',
      'src/utils/yamlFrontmatter.ts',
    ],
  },
  {
    id: 'multi-tab-conversations',
    title: 'Multi-tab conversation workspace',
    area: 'chat',
    state: 'pending',
    phase: '12D',
    modules: [],
    note: 'The implementation was deleted rather than orphaned, so there are no modules to '
      + 'match. Awaiting an explicit product decision: restore multi-tab, or commit to one '
      + 'conversation per Obsidian leaf and remove the remaining tab vocabulary from '
      + 'GrimoireView. Recorded here so the decision is not lost.',
  },
];

/**
 * Production entry points that are reachable but return an empty result.
 *
 * These are the second failure mode. Reachability cannot detect them: the call
 * site exists, runs, and succeeds with nothing. Each entry pins a marker that
 * disappears when the stub is replaced, so repairing one without updating this
 * ledger fails the gate.
 */
export interface StubbedEntryPoint {
  readonly module: string;
  readonly symbol: string;
  /** Substring that exists only while the stub is in place. */
  readonly marker: string;
  readonly disables: string;
  readonly phase: '12C' | '12E';
}

export const STUBBED_ENTRY_POINTS: readonly StubbedEntryPoint[] = [
  {
    module: 'src/features/settings/GrimoireSettings.ts',
    symbol: 'providerRegistryGetChatUIConfig',
    marker: 'return STUB_CHAT_UI_CONFIG;',
    disables: 'Model options, reasoning options, context window size',
    phase: '12C',
  },
  {
    module: 'src/features/settings/GrimoireSettings.ts',
    symbol: 'providerWorkspaceRegistryGetSettingsTabRenderer',
    marker: 'function providerWorkspaceRegistryGetSettingsTabRenderer',
    disables: 'All nine provider settings tabs',
    phase: '12C',
  },
  {
    module: 'src/features/settings/GrimoireSettings.ts',
    symbol: 'providerWorkspaceRegistryGetModelCatalog',
    marker: 'function providerWorkspaceRegistryGetModelCatalog',
    disables: 'Model selection and refresh',
    phase: '12C',
  },
  {
    module: 'src/features/settings/GrimoireSettings.ts',
    symbol: 'providerWorkspaceRegistryGetCommandCatalog',
    marker: 'function providerWorkspaceRegistryGetCommandCatalog',
    disables: 'Slash command discovery and management',
    phase: '12C',
  },
  {
    module: 'src/features/settings/GrimoireSettings.ts',
    symbol: 'providerWorkspaceRegistryGetRuntimeCommandLoader',
    marker: 'function providerWorkspaceRegistryGetRuntimeCommandLoader',
    disables: 'Runtime command loading',
    phase: '12C',
  },
  {
    module: 'src/features/settings/GrimoireSettings.ts',
    symbol: 'providerWorkspaceRegistryGetServices',
    marker: 'function providerWorkspaceRegistryGetServices',
    disables: 'All provider workspace services',
    phase: '12C',
  },
  {
    module: 'src/features/settings/GrimoireSettings.ts',
    symbol: 'providerWorkspaceRegistryGetCapabilities',
    marker: 'function providerWorkspaceRegistryGetCapabilities',
    disables: 'Workspace capability gating',
    phase: '12C',
  },
  {
    module: 'src/features/settings/GrimoireSettings.ts',
    symbol: 'providerWorkspaceRegistryRefreshAgentMentions',
    marker: 'async function providerWorkspaceRegistryRefreshAgentMentions',
    disables: 'Agent @-mentions',
    phase: '12C',
  },
  {
    module: 'src/features/chat/GrimoireView.ts',
    symbol: 'getDefaultCapabilities',
    marker: 'function getDefaultCapabilities',
    disables: 'Plan mode, rewind, fork, images, MCP, instruction mode, provider commands, '
      + 'for every provider',
    phase: '12C',
  },
  {
    module: 'src/features/chat/utils/assistantResponseMetadata.ts',
    symbol: 'STUB_CAPABILITIES',
    marker: 'STUB_CAPABILITIES',
    disables: 'Reasoning-effort metadata on assistant responses',
    phase: '12C',
  },
  {
    module: 'src/features/inline-edit/ui/InlineEditModal.ts',
    symbol: 'inlineEditService',
    marker: 'Inline edit requires a connected provider session.',
    disables: 'Inline edit, for every provider',
    phase: '12C',
  },
];
