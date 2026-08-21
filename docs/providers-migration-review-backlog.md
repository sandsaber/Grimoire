# `providers-migration` — review backlog

Three reviews, kept in one file because each reviews the fixes the last one asked for. The newest is
at the bottom.

## First review (2026-08-20)

A six-specialist review of `0f84b41 (origin/main) .. d9f715e`: kernel architecture, ACP transport,
security, Grok wave 5, the Claude/Codex/Antigravity flips, and QA. Verdict: **ready to merge with
fixes** — 1 Critical, ~18 Important, ~25 Minor.

The branch moved during the review: the Grok flip (`2b96e70`) landed while the specialists were
reading, so the range they covered ends at `d9f715e` and includes it.

**This file is the work list, not the reports.** The full per-specialist reports, including the
Minor items not repeated here, are in the session transcript at
`~/.claude/projects/-home-m5-HomeBrew-git-Grimoire/2b564528-0ab9-486c-a05c-a62b26b6ef47.jsonl`.

**Status column**: `confirmed` means re-checked against the tree at `d9f715e` in this session, with
the evidence named. `reported` means it stands on the specialist's reading and is the first thing to
verify before fixing it.

### Gates at `d9f715e`

All seven green: unit 476 suites / 7,627 tests, typecheck, lint, integration 145 passed / 35 skipped
(live suites are env-gated by design), `npm audit --omit=dev` clean, and `review:source` /
`review:css` / `review:deps`.

### Critical

| # | Finding | Evidence | Status |
|---|---|---|---|
| C1 ✅ | **Control records are never deleted, and every start reads all of them.** `VersionedRepository.remove` (`src/core/persistence/VersionedRepository.ts:136`) and `DurableStorage.remove` have no production caller anywhere in `src/core` or `src/app` — the only `.remove(` in either is the vault adapter primitive itself (`src/core/storage/VaultFileAdapter.ts:56`). `deleteConversation` (`src/main.ts:1078`) removes the provider session and the metadata and no control record, though D4 requires deleting every control record the conversation owns. Startup parses every intent and record ever written (`TransactionIntentCoordinator.ts:156`), so disk and start time grow monotonically in a real vault. | grep for `.remove(` callers; D3/D4 in `docs/provider-execution-persistence-decisions.md` | confirmed |

Order of work inside C1, as reviewed: completed transaction intents first (the highest-volume
artifact), then deletion by conversation, then eviction of terminal runs from the in-memory maps.

**Progress:** the intents half is done — completed intents are removed at completion and swept at
startup, including everything older builds left behind, with the repeat answer moved into a bounded
in-memory window. Deletion by conversation is done too: control records are owned by the conversation
rather than by the tab, `deleteOwnedRecords` removes them through an intent-backed transaction that
recovery finishes, and `deleteConversation` calls it. In-memory eviction is done as well: a disposed
session's runs and interactions go with it, bounding the maps by the tabs that are open rather than
by the length of the session. **C1 is closed.**

### Important

#### Kernel and adapter

| # | Finding | Evidence | Status |
|---|---|---|---|
| K1 ✅ | **The auto-turn callback has two different shapes.** The adapter calls `autoTurn(runId)` with `unknown` (`ExecutionChatRuntimeAdapter.ts:1016`, declared `1060`); the only consumer takes an `AutoTurnResult` and reads `result.chunks` (`Tab.ts:1795`). A backend-initiated run would throw inside the registry's observer and be swallowed. Latent today because nothing initiates one. | both call sites read | confirmed |
| K2 ❌ | **Refuted.** `wasSent` is false only for `invalidated`, and the terminal policy allows exactly two reasons there — `pre-dispatch-rejected` and `side-effect-free-rejection`, both meaning the turn never reached the provider. A dispatch that might have landed is `indeterminate`, which reports true, and a cancelled turn is already pinned at `wasSent: true` by `ExecutionAdapterConformance.test.ts`. | `ExecutionTerminalPolicy.ts` + the existing row | refuted |
| K3 ✅ | Every durable event rewrites the whole session record, including an unbounded `runIds` array — roughly six file writes per event. | confirmed by reading both envelope paths | confirmed |
| K4 ✅ | The browser timer in provider-neutral core (`ExecutionChatRuntimeAdapter.ts`) where an injectable clock already sat beside it; the DOM boundary gate covered neither that file nor that global. | gate read: the pattern named only `document` and `HTMLElement` | confirmed |
| K5 ✅ | `shutdown()` can wait forever on a hung `createSession` — `waitForAdmissions` had no grace period, while every other wait in that method did. | code read | confirmed |

