# Presentation and Control-Plane Parity Inventory

This document is the Phase 0 artifact that
[`provider-execution-migration-plan.md`](provider-execution-migration-plan.md) required but that was
never produced on this branch. It records, per user-facing surface, what the pre-migration
composition wired and what the post-cutover composition actually wires.

It exists because the plan's Definition of Done contains the statement *"every current user path is
present through the new composition"* with nothing to check it against. Without a baseline, that item
was self-certified as passing while most of the product surface was orphaned.

## Method

Reachability is computed by walking the import graph from `src/main.ts`, resolving relative
specifiers, the `@/*` alias, side-effect imports (`import './providers'`), dynamic `import()`, and
`require()`. A file that the entry point cannot reach is not in the production bundle, regardless of
whether it compiles, lints, or has passing unit tests.

Baseline: `710a43c` (`origin/main`, the commit the migration branch forked from).
Subject: `9df7b69` (`codex/provider-architecture-research` tip).

## Headline

| Measure | Baseline `main` | Branch tip | Delta |
|---|---|---|---|
| `.ts` files under `src/` | 536 | 660 | +124 |
| Reachable from `main.ts` | 525 | 336 | −189 |
| Unreachable (dead) | 11 | 324 | +313 |
| Dead lines | 1,031 | 52,213 | +51,182 |

330 files that the baseline wired are no longer reachable: 41 were deleted outright, 289 still exist
in the tree but nothing imports them.

Note on a related claim: the progress log states "81,391+ lines of legacy code deleted". Deletion did
occur, but `src/` grew from 144,822 to 160,847 lines over the same range. The net effect is more
code, roughly a third of it unreachable.

## Root cause

The baseline had one wiring hub. `src/main.ts` executed `import './providers'`, and
`src/providers/index.ts` registered nine `ProviderRegistration` values plus nine
`WorkspaceRegistration` values.

Each `ProviderRegistration` carried thirteen contributions. Each `WorkspaceRegistration` carried
roughly fifteen more. Together they were the only thing that attached provider settings tabs, model
catalogs, command catalogs, MCP managers, agent managers, history services, auxiliary services, and
chat UI configuration to the running plugin.

The cutover deleted `src/providers/index.ts`, the nine `registration.ts` files, `ProviderRegistry`,
and `ProviderWorkspaceRegistry`. It replaced exactly one of those contributions — `createRuntime`,
which became `ExecutionBackendFactory` and is wired through
`ProviderApplicationContextComposition`. The remaining contributions were not re-homed, so every
module that only the registration hub referenced became unreachable.

This is not a wiring oversight that can be fixed by re-adding imports. The replacement contract,
`ProviderModule` in `src/core/providers/ProviderModule.ts:174`, has **no slot** for most of what was
lost.

## Contribution-level gap

### `ProviderRegistration` (baseline) → `ProviderModule` (branch)

| Baseline contribution | Slot in `ProviderModule` | Status |
|---|---|---|
| `displayName` | `manifest.displayName` | Wired |
| `blankTabOrder` | `manifest.order` | Wired |
| `isEnabled` / `setEnabled` | `settings` codec | Wired |
| `createRuntime` | `execution` | Wired |
| `capabilities` | `capabilities` | Populated, but no consumer — see defects |
| `environmentKeyPatterns` | — | No slot |
| `chatUIConfig` | — | No slot |
| `settingsReconciler` | — | No slot |
| `historyService` | `features.ports.history?: object` | Placeholder type, not a contract |
| `taskResultInterpreter` | — | No slot |
| `createTitleGenerationService` | — | No slot |
| `createInstructionRefineService` | — | No slot |
| `createInlineEditService` | — | No slot |

### `WorkspaceRegistration` (baseline) → `ProviderWorkspaceContribution` (branch)

`ProviderWorkspaceContribution` (`ProviderModule.ts:46`) declares only `providerId`, `initialize`,
and `dispose`. The baseline registration additionally carried:

| Baseline contribution | Status |
|---|---|
| `settingsTabRenderer` | No slot |
| `modelCatalog` | Wired as `features.ports.models` — the one fully typed port |
| `commandCatalog` | `features.ports.commands?: object` — placeholder type |
| `mcpStorage` / `mcpManager` | `features.ports.mcp?: object` — placeholder type |
| `usageProvider` | `features.ports.usage?: object` — placeholder type |
| `agentStorage` / `agentManager` | Partially, as `features.ports.agents` (execution-side only) |
| `agentMentionProvider` | No slot |
| `refreshAgentMentions` | No slot |
| `workspaceCapabilities` | No slot |
| `cliResolver` | No slot |
| Provider storage services | No slot |

