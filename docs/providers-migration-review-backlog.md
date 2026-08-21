# `providers-migration` — review backlog

Two reviews, kept in one file because the second reviews the fixes the first asked for. The
[second](#second-review-2026-08-21) is at the bottom.

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
