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

## `ProviderRegistration` fields (10) — [types.ts:56](../src/core/providers/types.ts)

Rows that have already moved are not deleted; they are listed under
[Moved to the provider catalog](#moved-to-the-provider-catalog-5) with where they live now. Row
numbers are stable: a moved row leaves a gap rather than renumbering the rows below it, because the
plan and this file both refer to rows by number.

| # | Field | What it carries | Consumed by today | Target home | Moves at |
|---|---|---|---|---|---|
| 5 | `getPreloadedContextFiles?` | provider-preloaded context file names | chat context surfaces | context capability port | M3 |
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

## Registration- and app-level contributions (2) — outside both service objects

These carried no slot in the v1 module and are the easiest to lose again, because they are not
fields of either service interface.

| # | Contribution | Where it lives today | Consumed by today | Target home | Moves at |
|---|---|---|---|---|---|
| 1 | `workspaceCapabilities` | `ProviderWorkspaceRegistration.workspaceCapabilities` ([types.ts:484](../src/core/providers/types.ts)) | `ProviderWorkspaceRegistry.getCapabilities()`, settings gating | workspace part of `ProviderCapabilityDescriptor` in the module | M3 |
| 2 | default provider configs | `getBuiltInProviderDefaultConfigs()` in [defaultProviderConfigs.ts](../src/providers/defaultProviderConfigs.ts), a third source beside the two registries | [defaultSettings.ts](../src/app/settings/defaultSettings.ts) | `ProviderSettingsCodec` defaults, published through the catalog | M3 |

## Moved to their target homes (7)

Rows that have reached the home the tables above name for them. They stay recorded here for the
same reason those tables exist: a contribution that simply disappears from an inventory is
indistinguishable from one that was dropped. The `From` column says which table the row left, so
each table's total still adds up.

| # | Contribution | From | Now declared by | Read through | Moved at |
|---|---|---|---|---|---|
| 1 | `displayName` | registration | `ProviderManifest.displayName` | `ProviderCatalog.displayName()` / `displayNameOrId()` | M3 |
| 2 | `blankTabOrder` | registration | `ProviderManifest.order` | `ProviderCatalog.ids()`, which sorts by it | M3 |
| 3 | `isEnabled` | registration | `ProviderSettingsCodec.isEnabled` | `ProviderCatalog.isEnabled()` / `enabledIds()` | M3 |
| 4 | `setEnabled` | registration | `ProviderSettingsCodec.withEnabled` | `ProviderCatalog.setEnabled()` | M3 |
| 6 | `capabilities` | registration | `ProviderCapabilityDescriptor` | `ProviderCatalog.capabilities()`, projected by `toLegacyCapabilities` | M3 |
| 7 | `environmentKeyPatterns` | registration | `ProviderSettingsCodec.environmentKeyPrefixes` | `ProviderCatalog.environmentKeyOwner()` | M3 |
| 3 | workspace initialize/dispose lifecycle | app-level | `ProviderWorkspaceContribution`, both halves required | `ProviderWorkspaceManager`, owned by the plugin instance | M3 |

Both moved together, and had to: ordering with the names still on the registration would have left
two inventories able to disagree about the same provider — which they already did. Three modules
reached M3 declaring the `manifest.order` of the provider they were forked from, and nothing
compared the two, because nothing could. The catalog now refuses a duplicate order outright.

Rows 3 and 4 followed. Enablement is read and written through the provider's own settings codec, and
the write applies only the keys enablement changed: the legacy writer re-encoded the whole provider
config on every toggle, so switching a provider off also rewrote its CLI path and its model lists
through whatever normalizers those fields happened to have.

Row 6 followed once the descriptor could answer both command questions. The nine
`src/providers/<id>/capabilities.ts` files are deleted; the record the UI reads is projected from
the descriptor, and the values those files held live on as
`tests/fixtures/providerCapabilityBaseline.ts`, which the parity test compares field for field. A
projection is only trustworthy against something it cannot also change.

The app-level lifecycle row moved with the workspace manager. `initializeAll()` was a loop that
awaited each provider in turn with no `try`, published into a static map that outlived the plugin
instance, and had no teardown at all; the manager initializes concurrently, isolates a failure to
the provider that caused it, leaves that provider retryable, and releases everything at unload.
Initialization is still eager and there is no generation fence: laziness belongs with the move of
workspace consumers onto the module slots, since every consumer reads its service synchronously
today, and a fence belongs with the first settings transition that recycles a workspace.

Row 7 arrived at a different home than this table predicted. It named
`ProviderSettingsCodec`'s runtime-input declaration, but `runtimeInputKeys` are *settings* field
names and these are *environment variable* names — two questions that happen to sit next to each
other. It is `environmentKeyPrefixes` now, and prefixes rather than regular expressions: all nine
registrations wrote `/^PREFIX_/i` and nothing needed more, while a contract taking an arbitrary
expression has the core run provider-supplied code over every key a user types into their
environment settings.

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