Eight of the ten entries in `ProviderFeaturePorts` (`ProviderModule.ts:85`) are typed as bare
`object`. They are reserved names, not contracts. Only `models` and `agents` carry real types.

### Ports actually populated per provider

| Provider | Populated ports |
|---|---|
| Antigravity | `models` |
| Claude | `models`, `agents`, `rewind` |
| Codex | `models`, `commands` |
| Gemini | `models`, `history`, `usage` |
| Grok | `models`, `history` |
| Kimi Code | `models`, `history` |
| MiMoCode | `models`, `history` |
| OpenCode | `models`, `history` |
| Qwen | `models`, `history`, `commands`, `usage` |

No provider populates `mcp`, `fork`, `steering`, or `compaction`. Only Claude populates `rewind`.

## Production entry points that return stubs

These are live, reachable functions in the production path whose bodies unconditionally return an
empty result. Each one silently disables a surface the baseline implemented.

| Location | Symbol | Returns | Disabled surface |
|---|---|---|---|
| `src/features/settings/GrimoireSettings.ts:177` | `providerRegistryGetChatUIConfig` | `STUB_CHAT_UI_CONFIG` | Model options, reasoning options, context window (reported as 0) |
| `src/features/settings/GrimoireSettings.ts:181` | `providerWorkspaceRegistryGetCapabilities` | stub | Workspace capability gating |
| `src/features/settings/GrimoireSettings.ts:185` | `providerWorkspaceRegistryGetServices` | `null` | All provider workspace services |
| `src/features/settings/GrimoireSettings.ts:189` | `providerWorkspaceRegistryGetCommandCatalog` | `null` | Slash command discovery and management |
| `src/features/settings/GrimoireSettings.ts:193` | `providerWorkspaceRegistryGetRuntimeCommandLoader` | `null` | Runtime command loading |
| `src/features/settings/GrimoireSettings.ts:197` | `providerWorkspaceRegistryGetSettingsTabRenderer` | `null` | All nine provider settings tabs |
| `src/features/settings/GrimoireSettings.ts:201` | `providerWorkspaceRegistryGetModelCatalog` | `null` | Model selection and refresh |
| `src/features/settings/GrimoireSettings.ts:205` | `providerWorkspaceRegistryRefreshAgentMentions` | no-op | Agent `@`-mentions |
| `src/features/chat/GrimoireView.ts:57` | `getDefaultCapabilities` | all fields `false` | Plan mode, rewind, fork, images, MCP, instruction mode, provider commands — for every provider |
| `src/features/chat/utils/assistantResponseMetadata.ts:97` | `STUB_CAPABILITIES` | stub | Reasoning-effort metadata |
| `src/features/inline-edit/ui/InlineEditModal.ts:327` | `inlineEditService` literal | `{ success: false }` | Inline edit, for every provider |

The plan forbids this shape explicitly: *"Unsupported behavior is absent and visible, not a no-op
method"* and *"provider-local successful no-op capability services"* are listed for deletion in
Phase 10.

## User-facing surface inventory

Status values: **wired** — reachable and functional; **stubbed** — reachable entry point returning an
empty result; **dead** — implementation present but unreachable; **deleted** — removed from the tree.

### Chat