#### ACP transport

| # | Finding | Evidence | Status |
|---|---|---|---|
| A1 ✅ | **A process that dies while idle wedges the conversation permanently.** `onConnectionLost` only acts when a run is active (`ManagedAcpExecutionBackend.ts:662`): with no active run the dead client is neither closed nor invalidated, so every later turn fails `invalidated` until a reload. The legacy path handled it (`acpSessionResume.ts` / `acpManagedSession.ts:105`), so this is a fix the migration lost — the one finding that can freeze a conversation for good. | code read: recovery is gated on `active && !active.isTerminal` | confirmed |
| A2 ✅ | **`AcpSessionUpdateNormalizer.normalize` returns `undefined` for an update outside its union** — the switch has no `default:` and no trailing return (`AcpSessionUpdateNormalizer.ts:84–115`), while the signature promises `AcpNormalizedUpdate`. The presenter then reads `.type` off `undefined`. The vendor channel added in `e424c99` is exactly what delivers updates outside that union. | switch read in full | confirmed |
| A3 ✅ | Launch diagnostics degraded: the managed launcher drops stderr and the legacy `describeSpawnError` wording ("command not found…"), so an ENOENT now surfaces as a misleading resume hint. | — | reported |

#### Grok (wave 5)

| # | Finding | Evidence | Status |
|---|---|---|---|
| G1 ✅ | **`resolveGrokAcpModeId` is dead code** (`src/providers/grok/modes.ts:165`) — referenced only by its own test. It is the mapping that keeps Grimoire's synthetic `grimoire-*` mode ids off the wire, and issue #52 is that class of bug: on a release that reports native modes, every turn now sends a synthetic id to `session/set_mode` and takes `-32602`. | grep: declaration + `tests/unit/providers/grok/modes.test.ts` only | confirmed |
| G2 ✅ | `current_mode_update` and `config_option_update` no longer sync session state — the new content presenter has no case for either. | — | reported |
| G3 ✅ | The cost of a cancelled turn is lost; the legacy path read it off the session log before honouring the cancel. | — | reported |
| G4 ✅ | Grok's wire-vocabulary gate still asserts "not admitted" for the three vendor updates the flip consumes, so a regression that dropped them again would not go red. | — | reported |
| G5 ✅ | No execution-backend conformance suite for Grok, though OpenCode, Codex, Claude and Antigravity each have one. | — | reported |

#### Claude (wave 3)

| # | Finding | Evidence | Status |
|---|---|---|---|
| L1 ✅ | **`ClaudePlanUsageStore.recordSdkMessage` has no production caller** (`src/providers/claude/app/ClaudePlanUsageStore.ts:25`) — the plan-limit indicator loses its data. Wave 2 found and fixed exactly this class for Codex; Claude never got the equivalent. | grep: declaration only | confirmed |
| L2 ✅ | `claude-wire.json` exists and no test imports it — the wire row named in the journal as owed is still owed. | — | reported |
| L3 ✅ | Stop-during-subagent is disabled: the hook is hardcoded `{ hasRunning: false }` (`ClaudeExecutionComposition.ts:401`), where the legacy path blocked Stop while a subagent ran. | — | reported |

Codex and Antigravity came back clean — flip discipline, process ownership and sandbox policy all
held.

#### Security

