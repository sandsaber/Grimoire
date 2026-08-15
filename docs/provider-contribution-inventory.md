# Provider Contribution Inventory

Every contribution a built-in provider supplies to the product today, with its target home in the
new architecture and the milestone that moves it. This table is the seed of the M0a parity manifest
and the design input for the full `ProviderModule` slot contract in M1. It replaces the informal
"thirteen contributions" figure from the v1 audit: the real inventory is 16 registration fields,
11 workspace-service members, and 3 registration/app-level contributions that live outside both
service objects.

The v1 `ProviderModule` had slots for execution, settings codec, workspace lifecycle, capabilities,
and feature ports typed as bare `object` — and nothing else. The v1 cutover replaced `createRuntime`
and silently dropped most of the rest. A contribution below may not be harvested, moved, or deleted
without its row being updated. The M0a fitness test
(`tests/unit/architecture/providerContributionInventory.test.ts`) enforces that in three directions,
and it is worth being precise about which:

- **against the declarations** — the two tables are compared for exact set equality with the members
  of `ProviderRegistration` and `ProviderWorkspaceServices`, read through the TypeScript AST;
- **against the registrations** — all nine `*ProviderRegistration` objects must supply every required
  field and no undocumented one, and all nine workspace registrations must carry
  `workspaceCapabilities` and an initializer;
- **against the parity manifest** — for the ten contributions that own a named user-facing surface,
  the inventory row and the manifest state must agree, so a contribution cannot be listed as live
  here while its surface is quietly marked pending there.

What it does **not** check: the concrete `ProviderWorkspaceServices` object a provider returns, since
that is produced by `initialize(context)` and needs a live plugin. A provider that stops supplying an
optional workspace member is caught only by the parity gate, and only if its module leaves the
bundle.

## `ProviderRegistration` fields (16) — [types.ts:56](../src/core/providers/types.ts)

| # | Field | What it carries | Consumed by today | Target home | Moves at |
|---|---|---|---|---|---|
| 1 | `displayName` | provider identity label | settings UI, tab labels, pickers | `ProviderManifest` | M3 |
| 2 | `blankTabOrder` | deterministic provider ordering | blank tab, settings ordering | `ProviderManifest` | M3 |
| 3 | `isEnabled` | enablement predicate over settings | view, settings, tab creation | `ProviderSettingsCodec` | M3 |
| 4 | `setEnabled` | enablement writer | settings toggles | `ProviderSettingsCodec` | M3 |
| 5 | `getPreloadedContextFiles?` | provider-preloaded context file names | chat context surfaces | context capability port | M3 |
| 6 | `capabilities` | static feature flags | chat UI gating, controllers | `ProviderCapabilityDescriptor` | M2 (adapter reads descriptor); UI gating M3 |
| 7 | `environmentKeyPatterns?` | env keys that invalidate runtime | settings environment handling | `ProviderSettingsCodec` runtime-input declaration | M3 |
| 8 | `chatUIConfig` | provider chat UI configuration | chat feature rendering | UI-config feature contribution | M3 |
| 9 | `settingsReconciler` | settings/model normalization on load and env change | settings load, environment change | `ProviderSettingsCodec` | M3 |
| 10 | `createRuntime` | chat execution (`ChatRuntime`) | `TabManager` / `Tab` | `ExecutionBackendFactory` behind the presentation adapter | **M2 — this is the flip** |
| 11 | `createTitleGenerationService` | auxiliary provider execution | title generation | auxiliary owner over an isolated execution session | M5 (legacy path allowed until then) |
| 12 | `createInstructionRefineService` | auxiliary provider execution | instruction refine | auxiliary owner | M5 |
| 13 | `createInlineEditService` | auxiliary provider execution | inline edit modal | auxiliary owner | M5 |
| 14 | `historyService` | hydration, fork state, session resolution, deletion | conversation controllers, history UI | history capability port | M3 |
| 15 | `taskResultInterpreter` | provider task/tool result interpretation | chat rendering | result-interpretation port | M3 |
| 16 | `subagentLifecycleAdapter?` | subagent tool-name recognition and display parsing | `SubagentManager` | native-agent observation port | M5 |