| Surface | Status | Evidence |
|---|---|---|
| Send message, render assistant text | wired | `GrimoireView.submitInput` → `ChatProjectionViewController` |
| Message rendering, markdown, tools, thinking | wired | `MessageRenderer` and renderers reachable |
| Provider selection | wired (new) | `GrimoireView` dropdown, added post-cutover |
| Multi-tab conversations | deleted | `TabManager`, `Tab`, `TabBar`, `tabDOM`, `tabScroll`, `tabSettings`, `RenameTabModal`, `WarmRuntimeLru` |
| Model selector | stubbed | `getModelCatalog` → `null`; `STUB_CHAT_UI_CONFIG.getModelOptions` → `[]` |
| Input toolbar | dead | `ui/InputToolbar.ts` |
| File context / chips | dead | `ui/FileContext.ts`, `ui/file-context/**` |
| Image context and `/image` | dead | `ui/ImageContext.ts`, `imageGeneration.ts` |
| Answering interactions (approval, question, plan decision) | wired | `rendering/InteractionPromptRenderer.ts`, restored in Phase 12D |
| Rich prompt detail: command summaries, tool input, blocked paths | dead | `rendering/InlinePermissionRequest.ts`, `InlineAskUserQuestion.ts`, `InlineExitPlanMode.ts`, `InlinePlanApproval.ts` |
| Todo list rendering | dead | `rendering/TodoListRenderer.ts` |
| Agent work cards | dead | `rendering/AgentWorkCard.ts`, `projections/AgentProjection.ts` |
| Instruction mode | dead | `ui/InstructionModeManager.ts` |
| Bang-bash mode | dead | `ui/BangBashModeManager.ts`; `BangBashService` deleted |
| Navigation sidebar | dead | `ui/NavigationSidebar.ts`, `controllers/NavigationController.ts` |
| Status panel | dead | `ui/StatusPanel.ts` |
| Relevant notes | dead | `ui/RelevantNotesView.ts`, `core/context/RelevantNotesService.ts` |
| Editor / canvas selection context | dead | `controllers/SelectionController.ts` and siblings |
| Rewind / fork affordances | dead | `rewind.ts`; `MessageRenderer` receives `undefined` callbacks (`GrimoireView.ts:390`) |
| Usage display | dead | `utils/usageInfo.ts` |
| Greeting | dead | `utils/greetings.ts`; `GrimoireView.getGreeting` returns a literal |
| Local shell | wired (coordinator) | `LocalShellExecutionCoordinator` reachable; no UI entry point |
| Orchestrator plans | dead | `application/OrchestratorWorkGraphCoordinator.ts`, `rendering/InlineOrchestratorPlan.ts` |

Interactions were the most severe entry: a provider that requested tool permission had no surface to
ask through, so the run simply hung. Phase 12D closed that by rendering the provider-neutral
`ExecutionInteractionPresentation` directly. The legacy renderers stay orphaned because they expect
provider-shaped input — tool name, raw input object, blocked path, decision options — that the
interaction bridges normalize away by design. Restoring their detail is a separate decision about
which additional fields a presentation may carry, bounded by the plan's rule against persisting raw
protocol payloads.

### Settings

| Surface | Status | Evidence |
|---|---|---|
| Settings shell, general / providers / workspace / about tabs | wired | `GrimoireSettings.ts` |
| Provider enable / disable, display names, ordering | wired | routed through `builtInProviderCatalog` |
| Per-provider settings tabs (all nine) | dead + stubbed | nine `ui/*SettingsTab.ts` unreachable; `getSettingsTabRenderer` → `null` |
| MCP server management | dead | `McpSettingsManager`, `McpServerModal`, `McpTestModal` |
| Skill settings | dead | `ProviderSkillSettings`, provider skill storages |
| Agent settings | dead | nine `ui/*AgentSettings.ts` |
| Command settings | dead | provider command catalogs and settings |
| Model refresh | stubbed | `getModelCatalog` → `null` |
| Provider disabled notice | dead | `ui/ProviderDisabledNotice.ts` |
| Environment settings | wired | `ui/EnvironmentSettingsSection.ts` |

### Provider services

| Surface | Status |
|---|---|
| Execution backends (all nine) | wired |
| CLI resolution (nine `*CliResolver.ts`) | dead |
| Provider-native history services (18 files) | dead |
| Auxiliary services: title, refine, inline edit (31 files) | dead |
| Settings reconcilers (nine) | dead |
| Capability descriptors (nine `capabilities.ts`) | dead |
| Agent storage / managers / mention providers (20 files) | dead |

Inline edit is a shipped command in `main.ts:167` and its modal opens, but the modal constructs an
inline literal that always resolves to `{ success: false, error: 'Inline edit requires a connected
provider session.' }` (`InlineEditModal.ts:327`). Every provider's real inline-edit service is
unreachable.

## Defects, as distinct from gaps

These are not missing wiring; they are incorrect code on the live path.