| # | Finding | Evidence | Status |
|---|---|---|---|
| S1 ✅ | "Always allow" promotes the agent's whole `suggestions` rule set to `behavior: 'allow'` without showing them; a rule of `{toolName: 'Bash'}` with no pattern is permanent auto-approval of every command. Pre-existing, preserved by the flip. Fixed both ways the review asked for: clamped to the action approved, and shown on the card. | code read | confirmed |
| S2 ✅ | D7 path redaction misses Linux: the pattern matches `/Users`, `/Volumes`, `/tmp`, `/var`, `C:\` (`DebugLogService.ts:57`), so `/home/...` leaks through `stderrPreview`. | — | reported |
| S3 ✅ | Session metadata filenames embed an unvalidated provider-supplied id and are written non-atomically — the control store solves exactly this for its own records; the metadata file did not. | `conversationId = sessionId ?? generated` in `main.ts` | confirmed |

No Critical security finding in the new code. Fail-closed bridges, D2 enforced mechanically, atomic
CAS writes and shell-free Windows launch were all called out as done well.

#### QA

| # | Finding | Status |
|---|---|---|
| Q1 ✅ | Live matrices run nowhere automatically — by design, but nothing recorded when one last ran except each matrix's own Record table, and two matrices had no table at all. | confirmed |
| Q2 ✅ | The boundary gate did not see dynamic `import()` or `require()`; no violation existed. | confirmed |

### Where the first review stands

**Closed.** Every row is either fixed or, in K2's case, refuted with evidence. The last pass took
K3, K4, K5, S1, S3, Q1 and Q2 together; what each of them turned out to need beyond the literal fix
is in the journal entry for that commit.

### The order it was fixed in

1. **C1**, before the next flip — the only finding that accumulates in users' vaults every day.
2. **Grok, one pass**: G1 (the `#52` class), G2, G3, G5 — all small, all in one provider.
3. **Claude, one pass**: L1, L2, L3 — the patterns already exist in Codex's flip.
4. **ACP robustness**: A1 with a regression test, then A2.
5. **Hygiene**: K2, K1, S2, A3.

### What the first review praised

Kernel invariants living in one place (exactly-one-terminal, dedup, generation fencing, honest
`indeterminate`), with the adapter as a pure client. Gates that read the AST rather than text, a
boundary gate that guards itself, composition tests over the real registry. Wire-first discipline on
Grok — the recording taken before the code, its redaction catching a live API key, and fourteen live
rows actually run.

## Second review (2026-08-21)

A single-reviewer static pass over `d9f715e..2c80d7f` — the Grok flip plus the whole prioritized
backlog above — reading 70 files against `origin/providers-migration`. Verdict: the direction is
right and most of those rows are genuinely closed, but **do not push as it stands**: the D4 owner
change broke ordinary New Chat / history switching. Four bugs, two suggestions, no nits.

Every row was re-checked against the tree before it was touched, and all six were real.

### Gates at `2c80d7f`

Unit 477 suites / 7,668 tests, integration 5 passed / 145 (four live suites env-gated), typecheck,
`eslint`, `build:release`.

| # | Finding | Evidence | Status |
|---|---|---|---|
| R1 ✅ | **`resetSession()` drops the session but not the side channels.** `attachSideChannels` installs at most one (`if (this.sideChannels) return`), so after a New Chat or a history switch in the same tab the observer stays bound to the session that was left: content still streams through the per-run observer, while permission prompts, questions and backend-initiated turns reach nothing. `cleanup()` always did this correctly. The conversation-switch path added for D4 made it the common case, for every flipped provider. | both call sites read; the new switch test only checked `isReady()` / owner | confirmed |
| R2 ✅ | **`deleteConversation` never waits for the work it is deleting.** Cancelling is fire-and-forget and `createNew({force:true})` reaches `resetSession()`, which disposes with `void`. So either the live run makes `deleteOwnedRecords` throw and `.grimoire/control/**` survives a chat the UI already removed, or an idle session is yanked out of the map with no `dispose()` and the ACP process leaks. | `main.ts:1078` and `ExecutionLifecycleRegistry.deleteOwnedRecords` read together | confirmed |
| R3 ✅ | **A missing CLI still reads as a session that may be gone.** The launcher produces the "command not found" wording, but `ManagedAcpExecutionRun.start()` maps everything before dispatch to `invalidated` / `pre-dispatch-rejected`, and both ACP providers word that reason as a saved session that no longer exists. The launcher test asserted the throw, never the sentence a person sees. | `describeFailure` in both compositions | confirmed |
| R4 ✅ | **A user's Stop skips the last look and lands `indeterminate`.** `noteTurnEnded` was called only from `completeFromPrompt`; Stop goes through `terminate()`, which reconciled and finished in a microtask. Grok's and OpenCode's reconcilers both answer `unknown`, so Stop showed "Grimoire could not establish whether this run completed" and dropped the cancelled turn's cost. The last-look test never called `run.cancel()`. | `terminate()` read against `completeFromPrompt` | confirmed |
| R5 ✅ | `followBackendRun` consumes the per-tab `consumeProviderTurnMetadata` port, so a backend-initiated run settling beside a live user turn would take that turn's native ids. Latent — nothing starts one — and it is the code the K1 fix added. | port is per tab, consuming is destructive | confirmed |
| R6 ✅ | Comments still described five flips as dark, two JSDoc blocks sat on the wrong symbols, and `autoTurn` was still typed `(runId: unknown) => void` after K1 changed what it receives. | `registration.ts` vs. the paragraphs | confirmed |