## `ProviderWorkspaceServices` members (11) — [types.ts:436](../src/core/providers/types.ts)

| # | Member | What it carries | Consumed by today | Target home | Moves at |
|---|---|---|---|---|---|
| 1 | `commandCatalog?` | static slash-command inventory | command discovery, mention UI | commands capability port | M3 |
| 2 | `agentMentionProvider?` | agent mention inventory | mention UI | agent-mention port | M3 |
| 3 | `cliResolver?` | CLI binary resolution | launch paths, settings diagnostics | module CLI-resolution slot; the execution side moves with the M2 flip through the backend's own launch composition (exact mechanism is an M2-proofs design decision), the settings-side display at M3 | M2/M3 |
| 4 | `modelCatalog?` | model discovery and listing | settings, model picker | model-routing port | M3 |
| 5 | `usageProvider?` | plan/usage indicators | status UI | usage port | M3 |
| 6 | `runtimeCommandLoader?` | active-session command discovery | chat UI | commands capability port | M3 |
| 7 | `tabWarmupPolicy?` | provider warmup policy | `TabManager` | replaced by lifecycle residency policy | M5 |
| 8 | `mcpStorage?` | Grimoire-owned MCP config storage | MCP UI, session injection | MCP port | M3 |
| 9 | `mcpServerManager?` | MCP server lifecycle | MCP UI, sessions | MCP port | M3 |
| 10 | `settingsTabRenderer?` | provider settings tab | `GrimoireSettings` | settings presentation slot | M3 |
| 11 | `refreshAgentMentions?` | mention refresh hook | workspace refresh | agent-mention port | M3 |

## Registration- and app-level contributions (3) — outside both service objects

These carried no slot in the v1 module and are the easiest to lose again, because they are not
fields of either service interface.

| # | Contribution | Where it lives today | Consumed by today | Target home | Moves at |
|---|---|---|---|---|---|
| 1 | `workspaceCapabilities` | `ProviderWorkspaceRegistration.workspaceCapabilities` ([types.ts:484](../src/core/providers/types.ts)) | `ProviderWorkspaceRegistry.getCapabilities()`, settings gating | workspace part of `ProviderCapabilityDescriptor` in the module | M3 |
| 2 | default provider configs | `getBuiltInProviderDefaultConfigs()` in [defaultProviderConfigs.ts](../src/providers/defaultProviderConfigs.ts), a third source beside the two registries | [defaultSettings.ts](../src/app/settings/defaultSettings.ts) | `ProviderSettingsCodec` defaults, published through the catalog | M3 |
| 3 | workspace initialize/dispose lifecycle | `ProviderWorkspaceRegistry.initializeAll()` at plugin load; **no dispose contract exists today** | `main.ts` startup | lazy, failure-isolated init plus asynchronous dispose in the workspace manager — both halves land together; "init without dispose" is the v1 defect repeating | M3 |

## Rules

- A flip (M2) moves row 10 of the registration table and the execution side of `cliResolver` only.
  Every other row stays on its legacy path, untouched, until its listed milestone.
- Rows 11–13 of the registration table are provider execution outside chat: until M5 a flipped
  provider intentionally runs new chat execution beside legacy auxiliary execution. See the
  mixed-authority rule in the plan.
- The M1 `ProviderModule` contract must declare a typed slot for every row of all three tables
  before any backend is harvested, even though most consumers move only at M3/M5.
- `chatUIConfig` is one row here but a wide object (model presentation, reasoning controls,
  permission toggles, icons). The M0a surface manifest must expand its contents into individual
  surfaces; losing the model picker inside a "migrated" `chatUIConfig` is exactly the v1 failure
  shape.
