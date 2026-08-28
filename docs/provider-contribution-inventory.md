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

## `ProviderRegistration` fields (2) — [types.ts:56](../src/core/providers/types.ts)

Rows that have already moved are not deleted; they are listed under
[Moved to their target homes](#moved-to-their-target-homes-12) with where they live now. Row
numbers are stable: a moved row leaves a gap rather than renumbering the rows below it, because the
plan and this file both refer to rows by number.

| # | Field | What it carries | Consumed by today | Target home | Moves at |
|---|---|---|---|---|---|
| 15 | `taskResultInterpreter?` | provider task/tool result interpretation | chat rendering | result-interpretation port | M5 |
| 16 | `subagentLifecycleAdapter?` | subagent tool-name recognition and display parsing | `SubagentManager` | native-agent observation port | M5 |

## `ProviderWorkspaceServices` members (10) — [types.ts:436](../src/core/providers/types.ts)

| # | Member | What it carries | Consumed by today | Target home | Moves at |
|---|---|---|---|---|---|
| 1 | `commandCatalog?` | static slash-command inventory | command discovery, mention UI | commands capability port | M5 |
| 2 | `agentMentionProvider?` | agent mention inventory | mention UI | agent-mention port | M5 |
| 3 | `cliResolver?` | CLI binary resolution | launch paths, settings diagnostics | module CLI-resolution slot; the execution side moves with the M2 flip through the backend's own launch composition (exact mechanism is an M2-proofs design decision), the settings-side display at M3 | M2 execution side; M5 settings side |
| 4 | `modelCatalog?` | model discovery and listing | settings, model picker | model-routing port | M5 |
| 5 | `usageProvider?` | plan/usage indicators | status UI | usage port | M5 |
| 6 | `runtimeCommandLoader?` | active-session command discovery | chat UI | commands capability port | M5 |
| 8 | `mcpStorage?` | Grimoire-owned MCP config storage | MCP UI, session injection | MCP port | M5 |
| 9 | `mcpServerManager?` | MCP server lifecycle | MCP UI, sessions | MCP port | M5 |
| 10 | `settingsTabRenderer?` | provider settings tab | `GrimoireSettings` | settings presentation slot | M5 |
| 11 | `refreshAgentMentions?` | mention refresh hook | workspace refresh | agent-mention port | M5 |

## Registration- and app-level contributions (1) — outside both service objects

These carried no slot in the v1 module and are the easiest to lose again, because they are not
fields of either service interface.

| # | Contribution | Where it lives today | Consumed by today | Target home | Moves at |
|---|---|---|---|---|---|
| 1 | `workspaceCapabilities` | `ProviderCapabilityDescriptor.workspace`, read through `ProviderCatalog.workspaceCapabilities()` | settings gating | **arrived**; the registration still carries the record because the registry validates it, and a parity gate compares the two until the registry goes | M5 |

## Moved to their target homes (16)

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
| 5 | `getPreloadedContextFiles` | registration | `ProviderDeclarations.context` | `ProviderCatalog.preloadedContextFiles()` | M3 |
| 6 | `capabilities` | registration | `ProviderCapabilityDescriptor` | `ProviderCatalog.capabilities()`, projected by `toLegacyCapabilities` | M3 |
| 7 | `environmentKeyPatterns` | registration | `ProviderSettingsCodec.environmentKeyPrefixes` | `ProviderCatalog.environmentKeyOwner()` | M3 |
| 11 | `createTitleGenerationService` | registration | `ProviderAuxiliarySource` supplied by the provider's execution composition | `AuxiliaryExecutionOwner.titleGenerationService()` | M5 |
| 12 | `createInstructionRefineService` | registration | the same source, purpose `instruction-refine` | `AuxiliaryExecutionOwner.instructionRefineService()` | M5 |
| 13 | `createInlineEditService` | registration | the same source, purpose `inline-edit` | `AuxiliaryExecutionOwner.inlineEditService()` | M5 |
| 8 | `chatUIConfig` | registration | `ProviderDeclarations.chatUI`, a `ProviderChatUiContribution` each module builds over its own config | `ProviderCatalog.declarations(id).chatUI` | M5 |
| 9 | `settingsReconciler` | registration | `ProviderSettingsReconciliation`, which the codec extends and each module builds over its own reconciler | `ProviderCatalog.settingsReconciliation(id)` | M5 |
| 10 | `createRuntime` | registration | the provider's execution composition | `ApplicationRuntime.createRuntimeFor(id)` | M2 flipped it; M5 removed the registration hop |
| 14 | `historyService` | registration | split in two: `ProviderDeclarations.conversationState` for the four pure members, `ProviderWorkspaceSlots.transcripts` for the two that do I/O | `ProviderCatalog.declarations(id).conversationState`, `workspaceFor(id).transcripts` | M5 |
| 2 | default provider configs | app-level | `ProviderSettingsCodec.defaults()` | `ProviderCatalog.defaultConfigs()` | M3 |
| 3 | workspace initialize/dispose lifecycle | app-level | `ProviderWorkspaceContribution`, both halves required | `ProviderWorkspaceManager`, owned by the plugin instance | M3 |

Rows 11-13 moved together because they were one contribution wearing three names. Every provider
supplied all three or none, five supplied the same wrapper around a runner three times, three
supplied nine no-op classes, and the only per-provider facts in any of them were which auxiliary
conversation a purpose maps to and whether the provider owns the configured title model. What a
provider contributes now is a `ProviderAuxiliarySource` — a runner per purpose — and a provider that
contributes nothing is a provider that cannot do auxiliary work, which the owner says once in the
provider's own display name.

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

App-level row 2 went next, and the two sources agreed for eight providers of nine. Antigravity's
hand-maintained default omitted `discoveredModels`, which its own reader normalized back to an empty
list on every load — so the shipped settings file gains one key with the value it was already read
as. The nine `DEFAULT_<PROVIDER>_PROVIDER_SETTINGS` constants are no longer a source;
`getBuiltInProviderDefaultConfigs()` derives from the catalog, and the keys it ships are pinned in a
test rather than left to be re-derived from the codecs it is checking.

Row 5 followed the split that made `declarations` reachable without a plugin. Only Grok declares it —
it has no agent definition, so its system prompt is a vault file passed on the command line — and the
catalog answers an empty list for the other eight, which is where the knowledge belongs: the chat
context surface used to ask a registry that answered for a provider it named nowhere.

### Where the remaining rows go

Every row still in the two tables above moves at **M5**, with the consumer that reads it. M3 was
revised during execution: reading these rows against their target slots found thirteen shape
mismatches with one cause — the `ProviderModule` contract was written as a better contract, not as a
destination for the legacy one. `commandCatalog` answers `getDropdownConfig()` and
`listDropdownEntries()` against a slot offering `list()`; `chatUIConfig` has twenty-odd UI members
against three; `settingsTabRenderer` takes a context carrying `HTMLElement` against a deliberately
opaque host; `historyService` is workspace-global against a runtime-bound port. Each is a
re-implementation of a UI-shaped consumer, which is what M5 does anyway, to the same consumers, at
the same layer. The evidence table is in the progress log.

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
- **A typed slot exists for every row, and for more than half of them it is the wrong shape.** The
  slots were written from the row *names* in these tables rather than from the contributions'
  shapes, so `usage` is one window where the contribution has several, `models` is a reader where
  the contribution is a settings writer, `agentMentions` is async where the consumer searches while
  someone types, and `residency` is a boolean where the contribution answers one of three modes over
  a context. Read the slot beside its consumer before treating a row as a move; the eight known
  mismatches are enumerated in the migration progress log under *"The thirteen provider rows"*.