### What changed, beyond the literal fix

Three of these could not be fixed where they were reported, and the difference is worth carrying
forward:

- **R2 moved the waiting into the registry.** A conversation is deleted from a surface where
  cancelling is fire-and-forget, so no caller can honestly claim to have stopped anything first.
  `deleteOwnedRecords` now cancels the owner's live runs and disposes its sessions through the same
  queue every other session operation takes, and `disposeSession` became idempotent because a tab
  reset and a delete legitimately both ask. The refusal that survives is a **lease**: cancelling
  reaches a run, nothing reaches a holder still reading the session.
- **R4 needed evidence, not a verdict.** Waiting for the prompt is what ACP prescribes — the agent
  answers the cancelled turn on the prompt itself — so `terminate()` now waits for that answer,
  bounded by the control timeout, and takes the last look on the way past. But the answer is handed
  to the **reconciler** as `RunRecoveryQuery.nativeStopReason` rather than short-circuiting it: a
  turn reporting itself cancelled says nothing about a process whose termination could not be
  proven, and the conformance row that pins exactly that stayed green. `acpCancellationEvidence` is
  the shared helper both ACP compositions use to read it.
- **the two ACP fakes were wrong about cancellation.** Both swallowed `session/cancel` and left the
  prompt open forever, which models an agent no ACP implementation is. They answer it now, which is
  why the shared conformance suite needed no changes.

### What the second review did not cover

Static reading of the diff only — no unit run and no browser smoke on these paths. The rows below
are still owed a person in a vault, and R1 in particular is a rendering-level symptom.

## Third review (2026-08-21, at `e4f4cdb`)

Eleven domain teams — kernel, core platform, Claude, Codex, Grok, ACP+OpenCode, MiMoCode+KimiCode,
Antigravity+Gemini+Qwen, features, style/i18n/release, tests/QA. Gates green: typecheck, lint,
unit 478 suites / 7,699 tests. Ten Important, roughly sixty Minor, no Critical **as filed**.

**All ten Important re-checked against the tree in this session. None was refuted** — the first
review of this branch produced one refutation and the second none, so this is the first round where
every filed Important held up exactly as written.

**One severity is wrong, and it is wrong downward.** KER-1 is filed Important; it is Critical. It is
the failure mode on the *revert* path, which is the safety argument the entire migration rests on.

### Important

