# Provider Execution Migration Progress

This log records the implementation state of
[`provider-execution-migration-plan.md`](provider-execution-migration-plan.md) (v2). Update it
before every checkpoint commit. The plan remains the source of truth for acceptance criteria; this
file records what has actually landed and what remains open.

A checkpoint entry must record executed evidence (test counts, gate results, parity-manifest state),
not intentions. The v1 log demonstrated why: phases were recorded as complete on the strength of
gates that did not measure the product surface.

## Continuation on another machine

This migration is resumable from the repository alone. To pick it up anywhere:

1. `git clone` the repository, `git checkout providers-migration` (the branch is on `origin`).
2. Read, in order: [`provider-execution-migration-plan.md`](provider-execution-migration-plan.md)
   (canon), [`provider-contribution-inventory.md`](provider-contribution-inventory.md),
   then this log. The **Current blocker** line at the bottom is the single resume pointer.
3. For harvesting: `git fetch origin codex/provider-architecture-research`; exact per-slice commits
   are pinned in the plan's Harvest source map.
4. Environment: `npm ci`; gate commands are in the plan's Test strategy section; optionally set
   `OBSIDIAN_VAULT` in `.env.local` for manual smoke on a test vault.
5. Any `Downloads/` or out-of-repo copies of these documents are superseded; `docs/` is canonical.

Journal rules that keep this true:

- every checkpoint commit contains its entry here, in the same commit;
- stopping mid-milestone requires either discarding uncommitted work or committing it with an
  open-items note here stating what is unfinished and the exact next action;
- push to `origin` at every checkpoint; a local-only branch is not a valid stopping point.

## Branch

- Migration branch: `providers-migration`
- Baseline: `main` at 1.1.6 (`b08e4bd`)
- Last synced with `main`: 1.1.7 (`0f84b41`), merged at the M0a gate
- M0a, M0b (for the four proof providers), M1, M2-proofs, and M2-adapter are complete; M2-flips is in
  progress. The status table below carries the checkpoint commits; the **Current blocker** section at
  the bottom is the single resume pointer and overrides anything above it.

## Prior attempt (reference only)

The v1 plan was executed on `codex/provider-architecture-research` (77 commits over `710a43cf`,
archived unmerged on the remote). Its execution core — lifecycle kernel, versioned persistence,
nine provider backends, conformance and sanitized trace suites, durable agents, work graphs, and
control plane (v1 Phases 1–8) — passed independent reviews and is the harvesting source for M1–M5.
Its cutover (v1 Phases 9–10) switched the composition root before presentation parity existed,
leaving 324 source files unreachable and eleven production entry points stubbed; that work is not
harvested. The historical progress log and the parity audit
(`provider-execution-presentation-parity.md`) live on that branch.

None of that code is on this branch. Every harvested slice must be ported onto current `main`,
re-run through its gates here, and reconciled with the post-`710a43cf` fixes (UTF-8 stream
decoding, Grok transcript recovery) before its checkpoint is recorded below.

## Required reading before M0a

- [`provider-execution-migration-plan.md`](provider-execution-migration-plan.md) — the operational
  canon, including the M0a scope and the three harvest bans;
- [`provider-contribution-inventory.md`](provider-contribution-inventory.md) — the checked-in
  contribution tables (16 registration fields, 11 workspace members, 3 registration/app-level
  contributions) that seed the parity manifest and the M1 `ProviderModule` slots;
- `provider-execution-presentation-parity.md` on the archived
  `codex/provider-architecture-research` branch — the audit of what the v1 cutover orphaned. The
  M0a surface inventory is copied from it, not rediscovered.

## Checkpoint status

| Scope | Status | Checkpoint |
|---|---|---|
| Research and plan v2 saved to `docs/` | Complete | `ffebd58` |
| Plan revised per adversarial review (M0a/M0b, M2 split, adapter spec, harvest bans, contribution inventory) | Complete | `4fb915c` |
| Consistency pass: inventory completed (+3 rows), WorkGraph removed from operational target, stop condition aligned with mixed-authority rule, harvest source map, resumability rules | Complete | `da05d8e` |
| Third review applied: kernel-in-production-at-first-flip owned (interim kernel host, storage docs, revert safety, unload), adapter bound to the lifecycle registry, capability-driven flip smoke, providerState parity gate, release-train rules, shared-resource inventory in M0a | Complete | `6df5658` |
| UI verification layers documented (existing bundle-load/view-open smokes cited as gate layer 2), presentation-agnostic projection rule + stop condition, "After the migration" section (WorkGraph, UI evolution as renderer swap) | Complete | `b94a588` |
| M0a — parity gate and adapter contract | Complete | `3273321` … `401a1b8`, plus post-review corrections in this commit |
| M0b — golden traces (amortized; 4 topologies before freeze, rest at their flip) | Complete for the four proof providers; five remain, each at its own flip | `7f8dfaa` |
| M1 — execution kernel, dark-launched | Complete | `dca2f84`, `cc6081e`, `ec1303f`, `86f0585`, `a689af8` |
| M2-proofs — four topology proofs, dark | Complete — Antigravity, Codex, Claude, OpenCode | `e1ab910`, `2e46a87`, `5a5acad`, `4d844e0`, `bff6132`, `1a931c5` |
| M2-adapter — presentation seam, proven without a flip | Complete | `4f206d1`, `6133097`, `48a61a4`, `e7e754c`, `f69daaa`, `7e2c5cc`, `47b1fe5`, plus review fixes `f0c6114`, `1ead161` |
| M2-flips — nine production flips with legacy deletion | In progress — wave 1 (Antigravity) shipped, one manual check outstanding; wave 2 (Codex) under way | wave 1: `e06417b` … `a725a27`; wave 2: `0151961`, `1f34df6`, `e056871` |
| M3 — provider control plane | Not started | — |
| M4 — revisioned persistence in production | Not started | — |
| M5 — presentation evolution and seam deletion | Not started | — |
| M6 — final hardening | Not started | — |

## Checkpoint entry template

Every checkpoint recorded here must use this shape — executed evidence only:

```markdown
### <milestone> — <checkpoint subject> (`<commit>`)

- Gate commands run and results (suite counts, typecheck, lint, build as applicable).
- Parity manifest state: wired / pending / intentionally-removed deltas since last entry.
- Contribution inventory rows moved (if any).
- What was deleted.
- What remains open, as concrete items with an owning milestone.
```

## Checkpoints

### M0a — baseline gate recorded (`3273321`)

Gate commands run on `b94a588` (branch tip before this commit), after `npm ci`:

| Command | Result |
|---|---|
| `npm run test -- --selectProjects unit` | 400 suites, 6963 tests, all passed (7.4 s) |
| `npm run test -- --selectProjects integration` | 4 suites, 216 tests, all passed (3.2 s) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build:release` | passed, including `review:source`, `review:css`, `review:deps`, release-metadata validation, and both release verifiers (`verify-release-load`, `verify-release-smoke`); working tree stayed clean, so generated artifacts match source output |

Reachability probe (the M0a walker run ad hoc from the archived branch's
`tests/helpers/moduleReachability.ts`, not yet checked in): 536 modules under `src/`, 527 reachable
from `src/main.ts`, **9 unreachable**. None of the nine is referenced anywhere in `src/`; each is
kept alive only by its own unit test. They are listed below and must all carry an explicit manifest
verdict before the parity gate can be bidirectional.

- `src/features/chat/rendering/TodoListRenderer.ts`, `src/providers/claude/storage/GrimoireSettingsStorage.ts`,
  `src/providers/claude/storage/SessionStorage.ts` — re-export barrels whose targets are reachable;
- `src/providers/gemini/types/index.ts`, `src/providers/qwen/types/index.ts` — `*ProviderState`
  helpers with zero consumers;
- `src/providers/acp/history/sqliteModule.ts` (28 lines), `src/core/context/ContextIngestionService.ts`
  (93 lines), `src/providers/codex/runtime/CodexSessionFileTail.ts` (792 lines) — real
  implementations with tests and no production consumer; each needs an evidence-backed decision;
- `src/i18n/constants.ts` — belongs to staged i18n work (`origin/pr/01-i18n-foundation`), not to
  this migration.

Parity manifest state: not created yet (M0a work item). Contribution inventory rows moved: none.
Deleted: nothing.

Two environment facts worth carrying to another machine:

- `npm ci` is mandatory before trusting the gate. A stale `node_modules` (here: `obsidian` 1.12.3
  against lockfile 1.13.1) produces nine phantom `typecheck` errors in
  `src/features/settings/GrimoireSettings.ts` and `ClaudeDynamicUpdates.ts` that vanish after a
  clean install. They are not real defects;
- running Jest concurrently with `tsc` produced one spurious `database is locked` suite failure in
  `tests/unit/providers/claude/stream/transformSDKMessage.test.ts`. The suite passes alone and in a
  serial full run. Per the repository testing rules this is an environment restriction, not a test
  defect — run the gate commands serially.

Open items, all owned by M0a: the import-graph walker is not checked in (WP1), the parity manifest
and its fitness test do not exist (WP2), the contribution-inventory fitness test does not exist
(WP3), the adapter specification is unwritten (WP4).

### M0a — import-graph walker checked in (`79184ce`)

`tests/helpers/moduleReachability.ts` is now in the tree, ported from
`origin/codex/provider-architecture-research` and generalized to accept a source root and base
directory so its own resolution rules can be tested against fixtures. Reported paths and default
behavior are unchanged: it walks `src/main.ts` and reports repository-relative paths.

- `tests/unit/architecture/moduleReachability.test.ts` — 8 tests pinning each resolution form
  (relative, `@/*` alias, side-effect import, `export * from`, dynamic `import()`, `require()`,
  directory-to-`index.ts`), the exclusion of ambient `.d.ts` files and bare package specifiers,
  orphan reporting, and the documented blind spot that a computed `require()` specifier is not
  followed;
- checked-in walker reproduces the baseline probe exactly: 536 modules, 527 reachable, 9 orphaned;
- gates: `npm run test -- --selectProjects unit --testPathPatterns moduleReachability` (8 passed),
  `npm run typecheck` clean, `npm run lint` clean.

Parity manifest state: still not created. Contribution inventory rows moved: none. Deleted: nothing.

Open items unchanged: parity manifest and fitness test (WP2), contribution-inventory fitness test
(WP3), adapter specification (WP4).

### M0a — presentation parity manifest and gate (`db6ad82`)

The parity gate exists and is enforced by the unit suite.

- `tests/unit/architecture/presentationParityManifest.ts` — 40 user-facing surfaces across shell,
  chat, settings, and provider contributions, each with the modules that are its reachability
  evidence, plus 4 attributed orphans. `chatUIConfig` is split into separate surfaces
  (model selection, reasoning controls, capability gating) rather than tracked as one row;
- `tests/unit/architecture/presentationParity.test.ts` — 7 assertions: listed modules exist, ids and
  module claims are unique, non-wired surfaces name an owner, wired surfaces stay reachable,
  non-wired surfaces and recorded orphans stay unreachable, and **every** unreachable module is
  attributed.

Bidirectionality was verified by deliberately introducing each failure, not asserted:

| Injected condition | Assertion that fired |
|---|---|
| new unreferenced module added under `src/` | attributes every unreachable module to a manifest entry |
| recorded orphan imported from `src/main.ts` | keeps every recorded orphan orphaned |
| `src/main.ts` replaced by a stub that wires nothing — the v1 failure shape | keeps every wired surface reachable, plus the attribution assertion |

Orphan verdicts landed. Deleted as pure re-export barrels of reachable modules, with no behavior
attached: `src/features/chat/rendering/TodoListRenderer.ts` (its test duplicated
`tests/unit/core/tools/todo.test.ts` and went with it),
`src/providers/claude/storage/GrimoireSettingsStorage.ts`,
`src/providers/claude/storage/SessionStorage.ts`, `src/providers/gemini/types/index.ts`,
`src/providers/qwen/types/index.ts`. The two claude storage tests were re-pointed at the canonical
modules (`@/app/settings/GrimoireSettingsStorage`, `@/core/bootstrap/SessionStorage`) so no
coverage was lost. `npm run build:release` produced byte-identical artifacts afterwards, which is
the proof the five modules were dead rather than merely unreferenced by the walker.

The remaining four orphans are recorded with owners in `ORPHANED_MODULES`, with the evidence for
each: `acp/history/sqliteModule.ts` (superseded by the inline `require('node:sqlite')` at
`AcpSqliteReader.ts:13`; M2 managed-ACP wave), `core/context/ContextIngestionService.ts` (never
wired; product decision), `codex/runtime/CodexSessionFileTail.ts` (legacy tail parser superseded by
`CodexNotificationRouter`; deleted with the Codex flip in M2-flips), `i18n/constants.ts` (staged
i18n work, outside this migration).

Gates: unit 401 suites / 6966 tests passed, integration 4 suites / 216 tests passed, `typecheck`
clean, `lint` clean, `build:release` passed (see the correction below on what that did and did not prove).

Contribution inventory rows moved: none.

### M0a — contribution inventory made executable (`6cbf0e0`)

[`provider-contribution-inventory.md`](provider-contribution-inventory.md) is no longer prose that
can drift. `tests/unit/architecture/providerContributionInventory.test.ts` (26 tests) asserts it
against reality from two directions:

- the markdown tables are parsed and compared to the interface members declared in
  `src/core/providers/types.ts`, read through the TypeScript AST by the new
  `tests/helpers/interfaceMembers.ts` (interfaces are erased at runtime, so a table cannot be
  checked against a type any other way) — exact set equality for the 16 `ProviderRegistration`
  fields and the 11 `ProviderWorkspaceServices` members, plus the advertised counts;
- all nine registration objects are imported and checked to supply every required field and no
  undocumented one, so a provider cannot smuggle in a contribution the inventory does not know.

The three app-level rows are anchored individually: `workspaceCapabilities` on
`ProviderWorkspaceRegistration`, `getBuiltInProviderDefaultConfigs()` covering all nine providers,
and the row's claim that workspace init exists while dispose does not — pinned as
`initializeAll` present, `disposeAll` absent, so the day a dispose contract lands the row must move
with it.

Verified by injection: adding an undocumented optional field to `ProviderRegistration` fails
`documents exactly the declared fields`.

Gates: unit suite, `typecheck`, and `lint` all exit 0. Parity manifest state: unchanged.
Contribution inventory rows moved: none — the table is now enforced at its current state.

### M0a — presentation adapter specification (`85a9dc5`)

[`provider-execution-adapter-contract.md`](provider-execution-adapter-contract.md) maps every
`ChatRuntime` member onto the new lifecycle, with no deferred rows.

**Correction to the earlier entries and to the plan's estimate:** the contract has **32** members,
not the "~27" the plan estimates and not the 31 counted in the previous blocker line. The count is
now pinned by a test rather than by reading.

The plan's two mandatory questions are answered from call sites, not from the interface:

- **Synchronous `cancel()` and generator end.** Today `cancelStreaming()`
  ([InputController.ts:1566](../src/features/chat/controllers/InputController.ts)) sets a local
  flag, calls `cancel()` without awaiting or acknowledging anything, and the `for await` loop breaks
  on the next chunk — cancellation is optimistic and purely local. Generator end is treated as
  completion unconditionally in the `finally` block
  ([InputController.ts:638-729](../src/features/chat/controllers/InputController.ts)): finalization,
  `completedAt`, save, and the queued-message pump all run without consulting any terminal fact. The
  adapter keeps the synchronous signature, dispatches `run.cancel()` fire-and-forget, and closes the
  generator only on a terminal. The six run terminals map onto the two the UI observes through
  chunk types that already exist — `error` for `failed`, a warning `notice` for `indeterminate`,
  silence for the rest — so no member and no metadata field is added. Richer presentation of
  `indeterminate` is an M5 projection concern.
- **What `InputController` really depends on.** Eight behaviors, each cited to a line: the fields
  `prepareTurn()` writes back onto the user message, the `for await` shape, the break conditions
  being local rather than provider-driven, `consumeTurnMetadata()` being called exactly once inside
  `finally`, generator-end-as-completion, the unacknowledged `cancel()`, `steer()`'s boolean, and
  `setResumeCheckpoint()` before send. `ConversationController` adds
  `consumeSessionInvalidation()` → `buildSessionUpdates()` on save and `cancel()` on conversation
  switch.

Enforcement landed with the document, so the specification cannot drift from the interface:
`tests/unit/architecture/chatRuntimeContractFreeze.test.ts` pins the exact 32-member set (a new
member is a stop condition, not a routine change), asserts the count, asserts every member appears
in the specification, and rejects undecided verdicts in its tables.

Also corrected: `src/features/chat/AGENTS.md` still listed the deleted `TodoListRenderer` as a
render surface.

Gates: unit suite, `typecheck`, `lint` all exit 0.

### M0a — the two contract suites (`ae6f38f`)

The UI-facing behavior the adapter must reproduce is now executable, in two suites that disagree by
design.

`tests/unit/features/chat/runtime/chatRuntimeCharacterization.test.ts` (8 tests) drives the **real**
`InputController` against a fake runtime and pins what happens today, defect included:

- a generator that ends is finalized as `completed`, saved, and its message stamped with a
  completion time, with no terminal fact consulted anywhere;
- **a generator that yields nothing at all is treated exactly the same** — a provider process that
  dies silently is today indistinguishable from one that answered;
- `consumeTurnMetadata()` is called exactly once per turn, including when the generator throws;
- `cancel()` is called synchronously, nothing confirms the provider stopped, and the turn finalizes
  as `blocked` only once the generator happens to yield again.

`tests/unit/features/chat/runtime/adapterContractTarget.test.ts` (12 tests) pins the target
semantics against a spec-level double: the generator closes only on a terminal, stays open across
`disconnected`/`recovering` and across a cancel request, maps `failed` to the existing `error` chunk
and `indeterminate` to a warning `notice`, accepts exactly one terminal and drops everything after
it, and consumes turn metadata once. Passing proves the specification is coherent and executable, not
that an adapter exists; `createSubject` is the single seam re-pointed at the real adapter in
M2-adapter.

To let the characterization suite drive the real controller rather than a re-implementation of it,
the existing `InputController.test.ts` harness (mock deps, mock agent service, mock stream) was
extracted to `tests/helpers/inputControllerHarness.ts`. That file's 142 tests pass unchanged.

Gates: unit and integration suites, `typecheck`, and `lint` all exit 0.

### M0a — capability, topology, and shared-resource records (`da24e72`)

Every provider now has an execution record, machine-readable so the M2 flip's auxiliary-contention
check verifies against something instead of against a recollection.

- `tests/fixtures/providerExecutionTopology.ts` — the source of truth: process topology, session
  boundary, resume, concurrency, auxiliary execution owner, and the shared-resource inventory, with
  the modules each claim was read from;
- `docs/provider-capability-topology.md` — the readable rendering;
- `tests/unit/architecture/providerExecutionTopology.test.ts` (51 tests) — asserts coverage against
  the registration hub itself, that every cited module exists, that the document agrees with the
  fixture, and that no provider declares a `contended` resource.

Findings that matter for the flip order:

- **Antigravity, Gemini, and Qwen register no-op auxiliary services.** They cannot produce
  auxiliary contention at all, which makes them the cheapest providers to flip on that axis;
- the six providers with real auxiliary execution isolate it by construction, verified in code:
  Claude runs auxiliary queries cold with `persistSession: false`; Codex starts its own app-server
  process and thread; the managed-ACP four give each auxiliary runner its own subprocess, transport,
  session id, and artifact subdirectory under `.grimoire/<provider>/auxiliary/<purpose>/`, with
  Grok additionally deriving a separate `GROK_HOME`;
- **no provider declares a contended resource today**, so no flip is blocked on this condition. The
  claim is read from code, not from live runs — trace evidence is M0b's job.

Sharing is classified `read-only`, `partitioned`, or `contended`; a single `contended` entry is a
flip stop condition. Providers with no auxiliary execution still carry an explicit row saying so,
because an empty list reads as an unexamined claim and the test rejects it.

Gates: unit suite, `typecheck`, `lint` all exit 0.

### M0a — persisted-state characterization fixtures (`2aef017`)

The compatibility promise now has evidence instead of a claim.
`tests/unit/core/storage/persistedStateCharacterization.test.ts` (14 tests) runs real storage code
against checked-in fixtures under `tests/fixtures/persisted-state/`, through a new
`tests/helpers/inMemoryVaultAdapter.ts` that actually holds written bytes — a mocked `write` cannot
prove preservation, only that it was called.

Each fixture deliberately carries fields this build does not model, as a newer build would have
written them. Confirmed: session metadata survives a load-save cycle with unknown top-level fields,
the whole `providerState` bag, and the fork source intact, through both `loadMetadata` and
`listMetadata`.

Two behaviors were characterized rather than endorsed, both relevant to later milestones:

- **a session whose `providerId` is not registered is silently dropped** — it vanishes from history
  with no error and no trace (`isSupportedSessionMetadata` at
  `src/core/bootstrap/SessionStorage.ts:81`). This is precisely what the plan's typed hydration
  outcomes (`absent`, `partial`, `stale`, `corrupt`, `recovered`) exist to replace;
- **`providerState` accessors are unvalidated passthroughs**: `getCodexState` and `getClaudeState`
  return whatever was on disk, so a corrupt bag reaches provider code unchanged. Validation belongs
  at M4's versioned persistence boundary, where a bad record becomes a typed outcome.

Gates: unit suite, `typecheck`, `lint` all exit 0.

### M0a — persistence decisions, and the milestone gate (`401a1b8`)

[`provider-execution-persistence-decisions.md`](provider-execution-persistence-decisions.md) settles
what the lifecycle may write, for how long, what deletion does, how records are versioned, and what
diagnostics may contain. Eight decisions, each with its rejected alternative where one existed:

- **D1** the control store is `.grimoire/control/`, created at the first M2 flip — not merged into
  `.grimoire/sessions/`, which carries its own compatibility promise;
- **D2** a control record must establish what happened and who owns it, and must be insufficient to
  reconstruct what was said; secrets, hidden reasoning, raw payloads, second transcripts, and local
  shell output are forbidden outright;
- **D3** retention is tied to conversation lifetime, with only two seven-day operational windows, so
  "deleting the chat deletes its traces" stays true without a second concept to explain;
- **D4** deletion is idempotent, crash-recoverable, never touches provider-native data, and never
  removes a record while a lease is held;
- **D5** `schemaVersion` on every record; known-older migrates lazily and idempotently, unknown-future
  opens read-only and surfaces migration-required — never guessed, discarded, or downgraded;
- **D6** revert safety is structural: the old path has no reader for the store and no dependency on
  its absence;
- **D7** debug logs may carry control-plane facts and normalized error classes, never prompts,
  payloads, tool IO, or paths outside the vault;
- **D8** record shapes (M1), the revision model (M4), and the work graph (post-migration) are
  explicitly out of scope here.

`tests/unit/architecture/persistenceDecisions.test.ts` (9 tests) arms the rules before the code
exists. Two of them are conditional and pass trivially today, which is their purpose — they fire at
the checkpoint where forgetting them is easiest: the storage-boundary documentation must gain its
`.grimoire/control` row as soon as any reachable module references the store, and no legacy runtime
module may read it. Verified by injecting a control-store reference into `src/main.ts` and watching
the documentation guard fail.

**M0a exit gate, item by item:**

| Exit-gate item | Evidence |
|---|---|
| Walker, parity manifest, contribution inventory and their fitness tests green and enforced | `tests/unit/architecture/` — walker 8, parity 7, inventory 26, topology 51, freeze 4, persistence 9 |
| Adapter specification covers every `ChatRuntime` member, no deferred rows; cancel/terminal and generator-end resolved | `docs/provider-execution-adapter-contract.md`, enforced by the freeze test over all 32 members |
| UI-facing contract behavior executable as tests | characterization 8 tests against the real `InputController`, target semantics 12 tests |
| Every provider has a capability and topology record | `tests/fixtures/providerExecutionTopology.ts`, all nine, no contended resources |
| Existing provider-native data byte-preserved by the harness | `tests/unit/core/storage/persistedStateCharacterization.test.ts` — byte preservation holds for session metadata and `providerState`; settings and tab state are characterized as normalized state, see the correction entry below |

Checkpoint gate: unit 408 suites / 7090 tests passed, integration 4 suites / 216 tests passed,
`typecheck` clean, `lint` clean, `build:release` passed (see the correction below on what that did and did not prove), `git diff --check`
clean.

Deleted across the milestone: five orphaned re-export barrels and one duplicated test. Contribution
inventory rows moved: none — the table is now enforced at its current state.

Open items handed forward: the four recorded orphans keep their owning milestones; golden traces are
M0b, amortized, with the four topology-proof providers needed before the M2-proofs semantic freeze;
Windows process-tree conformance in CI is a hard prerequisite of M2-flips.

### M0a — post-review corrections (this commit)

A review of the closed milestone found three places where a document claimed more than the code
held, and two gates weaker than their description. All are fixed here rather than carried into M1.

**Documents that were wrong:**

- the plan's status line still read "Nothing from this plan is implemented on this branch", which is
  the first thing a resuming reader sees and directly contradicted this log. It now names the
  current milestone and points at this file as the authoritative state;
- the plan still specified the adapter table as "~27" `ChatRuntime` members. Corrected to 32, with
  the freeze test named as the authority;
- the contribution inventory claimed its fitness test "enforces agreement between this inventory,
  the parity manifest, and reality". It did not check the parity manifest at all, and imported no
  workspace registrations. Both are now true — see below — and the sentence is replaced by a precise
  three-part description plus an explicit statement of what is still unchecked.

**Gates that were weaker than described:**

- the inventory test now imports all nine workspace registrations, and cross-checks ten
  contributions against their parity-manifest surfaces. Verified by marking
  `provider-history-services` pending and watching the inventory test fail, not just the parity one;
- the topology test's auxiliary-isolation check was a permissive alternation ending in `options\.`,
  which almost any file satisfies. Each record now names a literal `isolationEvidence` string that
  must appear in its auxiliary owner, with a guard that the string is specific enough to mean
  something. The document-agreement check compared only the auxiliary owner's basename; it now
  compares topology, session boundary, resume, and concurrency per row.

**Exit-gate wording narrowed, because the original claim did not survive contact with real storage.**
The persisted-state suite previously only parsed the settings and tab-state fixtures. Driven through
the real code, three behaviors came out:

- **`GrimoireSettingsStorage.load()` rebuilds each provider config block from that provider's own
  settings schema.** A key written by a newer build, or simply one this build does not model, is
  dropped — the stored `providerOwnedSetting` does not survive. Settings are normalized state, not a
  preserved document;
- `tabBarPosition` is rewritten unconditionally to `header` by `normalizeTabBarPosition`, so a
  stored `top` does not round-trip;
- `validateTabManagerState` rebuilds each tab and carries a field forward only when it has the
  expected type, so `orchestratorMode: false` and explicit nulls disappear. The surviving state is
  equivalent in meaning, but it is not the same document.

Byte preservation therefore holds for `.grimoire/sessions/*.meta.json` and the opaque
`providerState` — which is what M2's persisted-state parity actually depends on — and the exit-gate
row now says so instead of implying it covers settings and tabs. The transient-field strip
(`claude.projectSettingsSnapshot`, removed on save by design) is pinned as well.

Gates: unit 408 suites / 7133 tests passed, `typecheck` clean, `lint` clean.

**Open items carried into later milestones, recorded so they are not rediscovered:**

- **D7 (diagnostic redaction) has no automated guard.** The persistence-decision test checks the
  document, not the logger. Arming it belongs to M1, when the kernel starts emitting records;
- **the target contract suite covers `query`, `cancel`, terminals, and turn metadata only.**
  `prepareTurn`, `steer`, `setResumeCheckpoint`, `buildSessionUpdates`, and
  `consumeSessionInvalidation` remain paper mappings. `createSubject` must grow to cover them at
  M2-adapter, or the adapter's conformance will be narrower than its specification;
- the M2 smoke matrix now has one machine-readable capability record to derive from — the topology
  fixture re-exports each provider's `capabilities.ts` — but the matrix itself is still written per
  flip.

### M0a gate — synced with `main` at 1.1.7 (`0f84b41`)

The branch policy replaces merging to `main` with syncing from it, so this is the first mandatory
sync. `origin/main` had moved three commits past the baseline: release 1.1.7, the OpenCode Auto-mode
and Grok `Invalid params` recovery fixes (#52, #47), and live Grok model loading — which added
`GrokModelDiscovery.ts` and `GrokModelsCache.ts` to the tree.

Merged cleanly, no conflicts. The gates then did the job they were built for: the parity manifest
attributed the two new Grok modules without complaint, meaning they are reachable from `src/main.ts`
rather than orphaned, and no inventory, topology, or contract record needed changing.

Gates after the sync: unit 411 suites / 7165 tests passed, integration 4 suites / 216 tests passed,
`typecheck` clean, `lint` clean, `build:release` passed (see the correction below on what that did and did not prove). Plugin version on the
branch is now 1.1.7.

Divergence from `main` after this sync: zero commits behind.

### M1 — execution composition boundaries (`dca2f84`)

First M1 checkpoint. Dark by construction: nothing constructs any of it, and the release build
produced byte-identical artifacts afterwards, which is the empirical form of "the parity gate proves
dark code stays out of the shipped bundle".

- `src/core/execution/ExecutionBackendDescriptor.ts` — harvested from v1 `1ae6a620` and kept close
  to the plan's contract: a branded backend id, a branded internal-service id, and an association
  that is a tagged union rather than an assumed `providerId`, so a local shell or a probe can be a
  backend without inventing a provider to own it;
- `src/core/providers/ProviderModule.ts` — **designed here, not harvested**, per harvest ban 1. The
  v1 module reserved eight feature ports as bare `object` and had no slot at all for chat UI config,
  settings reconciliation, environment keys, the three auxiliary services, the history service, the
  task-result interpreter, agent mentions, CLI resolution, or workspace capabilities. That absence is
  why its cutover dropped them. This contract declares a typed slot for **all thirty** inventory
  rows, with two rules stated in the file: no bare `object` slots, and an absent slot means
  unsupported rather than a no-op the UI cannot detect;
- `tests/unit/architecture/executionCompositionBoundaries.test.ts` (39 tests) — the architecture
  fitness test the plan requires from the first composition commit. It maps every one of the thirty
  inventory rows to the slot that carries it and asserts the slot exists through the AST, rejects
  bare `object` placeholders, and holds the two new modules to zero plugin, provider, feature,
  Obsidian, DOM, or `child_process` imports.

Two pre-existing violations of the permanent forbidden directions are enumerated rather than
wildcarded, each with an owner: three `src/core/providers/*` modules import the plugin type
(resolved at M3 when the catalog replaces the split registries), and
`src/features/chat/services/BangBashService.ts` launches a process directly (resolved at M5 when it
moves to the local-shell backend). The list is checked in both directions — new violations fail, and
a listed file that stops violating must leave the list, so the allowlist cannot outlive its reason.

Parity manifest: one new `pending` surface, `execution-platform-dark`, owned by M2. The gate now
asserts these modules stay **unreachable** until the first flip wires them.

Gates: unit 412 suites / 7204 tests passed, `typecheck` clean, `lint` clean, `build:release` passed
with no artifact drift.

Open for the rest of M1: the lifecycle kernel itself (`feat: establish execution lifecycle kernel`)
— backend, session, run, lease, generation, interaction, terminal types, the single-writer event
ingestor, the fake backend and its fault matrix, and the kernel race suites — then narrow kernel
persistence records when the kernel first needs them.

### M1 — kernel contracts and the event ingestor (`cc6081e`)

Second M1 checkpoint, still dark: `build:release` again produced byte-identical artifacts.

The v1 kernel commit (`1220271a`) is 8219 lines across 30 files. Porting it as one commit would
reproduce the v1 failure shape at a smaller scale — a large slab nobody can review — so it is split
by dependency. This checkpoint takes the contract layer and the ingestor; the registry, the
deterministic fake backend, and the local-shell backend follow.

Harvested and reconciled:

- `ExecutionIds.ts` — branded opaque ids validated by shape, so a caller cannot pass a run id where
  a session id belongs;
- `ExecutionContracts.ts` — backend, session, run, owner, terminal, interaction, and recovery
  contracts. **Reconciled against harvest ban 2:** the v1 `ExecutionOwnerKind` included
  `'work-graph'`, which this migration deliberately does not deliver. It is removed, with the reason
  stated in the file, because harvesting an owner kind nothing can produce or resolve would leave a
  state the kernel cannot reach or clear;
- `ExecutionEvents.ts` — adapter-owned ingress events and the core envelope that carries the
  assigned sequence;
- `ExecutionTerminalPolicy.ts` — which terminal reasons are legal for which terminal kind, so
  `succeeded` cannot be recorded with a failure reason;
- `ExecutionEventIngestor.ts` — the single-writer authority: bounded dedupe, causal buffering,
  typed gaps rather than silent skipping, quarantine, generation and instance fencing, and
  checkpoint/restore so a failed durable apply does not consume a sequence number.

The v1 suite for the ingestor ported and passed unchanged (8 tests). It left the harder edges
unexercised, so eight more were added on this branch, each pinning something the M1 exit gate
depends on: the two untested scope rejections (`wrong-backend`, `wrong-session`), monotonic
generation advance, dedupe memory clearing on generation advance, **bounded** dedupe — a delivery
evicted from the window is accepted again, which is the trade-off that forces adapters without
stable replay identity to reconcile rather than trust the ingestor's memory — gap flushing with
quarantine, resuming a quarantined stream through a reconnect rebase, and identifier validation.

Parity manifest: the five new kernel modules join the `execution-platform-dark` pending surface, and
all seven are now held to the strict boundary rule — zero plugin, provider, feature, Obsidian, DOM,
or `child_process` imports, with no allowlist.

Gates: unit 413 suites / 7225 tests passed, `typecheck` clean, `lint` clean, `build:release` passed
with no artifact drift.

### M1 — kernel persistence records (`ec1303f`)

Third M1 checkpoint, still dark, release build still byte-identical.

The registry needs durable records, so the plan's narrow, demand-driven persistence substrate lands
now rather than at M4. The boundary the plan draws is respected exactly: `VersionedRecord`,
`VersionedRepository`, `DurableStorage`, `TransactionIntentCoordinator`, and
`ControlRecordPayloadPolicy` are ported; `ConversationRepository` and `HistoryOutcomes` are **not**
— the conversation mutation queue and typed history hydration stay in M4. `VaultDurableStorage`
comes with them as the recoverable same-directory replacement for vault adapters that have no
native atomic replace.

On top of that: `ExecutionControlRecords`, `ExecutionControlSchemas`, `ExecutionControlRepositories`,
and `ExecutionControlTransactionCoordinator` — run, interaction, and reconciliation records with
schema envelopes and intent-plus-completion-marker writes.

**The control store paths now exist, and they match decision D1**: v1 already used
`.grimoire/control`, so the M0a decision record and the harvested code agree without adjustment.
The paths are declared at M1 so the dark kernel can be written and tested against them; nothing
writes to a vault until the first flip.

Two corrections this checkpoint forced:

- **the D1 coupling guard was blind.** It matched the literal string `.grimoire/control/`, but the
  paths are composed from `GRIMOIRE_CONTROL_PATH`, so the guard would have stayed silent through the
  entire migration. It now matches the constants as well — and immediately fired, which is how the
  storage-boundary row below got written rather than forgotten;
- `AGENTS.md` gains its `.grimoire/control/**` row, stating what may live there, what may not, that
  it is created at the first flip, and that it is inert to the legacy path so a flip revert is safe.

Ported suites pass unchanged: 31 tests across the persistence and control-record suites.

Gates: unit 418 suites / 7247 tests passed, `typecheck` clean, `lint` clean, `build:release` passed
with no artifact drift. Parity manifest: ten more modules join `execution-platform-dark`.

### M1 — the execution lifecycle registry (`86f0585`)

Fourth M1 checkpoint. The largest single harvest in the migration: `ExecutionLifecycleRegistry`
(2183 lines) with its 1109-line suite, plus `RunProjection` and the `DeterministicFakeBackend` the
suite drives. Still dark (see the correction below on how darkness is actually verified). The kernel now stands at 5561 lines
across `src/core/execution/` and `src/core/persistence/`, none of it reachable.

**The work-graph reconciliation had two more sites than the contracts commit found.** The registry's
owner validation still accepted `'work-graph'`, and — missed on the previous checkpoint —
`ExecutionControlSchemas` still listed it among the persisted owner kinds. Both are removed with the
reason recorded inline. Had the schema kept it, the store would have accepted and validated a
durable owner kind nothing in this migration can resolve.

The ported suite passes unchanged and covers the M1 exit gate directly, item for item:

| Exit-gate property | Test |
|---|---|
| exactly one terminal under duplicates | deduplicates cross-stream delivery and persists exactly one terminal |
| under reorder and gaps | reconciles a causal gap through the snapshot port without applying across it; discards both occupants of a causal conflict |
| under cancellation races | keeps one cancellation terminal when acknowledgement races explicit completion |
| under unload | closes admission synchronously and classifies unconfirmed work during bounded shutdown; persists a shutdown checkpoint before a hung recovery port can settle |
| under reconnect | rotates the live incarnation only after recovery evidence; replays a persisted resolving interaction on a fresh registry |
| required results cannot succeed on activity alone | does not treat thinking, tools, or progress as a required result |
| iterator end is not a terminal | classifies an omitted terminal through recovery instead of stream completion |
| state reduction is idempotent | `RunProjection` is referentially idempotent for duplicate, stale, and wrong-run envelopes |

Also proven there: a rejected cancellation with unknown effects becomes `indeterminate` rather than
cancelled, an accepted running attempt is never relabelled `invalidated`, a backend cannot report a
terminal kind and reason that contradict each other, and reconciliation appends without rewriting an
indeterminate terminal.

Gates: unit 420 suites / 7281 tests passed, `typecheck` clean, `lint` clean, `build:release` passed
with no artifact drift. Parity manifest: four more modules join `execution-platform-dark`; the
registry and projection are held to the strict boundary rule.

### M1 — local shell backend and cross-platform CI (`a689af8`)

Final M1 checkpoint. `LocalShellBackend` lands as an internal backend — a run with an owner and a
terminal like any other, with no provider association and no UI route yet — alongside its Node
process adapter, and the milestone's exit gate closes.

The split matters and is enforced: the backend lives in `src/core/execution/local/` and holds no
process API, while `src/app/execution/local/NodeLocalShellProcessAdapter.ts` owns spawning. The
strict boundary rule covers the core half, so a future edit that reaches for `child_process` there
fails rather than quietly making the kernel platform-bound.

**CI, and a consequence of the branch policy caught here.** The v1 commit already carried a
three-platform execution job (`ubuntu-latest`, `macos-latest`, `windows-latest`), which is exactly
the `windows-latest` prerequisite M2-flips requires. Harvested — but the workflow only triggered on
`main`, and milestones are not merged to `main`, so the job would never have run on this branch. It
would have been a decoration until the first flip discovered it. `providers-migration` is now a
trigger branch, with the reason recorded in the workflow.

Locally on Linux the process-ownership integration suite passes; macOS and Windows evidence arrives
from CI on the next push.

Gates: unit 422 suites / 7313 tests passed, integration 5 suites / 218 tests passed, `typecheck`
clean, `lint` clean, `build:release` passed (see the correction below on what that did and did not prove).

**M1 exit gate, item by item:**

| Exit-gate item | Evidence |
|---|---|
| exactly one terminal under duplicates, reorder, gaps, cancellation races, unload, reconnect | `ExecutionLifecycleRegistry.test.ts`, 29 tests, mapped to the gate in the previous entry |
| required results cannot succeed on progress or tool activity alone | does not treat thinking, tools, or progress as a required result |
| lifecycle state reduction is idempotent | `RunProjection.test.ts` — duplicate, stale, and wrong-run envelopes |
| core execution has no provider, feature, Obsidian, plugin, or DOM imports | `executionCompositionBoundaries.test.ts`, strict list, no allowlist |
| POSIX process-group ownership, cancellation, unload, terminal conformance on macOS and Linux | `LocalShellProcessOwnership.integration.test.ts` green locally on Linux; macOS and Windows from the new CI matrix |
| the parity gate proves the production bundle surface is unchanged | `build:release` byte-identical at every M1 checkpoint; 22 kernel modules held `pending` in `execution-platform-dark` |

Windows process-tree conformance is explicitly **not** claimed as passing yet — the job exists, its
first run happens on push. It is not an M1 blocker and is a hard prerequisite of M2-flips.

### M2-proofs — topology proof 1 of 4: Antigravity (this commit)

Stateless process-per-run, the smallest topology and the first flip wave. Dark; release build
byte-identical.

**The kernel was upgraded to its post-proof state first.** The Phase 3 kernel harvested during M1
predates the four topology proofs, and the conformance suite immediately exposed the gap: it expects
`nativeRunRef` on the run record, which v1 added while proving the backends. Rather than back-port
deltas one field at a time, the kernel files were re-taken from the semantic-freeze commit
(`892eec78`) — records, schemas, registry, contracts, events, ingestor, projection — which is the
mature state after all four topologies proved out. It also brought `ExecutionEventQueue` and
`ResultCommit`, two small helpers the backends need.

**The work-graph reconciliation had to be re-applied**, in all three places, because the newer files
carry it again. Verified absent afterwards: no `'work-graph'` remains anywhere in
`src/core/execution/`.

Antigravity slice: `AntigravityExecutionBackend`, the print-process runner, print protocol, and
transcript recovery, plus the app-level `NodeAntigravityProcessTransport` that owns spawning. The
legacy `AntigravityChatRuntime` is **untouched** — v1 refactored it to share the extracted helpers,
but M2-proofs' exit gate says production is untouched, and the byte-identical release build is the
evidence. The cost is bounded duplication between the legacy runtime and the new backend, deleted at
the Antigravity flip.

Conformance and traces:

- `tests/helpers/execution/ExecutionBackendConformance.ts` — the shared suite every backend runs;
- the deterministic fake backend passes it (`DeterministicFakeExecutionConformance.test.ts`);
- Antigravity passes it (`AntigravityExecutionConformance.test.ts`), plus its own backend, lifecycle,
  print-runner, and transport suites;
- `tests/fixtures/provider-traces/antigravity-execution.json` — the sanitized golden trace. **This
  resolves an M0b dependency that looked like a blocker:** the four topology providers need traces
  before the semantic freeze, and recording them here would need live CLIs and credentials. v1
  already recorded and sanitized them, so they are harvested rather than re-recorded.

Gates: unit 428 suites / 7359 tests passed, integration 5 suites / 218 tests, `typecheck` clean,
`lint` clean, `build:release` with no artifact drift. Parity manifest: 29 modules now dark under
`execution-platform-dark`.

Deliberately not landed yet: `executionSemanticFreeze.test.ts`. It asserts across all four provider
modules, so it belongs at the end of M2-proofs, not at proof one — and it needs rewriting against
the M1 `ProviderModule` contract rather than the v1 one it was written for.

### M2-proofs — Windows CI: three failures, and process-tree conformance proven (`9b1958d`, `6127df3`, `96eb9c8`)

The cross-platform job added at the end of M1 did its job on its first run and immediately caught
something — though not what it was aimed at.

`validate`, `ubuntu-latest`, and `macos-latest` passed; `windows-latest` failed in half a second
with no test output. The cause is not a platform defect in the kernel: the job selected suites by
passing POSIX-style paths as positional arguments, and Jest matches those as **regular expressions
against absolute paths**. On Windows those paths contain backslashes, nothing matched, and Jest
exited 1 with "No tests found".

Both steps now use `--testPathPatterns` with a `[\\/]` character class that matches either
separator, verified locally against the same suites the job runs.

The more useful half of the finding is what nearly happened. Jest only failed because
`--passWithNoTests` was absent. Had it been set — a natural thing to add when a job looks like it is
"failing for no reason" — Windows would have reported a **green** gate while running zero tests, on
the one platform the whole job exists to cover. That is the shape of failure this migration is
built around, arriving in the migration's own CI. The reasoning is recorded in the workflow next to
the flag so the next person does not reach for it.

That was the first of three. Two more followed, each hiding the next:

- **the job could not report.** Every PowerShell step on the Windows runner captured no child
  output at all — including the `npm ci` that succeeded — while the bash steps in the same job
  printed normally. A platform gate that returns an exit code and nothing else is not usable
  evidence, so all its steps now run through bash, which exists on the Windows runner and removes
  the quoting difference as a side effect;
- **with output visible, the real failure appeared, and it was the fixture rather than the kernel.**
  The contract suites passed on Windows. The ownership test compared file contents to an exact
  string, and `cmd` includes the space before `&` in the echoed line, so the file held
  `"hello world" ` with a trailing space. Fixed at the cause — the space is gone from the command —
  rather than by loosening the comparison, because the point of that test is that a quoted path and
  a command group survive the launch path verbatim.

**Windows process-tree conformance is now green** (run `31898748705`): `validate`, `ubuntu-latest`,
`macos-latest`, and `windows-latest` all pass, including the Job Object guardian killing Windows
descendants when the root process exits. The plan makes this a hard prerequisite of M2-flips and
explicitly refuses a waiver; it is now satisfied by evidence rather than deferred.

Three failures, none of them the thing the job was aimed at, and each only visible once the previous
one was fixed. The job was added at the end of M1 as a formality — it repaid that immediately.

### M2-proofs — Antigravity provider module (this commit)

The first real module written against the M1 `ProviderModule` contract, and the first evidence that
the contract is usable rather than merely complete. Dark (see the correction below on how darkness is actually verified).

Not harvested. The v1 module targets the contract harvest ban 1 excludes, and its shape does not
survive the redesign: capability fields differ, feature ports were bare `object`, and the module
took a single context type for both workspace and execution. Only the settings decode/encode
validation is reused as material — it is real validation with a real preserved-unknown path.

Three findings, each from writing the module rather than from reading the contract:

- **the contract needed a second context type.** A workspace initializes from vault-facing services;
  a backend is composed from a request resolver, process runner, result sink, and scheduler. One
  shared `TContext` would push a union into every provider, so `ProviderModule` now takes
  `TWorkspaceContext` and `TExecutionContext` separately;
- **workspace slots must not carry their own `dispose`.** The first draft had the slots object expose
  teardown, which makes every consumer of a single slot responsible for lifecycle it does not own.
  Teardown belongs to the contribution's `dispose`, which closes over what it created;
- **a `JSON.stringify` comparison in `reconcile` reported every reconciliation as a change**, purely
  from key ordering, which would have meant a settings write after every load. Caught by its own
  test and replaced with an order-insensitive structural compare.

The module also demonstrates the contract's "absent means unsupported" rule on a real provider:
Antigravity contributes **no** auxiliary execution, because its title, refine, and inline-edit
services are registered today as no-ops — contributing three present-but-empty slots is the lie the
rule exists to prevent — and omits history, task-result, and native-agent ports it has nothing to
put in.

One production change was attempted and reverted. v1 added the settings normalizers to
`settings.ts` and rewired two existing accessors to use them; applying that patch changes reachable
code and would have broken the "production untouched" exit gate. The normalizers are local to the
dark module until the Antigravity flip makes it the settings authority.

`tests/unit/providers/antigravity/AntigravityProviderModule.test.ts` — 17 tests over identity,
honest absences, the settings codec including preserved-unknown round-trips and typed decode issues,
and both halves of the workspace lifecycle.

Gates: unit 429 suites / 7377 tests passed, `typecheck` clean, `lint` clean, `build:release` with no
artifact drift.


### Correction — "byte-identical release build" proved nothing (this commit)

Every M1 and M2-proofs checkpoint above claimed the release build produced byte-identical artifacts,
on the evidence of `git status --short main.js` coming back empty. **`main.js` is listed in
`.gitignore` on this branch.** That command reports clean no matter what the file contains, so the
check measured nothing and the claim was vacuous each time it was made.

It is the precise failure this migration exists to prevent — a gate that cannot fail, reported as
evidence — and it appeared in the migration's own journal. Correcting it, not just the wording:

- **the paths leaked.** With a real check, `.grimoire/control` directory strings *were* present in
  the shipped bundle: `StoragePaths.ts` is reachable from `src/main.ts`, so declaring the control
  paths there compiled them into `main.js` even though nothing read them. They now live in
  `src/core/execution/ExecutionControlPaths.ts`, which is dark;
- **the check is now real.** `tests/unit/architecture/darkBundle.test.ts` asserts against the built
  bundle: no control-store paths, no registry internals, no backend descriptor, and no class name
  belonging to a `pending` parity surface. It skips rather than lies when the bundle is absent or
  older than `src/main.ts`;
- **it was verified by injection.** Re-exporting one control path from the reachable `StoragePaths`
  and rebuilding fails two assertions; reverting restores green.

Everything else the checkpoints claimed — unreachability from `src/main.ts`, suite counts, typecheck,
lint — was measured by gates that do fail, and stands.

### Correction — three more findings from an external review (this commit)

- **the composition fitness gate did not understand `@/`.** It matched only relative specifiers,
  while the repository imports through the alias — as the Antigravity backend does. A core module
  could have imported a concrete provider by alias and the gate would have stayed green. Fixed, and
  it immediately surfaced **eight** pre-existing `src/core/**` → provider imports, now enumerated
  with owners (M3 for registry and bootstrap, M5 for the auxiliary services) and checked in both
  directions like the plugin-import list;
- **persistence decision D5 was documented but not implemented.** `VersionedRepository` classifies a
  future or corrupt record, but every startup read went through a helper that threw, so one record
  from a newer build made `start()` fail — the exact path a user takes when a shipped flip is
  reverted. The registry now enters a `migration-required` state: it starts, refuses new work,
  leaves the record untouched, and exposes the requirement for the host to present.
  `ExecutionControlMigrationRequired.test.ts` covers all four behaviors;
- **the trace fixtures are not golden traces.** They are semantic case catalogues, not sanitized wire
  recordings. The checkpoint text implied M0b was partly satisfied; the status table always said
  otherwise. The resume pointer now states it explicitly.

### M2-proofs — topology proof 2 of 4: Codex (this commit)

Persistent app-server, multiplexed sessions over one JSON-RPC connection — the opposite end of the
topology range from proof one, which is why it is second. Dark: `darkBundle.test.ts` now also asserts
the Codex backend descriptor and the connection's identifiers are absent from the built `main.js`.

Slice: `CodexExecutionBackend`, `CodexExecutionTurnReconciler`, the provider-owned
`CodexExecutionConnection`, and the app-owned `NodeCodexExecutionProcess` that owns the process tree
and the stdin pipe. The local shell layer gained `stdin: 'pipe'`, including through the Windows job
guardian, because a persistent daemon needs a writable pipe where a print-mode run does not.

**Three findings, in descending order of how quietly they would have shipped.**

**1. A harvested field name survived a kernel rename because a spread hid it.** The backend builds a
run-scoped event as `{ kind: 'run', runId, ...(turnId ? { turnId } : {}) }`. This branch renamed that
field to `nativeRunRef` during M1. TypeScript does not excess-property-check spread properties, so
the stale name type-checked, and all 703 Codex tests passed. The consequences were not cosmetic: the
registry reads `scope.nativeRunRef` to fence a mismatched native run and to persist the run's
provider-side identity, so Codex would have had **no addressable run after a crash** — its recovery
port queries by exactly that reference — and the fencing check would never have fired.

The fix is one word. The guard is the point: `ExecutionBackendConformance` now requires every driver
to answer `expectedNativeRunRef()`, with `null` as an explicit statement that the backend has no
provider-side run identity, and asserts the registry's run record matches. Not optional, because an
optional member is opted out of by silence. Verified by re-introducing `turnId`: typecheck stays
clean, the conformance test fails. Antigravity answers `null` (print mode owns no run identity), the
deterministic fake answers `null`, Codex answers its app-server turn ID. The two harvested unit
assertions that pinned the old name were updated to the contract name.

**2. The cross-platform matrix was covering less than it looked.** It selects suites by regular
expression, and the integration step matched the literal `LocalShellProcessOwnership` — so the new
Codex process-ownership test would have been skipped on all three platforms while the job reported
green. Both steps now select by directory, and `executionPlatformCoverage.test.ts` asserts the
patterns still cover every suite under the platform-sensitive roots, match under both path
separators, do not widen into unrelated suites, and that `--passWithNoTests` never appears in an
executable line. Scope is stated rather than assumed: the matrix is for process ownership and
platform primitives; provider protocol state machines are platform-independent and stay in
`validate`.

**3. The live JSON-RPC transport was changed, deliberately and partially.** v1 generalized
`CodexRpcTransport` in this same commit so both paths could share it. It has five live consumers
including `CodexChatRuntime`, so it was taken in pieces rather than wholesale:

- **taken**, type-level: the constructor now accepts a `CodexRpcProcessPort` instead of the concrete
  `CodexAppServerProcess`. Structural, no behavior change, and it is what avoids a second copy of the
  protocol drifting against the first;
- **taken**, as a bug fix the frozen-path rule allows: a broken stdin pipe now settles the transport
  and rejects in-flight requests instead of surfacing an unhandled stream `error` while every caller
  waits out a 30-second timeout. `onConnectionLost` is additive — nothing on the chat runtime path
  subscribes, and the execution backend must, since a run whose transport died has to settle as
  indeterminate rather than hang;
- **refused**: v1's `dispose()` rewrite, which would have replaced a live error message for no
  benefit to the dark path, and would have overwritten the more specific failure reason. Four new
  transport tests cover the loss path; the existing 654 Codex tests were unchanged by the edit.

Gates: unit 436 suites / 7471 tests, integration 6 suites / 220 tests, `typecheck`, `lint`,
`build:release` all clean. Parity manifest: 34 modules dark under `execution-platform-dark`.

Not in this commit: the Codex `ProviderModule`. v1's version targets the v1 contract and is rewritten
against the M1 one, as Antigravity's was.

### M2-proofs — Codex provider module (this commit)

The wide module. Antigravity exercised the contract's floor — one execution slot, two workspace
slots, everything else honestly absent. Codex fills seven workspace slots, native resume, native
interactions, three auxiliary workflows, and a settings codec over twelve fields. That difference is
the reason it is proof two, and it earned its keep: **both defects the M1 contract has needed so far
were found by writing this module, not by reviewing the contract.**

**Defect 1: `ProviderModelPresentation` was settings-blind.** Its methods took only a model id, while
the live `codexChatUIConfig.ownsModel(model, settings)` has always consulted settings — that is how a
model typed into the custom-models box, or supplied through `OPENAI_MODEL`, is recognized as the
provider's own. A module built on the narrow signature would have disowned every custom model, and
the failure would have appeared as a model silently belonging to no provider. The slot now takes the
decoded settings, generic over the module's settings type. Antigravity's module gained the same
fidelity in passing: it now recognizes discovered and visible models, and labels through its aliases,
rather than matching a prefix.

**Defect 2: `reconcile` was required to return something it could not know.** The result carried
`invalidatedConversationIds`, but `reconcile` receives settings — not the conversation list — so no
provider could ever fill it. Antigravity concealed this by having no resumable session; Codex, which
resumes by native thread id, could not. It is now `invalidatesSessions: boolean`, decided by the
module and applied by the host, which owns conversations. No fidelity is lost: the legacy reconciler
already invalidates *every* conversation of the provider when the environment changes.

Two things the module states more precisely than the code it replaces:

- **environment invalidation is three named keys**, `OPENAI_MODEL`, `OPENAI_BASE_URL`, and
  `OPENAI_API_KEY`, as `CodexSettingsReconciler` computes them — not the registration's
  `/^OPENAI_/i` and `/^CODEX_/i` patterns, which invalidate a session when any matching variable
  changes, including ones the daemon never reads. A test covers `OPENAI_LOG_LEVEL` not invalidating;
- **`security.enforcement` is `native`**, where Antigravity's is `grimoire`. Codex's CLI owns its
  approval and sandbox policy; Grimoire owns only the process boundary.

**One divergence found in the shipped application, recorded rather than reconciled.** Codex registers
a command catalog through `CodexWorkspaceServices` and can list skills through a short-lived
app-server, but its capability record says `supportsProviderCommands: false`, so `TabManager` never
asks for that catalog. The two statements are about different things — what the provider can do
versus what the UI currently requests — and which one the module means is a flip decision, not a
migration decision. `CodexProviderModule.test.ts` asserts both values so the question cannot be lost.

**A second observation, outside this migration's scope.** `src/providers/codex/AGENTS.md` states
"Codex is opt-in; `isEnabled()` defaults to false", while `DEFAULT_CODEX_PROVIDER_SETTINGS.enabled`
is `true` and is what `getBuiltInProviderDefaultConfigs()` ships. Both have been that way since the
initial release commit, so one of them has always been wrong. The module mirrors the code, because
changing a shipped default is not a migration's call. Flagged for the owner to settle.

Also in this commit: the trace fixture headers were reconciled with the canonical topology record.
Both had drifted into private vocabularies — `per-run-process` and `persistent-app-server` against
`process-per-run` and `persistent-daemon` — and **nothing read those headers at all**, so a fixture
could have claimed any topology. `providerExecutionTopology.test.ts` now checks each fixture's
topology, session boundary, resume, and backend id against the record, and requires a trace for every
provider that has an execution backend, so a proof cannot land without one.

Gates: unit 437 suites / 7496 tests, integration 6 suites / 220 tests, `typecheck`, `lint`,
`build:release` clean, and the bundle assertions still find no Codex execution code in `main.js`.

### M2-proofs — topology proof 3 of 4: Claude (this commit)

Persistent SDK stream, serial runs — persistent like Codex but one turn at a time, the third distinct
topology. Backend, adapters, task-output loader, auxiliary query, module, and trace, all dark.

**The conformance guard added at proof two paid for itself immediately.** Claude's harvested backend
carried the same stale `turnId` in its run scope, so the field-name defect was systematic across v1's
backends rather than a Codex accident. It failed on the first run of the suite. OpenCode should be
assumed to carry it too.

Claude is the only provider that fills every remaining slot, and it found the contract's last two
gaps:

**Defect 3: `capabilities.conversation.rewind` had no port to land on.** Fork, steering, and
compaction are runs and travel through the execution backend as requests; rewind is not a run — it
edits the transcript and can restore files. The adapter contract already mapped `ChatRuntime` member
20 to "a rewind port; only Claude declares it today", and that port did not exist, so a provider
could declare `rewind: 'native'` with no way for the host to perform it. `ProviderRewindPort` now
exists. Its outcome type is deliberately not `ChatRewindResult`: that type reports `canRewind`, which
conflates "the rewind happened" with "a rewind would be possible", leaving callers to read `error` to
tell them apart.

**Defect 4: `features` was a static object, so context-dependent ports were unfillable.** History
hydration, session deletion, and rewind all need vault-facing services. Antigravity did not notice,
having none of them — but **Codex's module shipped one commit ago without its history port and
without saying so**, which is exactly the silent contribution loss this migration exists to prevent,
committed by the migration itself. `features` is now a factory over the same context the workspace
initializes from; Codex gained its history and native-agent ports, and Claude contributes history,
rewind, task results, and native agents.

Both defects have the same shape as defect 2 from proof two: a slot that looks filled in review and
cannot be filled in practice. Three of the four were invisible until a provider that needed them was
written, which is the argument for four proofs rather than one.

Claude-only slots, each asserted with real behavior rather than declaration: Grimoire-owned MCP
(load, save, start, stop), transcript rewind, static *and* session command discovery, and subagent
cancellation — the one provider so far that can stop a running subagent, still with `statusQuery` and
`reattachment` false, because the three are separate fields on purpose.

One behavior worth recording: Claude folds the project-settings hash into its environment hash when
`respectProjectSettings` is on, so a changed `.claude/settings.json` invalidates sessions like an
environment change. The snapshot hash is derived from the model and environment rather than stored, so
a stale hash from an older write is recomputed instead of trusted.

Gates: unit 441 suites / 7564 tests, integration 6 suites / 220 tests, `typecheck`, `lint`,
`build:release` clean, bundle assertions find no Claude execution code in `main.js`.

### M2-proofs — Windows CI: the stdin pipe never worked (this commit)

The cross-platform job failed on `windows-latest` for proof two, and it caught a defect that would
have reached users at the Codex flip. Ubuntu and macOS were green, which is the whole argument for
the matrix.

Both Windows failures come from the job guardian, the C# that owns the process tree inside a Windows
job object:

- **the real defect: neither pipe direction was flushed.** The guardian copied streams with
  `Stream.CopyToAsync`, whose destination `FileStream` buffers and delivers its last partial buffer
  at close. That is correct for a process that exits — which is every case the guardian had until
  now — and wrong for a persistent daemon, which never closes: a JSON-RPC request sat in the buffer
  and never reached the app-server, and its reply sat in the other buffer and never reached us. The
  test failed as a ping with no pong. Both directions are now explicit pumps that flush every chunk,
  on threads rather than `async` so the source still compiles under the CodeDom compiler `Add-Type`
  uses;
- **the second failure was a budget, not a bug.** The pid wait allowed five seconds, and on Windows
  the guardian is compiled by `Add-Type` at every launch, which on a cold runner takes seconds before
  the child is spawned. The wait is now platform-aware with the reason named, rather than bumped.
  Worth carrying forward: **starting a Codex or Claude daemon on Windows pays a C# compile first**,
  which is a real latency the flip will have to answer for.

This also validated the coverage gate added in the same milestone: the integration step selected its
suite by the literal name `LocalShellProcessOwnership`, so before that change the Codex ownership
test would not have run on Windows at all, and the job would have reported green.

### M2-proofs — topology proof 4 of 4: OpenCode, and the semantic freeze (this commit)

Managed ACP subprocess, the last topology and the one that generalizes: MiMoCode, Kimi Code, Grok,
Qwen, and Gemini all reach production through the same shared `src/providers/acp/` transport this
backend uses, so the five providers without a proof of their own inherit this one's argument.

As the journal predicted one commit earlier, OpenCode's harvested backend carried the same stale
`turnId` run-scope field. Four backends, four times — it was a systematic property of the v1 harvest,
and TypeScript caught it here only because the OpenCode test happened to read `scope.turnId`
directly rather than through a spread.

One structural difference the codec had to respect: `OpencodeProviderSettings` extends the persisted
shape with `availableModes` and `discoveredModels`, which are **discovery state, not settings**.
Encoding them would write a cached CLI catalogue into the settings file and let it outlive the
process that produced it, so `encode` omits them, `decode` reports them as an issue when an older
build stored them, and `reconcile` carries them through untouched.

**The three-field MCP split earned itself here.** OpenCode's live record says
`supportsMcpTools: false`, which reads as "no MCP" — but that boolean only gates the chat tab's
per-run server selector. Grimoire still owns `.grimoire/mcp/opencode.json` and still injects those
servers into the ACP session. The descriptor says what is true: `ownership: 'grimoire'`,
`sessionConfiguration: 'grimoire'`, `perRunSelection: 'unsupported'`.

**M2-proofs exit gate: `executionSemanticFreeze.test.ts`.** Written against the M1 contract, not
harvested — the v1 suite asserts a vocabulary this contract replaced (`observation`, `controls`,
support strings where these are booleans), so harvesting it would have frozen the wrong shape. Its
per-provider agent evidence is real observation, so that data was translated into the fixtures rather
than re-derived.

It binds each module to its trace — identity, backend descriptor, topology, session boundary, resume,
and every agent field — and asserts the set-level properties that four proofs exist to establish:
four materially distinct topologies, distinct backend ids, a spread of answers on resume, history
ownership, MCP ownership, command discovery, and security enforcement, and the rule that an
observation label never implies an agent action. Verified by injection: changing Codex's
`progressObservation` from `aggregate` to `full` fails it.

**The freeze immediately caught two overclaims, both mine, in modules committed hours earlier:**

- Claude declared `spawnOrigin: ['grimoire', 'provider-native']`. Grimoire writes agent definitions
  under `.claude/agents/`, but the CLI's tool is what launches one; writing a definition is not a
  spawn origin, and claiming it tells the UI it can start a subagent itself. Now `['provider-native']`;
- OpenCode declared `spawnOrigin: ['provider-native']` while its recorded evidence has no agent
  events at all. A spawn origin on a provider whose subagent lifecycle never reaches Grimoire
  promises an agent the UI can never observe. Now `[]`.

Claude's `agents.definitions` also moved from `provider-files` to `native`: it ships built-in agent
types the CLI knows without any file, and `.claude/agents/` only adds to that inventory. Codex and
OpenCode have files and nothing else, which is the distinction the two values exist to draw.

Gates: unit 450 suites / 7661 tests, integration 6 suites / 220 tests, `typecheck`, `lint`,
`build:release` clean, and no OpenCode execution code in the bundle.

**M2-proofs is complete.** Four topologies, four modules, one shared conformance suite, four traces,
and a freeze over all of it.

### Session end — Windows CI red on one launch form, diagnosed (this commit)

Stopping point recorded for a fresh session. Everything below the resume pointer is current; this
entry is the one thing that is not green.

**Where it stands.** The guardian flush fix worked: on Windows, `keeps JSONL stdin usable and
terminates the complete descendant tree` now passes, along with three of the four launch forms in
the shim case. **One form fails: `com`** — a copy of `cmd.exe` renamed to `codex shim.com` and
invoked with `/d /s /c "<command>"`. The diagnostic added for exactly this reported it by name on
its first run.

**Cause, verified locally rather than inferred.** `windowsProcessArguments` chooses its quoting by
`spec.executable.toLowerCase() === 'cmd.exe'` — an exact string a renamed copy at an absolute path
never matches. The `com` form therefore takes the direct MSVCRT path, and rendering its arguments
through `windowsDirectProcessArguments` produces:

```
/d /s /c "\"C:\node.exe\" \"C:\dir\persistent app server.js\" \"C:\dir\com.pid\""
```

`cmd.exe` does not understand `\"`; that is MSVCRT convention. It reads a literal backslash followed
by a quote, so the command line it tries to execute is malformed, the child never launches, and no
pid is ever published — precisely the observed failure. Reproduced on Linux by rendering the same
arguments through the exported helper, so no Windows machine is needed to work on it.

**Resolved the next session, and the case was not synthetic after all.** The first reading was that
no real Codex install is a renamed `cmd.exe`, so the `com` form modelled nothing. That was wrong, and
checking rather than assuming is what found it: `CodexAppServerProcess` resolves its interpreter as
`process.env.ComSpec`, which is normally `C:\Windows\system32\cmd.exe` — **an absolute path, never
the bare string the dispatch compared against.** The `com` form models exactly that shape.

Two independent defects were behind one red gate, and naming the failing form is what separated them:

- **production: the quoting dispatch keyed on the executable's name.**
  `spec.executable.toLowerCase() === 'cmd.exe'` misses every interpreter reached by path, so those
  invocations fell through to MSVCRT quoting, whose `\"` escape cmd does not implement. Now dispatched
  by the argument contract — `windows-process-tree` termination plus exactly `/d /s /c <one command>`
  — which `windowsCommandArguments` already validated and threw on. Four new cases cover the bare
  name, two absolute paths, and a renamed interpreter, plus one that holds an ordinary program to
  MSVCRT rules. Verified by restoring the name comparison: three of the four fail;
- **the test built a command line `cmd /s` cannot run.** `/s` strips the first and last quote
  character of the tail, so `"node" "server" "pid"` lost one quote from each end and became a command
  nobody wrote. No quoting strategy could rescue it. The tail now carries its own enclosing pair,
  exactly as `CodexAppServerProcess` wraps for the same reason — which is the corroboration for the
  `/s` rule, alongside cmd's own documentation.

The second defect was hidden behind the first: with the dispatch fixed, the form would still have
failed, and the fix would have looked wrong.

Local gates green (unit 450 suites / 7666 tests, integration 6 / 220, typecheck, lint,
`build:release`), and **CI is green on all four jobs including `windows-latest`** — which is the
confirmation of the second half, since `/s` stripping cannot be reproduced off Windows. The two
fixes compose as intended: the form now takes cmd quoting, which passes the tail through raw, and
`/s` strips the pair the tail carries for exactly that purpose.

### M2-adapter — stop condition: the kernel has no channel for streamed output (this commit)

Opening M2-adapter surfaced a blocker at the centre of it, before any adapter code was written. This
is the milestone working as designed — "the seam, proven without a flip" — but it needs a decision
that is not the migration's to make alone.

**The chain, each link verified rather than assumed:**

- `InputController` renders by `for await (const chunk of runtime.query(...))`, and today's providers
  yield text as it arrives: `CodexNotificationRouter` emits `{ type: 'text', content: params.delta }`
  **per delta**. Streaming is current behavior;
- the kernel's `ExecutionEvent` union carries **no content at all**. Its variants are facts —
  `thinking-activity`, `tool-activity` with an id, `progress`, `interaction-opened`, `terminal`,
  the native-agent family — plus `result: ResultRef`, and `ResultRef` is
  `{ resultId, storage, digest? }`: a pointer with no text and no partial or offset notion;
- the four proof backends accumulate. `CodexExecutionBackend.appendAssistantOutput` concatenates each
  delta into a buffer under a byte limit, and `storeResult` is called **once**, at the end, with the
  whole output. Claude and OpenCode do the same.

**Consequence:** an adapter built on the harvested kernel can only deliver the answer as one chunk
when the turn terminates. A flipped provider would render nothing while it works, then everything at
once.

**Why that is a stop condition rather than a detail.** The plan's preservation boundary is explicit —
"Until the owning milestone, current behavior is preserved exactly" — and the intentional-change list
does not contain deferred rendering. The M2-adapter definition says "envelope events map to
`StreamChunk` content", which presumes a content channel the kernel does not have. So this is a gap
in the plan, not a defect in the harvest.

**Three ways forward, with what each costs:**

1. **A transient content event in the kernel.** A variant such as `output-delta` travelling the same
   delivery path as every other event, so text and tool activity keep one ordering authority, but
   classed as transient: excluded from dedupe bookkeeping, from the projection reducer, and from
   persistence. D2 — "no second copy of any provider transcript" — then holds as an enforced
   property rather than a structural one, testable against `ControlRecordPayloadPolicy`. Cost: the
   event stream carries content, and the transient class has to be honoured everywhere it matters;
2. **A separate content projection.** Backends write deltas to a projection the adapter subscribes
   to, and the kernel stays content-free. Cost: two channels with independent ordering, so
   interleaving of text against tool and interaction events is no longer guaranteed by the component
   that exists to guarantee ordering;
3. **Accept deferred rendering** and add it to the intentional-change list. Cost: a visible product
   regression on every flipped provider, which is a product decision.

Recommended: **1**, because it keeps a single ordering authority — the reason the ingestor exists —
while the transient class answers both the persistence rule and the cost of pushing token-rate
traffic through causal bookkeeping.

Nothing was implemented for M2-adapter pending this decision. The rest of the milestone — session
lifecycle, capability ports, interactions, terminal semantics, and the twelve target assertions in
`adapterContractTarget.test.ts` — does not depend on the answer, since those concern terminals and
generator lifetime rather than content.

### M2-adapter — the transient content channel (this commit)

The stop condition above is resolved: the owner chose the transient content event. This commit is
that decision built, and nothing else — the adapter itself follows.

`ExecutionEvent` gains one variant, `output-delta`, with a `channel` of `assistant` or `reasoning`.
It is the only content-bearing event and the only transient one, and `isTransientExecutionEvent` is
the single predicate the three exclusions read:

- **the ingestor** neither remembers its delivery id nor consumes a sequence number. A run's
  `lastSequence` therefore still counts what happened rather than how much was said, and a turn's
  worth of token-rate traffic cannot evict the bounded set that protects the events which do need
  deduplication. A transient envelope carries the position it follows, which keeps it ordered
  without claiming a place;
- **the run projection** returns unchanged. The check sits *before* the sequence guard on purpose:
  an envelope carrying the position it follows would otherwise read as a replay;
- **the registry** routes it straight to observers — no control record, no state machine, no
  post-commit hook. D2 forbids a second copy of a provider transcript, and a stream of deltas is
  exactly that, so the guard is that this path writes nothing at all. The test asserts the control
  directory is byte-for-byte unchanged and that no written record contains the text.

Deduplication is deliberately absent rather than forgotten: a backend emits each delta once, and
recovery replays facts, not text. That is stated in a test, so the assumption is visible.

**The registry gained `observe(sessionId, observer)`**, which is what makes a presentation adapter a
client of the registry rather than of a backend. Durable envelopes reach observers only after they
commit, so nothing is rendered that a failed commit would take back; transient ones go straight
through. An observer that throws cannot fail ingestion — presentation is downstream of the record.

Three of the four backends now stream, at the point where each already had the text and had been
throwing it away into an accumulator: Codex per app-server delta, OpenCode per ACP
`agent_message_chunk`, Claude per SDK `content_block_delta` — including `thinking_delta` on the
reasoning channel, and excluding subagent deltas, since a nested agent's text is not the
conversation's. Each emits only after its byte-bound check, so a reader always sees a prefix of what
will be committed. Antigravity does not stream because print mode has nothing to stream: one process,
one output, at exit.

**The trace fixtures record it**, which is what made two of them fail first. OpenCode's summarizer
silently dropped event kinds it did not name, so the trace would have stayed silent about whether a
turn was readable while it ran; it now names `output-delta`, and both its recorded cases carry it.

Gates: unit 451 suites / 7675 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M2-adapter — the run stream, over the registry (this commit)

`ExecutionRunStream` is the turn's view of a run, and `startExecutionRun` acquires that run **through
the registry** — never a backend, because ingestion, ordering, deduplication, and terminal policy are
the registry's job and a second opinion about any of them is how the two disagree in production.

**The target suite was re-pointed at it, and eleven of the twelve assertions held unchanged.** That
is the value of having written them at M0a against a double. The twelfth did not hold, and **the
specification was the thing that was wrong**: it asserted the error chunk carries the provider's own
error string, and the kernel does not carry one. `RunTerminalReason` is a closed set of sixteen
causes, so the adapter renders the cause. That is a deliberate trade — a classified cause can be
rendered, counted, and reasoned about, where a raw provider string is diagnostic content, often a
stack trace, that D7 would have to redact before it could be shown. All sixteen have a sentence, so a
new reason is a compile error rather than a run that fails with no explanation. The changed assertion
says so at the assertion, not in a commit message.

Observation is established **before** `startRun` resolves. A run that dispatches quickly can emit
first, and an event observed one line too late is indistinguishable from one that never happened.

Two capability fields were added to the descriptor because the adapter had to answer
`getCapabilities()` with the record the UI reads today and had no source for them: `input`
(image attachments, instruction mode) and `interactions.planArtifactPrefix`. Without them the adapter
would have invented two answers and silently disabled an image button. `supportsMcpTools` maps from
`mcp.perRunSelection` rather than from ownership — that boolean gates the per-run selector and
nothing else, which is the distinction proof four found.

**A correction to this journal.** The M0a review found that the composition gate did not understand
the `@/` alias, and fixing it appeared to expose *eight* `src/core/**` modules importing a concrete
provider. That claim, recorded here and carried in the resume pointer since, **was wrong.** The
fixed gate still matched specifiers as text, and text cannot tell `src/core/providers/` — core's own
neutral contracts, which all eight import — from `src/providers/`. The gate now resolves each
specifier against the importing file, and the exemption list is **empty**: `src/core/` has never
imported a concrete provider. The rule was right; the measurement was not, twice, and the second time
it invented eight violations that did not exist. A case pinning both confusions now guards the guard.

Gates: unit 452 suites / 7686 tests, integration 6 / 220, typecheck, lint, `build:release` clean,
adapter absent from the bundle.

### M2-adapter — the five paper mappings, executed (this commit)

`prepareTurn`, `steer`, `setResumeCheckpoint`, `buildSessionUpdates`, and `consumeSessionInvalidation`
each had a verdict in the M0a contract and nothing running behind it. Three carry real state and now
have it, with the behaviour the mapping table specifies rather than the behaviour that is easiest:

- **the resume checkpoint is cleared by the dispatch, not by being read.** A dispatch that throws has
  resumed nothing, and dropping the checkpoint there would quietly turn the retry into a fresh
  conversation;
- **session invalidation is one-shot.** The caller that reads the fence owns the consequence, so a
  second reader must not act on it again;
- **steering follows the capability.** The contract is explicit that `steer` is absent when
  unsupported rather than present and returning `false`: the UI can test for an absent member, and
  cannot tell a member that always fails from a broken one.

**The spread hole bit again, this time in my own code.** `setResumeCheckpoint` maps onto the next
`ExecutionRequest`, and that field did not exist on the contract — yet the adapter's first attempt to
set it type-checked, because it was added through a conditional spread and TypeScript does not
excess-property-check those. This is the third occurrence on this branch, after the stale run-scope
field in all four harvested backends. Caught by checking the contract rather than trusting a green
typecheck. `ExecutionRequest.resumeCheckpoint` now exists, opaque to core like `requestRef`, and a
conformance case asserts the value actually arrives at the backend rather than the object merely
compiling.

The deterministic fake records what each run was dispatched with, which is what let that be asserted
at all.

Gates: unit 453 suites / 7693 tests, integration 6 / 220, typecheck, lint, `build:release` clean;
CI green on the previous commit.

### M2-adapter — the adapter assembled (this commit)

`ExecutionChatRuntimeAdapter` is the class the milestone asked for: one provider-neutral view of the
kernel where every member delegates to the registry, to a module contribution, or to a host port, and
holds no protocol knowledge of its own. It establishes its session on first use and idempotently —
a second `ensureReady` must not give one conversation two owners — streams a turn that closes only on
a terminal, dispatches cancellation without waiting, and disposes the session on `cleanup`, which
preserves today's behaviour that closing a tab cancels its work until M5 makes it detach-only.

`steer` is a getter returning `undefined` where the provider cannot steer, so the member is genuinely
absent rather than present and failing. Codex has it; Antigravity does not, and the test asserts both
directions.

**A fifth contract gap, recorded rather than papered over.** The adapter contract maps `prepareTurn`
to a **module contribution**, and `ProviderModule` has no slot for it. It is routed through a host
port here instead of being invented: prompt encoding is real provider behaviour that lives in the
four legacy runtimes today, so giving it a slot means moving four encoders, which is M3 work and not
a line in this file. Owner: M3, and it is in the open obligations below so it is added deliberately
rather than discovered missing at a flip.

The adapter is generic over its settings type for the same reason the contract became generic at
proof three: a module's feature contributions are typed by its settings, and erasing that would push
a cast into every provider.

Gates: unit 453 suites / 7698 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M2-adapter — interactions bridged (this commit)

The four interaction callbacks map onto one bridge, and building it made the boundary explicit: the
kernel carries an interaction as identity plus an **opaque `presentationRef`** and a set of response
ids. It does not carry the tool name, input, or description the approval callback expects, because
those are provider payload and core does not decode payload. So rendering needs a provider-owned
presenter, and the adapter's whole part is: ask, then resolve through the registry with the chosen
response id.

Three behaviours are worth stating because each could plausibly have gone the other way:

- **a dismissal leaves the interaction unresolved.** Returning `null` is not choosing the first
  option, and flattening the two would make the UI decide on the user's behalf — the one thing an
  approval prompt must never do. The provider times it out or cancels it;
- **a redelivered interaction is presented once.** Idempotent resolution is the registry's, which
  owns interaction ownership; the bridge only has to avoid asking the user twice;
- **a presenter that throws settles as a dismissal** rather than leaving the bridge unable to
  present anything afterwards.

Gates: unit 453 suites / 7702 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M2-adapter — coverage over the four topologies, and a hole it found (this commit)

The milestone's exit gate asks for adapter conformance over the fake **and the four proof backends**.
Running four full adapter harnesses would mostly re-test the registry, so the per-provider property
asserted is the one that actually differs: what each backend emits, checked against what the adapter
does with it. `classifyForPresentation` makes that checkable — every kernel event kind is `chunk`,
`terminal`, or `ignored`, and `ignored` is a decision in one list rather than a default branch that
would swallow the next kind someone adds.

**It immediately found that Claude's streaming was never executed by any test.** The delta handling
added two commits ago sat in a branch no scenario reached: the recorded persistent-turn case jumped
straight from the session init to the result. Its trace said so, and the gate compared the trace
against the topology. Fixed at the cause — the scenario now emits an SDK `content_block_delta`, the
Claude summarizer names `output-delta` as OpenCode's now does, and the trace records it. Had this
gate not existed, Claude would have shipped a streaming path that compiled, was described in the
journal, and had never run.

The streaming claim is now per-provider and checked both ways: three topologies must show streamed
output in their recorded events, and Antigravity must not, because print mode is one process, one
output, at exit.

Gates: unit 453 suites / 7711 tests, integration 6 / 220, typecheck, lint, `build:release` clean; CI
green on the three preceding commits, including the Windows teardown fix.

### M2-adapter — self-review, and what it found (this commit)

A deliberate review of everything M2-adapter added. Five findings, two of them defects that would have
reached users at the first flip.

**1. The capability projection changed behaviour nobody had decided.** `toLegacyCapabilities`
produced `supportsProviderCommands: true` for Codex where the live record says `false`, so the first
Codex flip would have made `TabManager` start requesting a command catalog it has never requested.
This is the divergence proof two *recorded as open* — and the adapter then silently resolved it in
the descriptor's favour. Fixed the way MCP already was: `commands` is now two fields, `discovery` and
`chatSurface`, because what a provider can do and what the UI asks for are different statements.
Codex is `ephemeral-process` plus `unsupported`, which states the fact instead of leaving a
contradiction between two records.

The gate that let it through was mine: the projection test compared three chosen fields. It now
compares **every field against each provider's live record**, for all four. Verified by restoring the
old mapping and watching Codex fail.

**2. A recovered envelope never reached observers.** `recoverBlockedIngestion` commits an envelope
and runs its post-commit hooks; it did not publish. Since the adapter closes a turn on the terminal
and on nothing else, a terminal blocked by a storage fault and later committed would have updated
every record and left the turn's generator open **forever**. Found by tracing every path that accepts
an envelope, not by a test.

The fix is one line. Its test is the honest part: the fault I could construct lands in the
*not-committed* branch, where publishing would be wrong — so the test asserts what that scenario
actually proves, that an envelope which never became durable is never published and the run has no
terminal. A phantom terminal is worse than a missing one, because nothing later contradicts it. The
committed branch is verified by inspection, and this says so rather than implying coverage it does
not have.

**3. A test that could not fail, again.** The first version of the storage-fault test passed with and
without the fix — I checked, which is the only reason it was not committed as evidence. It has been
replaced rather than kept.

**4. Two unbounded sets.** The interaction bridge remembered every interaction id for the life of a
conversation, and the registry kept an observer entry per session after disposal. Both are bounded
now — the bridge with a window that only has to outlast redelivery, the registry by releasing
observers with the session they were watching.

**5. A guard that guarded nothing.** The event-kind list in the coverage suite was hand-written, so
it would have stopped covering the next kind added while still passing. It is derived from the union
in the source now, and asserts that every kind classifies — exhaustiveness is a compile error only
while the switch has no `default`, and the first person to add one would turn an unclassified event
into `undefined` at runtime. Verified by adding a kind to the union and watching it fail.

Gates: unit 453 suites / 7717 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M2-adapter — complete, and a journal entry that was wrong (this commit)

The exit gate the milestone actually asks for is that the adapter answers the whole `ChatRuntime`
contract, since "a deviation that needs a new member is a stop condition" means nothing unless
coverage of the existing thirty-two is checked. `adapterMemberCoverage.test.ts` checks it.

**It immediately contradicted this journal.** The previous entry said only the two optional subagent
loaders remained. The gate found **twelve** members uncovered: `syncConversationState`,
`reloadMcpServers`, `getSupportedCommands`, all five interaction callbacks, the two observation
hooks, `buildSessionUpdates`, and `resolveSessionIdForFork`. The note was written from memory of what
I had built rather than from a comparison, which is exactly the habit the gates exist to replace.

All twelve are implemented. Two needed decisions rather than delegation:

- **`buildSessionUpdates` had no port to call.** Row 29 maps it to "a history port producing the
  conversation patch", and `ProviderHistoryPort` had no such method — the sixth contract gap the
  proofs have surfaced. Added as `buildSessionPatch`, returning two named fields rather than a
  `Partial<Conversation>`: that is a feature type, and `providerState` staying opaque is the reason
  core gets named fields it cannot be tempted to read;
- **`getSupportedCommands` reads `chatSurface`, not `discovery`.** The distinction found in the
  review earlier today, applied where it matters: Codex discovers commands and its chat input does
  not ask for them, so the adapter returns none.

**A false green found and fixed in the gate itself.** The coverage check compares member *names*, and
the adapter had a `rewind` getter returning the capability port — which satisfied the name while
having nothing to do with `rewind(userId, assistantId, mode)`. Rewritten in the contract's own
signature. Worth remembering: a name-based gate can be satisfied by a name.

Rewind also distinguishes `unavailable` from `failed`, which the legacy `ChatRewindResult` collapsed
behind `canRewind: false` — one says the provider has no rewind, the other that a rewind was
attempted and did not work.

**M2-adapter is complete.** The adapter is a client of the registry, covers the contract, passes the
twelve target assertions, projects the capability record field for field, and is absent from the
shipped bundle.

Gates: unit 454 suites / 7726 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M2-adapter — five defects from an external review, all confirmed (this commit)

An external review of the branch found five bugs, and every one of them was real. Two were hangs or
leaks on the most ordinary path there is. None would have been caught by the gates as they stood,
which is the part worth keeping.

**1. `terminalizeRun` published nothing.** It writes the durable terminal, refreshes the run, and
cancels open interactions — and never publishes an envelope. That path settles a run without any
backend event: pre-dispatch rejection, recovery, shutdown. Since a reader closes a turn on the
terminal and on nothing else, the control store would hold a settled run while the UI waited on it
forever — the worst pairing, because the record looks correct. **This is the sibling of the
`recoverBlockedIngestion` defect found in my own review two commits ago, and I missed it while
looking directly at that class of bug.** Fixed, and pinned with a `reject-side-effect-free` dispatch;
verified by disabling the publish and watching the test fail.

**2. `cleanup()` broke on a live run.** `disposeSession` refuses a session with a non-terminal run,
and closing a tab mid-turn is routine — `destroyTab` sets a flag, calls `cancel()` fire-and-forget,
then `cleanup()` immediately, with the legacy runtimes cancelling inside `cleanup`. The adapter did
neither, so the common path rejected, leaked the session, and did it as an unhandled rejection
because `ChatRuntime.cleanup()` returns void. Now: cancel, wait for the terminal under a bound, then
dispose, reporting failures instead of throwing. The wait is bounded because closing a tab must not
depend on a provider answering — which is what cancellation exists to break.

**3. The adapter was not a `ChatRuntime`.** It was documented as one and never declared as one, and
five members had shapes the caller could not use: `rewind` returned the port's outcome where the
caller reads `canRewind`, so a *successful* rewind read as "this provider cannot rewind";
`buildSessionUpdates` and `resolveSessionIdForFork` took the wrong inputs; `getSupportedCommands`
returned port descriptors rather than slash commands; and `resetSession` was listed in the coverage
gate as having **no production call site**, which was simply false — `main.ts` calls it on a settings
change. Every signature is translated at the boundary now, and the false claim is gone.

**The gate was the reason all of this passed.** It compared member *names*, which is how a getter
called `rewind` satisfied `rewind(userId, assistantId, mode)` — a false green I found and fixed one
commit earlier without asking what else the same weakness was hiding. It now asserts **assignability
to `ChatRuntime`**, decided by the compiler rather than by a test, and verified by giving one member
a wrong parameter type and watching `typecheck` fail.

**4. Interactions and auto-turns went nowhere.** All seven setters stored their callback and nothing
consumed them: the bridge was never constructed, and no auto-turn was ever delivered. Approvals and
backend-initiated turns would have stopped working at the first Claude flip. They are routed on the
run's own stream now, not a second subscription, so ordering cannot disagree.

**5. Turn metadata carried no native identities.** It reported `wasSent` alone, while the controller
copies `userMessageId` and `assistantMessageId` onto messages and rewind refuses to run without the
first. Rewind and resume would have degraded *silently*, which is worse than failing, because the
turn still looks complete. The identities are taken from the run scope and result, and a provider
with none reports none rather than a synthesized id it would not recognize.

Also fixed from the suggestions: the `ensureReady` race, where two overlapping calls each minted a
session id and orphaned the first with nothing left holding its id to dispose it, and the stale line
in this document that still called M2-adapter in progress.

Also done, in a separate pass so it did not ride along with the behaviour fixes: branch history moved
out of the source and into this log. Eight comment blocks narrated what v1 did, which review found
the gap, or what a previous entry got wrong — none of which a future editor needs, while the
constraint each one guards does. The constraints stayed and the narration went; the files lost about
twenty comment lines, not two hundred, because most of them explain non-obvious intent, which is what
they are for.

Gates: unit 454 suites / 7732 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M0b — real wire recordings, and what they contradict (this commit)

The owner authorized recording against their own CLIs, so the four proof providers now have
recordings taken from live processes rather than from the archived branch's fixtures:
`tests/fixtures/provider-traces/wire/`, one per provider, each naming the CLI version it came from.
Codex `app-server` and OpenCode `acp` over stdio JSON-RPC, Claude as `--output-format stream-json`,
Antigravity as print-mode stdout. `agy` was installed mid-session, which is why the fourth exists.

The owner also suggested reading each provider's documentation, and for Codex that turned out to be
better than prose: the CLI generates the **JSON Schema of its own protocol**, version-exact. It
declares roughly 166 methods.

**Our execution connection subscribes to eleven.** One trivial turn produced **nine notification
methods it does not list**, and the ones it drops are not decoration:

- `account/rateLimits/updated` — the provider's own instructions say Codex plan indicators come from
  exactly this notification;
- `thread/tokenUsage/updated` — usage display;
- `rawResponseItem/completed` and `rawResponse/completed` — the instructions say
  `experimentalRawEvents: true` exists so raw response items can be projected into stream chunks,
  and the recording shows five of them in one turn;
- `mcpServer/startupStatus/updated` — a failed MCP server would never reach the user;
- `hook/started`, `hook/completed`, `thread/started`, `remoteControl/status/changed`.

The schema names more that this turn did not trigger and a real session would:
`turn/plan/updated`, `item/commandExecution/outputDelta`, `item/fileChange/patchUpdated`,
`thread/compacted`, `thread/environment/disconnected`, `process/exited`, `model/rerouted`.

OpenCode shows the same shape in miniature: `available_commands_update` and `usage_update` arrive and
the backend handles neither. Claude's stream carries `rate_limit_event` and three `system` subtypes
the backend ignores — and notably **no** `stream_event` at all in print mode, so the streaming path
added for it only runs when partial messages are requested.

None of this is fixed here. Subscribing to a notification is provider-backend work owned by each
flip, and doing it now would be nine guesses instead of one decision. What is fixed is that the gap
is **visible**: `wireVocabularyCoverage.test.ts` pins the observed-but-unmodelled list per provider,
so it can shrink but cannot grow without a recording that justifies it, and no flip can claim
coverage it does not have.

Two things the recordings deliberately do not contain. Long strings are elided at capture — the
evidence wanted is protocol shape, and the payloads carry provider prompt material and model output
that has no business in a repository fixture. Identifiers, home paths, session ids, and anything
key-shaped are replaced. A test asserts both, so a refreshed recording cannot quietly reintroduce
either.

**M0b is satisfied for the four proof providers.** The remaining five need their own recordings
before their own flips, which is what the plan already schedules.

Gates: unit 455 suites / 7740 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M2-flips — the kernel host, before the flip (this commit)

The first flip owns three things besides the provider switch: an application-scoped kernel host, the
control store appearing under `.grimoire/`, and revert safety. The host is built first and separately,
because it is the piece that can be got wrong quietly, and because building it inside a flip would
mean debugging two things at once.

`ExecutionKernelHost` is **one explicit object**, not a module singleton — a singleton outlives the
plugin instance a reload replaces, and two registries over one control store would each believe they
own every run in it. It is the seed of `ApplicationRuntime` at M5, not a parallel structure.

**Obsidian's `onunload` does not await, which splits the shutdown guarantee.** The acceptance gate
closes **synchronously** — verified in the registry rather than assumed: `state = 'quiescing'` is set
before the first `await` in `shutdown()`, so calling it without awaiting still shuts the door the
instant unload begins. The bounded cancellation and cleanup run after, recording the checkpoint the
next startup recovers from. Waiting inside `onunload` would freeze the application on a CLI that
never answers.

**A defect caught by checking rather than trusting the typecheck.** The default shutdown checkpoint id
was `shutdown-<uuid>`, and the registry requires the opaque form `sd-` plus thirty-two hex digits. It
would have thrown — and since the host reports shutdown failures rather than raising them, so that a
void `onunload` cannot get a rejection, **the shutdown would simply never have happened**, silently,
on every unload. The two properties that hide each other are worth naming: a validated id and a
swallowed error.

Still dark: nothing constructs the host, and the bundle assertions now include one of its strings.

Gates: unit 456 suites / 7746 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M2-flips — the kernel host, corrected (this commit)

Review of the entry above found the host's own contract unclosed, in the same class of defect that
entry was written about. Both findings were confirmed against the registry, not the diff.

**Load and unload are not ordered, and the host assumed they were.** Obsidian's `onload` is async and
`onunload` is neither withheld until it finishes nor awaited. Two orderings broke: an unload before
any load, and an unload during one. In both, `registry.shutdown()` throws from `initializing`, the
host reports that failure and memoises the resolved promise — after which the start that follows
opens the acceptance gate and **no later `dispose()` can close it**, because `dispose()` is already
memoised. A kernel accepting work for a plugin instance that is gone, silently, exactly the shape the
previous commit existed to prevent.

The fix serialises the two paths. `dispose()` records the unload synchronously; a start that finds it
never opens the gate; a dispose that arrives mid-start waits for that start to settle and closes what
it opened. The synchronous close survives for the ordinary case because `shutdown()` is still called
before any `await` — that is the whole reason the branch exists rather than a uniform `await`.

A third defect surfaced while fixing: a control store that requires migration left the registry
read-only and never accepting, so `shutdown()` refused it and the host reported a **spurious failure
on every unload** for exactly the user who reverts a shipped flip. The host now tracks whether the
gate opened at all.

**The larger finding is the test suite, and it was measured rather than argued.** With `dispose()`
replaced by `Promise.resolve()`, the committed suite passed **in full** — all five tests. Every
shutdown assertion in it was vacuous, for three separate reasons:

- the gate test asked for backend `provider-fake` while the fake registers as
  `internal-deterministic-fake`, so its bare `.rejects.toThrow()` was satisfied by
  `Unknown execution backend` whether the gate closed or not;
- the failure-report test drove the report path with a second `dispose()`, which memoisation makes a
  no-op, so the reporter was never exercised;
- the control-path test asserted `every()` over a list it never checked was non-empty.

Each is now discriminating: the suite asserts the registry's exact refusal message, drives the
reporter with a malformed checkpoint id, and requires records before checking their prefix. Proven by
injection both ways — the four new ordering tests fail against the previous commit's host, and the
gate test fails against a `dispose()` that does nothing, which the previous suite tolerated.

Gates: unit 456 suites / 7750 tests, integration 6 / 220, typecheck, lint, `build:release` clean.

### M2-flips — the answer had nowhere to go (this commit)

Wiring the Antigravity flip began by reading what the adapter would render, and the answer was
nothing. `output-delta` is the kernel's only content-bearing event and the only kind the adapter
turns into text; the Antigravity backend never emitted one. It committed a result and finished. A
`ResultRef` is `resultId`, `storage`, `digest` — an identity, not a payload — so the flip as planned
would have shipped a provider whose every successful turn rendered **empty**.

Invisible until now for a specific reason: the backend's own suite asserts the events it emits, the
conformance suite asserts they are classifiable, and nothing asserted that a turn a user can read
comes out the other end. Dark code cannot fail that way, which is why the proof providers passed.

The backend now publishes the committed output as one `output-delta` on the assistant channel,
immediately before the `result`. Three things follow from where it is placed:

- **with the result, not on process exit.** An exit whose commit never settles is `indeterminate`;
  showing the text there presents an answer Grimoire cannot promise it kept. The negative half is
  a test: a never-settling sink yields `run-started` then `terminal:indeterminate:effects-unknown`,
  with no content;
- **transient, so D2 holds.** The durable copy is the committed result. A second one in the control
  store is exactly what D2 forbids without exception;
- **one delta, not a stream.** Print mode answers in one piece. That is what the topology says, and
  the whole output is a legitimate single delta.

The trace fixture and the backend were edited together, which is what the semantic freeze is for.

**A conformance claim was wrong and is retired.** `ExecutionAdapterConformance` asserted per
provider whether its fixture records `output-delta`, with Antigravity declared `streams: false` on
the reasoning that a process-per-run topology cannot stream. Cannot stream *incrementally* is true
and stays recorded as the fixture's `topology`; cannot carry content was the wrong conclusion drawn
from it, and the gate froze the defect in place instead of catching it. The assertion now requires
every proof topology to record content the adapter can render — the property that actually protects
a user-visible turn. An adjacency rule was tried first as a replacement claim and dropped: the
fixtures cannot express it, since the streaming providers' success cases also place their delta next
to the result.

Proven by injection: with the emission suppressed, three tests fail across the backend suite and the
conformance suite. Gates: unit 456 suites / 7751 tests, integration 6 / 220, typecheck, lint, and
`build:release` clean.

Still dark — nothing constructs the backend, and `build:release` left the generated `main.js` and
`styles.css` byte-identical, which is the same fact stated by the build rather than by a test.

### M2-flips — wave 1: Antigravity in production (this commit)

**The kernel is production code.** `main.ts` constructs `ExecutionKernelHost` over
`VaultDurableStorage` after settings load and disposes it in `onunload`; Antigravity's
`createRuntime` returns `ExecutionChatRuntimeAdapter` over the backend; `AntigravityChatRuntime` and
its test are deleted. Nothing else in that registration moved — workspace services, settings,
auxiliary no-ops, history, and UI config are untouched, which is the mixed-authority rule the plan
requires until M5.

Three pieces had to exist that no proof needed, because a proof never dispatches:

- a **request resolver**, which turns the kernel's opaque `requestRef` back into an `agy` invocation.
  The reference carries only what the turn decided — prompt and model. The CLI path, vault
  directory, environment, and permission mode are read at dispatch, so a turn queued before a
  settings change launches what the user has configured now;
- a **result sink**, which commits a reference without writing. `ResultRef` is an identity and a
  storage kind, never a payload; the answer's durable copy is the conversation, and D2 forbids a
  second one without exception. A sink that wrote the output anywhere else would be creating exactly
  the duplicate the boundary exists to prevent;
- the **prompt composer**, moved out of the deleted runtime rather than rewritten. Print mode keeps
  no session, so conversation continuity exists only as replayed history inside the prompt, and
  losing that would lose the conversation while every test stayed green.

**A kernel that cannot start does not take the plugin with it.** A failed start is recorded and
returns; the registry then refuses work it never accepted, so the failure surfaces as a refused
Antigravity turn rather than a vault without Grimoire in it. A control store requiring migration (D5)
is recorded the same way and leaves the store read-only.

**Revert safety has a test, not an argument.** A vault seeded with control records is opened by the
readers a reverted build would use — `SessionStorage` and `GrimoireSettingsStorage` — and must return
the same conversations and settings *and never read a control record while doing it*. The second half
is the one that matters: returning the right answers while parsing kernel bookkeeping is still a
build coupled to files it must not know about. Proven by injection — a session reader made recursive
over the storage root fails all three cases.

**`darkBundle.test.ts` was the wrong gate and is now the right one.** It asserted absence only, which
was correct while everything was dark and became false at this commit. It now names both directions:
seven markers that must be *present*, so a flip that silently failed to reach the bundle fails here,
and five that must stay absent for the providers still dark. One of the original markers was
vacuous — `.grimoire/control` is composed by template from the storage root, so no such literal has
ever been in a bundle and it could not have fired in either direction. Its two composed children are
real literals and are what the live list keeps.

The parity manifest splits accordingly: `execution-platform` and `provider-antigravity-execution` are
wired, the remaining backends stay pending under `execution-platform-dark`, and `RunProjection.ts`
gets its own pending row — it was covered by the old blanket entry and has no production consumer
until M5, since the adapter renders the event stream directly.

Gates: unit 457 suites / 7747 tests, integration 6 / 220, typecheck, lint, and `build:release` clean,
with `darkBundle` run against the fresh bundle.

**Not yet true when written:** the entry below corrects this one. The flip as committed could not
run a single turn.

**Not done, and owned:** the capability-driven manual smoke matrix. Antigravity declares no resume,
no plan mode, no rewind, no fork, no images, no provider commands, no MCP tools, and no steering, so
its matrix is four items — new session, cancel mid-run, model selection, and history replay across
turns — plus the fail-closed check that a non-`full_access` permission mode is refused before a
process starts. That runs against the built plugin in a real vault with `agy` 1.1.13, and it is the
one gate this checkpoint cannot self-certify.

### M2-flips — the flip could not run a turn, and three reasons why (this commit)

Every gate in the entry above was green and the flip was broken. Writing the first test that drives
one whole turn — tab to CLI invocation and back — found it in a minute, and then found two more.

**The request reference cannot carry the request.** `requestRef` is validated as a constrained
identifier, 128 characters and no whitespace, because core carries references rather than provider
payloads — the same line D2 draws for what it stores. (This entry first said the kernel *persists* it
into dispatch intents; the first production control records disprove that, and the correction is in
the entry below.) The flip encoded the prompt into it as JSON,
so `startRun` threw `request ref must be a constrained identifier` on the very first send. Every
suite passed because each half stubs the other: the backend's tests hand it a literal `opaque`
string, the adapter's tests hand the registry a fake, and nothing composed the two.

Fixed by making the reference a reference. `AntigravityRequestStore` holds prompt and model in
memory, hands out `agyreq-` plus 32 hex, and gives the request back exactly once — removed on
resolve, because holding a prompt after its run dispatched is retention nobody asked for, and
bounded at 64, because a turn rejected before dispatch never comes back for its request. In memory
on purpose: a reference that outlived a restart would promise a re-dispatch print mode cannot make,
and D3 already says an unknown dispatch must never launch again on its own.

That store is why the composition is now one object per plugin load rather than free functions. The
backend and every tab runtime must share it; a reference minted against one store and resolved
against another resolves to nothing.

**An `invalidated` terminal rendered nothing at all.** The adapter contract mapped it to "nothing",
justified by today's `wasInvalidated` path — but that flag means the *presentation* moved on (tab
closed, conversation switched), while the terminal means the turn was rejected before anything ran.
Two different facts under one word, and the paper mapping took the second's justification for the
first. The result is an empty assistant message with no explanation: the same silent empty answer
this adapter exists to prevent, one terminal over. For Antigravity it was the **default first turn** —
the shipped permission mode is `normal` and `agy --print` cannot request approvals, so the fail-closed
refusal is exactly this terminal. The contract, its target test, and the adapter changed together.

**The neutral sentence could not name the setting.** With `invalidated` rendering, a user in safe mode
got "The turn was rejected before it started, so nothing ran." The legacy runtime told them *why* and
what to change, localized. The kernel classifies causes rather than forwarding provider text, and
rightly so, but a classification is translatable: the host may now supply `describeFailure(reason)`
returning better wording for a cause the kernel already decided, or `undefined` to keep the neutral
one. No provider diagnostics travel, so D7 is untouched. Antigravity restores all three of its
messages — safe mode, disabled, and empty output — and defers on everything else.

Proven by injection in three places: suppressing the presenter, making `invalidated` silent again,
and — the one that started it — an end-to-end turn that fails outright if the reference is not
something the registry will accept.

The lesson is the same one M2-proofs recorded and this commit had to learn again: **a seam that both
sides stub is not covered.** The composition module is where the two halves meet, and it had no test
until the flip was already pushed.

Gates: unit 457 suites / 7749 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.

### M2-flips — the smoke matrix found a bug older than the flip (this commit)

The manual matrix stopped at step zero: Antigravity would not enable at all, on the owner's machine,
with `agy` 1.1.13 working perfectly from a terminal. Debug logging in the vault answered it in one
read — which is the first time D7's logging has paid for itself.

`buildAntigravityProcessLaunch` wraps every `agy` call in the user's login shell and forwards the
arguments separately, so a prompt containing `&&` or a quote cannot become shell syntax:

```
$SHELL -lc 'exec "$0" "$@"' <command> <args...>
```

That expression is POSIX. The owner's shell is **fish**, which has neither `$0` nor `$@` and says so:
`fish: $@ is not supported. In fish, please use $argv.` The CLI never runs, `agy models` exits 127 in
70 ms, and enabling the provider **silently reverts** — a model-catalog refresh that rejects turns
the toggle back off by design.

Now per shell: `exec $argv` for fish, `exec "$0" "$@"` for the POSIX family, and for anything else —
nushell, xonsh, csh — a **direct launch with no login shell at all**. Guessing a shell's syntax trades
the user's profile for a provider that cannot start; losing the profile is the smaller loss, and the
environment is already assembled before this point.

**Older than the flip, and not found by it.** `AntigravityProcessLaunch.ts` dates from the original
provider, so `agy` has been unusable for every fish user since it shipped. Nothing caught it because
the launch test pinned `SHELL: '/bin/zsh'` and asserted the exact POSIX string — a test that fixes
one shell cannot notice a second. The flip did make it worse in one direction: this builder is also
what the new print runner uses, so the same syntax error would have failed every turn as well.

Reproduced against real fish before and after, and the fix is in the vault build.

Gates: unit 457 suites / 7756 tests, typecheck, lint, and `build:release` clean.

### M2-flips — the provider was reading another provider's permission mode (this commit)

Step 1 of the smoke matrix passed: `normal` gives the safe-mode refusal, no process starts. Step 2
did not — switching the tab's toggle to Auto-approve changed nothing, and every turn kept coming back
refused in 35 ms. The vault settings named the cause on sight:

```
settingsProvider           : codex
permissionMode (top level) : normal
savedProviderPermissionMode: { antigravity: "full_access", codex: "normal", ... }
```

The toolbar toggle writes into `savedProviderPermissionMode[providerId]` and only copies to the
top-level `permissionMode` when the provider happens to be the one the settings tab is showing.
Reading the top level therefore reads **whatever the settings provider is set to** — Codex, on
`normal`. Antigravity refused every turn while its own toggle read Auto-approve, and would have
launched unsupervised in the mirror case where the two disagreed the other way.

Inherited verbatim: the legacy runtime read `plugin.settings.permissionMode` too, so Antigravity's
effective mode has always been a coin flip on another provider's setting. It only looked fine because
the two agreed. The resolver now reads the same projection the tab UI renders the toggle from, so what
the user sees is what the run gets.

**A second defect, found by the first one's test run.** The provider's failure presenter reads live
settings, so it can throw — and it is called from inside `accept`, while a terminal is being recorded.
The throw escaped, the terminal was abandoned mid-flight, and the generator never closed: **the turn
simply never ended**. A hung turn is worse than any wording, so the presenter is now wrapped and falls
back to the neutral sentence. Found because the test harness had no provider registry, which is
exactly the kind of accident worth keeping a test for.

Both proven by injection. Gates: unit 457 suites / 7757 tests, typecheck, lint, and `build:release`
clean, with the build installed in the owner's test vault.

Smoke matrix: step 1 (fail-closed) passes, step 2 (new session) is the next thing to re-check.

### M2-flips — the first production control records, read (this commit)

The flip's own claims, checked against what it actually wrote rather than what it was designed to
write. Two turns and their bookkeeping now exist in a real vault: 2 session records, 7 run records,
20 transaction intents under `.grimoire/control/`.

**D2 holds.** A run record carries run and session ids, owner, result expectation, state, dispatch
state, terminal with its reason and time, open interaction ids, and sequence. No prompt, no output,
no reference to either. Searching the whole control store for prompt text, `User:`, or the request
reference prefix returns nothing. The line D2 draws — sufficient to establish what happened and who
owns it, insufficient to reconstruct what was said — is where the records fall.

**And one claim of mine was wrong.** Three places said the request reference must be short because
the kernel persists it into dispatch intents and control records. It does not: `requestRef` appears
exactly once in the kernel, in `startRun`'s validation, and in no schema or record. The constraint is
a contract — core carries references, not provider payloads — not a storage rule. The store design is
unchanged and still correct; only the reason given for it was unsupported, and it is corrected in the
source comment, its test, and the entry above.

Also visible: the owner id reaching production as `agytab-…`, which is the per-runtime owner the
composition mints because the construction call site has no conversation to give until M3.

**Smoke matrix, with evidence rather than impression.** Steps 1 and 2 pass, timestamped in the vault
log: a turn refused in 29 ms with `wasSent: false` under Blocked, and a turn that ran 7.6 s and
returned text under Auto-approve. Steps 3 (cancel mid-run), 4 (model selection), and 5 (history
replay across turns) have **no evidence yet** — no interrupted turn appears in any log. Wave 1 is
therefore two-fifths certified, and that is the gate standing between here and wave 2.

### M2-flips — cancel never ended the turn (this commit)

Three of the five smoke-matrix items turn out to be automatable, so they were automated rather than
left to a click. Two were already covered by the end-to-end turn test — model selection asserts the
invocation's `--model`, history replay asserts the replayed prompt. The third, cancel, was not, and
writing it found a defect in **core**, not in the provider.

The registry reduces `cancellation-acknowledged` into a `cancelled` terminal, and then drops the
explicit `terminal` the backend sends next as `ignored-post-terminal` — correctly, the record is
already terminal. The presentation adapter closed only on `terminal`. So the stream saw an event it
ignored, then never saw another: **the generator stayed open forever and the turn never ended.**
Traced by intercepting `registry.ingest` on a hung cancel:

```
run-started               -> accepted
cancellation-acknowledged -> accepted        (record becomes terminal here)
terminal:cancellation-confirmed -> ignored-post-terminal
```

The adapter now treats an acknowledged cancellation as the terminal the registry already made it, and
renders no chunk, because the controller's cancel path says "Interrupted" on its own.

**Not an Antigravity bug.** Claude's recorded trace has the same shape —
`run-started, cancellation-acknowledged, terminal:cancelled:cancellation-confirmed` — so wave 3 would
have hit it identically. It survived M2-adapter because the adapter's own suites deliver a `terminal`
directly and never route a cancellation through the registry's reduction; the two halves agreed with
each other and disagreed with the kernel.

Proven by injection. Gates: unit 457 suites / 7759 tests, integration 6 / 220, typecheck, lint, and
`build:release` clean.

**Smoke matrix now stands at four of five automated or observed**: fail-closed refusal and a real
answered turn are timestamped in the vault log; model selection, history replay, and cancel are
automated gates. What no unit test can prove remains the OS half of cancel — that the `agy` process
tree is actually gone — which needs the live CLI.

### M2-flips — external review of wave 1: one bug, four suggestions, all confirmed (this commit)

**The bug is the one the host was written to prevent, one layer up.** `ExecutionKernelHost`
serializes start against unload, and that is enough only once the host exists. It does not exist for
the whole of `await loadSettings()`, and `onunload` is not withheld until `onload` finishes. An unload
landing in that window found `executionKernelHost` still null, disposed nothing, and the load that
followed opened an acceptance gate for a plugin instance that was already gone — after which the next
reload puts a second registry on the same control store. Exactly the dual ownership the host exists
to prevent, arriving through the gap in front of it.

Fixed with a synchronous flag on the plugin, set first thing in `onunload`, checked before the host is
constructed. `main.ts` gets its first test in the process, which is itself worth recording: the
composition root had no coverage at all, and this is the hazard it most needed.

The four suggestions were all real:

- **the classifier contradicted the code it describes.** `classifyForPresentation` still called
  `cancellation-acknowledged` ignored after `accept` had been taught to close on it. The exported
  function is documented as what the adapter does with each kind, so the next refactor trusting it
  would have restored the hung cancel. Both now say terminal, and a new test asserts the *agreement*
  rather than a hand-kept list: whatever the stream settles on must classify as `terminal`;
- **comments still said "dark".** The adapter's header claimed nothing constructs it, and the nested
  `src/providers/antigravity/AGENTS.md` still pointed at the deleted `AntigravityChatRuntime`. Both
  corrected, and the Antigravity instructions gained the two constraints this wave paid for: read the
  permission mode from the provider's own projection, and pick the login shell's argument-forwarding
  syntax per shell;
- **production comments had turned into a journal.** Several explained how a shape was found and which
  earlier claim was wrong. That belongs here, not in the source; trimmed to the constraint;
- **deleting the legacy runtime deleted coverage with it.** Its suite was the only thing asserting
  that a turn carries current note, context files, excluded folders, and editor, browser and canvas
  selections, and that a prior turn's note is rebuilt from history metadata. The composition suite
  covered only bare text replay, so a regression dropping every context surface would have passed.
  Both cases are ported onto the real invocation and proven by injection.

Gates: unit 458 suites / 7764 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.

### M2-flips — wave 2 survey, and the kernel gap it found (this commit)

Codex is a much larger flip than Antigravity, and the survey is the first deliverable: it names what
has to exist before any wiring, and it found a capability the kernel does not have.

**Steering has no path through the kernel.** Codex declares `supportsTurnSteer: true`, the backend
implements `steer(executionSessionId, requestRef)` and resolves it into `turn/steer`, and the
presentation adapter's `steer` was a stub that **threw** — "arrives with the provider request resolver
at M3". Between them, nothing. The registry had no steering concept at all: no method, no contract
member, no mention. Flipping Codex with that stub would have made a declared capability a thrown
error the moment a user pressed it, and the controller offers the affordance by testing for the
member's presence.

Built end to end in this commit:

- `ExecutionSession.steer?(requestRef)`, optional, opaque. On the session rather than the run because
  the provider decides which run an input belongs to — and because Codex's backend already had
  exactly that method, with that signature. Putting it on `ExecutionRun` collided with its own
  provider-shaped `steer(UserInput[])`, which is how the session turned out to be the right home;
- `registry.steerRun(runId, requestRef)`, which answers `false` for every reason an input cannot
  land — unknown run, terminal, cancelling, provider without the port — because the caller is a
  button and the controller falls back to queueing. It persists nothing and moves no state machine:
  steering is provider input, which D2 keeps out of the control store, and the run was running before
  and after. Deliberately outside the session queue, so input to a run that is answering now is not
  held behind that session's other work;
- the adapter's `steer`, present only when the provider declares steering **and** the host can encode
  an input. Present-but-failing is the shape the UI cannot tell from a capability.

The rest of the wave-2 survey, recorded so the sequence is not rediscovered: the request resolver
must produce Codex's three thread intents (`new`, `resume`, `fork` with rollback), and the backend
already dedupes "thread already loaded" through its own session state, so the legacy three-way branch
does not need reproducing. The interaction bridge — approvals, questions, plan decisions — becomes
reachable for the first time. `features` needs a real history port, unlike Antigravity's empty one.
`supportsImageAttachments` and `supportsInstructionMode` are both true and neither has been exercised
by a flip yet.

Gates: unit 458 suites / 7765 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.
The steering guards are proven by injection.

### M2-flips — the conversation the host could not see (this commit)

The second wave-2 gap, found where the first one was: writing the piece that needs it.

Codex's next dispatch depends on what the conversation remembers — a thread to resume, a fork still
to take — and **the host had no way to learn it.** The adapter's `syncConversationState` narrowed its
argument to `{ sessionId }`, absorbed it for invalidation, and forwarded nothing; `providerState` is
opaque to core by design, so `currentSessionId()` alone cannot express "bound to a thread" against
"carrying a fork that has not been taken yet". Antigravity never noticed: print mode has no session
at all, so its port returns `null` and means it.

`ExecutionChatRuntimeHostPorts.syncConversation?` now forwards the conversation as the caller gave
it. Core still does not read `providerState` — it hands it back to the provider's own host code,
which is the only party that knows what is inside.

**The decision itself is ported rather than reinvented**, because getting it wrong is not a visible
error: a fork downgraded to a resume answers on the wrong thread, and a resume downgraded to a new
thread loses the conversation while looking like a perfectly good reply. `readCodexConversationBinding`
reads the same two places the legacy runtime read, in the same order — a fork counts as pending only
while the conversation has no thread of its own, or a fork already taken would be taken again on every
turn, rolling back to the same checkpoint and answering on a thread the user has never seen. That case
is the one the test suite exists for, and it fails against the obvious wrong version.

`toCodexThreadIntent` stops there. The legacy runtime had a third branch — thread bound and already
loaded in this daemon, so start a turn without resuming — and the backend owns that now, tracking
which thread its own session loaded. Reproducing it here would be a second opinion about state this
module cannot see, and the two would disagree the first time a daemon restarted under a live tab.

Still dark. Gates: unit 459 suites / 7771 tests, integration 6 / 220, typecheck, lint, and
`build:release` clean.

### M2-flips — what a Codex turn may write, extracted and tested (this commit)

The sandbox policy decides which directories a turn can write to, and it lived inside the legacy
runtime as a private method with **no direct test** — reachable only by driving a whole turn through
a daemon. It is the one decision in a turn whose mistakes are not recoverable in either direction: a
writable root too many hands the model a directory the user never offered it, and one too few breaks
editing in a way that reads as the model refusing to work.

`buildCodexTurnSandboxPolicy` is now a pure function with the launch target behind a small port, and
**the legacy runtime delegates to it**. One implementation, not two: an extraction the flip uses
while the runtime keeps its own copy is a drift waiting for the checkpoint that changes one of them.

Extracting it found two ways to get it subtly wrong, both caught before they shipped:

- **the "is this machine POSIX" flag is not the "is this machine local" flag.** The memories
  directory falls back to this process's home only where the target *is* this machine. A single
  flag loses a case each way: a local Windows target is not POSIX but its home is ours, and a WSL
  target is POSIX and its home is not. Written as one flag first, caught by asking what each case
  actually needs;
- **strict and lenient path mapping are not the same port.** The runtime had two helpers — one
  returning the host path when the target mapping says nothing, one raising — and the first draft
  routed everything through the lenient one. That turns a pinned context path the target cannot see
  into a path that will not resolve there, and the turn answers about files it never read. The
  legacy suite caught it: its WSL test went from the specific error to a crash further along.
  Temp directories keep the lenient fallback, because a missing scratch directory is a degradation
  and a missing pinned file is not.

Gates: unit 460 suites / 7778 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.

### M2-flips — what a Codex turn carries, and what it asks for (this commit)

The turn input builder was the last large piece of provider logic private to `CodexChatRuntime`:
prompt, images and skills into `UserInput[]`, plus the parameters that decide what the model is for
this turn — plan mode, orchestrator instructions, effort, service tier, reasoning summary. Neither
half had a direct test. The bundle wrote real files into a real temp directory and could only be
reached by driving a whole turn through a daemon; the parameters are settings the user chose and
expects honoured on the very next turn.

`buildCodexTurnInput` and `buildCodexTurnParameters` are now pure functions — the temp directory
behind a small port, the target mapping behind a callback — and **the legacy runtime delegates to
both**, as it does for the sandbox policy. One implementation, not two.

Three things the extraction turned up:

- **the attachment filename has never been read.** The helper reads `filename`; every caller hands
  it a core `ImageAttachment`, which carries `name`. So every image Codex has ever been given was
  written as `1-image-1.png` — the name the user attached it under never reached the model. Kept
  exactly as it was, because what this checkpoint buys is parity between the two paths, not an
  improvement to one of them; it is an open item below, owned by the flip;
- **"the instructions already went out" had no test.** The legacy suite covers the direction where
  orchestrator rules ride on the turn, and not the direction where they must not — a query that
  already sent them as base instructions on a thread start or resume. That is the branch that
  silently states the worker-plan contract twice in one conversation, and it is now pinned;
- **behind a port, cleanup is no longer free to run twice.** The legacy version re-ran `rmSync` on
  every call and got away with it through `force: true`. A port has no such guarantee, so the bundle
  discards its directory once however often it is asked.

Every new gate was proven by breaking it: sending the prompt before the images, dropping the
"already sent" guard, silently skipping an image the target cannot see, and moving the effort
fallback off `medium` each failed exactly one test, named. The delegation itself is held by the
legacy runtime's own suite, which already covers `turn/start` parameters and image inputs and stayed
green through the swap.

Deleted from the runtime: `EFFORT_MAP`, its copy of `resolveCodexServiceTier`, `toAttachmentFilename`
and its `_toAttachmentFilename` export, the local `ImageAttachment` and `CodexInputBundle` types, and
the three node imports that only the bundle used — 123 lines out, 41 in.

Parity manifest: `CodexTurnInput.ts` is recorded on the `provider-chat-execution` surface beside the
sandbox policy. Worth knowing that this row is documentation rather than a gate — deleting it fails
nothing, because the manifest checks the modules it lists and cannot miss one it does not. What
actually binds the two paths is the legacy suite. No contribution-inventory row moved: row 10 moves
at the flip, not before it.

Gates: unit 461 suites / 7792 tests, integration 6 / 220, typecheck, lint, and `build:release`
clean, review gates and the bundle load/open smoke included. One environment note for whoever
resumes this on another machine: on Node 25 the runtime exposes a `localStorage` object without
`getItem`, which fails 57 unit suites at `getHostnameKey` until jest is run with
`--localstorage-file`. It is not a gate failure, and the new test mocks `@/utils/env` the way the
provider settings suites already do.

### M2-flips — the daemon, and the terms a turn's paths are in (this commit)

The connection factory is what stands between the backend and a running `codex app-server`. Writing
it forced the question the flip cannot avoid: **which target does a turn's paths mean?** Codex runs
either on this machine or inside a WSL distro, and those two disagree about every path there is — the
sandbox roots, the pinned context files, the image attachments just extracted. The launch spec
answers both halves, the CLI to run and what a path means to it, and they have to be the same answer.

So `CodexActiveLaunchSpec` resolves it once and hands everyone the same one, and re-reads only when
the daemon it described is gone — which is also what makes a changed CLI path or WSL distro take
effect on the next connection instead of the next plugin load. A resolution that *failed* is not
remembered: the settings behind it are ones the user can fix, and fixing them must not need a reload.

`NodeCodexExecutionConnectionFactory` puts one application-owned process behind each connection, and
reads the spec when the **process** is created rather than when the connection is. That is not a
detail: `create()` is synchronous and the backend calls it before it has anywhere to report a
failure, so a launch the settings cannot describe has to surface from `initialize()`, where the
backend already retires the connection and fails the run. Moving the read one step earlier — the
obvious shape — was tried as a mutation and failed two tests, one of them by throwing where nothing
catches.

Every gate here was proven by breaking it: dropping the memoization, never invalidating, resolving
eagerly, and removing the exit hook each failed exactly the tests that claim those properties, named.

**A correction to the entry above.** It said the parity-manifest row for `CodexTurnInput.ts` is
"documentation rather than a gate". That is true only of a module that is already reachable. For an
unreachable one the row is load-bearing: `presentationParity › attributes every unreachable module to
a manifest entry` failed on this commit until the new factory was attributed to
`execution-platform-dark`. Both halves of the manifest matter; only the reachable half is redundant
with the import graph.

Gates: unit 462 suites / 7799 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.
The unit suite was re-run after the release build, so the `darkBundle` markers were checked against
the bundle this commit produces: `provider-codex` and the Codex connection are still absent from it,
which is what keeps the new module dark.

### M2-flips — one run, several results (this commit)

The result sink looked like Antigravity's with the names changed, and it is not. A Codex run can
commit **more than one result**: its own answer, and one for every native agent that finishes inside
it. `result-${runId}` — the identity the only existing sink mints, and the one the backend's own test
fake mints — would hand two different answers the same identity, inside the same run. So the identity
is per source: the run's answer keeps `result-${runId}`, and a native agent's is derived from its key.

Derived, not embedded, and that is the second thing writing it turned up. A result id the control
store accepts is a constrained identifier — `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` — while the agent
key is named by the model and reaches us off the wire. `code reviewer`, a path, an emoji, or four
hundred characters all produce a reference the store refuses, which is a run that cannot record its
own result. The test decodes the reference through `executionRunRecordSchema`, so what it checks is
the store's own rule rather than a copy of the regex.

Third: the daemon reports a finished agent on **every** `wait` that observes it, and nothing upstream
de-duplicates. A stable identity plus a content digest is what makes that one result observed twice
rather than a second result quietly replacing the first — and if the content ever does differ under
the same key, the digest is what shows it instead of hiding it.

`projection` is the truthful storage even though Codex keeps a native JSONL transcript. A
`provider-native` reference has to *locate* the answer, and the sink is told only the run — naming a
store it cannot point into would be a claim nothing can act on. The answer is durable twice already,
in the conversation and in Codex's own transcript, and D2 permits the reference, not a third copy.

Gates: unit 463 suites / 7804 tests, integration 6 / 220, typecheck, lint, and `build:release` clean,
with the unit suite re-run after the build so the `darkBundle` markers were checked against it. Each
gate was proven by breaking it: one identity per run, the key embedded verbatim, no digest, and
committing through the cancellation window each failed exactly the tests that claim those properties.

### M2-flips — external review of the Codex wave: one bug, eight more, all confirmed (this commit)

Nine findings against `a725a27..cb5a3c7`, every one of them checked against the code before anything
was changed, and every one real. Three were defects rather than polish.

**The bug: a test that only passed on this machine.** The sandbox suite asserted the whole writable
root list — `['/mnt/c/vault', '/tmp']` — while the policy also appends the host `os.tmpdir()` and
`$TMPDIR`, deliberately leniently. On Linux with the default temp those collapse into `/tmp` and the
assertion is accidentally green; re-run with `TMPDIR=/var/tmp/elsewhere` and it fails, which is what
a macOS or Windows job would have hit. It now asserts what the case is about: the workspace is
writable, POSIX `/tmp` is, and no home-derived memories path was invented.

**The launch spec was retired by any process exit, including one that had already been replaced.**
The backend swaps a lost connection without waiting for the old process to die, so the retired
daemon's exit arrives *after* its replacement is running — on the same spec. Clearing it there means
the next path mapping resolves a fresh spec while the live daemon runs on the old one: the host/WSL
split `CodexActiveLaunchSpec` exists to prevent. It now counts daemons per spec and retires one only
when the last launched from it is gone, and a release belongs to its own spec so a late one cannot
retire a newer.

**The adapter's `steer` was never driven on a live run.** The test that reads as if it did started
the run through the registry and then called `registry.steerRun` directly, so `this.active` plus the
host encoder — the production path — was covered only for the idle `false` case. Driving it properly
failed immediately, and for the reason the reviewer predicted: the conformance host encoded
`steer:${turn.prompt}` and the registry accepts only `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, so a real
queued message with a space in it throws out of `steerRun` — which `InputController` reports as a
failure notice instead of the documented "not accepted, put it back in the queue". The host now mints
an opaque reference the way a real one does, both encode ports say so in their contract, and the
adapter's `?? ''` fallback is gone: the only value it could ever supply is one the registry refuses.

The rest, each fixed:

- the extracted attachment type read `filename` while the chat surface sets `name`. Recorded as an
  open item last checkpoint; fixed here instead, because leaving it would have let the flip inherit
  the mismatch as a contract. Images now reach Codex under the name the user attached them with;
- the factory test used one path for both `spawnCwd` and `targetCwd`, so nothing would have caught
  spawning the daemon in the target path. They differ now, and swapping them fails the test;
- the resume pointer said wave 2 was under way while a paragraph below it still said wave 2 "must not
  start". The rule is restated as **no second flip may land** until wave 1 is certified, with dark
  preparation named as what proceeds meanwhile;
- three "delegated so the two cannot drift" comments in the legacy runtime narrated the extraction
  rather than constraining the code around them. Dropped; the invariant now sits once in each
  extracted module, where the reader who might duplicate it is standing;
- the deterministic fake always had a `steer`, so the registry's "this backend cannot take mid-turn
  input" branch had no test. The fake can be a non-steering provider now, and that branch is covered.

Gates: unit 463 suites / 7809 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.

### M2-flips — the two answers that are not a choice (this commit)

The interaction bridge is where Codex's four server requests become interactions the kernel can
carry, and writing it found the shape mismatch the wave has now met three times: **the kernel takes
identifiers, and two of Codex's answers are not identifiers.**

A command approval can be answered with a policy-amendment *object* —
`{ acceptWithExecpolicyAmendment: … }` — and the legacy runtime carried it as the option's value by
`JSON.stringify`. A response id must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, and the interaction
record decodes every offered id through that rule, so the legacy encoding is one the control store
would refuse outright. A question is worse: its answer is free text the user typed, which can never
be an id at all.

So the id stands for the answer and the answer stays on the provider's side. Amendments become
`amendment-1`, `amendment-2` with the objects held in the bridge; a question offers `answered` and
`dismissed`, and the presenter hands its collected answers back through `submitAnswers` before it
resolves. Both directions are covered: the amendment comes back verbatim as the decision, and the
answers come back in Codex's own `{ id: { answers: [...] } }` shape with blanks dropped, which is the
normalization the legacy router did.

The rest is preserved from `CodexServerRequestRouter` deliberately unchanged: the offered decisions
come from `availableDecisions` with the daemon's three-way default, a network request is described by
the host it wants rather than by the command, an unknown response id declines, a permission grant is
`turn` or `session` by what the user chose and empty otherwise, and every cancellation — a run
already terminal, or Codex resolving its own request — answers with the decline payload for that
method rather than nothing.

Gates: unit 464 suites / 7820 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.
Five mutations, five caught: the amendment carried as JSON the way the legacy encoded it, an unknown
id accepted instead of declined, a denied permission granting what was asked for, the
provider-resolved id left out of the offered ids, and blank answers passed through.

One seam is still stubbed on both sides: the backend's own suite fakes this bridge, and this suite
asserts the backend's rules rather than running them. That is what the end-to-end composition test
exists to close, and it is the next checkpoint — the wave-1 lesson is that a seam both sides stub is
not covered.

### M2-flips — what a queued turn becomes at dispatch (this commit)

`CodexExecutionRequests` is the reference store and the resolver behind it: the runtime puts a turn
in, the kernel carries an identifier, and the backend takes back a full invocation. It is where the
four pieces built above finally compose — the conversation binding into a thread intent, the input
bundle, the turn parameters, and the writable-root policy — and where the rule that everything
ambient is read *at dispatch* is actually enforced.

The turn's own choices are held; the thread it is bound to, the settings, the target the daemon runs
on, and the skills the vault offers are all read when the run resolves. That matters most for the
prompt: a thread being **started** has read nothing, so the conversation so far is replayed into it;
a **fork** has read up to its checkpoint, so only what came after is replayed; a **resumed** thread
holds all of it, and replaying there would hand the model the conversation twice. Three cases, one
place, each with a test.

Two decisions worth naming:

- **the orchestrator instructions are always sent with the turn.** The backend decides for itself
  whether a bound thread still needs resuming, so the resolver cannot know whether base instructions
  went out with it. Being wrong one way states the worker-plan rules twice in a conversation; being
  wrong the other way sends a turn that never states them at all. It answers "not yet sent", which
  buys the mild failure. The narrow case is orchestrator mode on the first turn after a restart;
- **a turn's scratch directory is held until the next turn has one.** The daemon reads the images
  while the turn runs, and nothing in the resolver observes when a run ends. `dispose` — which the
  plugin's unload calls — is the other end of it. Prompt cleanup needs a run-terminal signal the
  composition can subscribe to; that is the composition's checkpoint, not this one.

**The parity gate caught a real leak, and it was mine.** `resolveCodexPermissionMode` was extracted
into this module and the legacy runtime pointed at it — which made a module that imports the backend
reachable from the shipped path, and the walker said so: the backend, the conversation binding, and
the execution connection all became reachable in one edit. It now lives beside the sandbox policy,
which is the file the live path already shares, and the rule it taught is worth keeping: **a module
the flip owns cannot be imported from the path that is still live.**

That move also closed the item the last checkpoint left open — `resolveCodexSandboxConfig` is no
longer a second copy in the runtime — and the delegation is proven: mutating plan mode to ask for
full access fails one test here and four in the legacy suite.

Gates: unit 465 suites / 7830 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.
Five mutations were run; four were caught and one — resolving a reference twice — was not, which was
a property the module documented and no test held. It has one now.

### M2-flips — the answer, in the surface's words and the kernel's (this commit)

The presenter is where an opened interaction reaches the chat surface. The surface speaks the legacy
callback contract — a tool name, an input, a description, a set of decision options — and the kernel
speaks response ids, and this is the piece that holds the two together so neither learns the other's.

The join is deliberately cheap: the decision options handed to the surface carry the kernel's ids as
their **values**, so a picked option comes back as an answer the run can record without a second
mapping table. It works because the bridge's ids were chosen to be the legacy option values already —
`allow-once`, `allow-always`, `deny`, `cancel` — with amendments the one place where a new id had to
be minted.

Three behaviours are preserved from the legacy runtime rather than reasoned from the port's
documentation:

- **a missing callback declines.** The port says an absent presenter leaves an interaction for the
  provider to time out, and that is right for an absent presenter. A present presenter whose surface
  has installed no callback is a different thing: the legacy runtime answered it with a decline, and
  leaving it open would hang the turn on a prompt nobody can see;
- **anything the interaction cannot express is declined**, which is what the legacy mapped an
  unrecognised decision to — and where decline is not on offer it says nothing at all;
- **a picked option that was never offered is declined too.** The registry refuses a response id
  outside the interaction's own list, and a refusal there leaves the approval open rather than
  answering it. That one was found by a surviving mutation: five were run, four caught, and this was
  the property no test held. It has one now.

A question is the case the id model cannot carry on its own: `answered` says only *that* it was
answered, and the answers go back through the bridge before the id is returned, never through the
resolution.

Gates: unit 466 suites / 7838 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.

One gap this opened, recorded rather than papered over: **an interaction Codex resolves itself does
not reach the presenter.** `serverRequest/resolved` settles the pending interaction in the backend
and emits `interaction-resolved`, but the adapter's bridge listens only for `interaction-opened`, so
a surface that is showing the prompt keeps showing it. The legacy runtime had `approvalDismisser` and
`abortPendingAskUser` for exactly this. Owner: the composition, which is where the dismisser is
wired.

### M2-flips — review of the presenter: four hangs and a keying bug (this commit)

Fourteen findings against the presenter, each checked against the code before anything changed. The
serious ones share a shape: **an interaction that is never answered blocks the daemon**, and four
separate paths reached it.

- **a dismissal that nothing else can express.** The surface answers a dismissed prompt with
  `cancel`, and where the daemon offered no refusal `cancel` was not an id this interaction had, so
  the presenter returned nothing and upstream resolved nothing. The daemon says which decisions to
  *offer*; it does not decide whether the user may say no. `cancel` is now always answerable — a
  superset of what is rendered — and refusal falls back deny → cancel → nothing;
- **a surface that throws.** `InputController` rejects when the chat view is detached, and the
  kernel's bridge reads a rejection as a dismissal and resolves nothing. The legacy transport
  answered the daemon with an error; this declines, which is the same outcome for the run;
- **a prompt with nothing to take it down.** A run cancelled mid-approval and a request Codex
  resolved itself both settle in the backend *without* emitting a resolution, so the presenter is
  never called back and the prompt stays up with the composer locked behind it. The presenter now
  holds what is on screen and `dismissAll()` aborts it — including the abort signal the ask-user
  callback always took and never got, which is how the legacy runtime closed a pending question. It
  is the composition that will call it on a run terminal;
- **a `cancel` silently downgraded to `deny`.** Legacy mapped `cancel` to Codex's own cancel, which
  aborts the turn rather than refusing one action. Preserved now for commands and file changes;
  permissions have no turn-level cancel, and refusing there still grants nothing.

The keying bug: `DECISION_RESPONSE_IDS` was keyed by decision and looked up by response id, so the
Allow-once option lost its `decision` field while every other option kept it. One list read both ways
now, which is what the reviewer asked for and what would have prevented it.

Two retention fixes: a presentation is forgotten when its interaction settles — it carries the
command, the working directory, the reason, and whatever was typed into a question — and amendment
ids are scoped to their own interaction, so a stale `amendment-1` cannot resolve a later approval
into a policy change nobody chose there.

The callback join between the adapter and the presenter is now a named `ExecutionInteractionCallbacks`
rather than `Record<string, unknown>` plus casts. It earned itself immediately: typing it turned a
loose test helper into a compile error.

**One finding is recorded rather than fixed.** A missing presentation still answers nothing. It is
unanswerable by definition — there is nothing to show the user, and choosing on their behalf is the
one thing an approval must never do — and with presentations now forgotten only at settle, the
reachable case is an interaction that has already ended and will not be presented again. What is
actually missing is interaction expiry in the kernel, which no provider has needed yet. Owner: M5.

Gates: unit 466 suites / 7851 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.
Six mutations were run against the fixes; four were caught immediately, and two — the cancel fallback
and the throwing callback — were not, which is how the two tests that now hold them were found.

### M2-flips — the composition, and two things it corrected (this commit)

`CodexExecution` is the object every tab runtime and the backend share: the store behind the kernel's
request references, the launch spec the daemon runs under and paths are expressed in, the interaction
bridge, and the presenters subscribed to it. It lives in `src/app/` for the same reason wave 1's does
— the backend takes no plugin and no vault, so everything ambient reaches it as a port constructed
here.

Assembling it corrected two things in the resolver, both invisible until a second caller existed:

- **the conversation is per tab, and the environment is not.** One store serves every runtime, so a
  binding read from the shared environment would answer with whatever tab was last synced. It travels
  with the request now, as a getter rather than a value, because the turn before this one can bind
  the thread between the send and the dispatch;
- **base instructions depend on the turn.** The orchestrator rules belong in the base instructions of
  a thread started for an orchestrator turn, and that is a property of the request, not of the
  settings. The environment takes the mode and answers with the prompt.

It also closes the dismissal gap the review found, and provider-side rather than by changing the
kernel: both endings the surface cannot see — a run cancelled while its prompt is up, and a request
Codex answered itself — reach the bridge's own `cancel`, so the bridge announces a settled
interaction and the presenter takes that prompt down. The composition is what subscribes them.

`dispose` had the order wrong on the first attempt: it dropped the subscriptions before dismissing,
which empties the set it then iterates and leaves every prompt on screen. The test caught it, and it
is the kind of defect that only exists once there is a composition to get wrong.

Gates: unit 467 suites / 7859 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.
Four mutations were run; three were caught, and the fourth — freezing the settings snapshot at first
use — was not, because the test changed the settings before the only dispatch. It reads two turns
now, with the change between them.

**A process note, since the journal is the record.** This entry was written after its commit rather
than in it: the script that appends it failed on a stale anchor and the commit went out anyway. It is
amended into the same commit, which is what the rule asks for, and the lesson is that a journal
appended by a script needs the script's exit code checked.

## Current blocker

**Single resume pointer. Everything below this line is the current state; nothing above it
overrides it.**

Active branch: `providers-migration`. Last synced with `main`: 1.1.7 (`0f84b41`).

Completed: **M0a** (parity gate, contribution inventory, adapter contract, the two contract suites,
topology and shared-resource records, persistence decisions), **M1** (execution kernel, narrow
control-record persistence, local-shell internal backend, cross-platform CI with Windows
process-tree conformance green), **M2-proofs**, **M2-adapter**, and **M0b** for the four proof
providers. In progress: **M2-flips** — wave 1 (Antigravity) shipped and running in production, wave 2
(Codex) under way.

**M2-proofs.** Four topologies proven dark — Antigravity (stateless process-per-run),
Codex (persistent daemon, multiplexed sessions), Claude (persistent SDK stream, serial runs), and
OpenCode (managed ACP subprocess) — each with an execution backend, a `ProviderModule` on the M1
contract, a settings codec, a capability descriptor, the shared conformance suite, and a trace
fixture, with `executionSemanticFreeze.test.ts` binding modules to traces as the exit gate.

The four proofs cost the M1 contract four defects, none of which review had found: a settings-blind
model presentation, a `reconcile` result no provider could fill, a rewind capability with no port,
and static feature contributions that made context-dependent ports unfillable. Each was invisible
until a provider that needed it was written, which is the argument for four proofs rather than one.

Every gate is green, CI included, on all four jobs. The Windows failure that closed the previous
session is fixed and confirmed; it was two defects, one production and one in the test, recorded in
the entry directly above.

**M2-adapter is complete.** Its stop condition — the kernel had no channel for streamed output —
was decided by the owner in favour of a transient content event, and that is built: `output-delta`,
excluded from persistence, projection, and deduplication, plus `registry.observe()` so the adapter
can be a client of the registry. Three backends stream through it.

**M2-flips wave 1 — Antigravity — is wired and every automated gate is green.** The kernel is
constructed at load and disposed at unload, chat execution for Antigravity runs through the adapter
over its backend, and the legacy runtime is deleted. This is the first checkpoint that **changes
production behaviour**: the kernel is in the bundle, the control store is written under `.grimoire/`,
and revert safety now has a test rather than an argument.

A whole turn is now covered end to end — the runtime stores a request, the registry dispatches its
reference, the backend resolves it into an `agy` invocation, and the print output comes back as a
chunk — over a fake process runner. That test found three defects the per-half suites could not, one
of them fatal to every turn; they are in the entry above.

**Wave 1's remaining gate is one manual check.** Four of the five smoke-matrix items are automated
gates or timestamped in the vault log; what is left is the OS half of cancel — that the `agy` process
tree is actually gone — which needs the live CLI.

**Wave 2 (Codex) is under way, and the next action is the runtime half of the composition.**

Done so far. **Dark** means unreachable from the running application and proven by injection;
**shared** means the legacy runtime delegates to it, so it is in the production bundle already:

| Piece | Where | State |
|---|---|---|
| A steering path through the kernel — it had none, and the adapter's `steer` threw | `ExecutionSession.steer?`, `registry.steerRun`, adapter `steer` | dark |
| The conversation binding the next turn depends on, and the host port that carries it | `CodexConversationBinding.ts`, `ports.syncConversation?` | dark |
| What a turn may write, extracted from the legacy runtime, which now delegates to it | `CodexTurnSandboxPolicy.ts` | shared |
| What a turn carries and what it asks the model to be, extracted the same way | `CodexTurnInput.ts` | shared |
| The daemon behind a connection, and the launch spec whose terms its paths are in | `NodeCodexExecutionConnectionFactory.ts` | dark |
| Where an answer lives once the turn is over, one identity per result rather than per run | `CodexProjectionResultSink.ts` | dark |
| What the user is asked, and what Codex is told they said | `CodexInteractionBridge.ts` | dark |
| What a queued turn becomes at dispatch, and the reference the kernel carries for it | `CodexExecutionRequests.ts` | dark |
| How an opened interaction reaches the surface, and comes back as an id the run can record | `CodexInteractionPresenter.ts` | dark |
| What the backend and every tab runtime share, assembled from the running plugin | `CodexExecutionComposition.ts` | dark |

**Next, in this order.** First the runtime half of the composition: `createRuntime`, the host ports
over it — `prepareTurn`, the request and steer references, `syncConversation`, the interaction
presenter, `describeFailure` — and the module's workspace context, which the flip's registration has
to build from the workspace services. Then an end-to-end turn test over a fake connection **written
before the flip rather than after**, and only then the flip itself: registration, `main.ts`, the
parity manifest, the `darkBundle` markers, and the deletion of `CodexChatRuntime`.

One loose end remains from the request resolver: a turn's scratch directory is discarded when the
next turn has one, rather than when its run ends. The composition now has the presenter subscription
that shows how to do better — a signal from the thing that knows — but nothing yet watches run
terminals.

Two things to carry into that work. Codex declares `supportsImageAttachments` and
`supportsInstructionMode`; no flip has exercised either, so neither has ever been proven through the
adapter. And the wave-1 lesson holds: **a seam both sides stub is not covered** — the end-to-end
composition test is what found every fatal defect in wave 1, and it found them only because it ran
before the flip was trusted.

Antigravity declares no resume, plan mode, rewind, fork, images, provider commands, MCP tools, or
steering, so those five items are the whole matrix. Until it passes, wave 1 is wired but not
certified, and **no second flip may land** — the point of one provider per checkpoint is that the
first one is proven against a live CLI before the pattern is repeated eight times. What proceeds
meanwhile is wave 2's dark preparation, which changes no production behaviour and is revertible as
commits; the Codex flip waits on wave 1's certification. An earlier version of this sentence said
wave 2 "must not start", which the wave-2 table above contradicted.

**M0b is satisfied for the four proof providers**, recorded from live CLIs on the owner's machine.
The remaining five providers need their own recordings before their own flips.

Open obligations, each with an owner:

- **a Codex result reference cannot be resolved back to the turn that produced it.** The sink is
  given the run and nothing else, so it commits a `projection` reference; Codex's own JSONL could
  locate the answer, and the backend holds the thread and turn ids it would take, but does not pass
  them. Nothing resolves a result reference today, which is why this is recorded rather than built.
  Owner: M5, with result provenance;
- **the Windows process-ownership gate is flaky, and a flaky gate is worth less than none.**
  `CodexPersistentProcessOwnership.integration.test.ts` failed on a **documentation-only commit**
  (`634fe7c`) — the descendant did not publish its pid within 15s — and passed on re-run of the same
  commit, with the three commits before it green on identical code. So it is timing on a shared
  Windows runner, not a regression. Worth noting before changing the number: this bound is 15s while
  the local-shell equivalent waits 5s, so raising it further without measuring what the wait actually
  costs would be guessing. The gate this weakens is the one M2-flips depends on most — process
  ownership on every desktop platform — and treating a red Windows job as noise is how a real
  failure gets waved through. Owner: wave 2, before the Codex flip, since that is the provider whose
  ownership this test covers;
- **the wire recordings show nine Codex notifications, two OpenCode session updates, and four Claude
  message types that no backend consumes**, including the ones carrying plan indicators, token usage,
  and raw response items. Pinned in `wireVocabularyCoverage.test.ts` so the gap cannot grow. Owner:
  each provider's flip;
- **five providers still need wire recordings** — MiMoCode, Kimi Code, Grok, Qwen, Gemini — each
  before its own flip. Owner: M2-flips, per provider;
- **awaiting an owner decision: redo.** Recorded as D9 in the persistence decisions. Re-running a
  request is free and needs no new state; undoing a rewind cannot be built on the control store,
  because D2 forbids a second copy of a provider transcript without exception, and the file backup
  is discarded after a successful rewind. Which of the two the product wants is the open question;
- the provider backends that carry them must absorb the UTF-8 stream decoding (`utf8Stream`) and
  Grok transcript recovery semantics that landed on `main` after the v1 baseline. Owner: the Grok
  and ACP backends, at their harvest;
- D7 (diagnostic redaction) has no automated guard. Owner: M1 follow-up, once the kernel emits log
  records;
- `ProviderModule` has no slot for `prepareTurn`, which the adapter contract maps as a module
  contribution. The adapter routes it through a host port meanwhile. Owner: M3, when the four legacy
  prompt encoders move;
- four `ChatRuntime` members are absent by contract, each with its reason in
  `adapterMemberCoverage.test.ts`: `reloadWorkspaceResources`, `getAuxiliaryModel`, and the two
  subagent loaders. `resetSession` was on that list with a false reason and is now implemented.
  Owner: whoever declares a call site for one of the four;
- the kernel and adapter carry long explanatory comments where a sentence would do. Owner: a focused
  pass, so it does not ride along with behaviour changes;
- three `src/core/**` modules import the plugin type, enumerated in
  `executionCompositionBoundaries.test.ts`. Owner: M3, when the provider catalog replaces the split
  registries. **The eight core→provider imports previously listed here did not exist** — they were an
  artifact of a gate that matched specifiers as text; see the M2-adapter correction above.

Standing rules that outlive any milestone:

- the old runtime path is frozen for new product features; `ChatRuntime` gains no members, enforced
  by the freeze test. Bug fixes are allowed and must be absorbed by later harvested slices;
- milestones are **not** merged to `main`, per the owner's decision. The mandatory mitigation is to
  sync `main` into the branch at every milestone gate and whenever `main` ships a release, recording
  the synced commit in that checkpoint's entry.