1. **No provider can execute a turn.** This is the top blocker, ahead of every missing surface.

   `GrimoireView.submitInput` fabricates `startupRef: \`startup-${Date.now()}\`` and
   `restartFingerprint: \`fp-${Date.now()}\``. `startupRef` is not a free-form string: it must be an
   opaque reference registered with the execution request broker under `managed-acp-launch`, which
   resolves to `{executable, arguments, cwd, environment}` — see `ManagedAcpLaunchResolverAdapter`.
   Claude has the equivalent contract under `claude-startup-options`.

   Nothing in `src/` registers either kind. The resolvers exist and are wired, but no producer ever
   supplies a launch spec, so `EphemeralExecutionRequestStore.resolve` throws
   `Execution request "startup-…" is unavailable for managed-acp-launch` and the provider process
   never starts. This affects Claude plus all six managed-ACP providers.

   The payload is invalid on shape as well: `OpencodeExecutionInvocation` requires `cwd` and
   `mcpServers`, and the view sends neither.

   The clock-derived `restartFingerprint` would separately defeat client reuse — managed-ACP backends
   compare it against the cached value to decide whether to relaunch, for example
   `GeminiExecutionBackend.ts:559` — but that only matters once a launch can succeed at all.

   Producing a real launch spec requires the orphaned `*CliResolver.ts`, `*LaunchArtifacts.ts`, and
   `*RuntimeEnvironment.ts` modules, so this is blocked on the 12B contract work rather than fixable
   at the call site.

2. **Diagnostic notice shipped to production.** `GrimoireView.ts:128` raises
   `new Notice('Grimoire onOpen: contentEl=…', 5000)` on every view open. It was added deliberately
   in the branch-tip commit to trace lifecycle and never removed.

3. **Full re-render per projection update.** `GrimoireView.replace` calls
   `MessageRenderer.renderMessages` unconditionally, including during streaming
   (`GrimoireView.ts:477-479`, comment: "Do a full re-render for now"). The baseline updated
   incrementally.

4. **Capabilities computed, then ignored.** Each module publishes a
   `ProviderCapabilityDescriptor`, but the chat view calls a local `getDefaultCapabilities` that
   returns `false` for every field. The descriptors have no consumer in `src/features/`.

5. **Legacy bridge types retained.** `LegacyProviderContext` and `LegacyProviderTabManagerHandle`
   appear in 48 files, and `GrimoireView` defines `GrimoireTabManagerStub` plus seven no-op methods
   (`GrimoireView.ts:552-594`). Phase 10 requires every temporary bridge to be gone.

## Scope implication

Remediation is not reconnection. Restoring these surfaces requires, in order:

1. extending `ProviderModule` with slots for settings presentation, chat UI configuration, auxiliary
   services, agent mentions, CLI resolution, and workspace capabilities;
2. replacing the eight placeholder `object` ports with real contracts;
3. populating those slots in all nine modules;
4. replacing the ten stub entry points with catalog-backed lookups;
5. re-hosting the chat surfaces that currently have no owner, including the four inline interaction
   renderers;
6. deciding explicitly whether multi-tab conversations return or are replaced by Obsidian leaves.

Items 1 through 3 are contract work on `src/core/` and `src/providers/`. Item 4 is mechanical once
the contracts exist. Item 5 is the largest and least specified.

## The gate

This inventory is enforced, not narrated. Phase 12A landed three files:

| File | Role |
|---|---|
| `tests/helpers/moduleReachability.ts` | Import-graph walker over the TypeScript AST, from `src/main.ts` |
| `tests/unit/architecture/presentationParityManifest.ts` | The ledger: 29 surfaces owning 322 orphaned modules, plus 11 stubbed entry points |
| `tests/unit/architecture/presentationParity.test.ts` | Asserts the ledger against the real import graph |

Run it with:

```bash
npm run test -- --selectProjects unit --testPathPatterns presentationParity
```

The gate is bidirectional, which is the property that matters:

- a **newly orphaned** module fails `attributes every unreachable module to a manifest surface`,
  so code cannot quietly drop out of the bundle again;
- a **restored** module fails `keeps every pending surface orphaned until the manifest is updated`,
  so progress must be recorded rather than assumed;
- a **repaired stub** fails its entry in `stubbed production entry points`, because each stub is
  pinned by a marker string that disappears when it is replaced.

All three were verified by deliberately introducing each condition and confirming the corresponding
assertion fires.

Remediation therefore has a countable finish line: Phase 12 is done when the manifest holds no
`pending` surface and `STUBBED_ENTRY_POINTS` is empty. Every surface moved to `wired` is a real,
checked claim rather than a checkbox.

The walker treats a module as shipped only if the production entry point can reach it. Ambient `.d.ts`
declarations are excluded, since the compiler consumes them without an import.