| # | Finding | Re-check | Status |
|---|---|---|---|
| KER-1 ✅ | **Critical, not Important. A corrupt or future transaction intent breaks startup and leaks every backend.** `recoverPending` throws a plain `Error` for a `future` or `corrupt` record; `registry.start()` converts only `UnreadableControlRecordError` into a migration state, so a plain throw propagates, `migrationRequirement()` stays null, and the user gets no explanation. Worse, `ExecutionKernelHost.dispose()` returns early on `if (!this.gateOpen)` — a gate that never opened — so `registry.shutdown` never runs and no registered backend is disposed. This is exactly the D5 revert scenario: a newer build leaves a pending v2 intent, the user reverts, and the old build both fails opaquely and leaks provider processes on unload. | all three legs read: `TransactionIntentCoordinator.ts` throws `new Error`; `start()` rethrows anything not `UnreadableControlRecordError`; `dispose()` gates on `gateOpen` | confirmed |
| KER-2 ✅ | No retention sweep for shutdown checkpoints or settings-transition records: one checkpoint per unload, startup only marks it `completed`, nothing ever removes one. D3 says "consumed at next startup, or 7 days". | `shutdownCheckpoints` has `create`/`read`/`update`/`listRecordIds` callers and no removal | confirmed |
| KER-3 ✅ | Startup loads every run and interaction record of every undeleted conversation into memory, terminal runs of skipped-disposed sessions included, and `VaultDurableStorage.list()` reads each file in full just to enumerate ids. C1 bounded the maps within one process; a restart is still O(all records). | `loadPersistedControls` iterates `runs.listRecordIds()` unconditionally; `list()` calls `read` per path | confirmed |
| KER-4 ✅ | `deleteOwnedRecords` takes no admission, while `createSession` registers in the map only after its provider await — so deleting a conversation during its first session creation either misses the record or strands a live session whose records are gone. | no `beginAdmission()` in `deleteOwnedRecords`; `sessions.set` is 53 lines after the provider await | confirmed |
| CLA-1 ✅ | The Claude composition never calls `content.beginTurn()` at the turn boundary, where Grok and OpenCode both do. `sawStreamText`/`sawStreamThinking` therefore persist across turns in one conversation, and a later turn whose assistant message arrives without its own deltas renders empty. | `beginTurn()` has exactly one caller — `forgetConversation()`, which runs on conversation change | confirmed |
| CLA-2 ✅ | SDK amnesia recovery — resume answering with a different session id, then rebuilding context by injecting history — was dropped at the flip. The new path rejects the identity and finishes, and the next turn rebuilds the same intent with no injection anywhere. | `rg amnesia\|historyRebuild` is empty in `src/`, while `src/providers/claude/AGENTS.md:17` still documents the injection as provider behaviour | confirmed |
| MK-1 ✅ | MiMoCode and KimiCode each hand-roll `mapApprovalDecision` / `buildAcpApprovalDecisionOptions` / `selectPermissionOption`, reusing the shared helpers' names without importing them. Equivalent today; the local copies check `select-option` last where the shared one checks first. | both files define all three locally; only `src/providers/acp/index.ts` re-exports the shared module, and only Gemini consumes it | confirmed |
| GQ-1 ✅ | **Gemini and Qwen gate containment and write approval on the global `settings.permissionMode`**, which `ProviderSettingsCoordinator` overwrites with whichever provider was projected last. Another provider's Auto-approve toggle therefore disables Gemini/Qwen path containment and skips write approvals. Every flipped provider reads the per-provider snapshot instead. | five sites read `this.plugin.settings.permissionMode` directly; neither file mentions `getProviderSettingsSnapshot`; the coordinator writes the projected value at line 329 | confirmed |
| GQ-2 ✅ | Gemini's notification switch handles `message_chunk`, `tool_call`, `tool_call_update` and `usage` and drops `plan` and `current_mode`, while its capabilities declare `supportsPlanMode: true`. | switch read in full; `capabilities.ts:9` declares it | confirmed |
| GQ-3 ✅ | Antigravity declares `reasoningControl: 'effort'` and renders the picker; nothing in the print path reads `effortLevel`. A control that changes nothing. | the only `effortLevel` references under `src/providers/antigravity/` are the two UI writes | confirmed |
| GQ-4 ✅ | Gemini and Qwen erase a valid session binding on **any** load failure — `catch { return false; }` — where the shared `isAcpMissingSessionError` exists precisely to tell a missing session from a transient one. | neither provider references `isAcpMissingSessionError` | confirmed |

### Where the third review stands

**Every Important is closed.** KER-1..4, CLA-1, CLA-2, MK-1, GQ-1..5, QA-1, QA-2 — plus GQ-5 and the
settings-hub flake, neither of which was filed as Important. The Minor list below is what is left.

One is closed differently from how it was filed. CLA-2 asked either to port the legacy history
injection or to record the gap; what the re-check found underneath it was worse than the missing
context and simpler to fix: a conversation whose SDK session went missing could not take *another
turn at all*, because the refused resume left the binding stored and the next turn asked for the
same missing session. The binding is let go now. **Re-injecting the history remains owed** — see the
journal entry, and `src/providers/claude/AGENTS.md` still describes it as provider behaviour.

### The shape of it

Two clusters, and they are not the same kind of problem:

- **The kernel findings are lifecycle and growth edges** (KER-1..4). The design is not in question; what is missing is the unhappy path — a revert, a sweep, a restart, a race — and every one is fixable without moving a boundary.
- **Gemini and Qwen silently missed a round of fixes the rest absorbed** (GQ-1, GQ-2, GQ-4). They are the two providers still on the legacy path with no flip scheduled, and they are the two that never received the per-provider settings projection or the shared missing-session policy. GQ-1 is a real security gap for a live user, not a migration artifact.

The Minor list is long but ordinary: dead exports the flips were supposed to take with them, duplicated helpers, unlocalized strings, two fixture files carrying `/home/m5/...` paths (QA-1, QA-2 — worth doing early, they leak a username on every wire-gate run).

### Minor

Carried over in full, because the report they came from is a temporary file. `✅` is closed.

Kernel/persistence:
- KER-5 [M][bug] Codex + Claude compositions never release per-tab `onSettled` subscriptions at tab close (only at plugin dispose); Grok/OpenCode do release — parity drift. `src/app/execution/codex/CodexExecutionComposition.ts:327-331,307-310`; `src/app/execution/claude/ClaudeExecutionComposition.ts:252,345-350`.
- KER-6 [M][bug] `startRun` adds runId to `session.knownRunIds` before `commitWrites`; failed commit leaves phantom id. `ExecutionLifecycleRegistry.ts:412-416`.
- KER-7 [M][parity] Tab-scope-owned session (created before conversation binds) never matches D4 conversation-owner deletion; owner immutable in schema. `ClaudeExecutionComposition.ts:334` (same fallback in all compositions).
- KER-8 [M][hygiene] `LocalShellBackend.ts:472-515` duplicates `ExecutionEventQueue.ts` verbatim as `AsyncEventQueue`.

Core platform:
- CORE-1 ✅ [M][tests] `executionCompositionBoundaries.test.ts:100-111` specifier regex misses side-effect `import '...'` and double-quoted specifiers (AST walker in moduleReachability handles both). Reuse walker.
- CORE-2 ❌ [M][hygiene] **Refuted.** `McpTester` sits under `src/core/` but its only caller is the settings UI, and Obsidian's own review asks for `window.setTimeout` so a timer scheduled from a popped-out settings window belongs to that window. The rule keeping the browser object out of core is about the execution kernel's boundary, which this is not part of; the reason is now written in the file.
- CORE-3 [M][hygiene] two YAML stacks: `utils/frontmatter.ts` vs `utils/yamlFrontmatter.ts`.
- CORE-4 [M][hygiene] 28 repo-wide copies of `isRecord`.
- CORE-5 ✅ [M][hygiene] `src/app/settings/defaultSettings.ts:52` hard-codes 'codex' instead of DEFAULT_CHAT_PROVIDER_ID.
- CORE-6 [M][architecture] `GrimoireSettingsStorage.ts:26-37,421-432` hard-codes three providers for legacy migration; should not survive M3 unnamed.
- CORE-7 [M][architecture] `src/core/context/VaultTextIndex.ts:1,19` vault calls outside the sanctioned storage adapter directory.
- CORE-8 ✅ [M][security] `ApprovalManager.ts:111` prefix match without boundary for non-bash/file tools: rule `{"a":"` matches any input starting `{"a":"`. User-authored rules only; defaults fail closed.

Claude:
- CLA-3 ✅ [M][bug] `CCSettingsStorage.ts:46` unguarded `JSON.parse` in `load()` (save() tolerates corrupt); corrupt `.claude/settings.json` breaks every permission read/write.
- CLA-4 ✅ [M][hygiene] `ClaudeExecutionBackend.ts:400-403` dead conditional (`if terminal return evidence; return evidence`).
- CLA-5 ✅ [M][bug] `ClaudeExecutionBackend.ts:1521-1524` `handleConnectionLost` discards `_error`; cause never reaches run event.
- CLA-6 [M][hygiene] `runAuxiliaryQuery`/`ClaudeAuxiliaryQuery` production code wired to always-throwing resolver (M5 seam; mark as such).
- CLA-7 [M][architecture] `VaultFileAdapter.ts:34-37` plain writes + unsynchronized read-modify-write of `.claude/settings.json` (crash/race can corrupt); pre-existing, shared.

Codex:
- CX-1 ✅ [M][hygiene] `CodexSessionFileTail.ts` 792-line legacy JSONL tail parser, zero importers in src/; flip manifest said it would die with the legacy runtime.
- CX-2 ✅ [M][docs] `codex/AGENTS.md:30` says enabled defaults false; `settings.ts:43` defaults true (pinned by test).
- CX-3 ✅ [M][bug] `CodexAuxQueryRunner.ts:40` restarts only when process/transport are null; after process death both non-null → inline-edit/refine fail on every later call until reload.
- CX-4 ✅ [M][hygiene] `CodexNotificationRouter.ts:80` `seenWebSearchIds` never cleared (unbounded growth).
- CX-5 ✅ [M][hygiene] `CodexExecutionConnection.ts:151` only first registered `onServerRequest` handler dispatched.
- CX-6 ✅ [M][hygiene] `CodexExecutionRequests.ts:224-226` `sandboxPolicyFor` evaluated twice per resolve.
- Tracked unchanged (not new): result-reference→turn provenance (M5); six unmodelled notifications pinned (no growth); scratch-dir release still next-turn; steering now REAL through kernel (improved); plan-turn-silent-success still open.

Grok:
- GK-1 ✅ [M][bug] `GrokExecutionComposition.ts:496-507` `syncConversation` never removes old conversation's entries from `writeApprovers`/`surfaceReaders`/`sessionPaths`/`questionAskers`; `ownedSessions` only grows; late-settling run from previous conversation resolves against NEW session's directory.
- GK-2 ✅ [M][hygiene] `grokSubagentNormalization.ts:247-277` `normalizeGrokSubagentExtensionNotification` production-dead (consumer was deleted runtime) — G1 defect class.
- GK-3 [M][hygiene] `GrokHistoryStore.ts:274-323` ~130 lines test-only mapping code.
- GK-4 [M][hygiene] `GrokSessionNotifications.ts:59-68` test-only predicates (one is the wrong-shape test the wire gate forbids).
- GK-5 ✅ [M][hygiene] `modes.ts:77-79` `isManagedGrokModeId` no production caller.
- GK-6 [M][docs] `GrokExecutionRequests.ts:30,33` stale OpenCode-template JSDoc ("grok acp" launch wording, "the other two").
- GK-7 [M][parity] mirror dedup suppresses only adjacent copies (`GrokSessionNotificationMirrorDeduplicator.ts:19-31`); honest comment; fingerprint LRU if delayed mirrors appear.

ACP/OpenCode:
- ACP-1 ✅ [M][parity] actionable `AcpSpawnError` wording discarded on flipped path: run finishes `failed/spawn-failed`, surface shows only generic "could not start the provider process"; sentence reaches neither user nor debug log. `ManagedAcpExecutionBackend.ts:899-906`.
- ACP-2 ✅ [M][bug] connection lost BEFORE first dispatch (attempt 0) skips retry (`attempt === 1` only) → `indeterminate/effects-unknown` for a turn that never dispatched; should be `pre-dispatch-rejected` sideEffectFree (or retry). `ManagedAcpExecutionBackend.ts:599-636`. Fix before next providers flip onto the kernel.
- ACP-3 ✅ [M][parity] `limit: 0` semantics differ: aux runner returns whole file (falsy check) vs shared delegate zero lines. `OpencodeAuxQueryRunner.ts:303` vs `AcpWorkspaceFileSystem.ts:44`.
- ACP-4 [M][hygiene] `OpencodeAuxQueryRunner` duplicates shared `ManagedAcpAuxiliaryQuery`; up to 3 idle `opencode acp` processes; M5-fenced.
- ACP-5 ✅ [M][security] **Sound, and now pinned.** The CLI fallback cannot bind — the sqlite3 CLI takes a statement and nothing else — so the escaping *is* the safety: quotes are doubled, every non-string is a recognised type, and anything else throws rather than being interpolated. That was true and untested, which is a claim rather than a guarantee; `AcpSqliteBinding.test.ts` asserts it directly, including the injection shapes.
- ACP-6 [M][hygiene] `AcpJsonRpcTransport.ts:392-397` write() return ignored, no drain handling (bounded in practice).

MiMo/Kimi:
- MK-2 ✅ [M][bug] `MimocodeRuntimeCommandLoader.ts:53-60` (+Kimi twin, +`MimocodeChatRuntime.ts:603`) `ensureReady` can reject on spawn failure through slash-menu warmup; OpenCode's flipped loader catches → `[]`.
- MK-3 [M][parity] MiMo/Kimi loaders reuse a session-less tab runtime and create warmup ACP session on it (`:memory:` DB override); OpenCode gates on existing session + isolated metadata ask.
- MK-4 [M][parity] model-metadata warmup spins throwaway legacy ChatRuntime with `:memory:` DB (expected pre-flip; port at flip).
- MK-5 ✅ [M][tests] Kimi has no `KimicodeAcpLaunch.test.ts` counterpart (Windows-path coverage absent).
- MK-6 ✅ [M][hygiene] `sessionCwds` grows unbounded in both runtimes (199,1230,1265 / 194,1200,1235).
- MK-7 [M][docs] wire recordings: MiMo partial (4 cases), Kimi absent — flip precondition per plan; keep blocking.

Antigravity/Gemini/Qwen (beyond GQ-*):
- GQ-5 ✅ [M][parity] Gemini never applies selected mode (`applySelectedMode` absent; Plan toggle is a no-op).
- GQ-6 ✅ [M][hygiene] `AntigravityTranscriptRecovery.ts:19` exported recover fn referenced nowhere.
- GQ-7 [M][hygiene] `QwenChatRuntime.ts:1081-1100,791-799` duplicates shared approval mappers (same class as MK-1).
- GQ-8 ✅ [M][hygiene] `AntigravityProviderModule.ts:42-61` duplicated normalizers whose comment says they'd die at the flip; flip shipped, dedup didn't.
- GQ-9 ✅ [M][hygiene] `antigravity/models.ts:64` `return model === X ? null : null`.
- GQ-10 ✅ [M][hygiene] `i18n/locales/en.json:423` dead `sessionResumeFailed` copy key (all locales).
- GQ-11 [M][tests] Gemini suite: no plan/current_mode coverage, no transient-vs-missing load coverage.
- GQ-12 [M][hygiene] `AntigravityCliResolver.ts:48-57` redundant double resolution chain.

Features/shared:
- FE-1 ✅ [M][hygiene] hardcoded English strings bypassing `t()`: `StreamController.ts:264,274` ('Blocked'/'Notice', '❌ **Error:**', '**Error:**', 'Interrupted · …'), `InputController.ts:603,641,758`, `Tab.ts:1756` ('New Chat' default title).
- FE-2 [M][architecture] `SubagentManager.ts:83` defaults `taskResultInterpreter` to Claude's; rebound per tab; future path skipping bind misinterprets. Make required.
- FE-3 ✅ [M][hygiene] `ConversationController.ts:952-956` unknown-provider dot color falls back to Claude's CSS var.
- FE-4 ✅ [M][hygiene] `ExecutionChatRuntimeAdapter.ts:1061` stale cast `(runId: unknown) => void` re-imports the K1/R6-removed shape (field typed correctly at :1186).
- FE-5 [M][hygiene] `Tab.ts:1737`, `tabProviderUI.ts:361` floating cleanup promises.

Style/i18n/release:
- ST-1 [M][hygiene] ~19 dead CSS selectors across `settings/env-snippets.css`, `components/header.css`, `settings/base.css`, `mcp-settings.css`, `base/container.css`, `features/file-context.css`, `features/ask-user-question.css` + mirrors in `accessibility.css:24-28` (zero TS references).
- ST-2 [M][hygiene] `lockfile-age-exceptions.json` all 42 entries expired 2026-08-06..11; nothing prunes/warns.
- ST-3 [M][parity] `ja.json` 14 values byte-identical to English (several translatable); de.json 41 (mostly cognates).

Tests/QA:
- QA-1 ✅ [M][hygiene] `tests/fixtures/provider-traces/wire/grok-wire.json:457+` dozens of unredacted `/home/m5/...` absolute paths in tool payloads; leaks username; wire gate replays it every run. Extend the "no content, only shape" test to assert no home paths.
- QA-2 ✅ [M][hygiene] `mimocode-wire.json:6` real home path in transport metadata.

### Prior reviews

Both confirmed closed by this round, with three residues filed as Minor: FE-4 (a stale cast left where K1's shape was removed), ACP-1 (the spawn wording still not reaching a surface), and KER-3 as the restart-shaped caveat on C1. K2 remains refuted, and the reviewers agreed.
