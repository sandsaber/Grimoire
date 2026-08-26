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
| M0b — golden traces (amortized; 4 topologies before freeze, rest at their flip) | **Complete** — all nine wire recordings taken. Three are `partial` because their accounts cannot open a session, and each says so in the file | `7f8dfaa`, plus this commit |
| M1 — execution kernel, dark-launched | Complete | `dca2f84`, `cc6081e`, `ec1303f`, `86f0585`, `a689af8` |
| M2-proofs — four topology proofs, dark | Complete — Antigravity, Codex, Claude, OpenCode | `e1ab910`, `2e46a87`, `5a5acad`, `4d844e0`, `bff6132`, `1a931c5` |
| M2-adapter — presentation seam, proven without a flip | Complete | `4f206d1`, `6133097`, `48a61a4`, `e7e754c`, `f69daaa`, `7e2c5cc`, `47b1fe5`, plus review fixes `f0c6114`, `1ead161` |
| M2-flips — nine production flips with legacy deletion | **Complete** — all nine providers execute through the kernel and every `*ChatRuntime` is deleted. Certification is account-bound, not code-bound: Antigravity 2/2 and wave 1–3 certified, Gemini one turn per replenishment, MiMoCode/Kimi Code/Qwen not certifiable on this machine. Every provider has a live harness and a matrix that says when it last ran | wave 1: `e06417b` … `a725a27`; wave 2: `0151961` … `e056871`; wave 3: `3df7a3a` … `f8c4ad2`; wave 4: `3b01158` … this commit |
| M3 — one validated provider inventory, and an owner for provider workspaces | **Complete**, at a revised scope the owner approved: the catalog owns provider identity, ordering, enablement, capability gating, environment-key ownership, shipped defaults and preloaded context files, and a workspace manager owns both halves of the workspace lifecycle. The thirteen remaining rows are re-implementations rather than moves and went to M5 with their consumers, along with registry deletion, lazy initialization, the generation fence and the settings transaction coordinator | `0dd3580`, `928a3c9`, `6cf0045`, `6a4d341`, `99aee54`, `5d17e85`, `6b822c5`, `9ea3e1c`, `5175d37`, `11750e8`, this commit |
| M4 — revisioned persistence in production | **Complete** — conversation writes go through the record store and carry only what the writer changed, and history hydration answers a typed outcome that the conversation itself now shows | `4cf12a1`, `77f896d`, this commit |
| M5 — presentation evolution, provider rows, and seam deletion | In progress — **the auxiliary checkpoint is complete**: every provider runs auxiliary work on the kernel except Claude's, which is cold by design, and all five runners are deleted. Bang-bash mode runs on the kernel and the local-shell backend is live. Projections, durable agents and the seam deletion are untouched, and M3 handed over thirteen provider rows plus registry deletion | `fa9cfbc`, `d07e083`, `c471618`, `0308871`, `0284420`, `02f8855`, `1e55bac`, `feb292c`, `3d6be12`, `69128ec` |
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

### M2-flips — the runtime half, and the defect the end-to-end turn found (this commit)

`createRuntime` puts the adapter over this composition: `encodeCodexTurn` for the prompt, the request
and steer references into the shared store, the conversation held per tab, the interaction presenter
reading its callbacks late, and the bound thread as `currentSessionId`. With it, a whole Codex turn
runs through the kernel over a fake connection — the runtime stores the turn, the backend starts a
thread and a turn, the answer streams back, and the second turn joins the thread the first one bound.

**And that test found what the flip would otherwise have shipped: approvals reach the surface, are
answered, and the answer never gets back to Codex.** `CodexExecutionBackend` is also the interaction
and recovery port, and `registerBackend({ backend })` wires neither. The registry then refuses the
resolution with "backend has no interaction resolution port", the presentation adapter swallows that
refusal by design — the registry is the authority on why a resolution failed — and the daemon waits
forever on a request the user already answered. Wave 1 never met it: Antigravity has no interactions
and no recovery.

The fix is `createBackendRegistration`, which returns the backend and both ports together, so the
flip has one call to make and nothing to remember. The test that found it is the first thing in this
wave to drive an approval end to end: the daemon raises it, the surface is asked, the answer becomes
a response id, and `{ decision: 'accept' }` reaches the fake.

Three more mutations were run against the runtime half, and all three initially **survived** — the
first version of the end-to-end test proved only the happy path. Each now has a test: the conversation
must reach the store (or a bound tab silently starts a new thread), the prompt must be the prepared
one and not the persisted text (they differ whenever a turn carries context), and the presenter must
read its callbacks late (the tab installs them after the runtime exists).

Gates: unit 467 suites / 7863 tests, integration 6 / 220, typecheck, lint, and `build:release` clean.

**What remains before the flip**: the module's workspace context — the sixteen methods
`codexProviderModule.features` needs, built from the workspace services — and then the flip itself.
`createRuntime` takes the contributions as a parameter for exactly that reason: what the provider
contributes to the UI is registration's business, not execution's.

### M2-flips — CI was red on two platforms, and the local gate could not see it (this commit)

Three runs failed on `windows-latest` and one on `macos-latest`, starting at the composition
checkpoint. Both failures are in the tests I wrote, not in what they test:

- **`cwd: '/vault'`** — the launch spec expresses the vault directory the way the platform writes it,
  so Windows produced `\vault` and the assertion wanted a POSIX path. It reads `path.normalize`
  now, which is the same statement in a form that is true everywhere;
- **`Codex target mismatch: expected windows, received linux`** — the fake connection reported a
  Linux daemon while the launch spec resolved for the host, and `createCodexRuntimeContext` refuses a
  daemon whose platform disagrees with the target it was launched for. The fake stands in for a
  daemon launched *on this machine*, so it reports this machine. The guard it tripped is doing its
  job: a daemon on another OS means every path in the turn is expressed for the wrong target.

**The process correction matters more than either fix.** Four checkpoint entries above say "gates
green" and mean *green on Linux*: `npm run test` here runs one platform, and this branch's CI runs
three. The gate line in an entry will name that from now on, and the check after pushing a checkpoint
is `gh run list`, not the local suite. Wave 1 recorded a Windows-only defect for the same reason; this
is the second time the branch has learned it, which is what makes it worth writing down rather than
just fixing.

Gates: unit 467 suites / 7863 tests, integration 6 / 220, typecheck, lint clean **on Linux**; the
Windows and macOS jobs are what this commit is for, and their result is the gate.

### M2-flips — what the module can answer about a tab (this commit)

The last piece before the flip is the module's own context: sixteen methods that let
`codexProviderModule` reach the provider's services without taking a plugin itself. Nearly all of it
is delegation to things that already exist — the command catalog, the agent mentions, the model
options, the plan usage store, the settings tab renderer — but two decisions are not.

**A runtime answers for its own conversation and no other.** The history contribution is asked about
a conversation *id*, and the only conversation a runtime has is the one the adapter syncs into it.
Answering for another id would report a thread belonging to a different tab's daemon session, so an
id that is not this tab's gets `null`. That is also why the context is built inside `createRuntime`,
closing over the same conversation the ports sync — and why the workspace slots, which depend on no
conversation, are built once per plugin load instead.

**`syncConversationState` is typed as a binding and handed a whole conversation.** Core narrows it to
an id, a session, and an opaque provider state; the object the tab passes is the conversation itself,
and provider code may read the provider's own fields. Hydration needs the whole thing, so the context
checks the shape rather than assuming it: a caller that really syncs a hand-built binding gets
`absent` instead of a hydration that reads fields that are not there.

Two smaller notes. The per-turn questions — the session id and whether a fork is pending — are
answered from the conversation binding rather than from the history service, because a binding is
exactly what a session id is and they are asked on every turn. And where the workspace services are
not registered, every slot answers as a provider with nothing to offer: an empty list is what an
unregistered workspace has, and it is not an error.

Gates: unit 468 suites / 7869 tests, integration 6 / 220, typecheck, lint, and `build:release` clean
**on Linux**; CI's Windows and macOS jobs are the rest of the gate. Three mutations, three caught.

**Next is the flip itself**: `registration.ts` pointing `createRuntime` at the composition, `main.ts`
constructing it and registering the backend with its interaction and recovery ports, the parity
manifest and `darkBundle` markers moving, and `CodexChatRuntime` deleted in the same commit.

### M2-flips — the Codex flip is ready except for what the surface renders (this commit)

Every piece the flip needs exists and is green: the composition, the runtime over it, the backend
with its interaction and recovery ports, and an end-to-end turn that runs through the kernel over a
fake connection. What is not ready is the **chat surface**, and checking that before landing is the
product invariant doing its job.

The legacy runtime's notification router produces seven chunk kinds: `text`, `thinking`, `tool_use`,
`tool_result`, `progress`, `context_compacted`, and `user_message_start`. The kernel path produces
**one** — `output-delta`, as assistant text or reasoning. Everything else the backend observes it
emits as a *fact*: `tool-activity` carries a tool call id and nothing else, `progress` and the
native-agent events carry no payload, and `classifyForPresentation` marks all of them `ignored`, in
its own words because "tool and native-agent rendering needs the provider payload the kernel
deliberately does not carry, so those surfaces move with the chat projections at M5".

So flipping Codex today would ship a Codex chat that streams the answer and the reasoning and shows
**no tool calls, no tool results, no diffs, no plan updates, and no compaction notice** — for the
provider whose surface is mostly those. Wave 1 never met this: `agy --print` has no tool surface at
all, which is exactly why it was chosen first.

This is the shape of the obligation already recorded above — "the wire recordings show nine Codex
notifications that no backend consumes, including the ones carrying plan indicators, token usage, and
raw response items. Owner: each provider's flip" — arriving at the flip that owns it. It is bigger
than it read: it is not nine unread notifications, it is the whole tool surface.

Three ways forward, and the choice is the owner's:

1. **Land the flip and declare the regression.** Revertible as a commit, and the smoke matrix would
   record what is missing. Honest, but it makes the product worse for as long as M5 takes;
2. **Carry the payload first.** A content event that carries the provider's tool payload — the
   kernel has one content channel by an M2-adapter decision, and this is the second provider proving
   that channel too narrow. Then the adapter maps it to the chunks the surface already renders. This
   reopens a contract that was declared complete, which is the honest reading of a defect the fifth
   proof found;
3. **Flip Codex after the projections.** Keep the legacy runtime, take M3/M5 first, and flip when the
   surface the kernel feeds is the one the UI reads.

Nothing is landed by this commit. The branch state is unchanged except for this entry, which is the
resumable form of "the flip stopped here and why".

### M2-adapter reopened — a second content channel, because a turn says more than text (this commit)

**Owner's decision on the flip blocker: carry the payload first.** So the contract declared complete
at M2-adapter is reopened, which is the honest reading of a defect the fifth provider found: its one
content channel is a string, and the surface a real provider renders is tool calls, their results,
plan updates and compaction boundaries.

`provider-content` is that channel. It carries the provider's item **opaquely** — core never reads it,
for the same reason it never reads a `requestRef` — and reaches the surface through a new host port,
`presentProviderContent`, which turns one item into the `StreamChunk`s the chat already renders.
Absent for a provider whose turn is text; the item is then dropped rather than guessed at.

It is transient on the same terms as `output-delta`, and that is the part worth stating: never
persisted, never reduced into a projection, never deduplicated. A tool call is not a fact about the
run — the committed result is — and D2's rule that a control record must stay insufficient to
reconstruct what was said holds only if the tool payload never lands in one.

What changed: the event kind, `isTransientExecutionEvent`, `classifyForPresentation` (the exhaustive
switch caught the omission before any test did), the host port, and the run stream that consults it.
Three mutations, three caught: persisting the item, never consulting the presenter, and classifying
it as a fact.

Gates: unit 468 suites / 7871 tests, integration 6 / 220, typecheck, lint, and `build:release` clean
on Linux; CI covers Windows and macOS.

**Next**: the Codex side of it — the backend forwarding the notifications its router already knows how
to normalize, and the host port running that normalization — then the flip. The legacy
`CodexNotificationRouter` is the thing that produces those chunks today, so the flip's job is to keep
it, not to reimplement it.

### M2-flips — second external review: one bug, four suggestions, all confirmed (this commit)

**The bug: one scratch slot for the whole plugin.** A turn's images are freed when the *next* turn is
resolved — but the store serves every tab, and steering resolved through it too. So a turn in one tab
freed the pictures another tab's daemon was still reading, and steering a turn deleted the images of
the very turn it was joining. The journal's "held until the next turn" hid both, and the test held
only the case it described.

Retention is per tab now, and steering adds to the set rather than replacing it — which is what the
legacy runtime did: it cleared its bundles at the start of each query, and its query was one tab's.
Two tests were added for the two paths that were wrong.

The four suggestions, each real:

- **the sandbox never learned where the daemon keeps its transcripts.** The composition computed the
  sessions root for the reconciler and did not pass it to the turn, so a plan-mode turn invented
  `~/.codex/memories` — wrong under a custom `CODEX_HOME`, and impossible for a WSL target, where the
  policy then granted no memories directory at all and Codex silently forgets. The handshake's own
  answer is now remembered once and used by both;
- **an externally dismissed approval read as the user cancelling the turn.** Dismissing resolves the
  surface's prompt with nothing, the input controller reports that as `cancel`, and `cancel` aborts
  the whole turn in Codex. The approval path now watches the same abort signal the question path
  already did, and answers with nothing;
- **the callback store was typed on the reading side only.** Typing it on the storing side found two
  keys the presenter could never have read — `permissionModeSync` and `subagentState` — which is
  exactly the failure the type was added to prevent;
- **the `output-delta` comment still said it was the only content-bearing and only transient event**,
  one commit after `provider-content` joined it.

**A method note worth more than any of the fixes.** Two mutations "survived" while proving the
sandbox fix, and both were silent no-ops: the edit script's `replace` matched nothing and said so
nowhere. A mutation that does not apply is a gate that reports itself green for the wrong reason —
the same class of mistake as the parity check that measured nothing, recorded at M2-adapter. Every
mutation edit asserts its match from here on; the two that mattered were re-run that way and both
failed the tests, as they should have.

Gates: unit 468 suites / 7875 tests, integration 6 / 220, typecheck, lint, and `build:release` clean
on Linux; CI covers Windows and macOS.

### M2-flips — the tool surface, carried by the code that already draws it (this commit)

The Codex half of `provider-content`. The backend forwards every notification of its own turn as an
opaque item, and the host runs `CodexNotificationRouter` — the thousand lines that already know how a
Codex tool call, its result, a plan update and a compaction boundary are rendered — over exactly
those items. The flip keeps that code rather than writing a second opinion about it, which is the
same reasoning that made the sandbox policy and the turn input shared rather than reimplemented.

Two things had to be decided rather than copied:

- **what the kernel already carries must not be rendered twice.** The assistant's deltas and the
  reasoning's arrive neutrally as `output-delta`, so the router's copies of those are dropped. The
  filter is **by notification, not by chunk type**: a plan delta is also a `text` chunk and it is the
  only copy of the plan there is, so filtering by type would have silently emptied plan mode. That is
  the failure the by-type version had, and a test now holds it;
- **reasoning had no text at all.** The backend emitted `thinking-activity` — a sign of life — and
  dropped what the model was thinking. It now emits it on the reasoning channel, which is what the
  neutral channel was for.

The frozen Codex trace changed, deliberately: every case that carried a notification now shows the
`provider-content:<method>` that carries it, immediately before whatever that notification produced.
The summariser names the method rather than the kind, because a trace recording only
"provider-content" would freeze the fact that something was forwarded without freezing what.

Four mutations, four caught — including "filter every text chunk", which is the plan-mode failure
above, and "let the mirrored text through", which is the doubled answer.

Gates: unit 469 suites / 7882 tests, integration 6 / 220, typecheck, lint, and `build:release` clean
on Linux; CI covers Windows and macOS.

**Next is the flip**, and the surface it lands on is now the one the legacy runtime draws: an
end-to-end turn through the kernel renders the tool call, its result, and the answer. What is still
missing is turn metadata — usage and model — which the router reports to a listener the adapter has
no port for; that is the "token usage" half of the wire-coverage obligation and is not a rendering
regression.

### M2-flips — wave 2: Codex in production (this commit)

The second flip, and the first one on a provider with a surface. `createRuntime` returns the
presentation adapter over the Codex backend, `main.ts` constructs the composition at load and
registers the backend **with its interaction and recovery ports**, initializes the workspace slots
once, and disposes the composition before the kernel at unload. `CodexChatRuntime` is deleted in the
same commit — 1,403 lines, with the 2,642-line suite that drove it — along with two helpers the flip
orphaned: `CodexServerRequestRouter` (the interaction bridge and presenter answer server requests
now) and `CodexSessionManager` (the backend tracks its own thread). 5,049 lines out.

Only the chat-execution row moves. Workspace services, settings, the three auxiliary workflows,
history, and the UI config are untouched, per the mixed-authority rule that holds until M5 — and
Codex's auxiliary services each run their own app-server process, so the rule's one hard requirement,
that the two paths never contend for the same session or process, holds by construction.

**How the flip is proven, and by what.** The pieces answer different questions, and no one of them
would have caught a flip that only half happened:

- `ProviderRegistry` builds an `ExecutionChatRuntimeAdapter` for Codex — the row moved. Breaking it
  (a registration returning a plain object) fails exactly that test and nothing else;
- `provider-codex` and the Codex connection are **live** bundle markers now instead of dark ones.
  Both states have been observed: absent before this commit, present after, each asserted by the same
  gate in the direction that applied;
- an end-to-end turn runs through the kernel over a fake connection and renders the tool call, its
  result, and the answer — which is the whole reason the two commits before this one exist;
- the parity manifest moves fourteen modules from `execution-platform-dark` to
  `provider-chat-execution`, and the reachability gate found the two orphans above by itself.

**Landed on the owner's instruction, before wave 1's manual certification.** The rule above says no
second flip lands until Antigravity's smoke matrix passes; the owner directed this one anyway, and
that is recorded here rather than quietly worked around. What it costs is that two providers now run
on the kernel with neither certified against a live CLI, and both flips are one commit each to
revert.

**Codex's smoke matrix is the one that matters**, and it is much larger than wave 1's: resume across
a restart, plan mode, fork with rollback, images, skills, approvals and questions, native agents,
steering, compaction, and cancel's OS half. Until it runs, this is wired and not certified.

One known gap, not a rendering regression: **turn metadata — usage and model — is still lost.** The
router reports it to a listener the adapter has no port for, so the plan-limit indicator and the
model line will not update from a turn. It is the "token usage" half of the wire-coverage
obligation, and it is now the flip's own item rather than a general one.

Gates: unit 466 suites / 7,762 tests, integration 6 / 220, typecheck, lint, and `build:release`
clean on Linux, with the unit suite re-run against the built bundle so the live markers were checked
against what ships; CI covers Windows and macOS.

### M2-flips — review of the flip: four bugs, and the wire it shipped with (this commit)

The flip landed with a connection thinner than the runtime it replaced. Four bugs, four suggestions,
all confirmed; the first is the one that mattered.

**The live wire was cut to eleven notifications while the renderer handles nineteen.** The eight
missing ones carry streamed command output, patch updates, raw response items, plan updates and token
usage — most of what a Codex turn shows after its first sentence. Both halves were right about their
own list, which is why no test noticed: the connection subscribed to what the *backend* acts on, and
the renderer switched on what it can draw. The list is derived from the renderer's now
(`CODEX_ROUTED_NOTIFICATION_METHODS`), so it cannot drift again, and a test states the union the
connection must deliver.

The other three:

- **the plan-limit badge could not be fed.** Its reader and its `account/rateLimits/updated`
  subscription both lived in the deleted runtime, so every refresh answered "no reader". Both are
  rebound per connection now, which is also the only correct lifetime: a reader pointed at a dead
  daemon answers nothing;
- **a reasoning summary was rendered twice** — as the progress widget the router draws and again as
  thinking text, because the backend mirrored *both* reasoning notifications onto the neutral
  channel. Only the reasoning text is mirrored now;
- **a failed turn printed two errors**: the daemon's own message from the renderer, and the kernel's
  terminal. The renderer's error and its `done` are dropped — `done` would have ended the surface's
  turn before the result was committed — and the daemon's words are kept and returned through
  `describeFailure`, so the one error that is rendered is the one Codex sent.

The suggestions, each real: `turn/started` was never forwarded, so the renderer never reset its item
tracking between turns and plan mode was never switched on; a closed tab's scratch waited for a turn
that never comes, which a `cleanup` override now releases along with any prompt that tab was showing;
and `/compact please` silently compacted instead of being refused, which the resolver refuses again.

**And the wire gate had the defect it exists to catch.** `wireVocabularyCoverage` scraped the
connection's source for quoted method names; once the list was composed rather than written out, the
scraper saw four literals and called the other fifteen unmodelled. It reads the value now. The
recorded Codex gap drops from nine notifications to six — hooks, MCP startup status, remote control,
the whole raw response, and a thread-start the backend learns from its own RPC results.

Gates: unit 467 suites / 7,772 tests, integration 6 / 220, typecheck, lint, and `build:release` clean
on Linux; CI covers Windows and macOS. Codex's manual smoke matrix is still what certifies the flip,
and this is the second time a review has found what only a live daemon would have shown — the wire
gap would have been the first thing the matrix hit.

### M2-flips — the flaky Windows gate, measured at last (this commit)

The commit above went red on `windows-latest` and green on a re-run of the same commit, on the same
test the journal has been carrying as an open obligation: the persistent process descendant did not
publish its pid within 15s. This time it was measured rather than re-run and forgotten.

**The numbers.** The whole ownership suite takes **11.2–11.8s** on a green Windows job, and it makes
five launches — one in the first case and four launch forms in the second. So a launch typically
costs **two to three seconds**, against a per-launch budget of 15s. The failure was therefore not a
launch running slightly long: it was one launch stalling past five times its normal cost while the
other four in the same run were fine. That is a shared-runner stall, and it is why raising the number
is guessing — the journal said so before there were numbers, and the numbers agree.

**Where the two seconds go, and why it is not only a test problem.** Every Windows launch compiles
the job guardian: a C# source string handed to `Add-Type`, which runs the CodeDom compiler before the
child is spawned at all. A Codex daemon start on Windows pays it too, once per launch, and so does
every local-shell run. Caching the compiled assembly — `Add-Type -OutputAssembly` once, keyed by a
hash of the source, `-Path` afterwards — would take the cost out of both the product and the test,
and shrink the window in which a stalled runner can miss the deadline.

It is **not** done here, and deliberately: it is Windows process-ownership code that cannot be
exercised on this machine at all, so every iteration is a CI push, and getting it wrong breaks the
one guarantee this gate exists to protect. Owner: a checkpoint of its own, before the next provider
with a persistent daemon flips. Until then the gate stays as it is, and a red Windows job on this
test is re-run **once** and investigated if it repeats — recorded here so the next person does not
rediscover the measurement.

### M2-flips — the flip broke forking, and nothing failed (this commit)

Looking for what the smoke matrix would hit first turned up a live defect the flip shipped:
**`assistantMessageId` stopped being an id the daemon knows.**

The tab copies that field onto the assistant message, and a fork asks Codex to resume at it. The
legacy runtime reported the native turn id; the adapter derives it from the committed result
reference instead — `result-run-…`, minted by the result sink. So a fork forks the thread, looks for
its checkpoint among the thread's turns, finds nothing, and throws. Every automated gate stayed green,
because each half is right on its own terms: the sink mints a truthful reference, and the adapter
reports the identity it has.

The fix is a host port, `consumeProviderTurnMetadata`, merged over what the adapter derives. Some of
a turn's identity is not the kernel's to know: the native id is what the provider's own fork and
rewind address. Codex fills it from the renderer, which already reports the turn id and whether a
plan turn completed — the listener that had nowhere to go when the flip landed, recorded then as
"turn metadata is lost". It is not lost now, and it was never only a badge.

The token-usage half of that same note fixed itself with the wire: `thread/tokenUsage/updated` is
delivered again, the renderer turns it into the `usage` chunk the context indicator reads, and the
presenter passes it through untouched.

Two mutations, two caught — the adapter ignoring the provider's reading, and the presenter never
listening for it.

**And the matrix itself is written**: [`docs/codex-flip-smoke-matrix.md`](codex-flip-smoke-matrix.md).
Twenty-two rows derived from what Codex declares — persistent runtime, native history, plan mode,
fork, images, instruction mode, steering, interactions — with the reason each one needs a live daemon
rather than a fake connection, the two known wire gaps that should explain nothing in it, and the
instruction to record the outcome here. Fork is row 15; without this commit it would have been the
first row to fail.

Gates: unit 467 suites / 7,773 tests, integration 6 / 220, typecheck, lint, and `build:release`
clean on Linux; CI covers Windows and macOS.

### M2-flips — wave 2 against a live daemon: row 1, and what it found (this commit)

The smoke matrix has two halves — what the daemon does and what a person sees — and the first half
does not need a person. `CodexLiveSmoke.integration.test.ts` drives the flipped path against a real
`codex app-server` (CLI 0.147.0, ChatGPT account), off unless `GRIMOIRE_CODEX_LIVE=1`, because it
starts a CLI and spends the account's tokens. `GRIMOIRE_CODEX_TRACE=1` prints the daemon's own
notifications beside the chunks, which is how the findings below were read rather than guessed.

**Row 1 answers, and three things it proves that no fake could.** The daemon starts, the thread is
created, the turn runs, and the answer comes back — with the reasoning summary as its widget, the
token usage as the chunk the context indicator reads, and `assistantMessageId` equal to the **native
turn id**, which is the fork fix from the entry above, confirmed against the real thing.

**And row 1 fails, on a defect that only a real turn produces: the answer is rendered three times.**
`["user_message_start","progress","progress","assistant_message_start","text:ok","text:ok","text:ok","usage","usage"]`
— every content chunk doubled, and the text tripled. What is established:

- the daemon sends each notification **once** (the wire trace confirms it);
- the backend emits each event **once**, with a unique delivery id;
- the presenter is asked to render the same notification **twice**, and every call arrives through
  `ExecutionRunStream.accept`, which is the registry's observer;
- the same doubling reproduces in the unit composition harness, so it is not a live-only artifact and
  a test can hold it without a CLI;
- transient events are deliberately **not** deduplicated by delivery id, which is why facts survive
  this unharmed and content does not — the terminal, the result and the interactions are all correct.

What is **not** established is which of the two delivery paths is the duplicate. The registry
consumes a run through `consumeRunEvents` *and* subscribes to its session, and both flipped backends
push each event to the run queue and publish it to the session in the same `emit`. That is the
suspect and it is one line in each backend — but Antigravity ships the same shape, so a fix that is
wrong here is wrong in production twice, and this session had spent its budget for a careful one.

Owner: the next checkpoint, before any further rows are run. The live harness stays, with row 1's
duplication assertion left **failing on purpose**: it is the reproduction, and it will pass when the
defect is fixed.

The matrix runs on **`gpt-5.4-mini`**, which is what this account's `~/.codex/config.toml` already
selects and what the harness now defaults to: the rows are about the path, not the answer, and every
run spends tokens. `gpt-5.3-codex-spark` is not the cheap option — a ChatGPT account refuses it
outright ("not supported when using Codex with a ChatGPT account"). The refusal was useful anyway: a
model the daemon rejects arrives as a `systemError` thread status and an `error` notification, and
the surface showed **nothing at all** for it. That is worth a row of its own, and row 21 now says so.

The duplication is identical on both models, so it is not a property of what the model streams.

Gates: unit 467 suites / 7,773 tests, integration 6 / 220 plus the live suite skipped, typecheck,
lint, and `build:release` clean on Linux.

### M2-flips — the answer, once (this commit)

The duplication row 1 reproduced is fixed, and it was the kernel's, not either backend's.

**What the evidence said.** The daemon sends each notification once and the backend emits each event
once, with a unique delivery id. The registry consumes a run through `consumeRunEvents` *and*
subscribes to its session, so an event pushed to the run queue and published to the session arrives
twice — which the kernel already knew: `deduplicates cross-stream delivery and persists exactly one
terminal` has been a registry test since M1, and the fake backend's delivery destination defaults to
`both`. Cross-stream delivery is a permitted backend shape, and the kernel's job is to collapse it.

**What it did not do was collapse content.** Transient events skipped the delivery-id set entirely,
on a stated assumption — "a backend emits each delta once and never redelivers it" — that
cross-stream delivery makes false. The reason for skipping was real, though: a turn's worth of deltas
would evict the bounded set that protects facts from redelivery.

So transient content now has **its own** window, sixty-four ids deep. A cross-stream twin arrives one
event after its sibling, so that is all the window has to outlast, and it churns at token rate
somewhere the facts are not. Both properties are tested: the twin is refused, and two hundred deltas
later an old delta is accepted again while the fact ids from before them are still remembered.

The rule this replaces was written down, which is what made it correctable rather than folklore. The
test that stated it now states the corrected one and says why.

**Live, row 1 is green**: `["user_message_start","assistant_message_start","text:ok","usage"]` — one
answer, one usage, against `codex app-server` on `gpt-5.4-mini`. And because the fix is in the
kernel, **wave 1 is fixed too**: Antigravity has been publishing on both streams since its flip, so
its streamed answer was doubling in production exactly the same way, unnoticed because print mode
delivers its output in one delta.

Gates: unit 467 suites / 7,774 tests, integration 6 / 220 with the live suite green when enabled,
typecheck, lint, and `build:release` clean on Linux. The mutation that removes the transient window
fails exactly the test that claims it.

### M2-flips — eight rows of the matrix, run live (this commit)

The live harness now drives eight rows against a real `codex app-server` on `gpt-5.4-mini`. Seven are
green; each of the three that were not found a defect the automated gates could not.

| Row | What it drives | Result |
|---|---|---|
| 1 | a plain message | green — one answer, one usage |
| 2 | a command | green — `tool_use:Bash`, then its output as a `tool_result` |
| 6 | `/compact`, then `/compact please` | green — the first compacts, the second is refused locally |
| 8 | an approval the sandbox forces | green — `Execute: /usr/bin/bash -lc "printf 'yes' > …"`, allowed, and the file written |
| 12 | a plan turn | green — the plan streams, and nothing is reported as failed |
| 16 | stop mid-answer | green — the turn ends rather than hanging |
| 21 | a model the daemon refuses | green — one error, in the daemon's words |
| 14 | resume in a fresh daemon | **open** — see below |

**Three defects, each user-visible, each fixed here.**

- **a compaction was reported as a failure.** The kernel demands a result of every run, and a
  compaction answers nothing by design — so `/compact` ended with "the provider ended the turn without
  producing a result". A plan turn failed the same way for a different reason: its answer arrives as a
  plan notification rather than as a message, so nothing is committed as a result. `resultExpectation`
  is a host port now: a compaction produces none, a plan turn's is optional, everything else is
  required;
- **a model the daemon refuses ended the turn silently.** The daemon's `error` notification carries no
  thread id, so it was dropped before reaching any run; the turn then died with the daemon and was
  reported as `interrupted`, which the surface renders as nothing at all. An unscoped error now
  reaches the running turn and fails it, and the message it carries is the one shown;
- **a conversation could never learn its thread id.** `currentSessionId` read the conversation's own
  binding, which is empty until a finished turn writes it — and what writes it is `currentSessionId`.
  Circular: every turn would have started a new thread, so resume and fork could never work at all.
  It falls back to the thread the daemon is actually on, which is what the deleted runtime reported.

**Row 14 stays open, with its symptom recorded.** Resuming a thread in a *fresh* daemon — a restart —
leaves the run `indeterminate`: `thread/resume` succeeds and the thread goes active then idle without
the turn ever running, and the surface shows "Grimoire could not establish whether this run
completed". The assertion is left failing on purpose, the way row 1's duplication was, because it is
the reproduction. Owner: the next checkpoint, and it is the row that matters most — resume is what a
persistent-daemon provider is for.

Two smaller observations for whoever runs the manual half: a tool result is emitted again at the end
of a turn (the renderer flushes pending raw outputs on `turn/completed`), which the surface may or may
not dedupe by id; and the model reaches for the vault's `AGENTS.md` unprompted, which is Codex being
Codex rather than anything the flip changed.

Gates: unit 467 suites / 7,774 tests, integration 6 / 220 with the live suite green except row 14,
typecheck, lint, and `build:release` clean on Linux.

### M2-flips — a review of the live fixes, and a correction to the entry above (this commit)

A review of the previous commit found fourteen things, and the first of them corrects the journal.

**The correction.** The entry above says "an unscoped error now reaches the running turn and fails
it". The fan-out that was supposed to do that is **dead code**: a run drops any notification whose
params carry no thread id, so an unscoped error never reaches it. What actually made live row 21
green is the other half of that change — the `error` branch in `applyNotification`, reached the
normal way, because a real daemon error *is* scoped: the wire shows
`{"error":{…},"willRetry":false,"threadId":"01a01670-…","turnId":"01a01670-…"}`. The fan-out is
removed rather than repaired, for the reason the review gives: it delivered to every session, so once
it worked it would have failed every other tab's in-flight turn on one tab's error.

**Two more real defects, both fixed:**

- **the thread id leaked into the next conversation.** `currentSessionId` falls back to the thread the
  daemon is on, which is how a conversation learns its own — but the presenter never forgot it, so a
  tab that started a new chat reported the *previous* conversation's thread, and the new conversation
  would have been saved pointing at it and silently continued it. The presenter forgets its
  conversation when the tab syncs a different one;
- **a failure was rendered in the previous turn's words.** The captured message was never cleared, so
  a turn that fails without the daemon describing it showed the last error the daemon *did* describe.
  Cleared at `turn/started`.

**And the testing rule, which the review was right to call.** Three production fixes shipped with
their only coverage in a suite that CI never runs. They have CI tests now: a daemon error fails the
turn and interrupts it; a retryable one does neither; the session id is reported and then forgotten
with its conversation; and a compaction and a plan turn are not asked for a result.

Two smaller ones taken: the compaction rule moved into the adapter, because `isCompact` is a
provider-neutral property of a prepared turn and every provider that flips next would otherwise
rediscover it; and the plan-mode predicate is written once rather than twice.

The live harness was leaking: a row that threw left its daemon and its temp vault behind, and row 16
cancelled on a wall-clock timer that could fire before the turn was dispatched. Every row now releases
its daemon in `afterEach` and row 16 waits for the turn to actually be saying something — it cancels
mid-count now, which is the case it exists for.

**Row 14 is green.** Its failure was the harness, not the product: the first daemon still held the
thread, so `thread/resume` answered "already has an active writer". A restart takes the daemon with
it, which is what the harness now does — and the resumed thread remembers the word. **Eight of eight
live rows pass.**

Left open, with the review's reasoning recorded: plan mode returns a blanket `optional`, so a plan
turn that genuinely produces nothing reads as a silent success. The renderer already tracks
`sawPlanDelta`, which distinguishes the two, but it is known only after the turn while the
expectation is declared before it — closing that means committing the plan itself as the result.
Owner: the next provider that flips with a plan mode, or the projection work at M5.

Gates: unit 467 suites / 7,778 tests, integration 6 / 220, the live suite 8 / 8 against a real
daemon, typecheck, lint, and `build:release` clean on Linux.

### M2-flips — wave 1's last row, and the version of it that proved nothing (this commit)

Wave 1's fifth smoke-matrix item was the one no fake could answer: after a cancel, is the `agy`
process tree **actually** gone. It is now a headless gate against the real CLI, in
`tests/integration/app/execution/antigravity/AntigravityLiveSmoke.integration.test.ts`, skipped
unless asked for because it starts a CLI and spends the account's tokens:

```bash
GRIMOIRE_ANTIGRAVITY_LIVE=1 node scripts/run-jest.js --selectProjects=integration \
  --runTestsByPath tests/integration/app/execution/antigravity/AntigravityLiveSmoke.integration.test.ts
```

`GRIMOIRE_ANTIGRAVITY_CLI` points at a binary other than `agy` on `PATH`, and
`GRIMOIRE_ANTIGRAVITY_MODEL` sends a `--model`; with neither, the CLI picks what the account is
configured for. Nothing below the composition is stubbed — the production backend, over
`NodeAntigravityProcessTransport`, over a real login-shell launch — and the process tree is read from
`ps` rather than from the runner that is supposed to have killed it. Run through
`scripts/run-jest.js`, not bare `npx jest`: the runner passes `--localstorage-file`, without which
every suite that touches provider settings fails on this Node.

**The first version of the row went green with process termination disabled.** Written the obvious
way — ask for a long answer, cancel mid-stream, assert the tree is gone — it passed against a
`terminate` that had been patched to signal nothing at all. `agy` had simply finished on its own
inside the window the assertion allowed, so the row was measuring the model's speed, not the
kernel's cancel. It would have certified wave 1 while proving nothing.

The fix is to make a natural exit impossible rather than unlikely: the turn now asks for
`sleep 120` as a tool call, so the tree that must disappear contains a descendant that will still be
running two minutes later. That also makes the tree a tree — root plus child, the noun the row is
about — where the earlier version only ever saw one process. Recorded live:
`agy --dangerously-skip-permissions …` and `sleep 120` under it, both gone after the cancel.

Proven by breaking it. With `NodeLocalShellProcessAdapter.terminate` returning `confirmed` without
signalling, the row fails with `the agy tree to disappear did not happen within 20000ms`; with the
real code it passes in ~18s. Row 1 — a plain message answered live, and nothing left running after a
turn that ends by itself — runs beside it, so a green cancel row cannot be green because no CLI was
ever launched.

Windows is excluded and says so: ownership there is a job object rather than a process group, and
`ps` is not how that is read. That half of the row stays a person's check, and it is the same
guardian the open obligation below is about.

**Wave 1 is certified.** All five smoke-matrix items are now automated gates or timestamped in the
vault log, and the last one is a gate rather than a memory of a terminal window.

Gates: unit 467 suites / 7,778 tests, integration 6 / 220, the Antigravity live suite 2 / 2 and the
Codex live suite untouched, typecheck, lint, and `build:release` clean on Linux.

### M2-flips — the job guardian compiles once now, and CI is the only proof (this commit)

The Windows guardian is C# handed to `Add-Type -TypeDefinition`, which ran the CodeDom compiler
**before the child was spawned at all, on every launch** — measured two entries above at two to three
seconds a launch against a 15s budget, which is latency a Codex daemon start and every local-shell
run pay, and the reason that gate goes red on a stalled runner. It is compiled once now, to
`%LOCALAPPDATA%\Grimoire\job-guardian\guardian-<fingerprint>.dll`, and loaded from that file
afterwards.

**The fingerprint is of the C# this build embeds**, so a guardian that changes is a different file
rather than a stale one: the cache can never serve a guardian this build did not write. Per-user by
preference — `LOCALAPPDATA` before `TEMP` and `TMP` — because the assembly is loaded into the process
that owns other processes, and a path other accounts can write to would be a place to put something
else. An environment that names none of the three yields no path at all, and that launch compiles in
the session exactly as before.

**Every step is allowed to fail, and each failure lands on today's behaviour.** A cached assembly
that will not load, a directory that cannot be created, a compiler that does not know
`-OutputAssembly`, a second process that won the race to the same path — the script ends with the
same line in all of them: compile the source in this session. The one failure this may never cause is
a guardian that did not start, because that is the guarantee the whole file exists to protect.

Two details that are not decoration. The compile goes to a staging file and is *moved* into place, so
a half-written DLL never appears at the path another launch is loading from and the loser of a race
keeps the winner's copy. And because that move refuses to overwrite, a cached file that will not load
is **removed** when the load fails — otherwise a corrupt assembly would make every later launch pay a
compile and never repair itself.

**What is proven, and where.** This machine cannot run the guardian and has no PowerShell to so much
as parse the script, so the unit tests pin what is readable here: the path resolution and its
fallbacks, the fingerprint in the file name, the order of the script, the quoting of a path with an
apostrophe in it, and — the assertion that matters most — that the last line still compiles in the
session. Proven by breaking it: dropping that line, or the move's own `try`, turns the suite red. The
real question is answered by two new Windows-only cases in
`CodexPersistentProcessOwnership.integration.test.ts`: a cold launch writes the assembly and a warm
launch does not rewrite it — mtime, not a clock — and a junk file planted at the cache path still
starts a guardian and is repaired. Both launches report their durations and **assert nothing about
them**: building a gate on a shared runner's clock is the disease this checkpoint is treating.

**Unverified until a Windows job runs it.** Nothing above has executed on Windows; the local gates
are green on Linux and CI is the proof. The 15s budget in that suite stays as it is until CI says
what a warm launch costs — raising or lowering it before there is a number would be the guessing the
measurement entry already refused.

Left alone deliberately: guardian assemblies from earlier builds stay in the directory, a few
kilobytes each, changing about as often as the C# does. Pruning them would mean deleting a file a
concurrently running build may have loaded, for a saving nobody can measure.

Gates: unit 467 suites / 7,784 tests, integration 6 / 222, typecheck, lint, and `build:release` clean
on Linux.

### M2-flips — the first Windows job, and a cache that failed in silence (this commit)

The guardian cache went to CI and the Windows job answered in one round: **the assembly was never
written**. The guardian started, every ownership assertion passed, and
`C:\Users\runneradmin\AppData\Local\Grimoire\job-guardian\guardian-e85184f105564580.dll` did not
exist. The floor held — which is the property the previous entry cared most about — and the
optimization did nothing at all.

**Why it could fail silently is the finding.** The branch was written in cmdlets — `Test-Path`,
`Split-Path`, `New-Item`, `Remove-Item` — and a cmdlet that fails *non-terminatingly* is not caught
by `try`. PowerShell writes the error to the stream and carries straight on, so the branch could
neither succeed nor report; it ran to the end, found no type, and the last line compiled in the
session exactly as designed. A design whose failure mode is invisible is a design that cannot be
debugged from a CI log, and this one proved it on its first run.

Rewritten in .NET calls — `[IO.File]::Exists`, `[IO.Directory]::CreateDirectory`, `[IO.File]::Move`,
`[IO.File]::Delete` — with `-ErrorAction Stop` on the two `Add-Type` calls that remain. Those throw
where the code says `catch`. `Split-Path` is gone, and it is the most likely author of the original
silence: its `-LiteralPath` and `-Parent` are not obviously one parameter set, and a null directory
explains every symptom the job showed.

**And the diagnosis is now a gate rather than a guess.** A new Windows-only case runs the guardian
preamble in a real `powershell.exe`, twice, and reads back what it did: `CACHE`, `TYPE`, `COMPILED`,
and every message in `$Error` — including the ones the script caught, because `$Error` keeps them.
The cold run must write the cache and have the type; the warm run must have the type **without
compiling**, which is the fact a stopwatch can only hint at on an idle machine. Both runs report
their duration and neither asserts on it. `$compiled` is a line in the production script for this
reason, and it is the only thing the diagnosis added to it.

The launch-based cases stay: they prove the *production launch path* uses the cache, where this one
proves the script does.

Gates: unit 467 suites / 7,785 tests, integration 6 / 223, typecheck, lint, and `build:release` clean
on Linux. Windows CI is the proof, and this is the second push at it.

### M2-flips — the guardian cache is green on Windows, and the number reframes the flake (this commit)

Three Windows jobs: the first found the cache silently doing nothing, the second was green with the
rewrite, and the third measured the thing properly. From the third, on `windows-latest`:

| | time |
|---|---|
| first compile on the machine | **6,939ms** |
| loading the cached assembly | **402ms**, `COMPILED: False` |
| compiling again, compiler already warm | **510ms** |
| whole guarded launch, warm | **515–628ms** |

**The second measurement was wrong and is corrected here.** The diagnostic first ran third in its
file, after two launches had already compiled in the same runner, and reported "cold 538ms, warm
427ms" — a warm `csc.exe` wearing the word cold. Run first, the same code reports seven seconds. The
case now runs first for exactly this reason, and reports three numbers instead of two so the one-time
cost cannot hide inside the per-launch one.

**What the split means.** Almost all of it — about 6.4 of the 6.9 seconds — is machinery that happens
once on a machine: `csc.exe` starting, the compiler's own assemblies loading, whatever scans a
freshly written DLL. The compile itself, once that has happened, is ~510ms, and loading the cached
assembly instead is ~402ms.

So the cache is worth about **100ms a launch**, not the two to three seconds the entry that motivated
it estimated — *and* it takes the compiler out of the product's path permanently after the first run,
which is the part that actually matters: the 6.9 seconds recurs on a machine whose compiler has gone
cold again, and a user who never compiles never pays it twice.

**It also reframes the flaky gate, and this is the finding.** The suite's earlier measurement —
11.2–11.8s for five launches, "two to three seconds each" — decomposes now as one launch paying ~7s
and four paying ~1s. The stall that missed a 15s deadline was therefore almost certainly **the first
launch**, the one paying the cold compiler, with 8s of margin left for a shared runner to lose. Not
five equal launches with one unlucky.

That is fixed by where the diagnostic sits rather than by the budget: running first, it compiles and
writes the cache, so every timed case after it launches without a compiler in the path at all. The
15s budget stays as it is — a warm launch is ~600ms against it — and it now guards a launch that no
longer contains the seven seconds it was flaking on. Whether that is enough is a question CI answers
over the next several runs, not one this entry can close by assertion.

**A second runner, a second number.** The next Windows job reported cold **3,217ms**, warm 391ms,
recompiled 510ms. So the first compile is not one figure but a range — 3.2 to 6.9 seconds between two
runners of the same image — while the warm load and the warm recompile barely move. That variance is
the flake: a cost that swings by three and a half seconds inside a fifteen-second budget is what a
stalled runner turns red, and it is now paid once per machine instead of once per launch.

Gates: unit 467 suites / 7,785 tests, integration 6 / 223, typecheck, lint, `build:release` clean on
Linux; CI green on all four jobs at `102c965`, Windows included.

### M2-flips — third external review of the flip: eight items, eight real (this commit)

A review of the Codex flip slice (`21e831d`..`a65bdc9`) found three bugs, three suggestions and two
nits. Every one held up when checked against the code, and the two most serious were reproduced as
failing tests before anything was changed.

**The transient window was sized on an assumption that is false for this backend.** Content ids were
remembered sixty-four deep, on the reading that a cross-stream twin "arrives one event later". That
holds only while the two streams take turns. A backend pushes onto the run queue and publishes to the
session in the same call, and the run stream is drained by an async iterator — so a *synchronous*
burst (a buffered-notification flush, or one stdout chunk readline turns into many lines) ingests
every session copy first and the run copies a whole burst later. A registry test that emits two
hundred deltas on both streams reproduced it: `burst-0` was delivered twice, which is the
answer-duplication the window exists to stop.

Fixed by making the rule exact instead of approximate. Two streams means two deliveries, so the twin
is the **last** copy that can arrive: an id is remembered when first seen and **retired by its twin**.
The set now holds only what has been delivered once, drains as the second stream catches up, and its
bound — a thousand ids — is a backstop for a one-stream backend rather than the mechanism.

**A `turn/started` that outran its own RPC was dropped.** It is handled before the buffer and
forwarded only once the turn id is known; for a normal turn that id arrives with the `turn/start`
result, and the daemon may announce the turn first. It was not buffered either, so the renderer never
learned a turn began — plan mode stayed off and the previous turn's item tracking leaked into the new
one. Compact never hit it because its path may establish the turn from the notification. It is
buffered now, like every other scoped notification, and `establishTurn` replays it. The existing test
waited for the RPC before notifying, which is exactly the case that works.

**`/compact please` was refused in the resolver's words and rendered in the kernel's.** The resolver
throws "`/compact does not accept arguments`"; the run finishes `pre-dispatch-rejected`; the adapter
says "The turn was rejected before it started, so nothing ran." The sentence a user can act on was
inside the throw. The store now records the refusal against the reference it was refused under, the
tab remembers the reference it last minted, and `describeFailure` reads it back for that terminal —
the same shape wave 1 used for its fail-closed refusal, one step earlier.

The rest: the plan-usage reader is cleared on dispose (identity-checked, because the store is
process-wide and a later connection's reader is not ours to clear); the transient comments no longer
claim content is undeduplicated, which is the stale rule that made sixty-four look sufficient; live
row 16 now asks `ps` whether the daemon is gone after the unload, proven by removing the shutdown and
watching it go red; and two comments name code that no longer exists or sit on the wrong function.

**Row 16 is the review's sharpest point, and it is the same lesson as wave 1's cancel row**: a row
named for a process being gone must look at the process. It could have passed with a
`codex app-server` still running.

One item in the review is already answered: it records the Windows job guardian as unproven on a
Windows job, which was true of the slice it read. Three CI rounds since then proved it — and found
that its first version wrote nothing at all — in the entries above.

Gates: unit 467 suites / 7,789 tests, integration 6 / 223, the Antigravity live suite 2 / 2 and Codex
live row 16 green against a real daemon, typecheck, lint, and `build:release` clean.

### M2-flips wave 3 — Claude's dark half, and what it found missing (this commit)

The backend half of Claude's composition is built and unreachable: `ClaudeExecution` binds the dark
`ClaudeExecutionBackend` to the running plugin, `ClaudeExecutionRequests` holds what the kernel's
references stand for, and `ClaudeProjectionResultSink` commits a reference rather than a second copy
of a transcript. `registration.ts` still points at `ClaudeChatRuntime`; nothing constructs any of
this.

**Two reference spaces, one store**, which is the shape this provider forces. The kernel carries a
`requestRef` and hands it back at dispatch; the SDK query factory carries a `startupRef` and hands it
back when it actually builds `Options`. Both resolve against the same object, because a reference
minted against one store resolves to nothing in another — the defect wave 1's end-to-end turn found
on its first run, and the reason this checkpoint starts with that test rather than ending with it.

**The restart fingerprint is `QueryOptionsBuilder.needsRestart`, expressed as a value the kernel can
carry.** Model, permission mode and effort are deliberately outside it: those are the dynamic updates
the SDK applies in place, and folding them in would restart the query for a change it can absorb.

**One whole turn runs end to end, with the SDK's own `query` as the only fake in the path.** A
reference minted here, dispatched by the kernel, resolved into an invocation, started as a query
whose options were built from this vault's live settings, answered, committed, terminal. The options
assertion is the point: `cwd` and the MCP disallow-list come from the plugin at dispatch, not from
anything the reference carried.

**What the exercise found is what is missing, and each item is now a flip blocker:**

- **the backend emits `output-delta` and nothing else.** It was harvested at M2-proofs, before
  `provider-content` existed — that channel was added during wave 2 — so a flipped Claude tab would
  render text with no tool cards, no plans, no results around it. Wave 2 solved the same problem by
  carrying the provider's items through the kernel opaquely, and wave 3 owes the same;
- **and therefore the native session id never reaches the tab.** The SDK announces it in a `system`
  message the backend consumes and keeps to itself; the session snapshot carries it into the control
  store, but the adapter reports `currentSessionId()` *into* the registry rather than reading it out.
  A conversation that cannot learn its session cannot resume or fork — so the content surface is not
  cosmetic, it is what makes the provider's headline capability work;
- **interactions are refused.** The bridge denies every tool request with a sentence that names why.
  Fail-closed and useless, on purpose: a composition wired up before its approval surface exists must
  refuse work rather than approve it silently;
- **auxiliary work is refused** for the same reason — titles, refinement and inline edits still run
  on the legacy services until M5 — and **reconciliation answers `unknown` with effects possible**,
  which is what makes the kernel refuse to re-dispatch a run nobody watched finish.

The runtime half is the next increment: `createRuntime` needs the provider module's feature context —
history hydration, rewind, task-result interpretation — which is the tab-facing surface rather than
the execution one.

Gates: unit 468 suites / 7,791 tests, integration 6 / 223, typecheck, lint, and `build:release`
clean. The three new modules are declared in the parity manifest as `execution-platform-dark`, so the
gate asserts they stay out of the bundle until the flip.

### M2-flips wave 3 — Claude's content surface (this commit)

The gap the dark half found is closed. `ClaudeExecutionBackend` now forwards every message it accepts
as `provider-content`, and `ClaudeContentPresenter` turns those messages into the chunks a tab draws.
Both are still dark.

**One call site, before anything is read out of the message.** The backend consumed several kinds
itself — a subagent's tool call, the task notifications, the `init` that names the session — and
those never reached the run at all, so a per-branch forward would have missed exactly the messages
the surface most needs. It forwards at the top of `routeMessage`, after the session-identity gate,
with its own dedup set: the one `handleMessage` keeps is for the facts it derives, and sharing it
would make the first reader hide the message from the second.

**The presenter runs the code the legacy runtime rendered with.** `transformSDKMessage` already knows
how a Claude tool call, its result, a subagent, a plan and a usage report are drawn, proven against
real transcripts, so the flip keeps it rather than writing a second opinion.

**The answer arrives twice and is rendered once.** The SDK reports it as deltas while the turn runs
and whole in the assistant message; the backend mirrors the deltas as `output-delta`, which is the
copy core can read. The presenter drops the streamed text and thinking, records that they arrived,
and drops the assistant message's copy only when they did — a turn answered in one message still
renders. That is the provider's own documented rule, kept.

**Two things no chunk carries, and both are capabilities rather than decoration:**

- **the session id.** The adapter reports the tab's answer to `currentSessionId()` *into* the
  registry rather than reading the backend's, so before this a Claude tab could not learn the session
  the SDK put it on: no resume across a reload, and nothing to fork from. The presenter captures it
  from `system/init` and from any message that carries one;
- **the assistant message id**, because a fork asks the SDK to rewind to it. Wave 2's live matrix
  found precisely this defect after its flip — a fork resuming at an id the daemon had never
  minted — and it is recorded here before wave 3 can repeat it.

`EnterPlanMode` gets a port of its own: the SDK approves that tool itself, so `canUseTool` never
fires and the tool call in the stream is the only sign the turn began planning.

Still owed before the flip: **interactions** — the bridge still refuses every request — and the
**runtime half**, which is what constructs this presenter per tab and wires `presentProviderContent`,
`currentSessionId` and the plan-mode callback to it.

Gates: unit 469 suites / 7,800 tests, integration 6 / 223, typecheck, lint, and `build:release`
clean. The presenter is declared dark in the parity manifest; the backend's forward is proven by
removing it and watching its test go red.

### M2-flips wave 3 — Claude's interactions, and the two that are not questions (this commit)

The refusing bridge is gone. `ClaudeInteractionBridge` turns Claude's tool permission requests into
interactions the kernel can carry, and the composition wires it. Still dark.

**Three kinds, which are the legacy handler's three branches kept.** `ExitPlanMode` is a plan
decision, `AskUserQuestion` is a question, everything else is an approval. `EnterPlanMode` is absent
because the SDK approves that tool itself and it never reaches a permission callback at all — which
is why the content surface, one entry above, watches for it in the stream instead.

**Two of the requests are policy rather than questions, and the contract now says so.** A tool
outside the allow-list a query was started with, and a read-only MCP tool the vault trusts in normal
mode, were both answered by the legacy handler without anyone being asked. Preparing an interaction
for either would put a prompt on screen with exactly one possible answer, so `prepare` returns
`{ kind: 'resolved', result }` and the backend answers with it: no interaction is opened, so nothing
has to be shown, settled, or cancelled when the run ends. That is a change to the bridge contract,
made because the alternative was a prompt for behaviour that has not changed.

**The id stands for the answer, and the answer stays here.** The kernel accepts only constrained
identifiers as responses, and two of Claude's answers are not: a question is answered with structured
selections, and a refused plan carries the words it was refused with. So the presenter hands what it
collected back through the bridge under the same reference the resolution names — the shape wave 2
settled on for the same reason.

Details worth keeping, each from the handler being replaced: an approval that is denied is **not** an
interruption, and a plan refused with feedback is not either — the model is being told what to change
and the turn goes on; an approved plan sets the session's mode through `updatedPermissions` *and*
tells the surface, or the toolbar keeps showing the mode the turn started in; a response id the
interaction never offered is denied rather than guessed; and the `Skill` tool passes an allow-list
that does not name it, because a skill is how a query reaches the tools it was allowed.

`AskUserQuestion` gets the option the SDK documents and does not inject: its own JSDoc says "Other
will be provided automatically" and nothing adds it, so Grimoire — which renders this prompt itself —
has to, exactly as the CLI would have shown it.

What is still missing before the flip is the surface that *shows* an interaction: the presenter that
puts one on screen and hands back what the user chose belongs to the tab, and therefore to the
runtime half, which is the next increment.

Gates: unit 470 suites / 7,812 tests, integration 6 / 223, typecheck, lint, and `build:release`
clean. The bridge is declared dark in the parity manifest.

### M2-flips wave 3 — Claude's runtime half, and the port whose absence hangs a turn (this commit)

`ClaudeExecution.createRuntime()` exists. A tab prepares a turn, the kernel dispatches it, the SDK
answers, and what comes back is what the surface draws — proven by a composition test that runs a
whole turn with the SDK's own `query` as the only fake and asserts three things at once: the text,
the tool card the presenter makes from the message carried beside it, and the session id the tab now
knows it is on. Still dark; `registration.ts` still points at `ClaudeChatRuntime`.

**The finding is a port, and it was found by a test that hung.** A backend registered as
`{ backend }` alone opens interactions nobody can answer: the registry refuses to resolve an
interaction for a backend that declared no resolution port, the SDK's `canUseTool` waits on a
permission for ever, and the turn never ends. The registration is `{ backend, interactions: backend,
recovery: backend }` — the same three the Codex flip registers — and the approval test is what
surfaced it, by deadlocking on its first tool rather than failing an assertion.

Three per-tab objects and one shared, which is the division this provider forces. The **content
presenter** and the **interaction presenter** are per tab, because one tracks a turn's streamed text
and the session the tab is on, and the other owns a prompt that belongs to the tab that raised it.
The **interaction bridge** is shared, because a control record carries an opaque reference to a
presentation and the presentation itself is held where the reference resolves.

**What a turn resumes is read at dispatch, not when it was queued** — a turn waiting behind another
must resume the session that one created. The order is the provider's own: a fork before its first
turn, then the conversation's session, then the session the presenter watched arrive. The last
fallback is what makes a *new* conversation work at all: it learns its session mid-turn, and the
record that would carry it is written only after that turn ends.

The module's feature context is wired from services that already exist — history hydration, session
resolution, pending-fork, task-result interpretation — and its rewind reaches the backend, which owns
the SDK query the files are restored through. Its **workspace** slots are not wired and say so by
throwing their own name: Claude's workspace is still registered the legacy way, its flip is a
separate checkpoint, and a settings surface that silently lists nothing is worse than one that fails
where it was wired.

**Wave 3's dark half is now complete**: request store, result sink, content surface, interactions,
and the runtime over them. What remains is the flip itself — `registration.ts` and `main.ts`,
`ClaudeChatRuntime` deleted in the same commit, and a capability-driven smoke matrix that for Claude
is the longest of the three so far.

Gates: unit 470 suites / 7,814 tests, integration 6 / 223, typecheck, lint, and `build:release`
clean. The three new modules are declared dark in the parity manifest.

### M2-flips wave 3 — Claude in production (this commit)

`registration.ts` points `createRuntime` at the composition, `main.ts` constructs it and registers
the backend **with its interaction and recovery ports**, and `ClaudeChatRuntime` — 1,969 lines — is
deleted in the same commit along with the four helpers that existed only for it: the approval
handler, the message channel, the session manager, and the dynamic-update applier. Three providers
now execute through the kernel.

**The certification order was overridden deliberately, and it is recorded rather than forgotten.**
Wave 2 is still uncertified: its rendering rows need a person in a vault, and the rule this migration
wrote for itself is that the pattern is not repeated until the previous provider is proven at the
surface. The owner was told this twice and asked for the flip anyway, which is their call to make —
so what stands in for the missing evidence is the revert: this is one commit, and reverting it puts
`ClaudeChatRuntime` back with nothing else moved. Both matrices are now outstanding at once, and that
is the risk being carried.

**Flipping found a safety net the new path had dropped.** The legacy runtime's rewind took a backup
of the files its preview said would change, restored it when the apply failed or threw, and reported
"failed but files were restored" as a different fact from "failed and could not restore". The
kernel's backend had preview-and-apply and no backup — so a rewind interrupted between the two would
have left the vault half rewound with nothing to put it back. The backup is a port on the backend
now, filled by the composition with the same helper and the vault path, taken in the only window
where what is about to change is known and still unchanged. `ClaudeRewindService` survives as exactly
that half; its orchestration moved into the backend, which owns the query that rewinds.

The preview's insertions and deletions travel with the result too — the legacy surface reported them
and the kernel's result type had no room for them.

**What a tab test had to learn.** `Tab.test.ts` mocked the deleted runtime module by path and
injected one-shot runtimes through its constructor. A tab's runtime now comes from the plugin's
execution composition, so the stub is a `getClaudeExecution()` on the mock plugin and the one-shot
overrides set that instead. The parity manifest moves twelve modules from `execution-platform-dark`
to `provider-chat-execution`, the bundle marker for `provider-claude` moves from dark to live, and
the topology fixture cites the backend where it cited the runtime.

**Wave 3 is wired and uncertified.** Its matrix is
[`docs/claude-flip-smoke-matrix.md`](claude-flip-smoke-matrix.md) — twenty-eight rows, the longest of
the three, because Claude is the first flip with a rewind, the first with native agents, and the only
one whose interactions come in three kinds. Rows 14–16 are the ones this commit's own change is
about: the third of them, a rewind that fails with the files restored, is the row that would have
failed silently before it.

Gates: unit 465 suites / 7,557 tests, integration 5 / 145, typecheck, lint, and `build:release`
clean. The suites lost 257 tests with the runtime they covered; what replaced them is the
composition's end-to-end turn, the content presenter's dedup, and the interaction bridge's twelve.

**The flip pushed red, on typecheck, and the reason is worth recording**: the last local round ran
lint, the suites and `build:release` but not `npm run typecheck`, and `build:release` does not
typecheck tests — so two `as any`-shaped stubs in `Tab.test.ts` compiled locally and failed on CI.
The gate in `AGENTS.md` lists four commands for exactly this reason, and running three of them is not
running it.

### M2-flips wave 4 — OpenCode's dark backend half (`3b01158`)

The first ACP provider reaches the kernel. `OpencodeExecution` binds the dark `OpencodeExecutionBackend`
to the running plugin, `OpencodeExecutionRequests` holds what its references stand for, and
`OpencodeProjectionResultSink` commits a reference rather than a copy of a session database. Nothing
constructs any of it; `registration.ts` still points at `OpencodeChatRuntime`.

**Three reference spaces, not two, and the third is what makes this provider different.** Codex
resolves a daemon and Claude an SDK query; an ACP session is *configured after it exists*, so a turn
mints a `requestRef` for itself, a `startupRef` for the process the launcher will spawn, and a
`dynamicRef` for the mode, model and effort the session is set to once it is open. One store serves
all three, for the reason wave 1 learned the hard way: a reference minted against one store resolves
to nothing in another.

**The launch is a directory, not a command line.** OpenCode reads its config and system prompt from
files Grimoire writes, so `environment()` prepares the launch artifacts *before* minting the startup
reference — a process spawned before they exist runs under the previous turn's configuration. The
restart fingerprint is the legacy runtime's launch key unchanged: command, config path, environment
text, system prompt key, artifact key. Everything a running process cannot be told about afterwards.

**How little of it is OpenCode's.** The client adapter, the JSON-RPC transport and the process
launcher are already protocol-generic and shared with every ACP provider that follows — MiMoCode,
Kimi Code, Grok, Qwen, Gemini. What this composition adds is the launch, the three stores and the
sink, which is the shape the next five waves should each cost.

One whole turn runs end to end with a fake ACP client as the only stand-in: the reference is
dispatched, a session is created, the prompt is sent, the answer arrives as a session update, and the
result commits. A second test resolves the startup reference the turn minted and asserts what a
launcher would actually spawn — `opencode acp`, under the `OPENCODE_CONFIG` those artifacts just
wrote. That is the assertion the three spaces exist for.

Not here, each named so a flip cannot land while it is missing: **the content surface** — session
updates are carried and nothing yet turns them into chunks, though `AcpSessionUpdateNormalizer` and
the OpenCode tool stream adapter already know how — and **interactions**, where the bridge refuses
every permission request. ACP asks before edits and commands, so that refusal is fail-closed and
useless, exactly as wave 3's was at this stage.

Gates: unit 465 suites / 7,560 tests, integration 5 / 145, typecheck, lint, and `build:release`
clean. The three new modules are declared dark in the parity manifest.

### M2-flips wave 4 — OpenCode's content surface (`1ad9421`)

The backend reported facts about a turn — a tool started, a thought happened — and the answer's
text, and nothing a tool card, a diff, a plan or a context badge could be drawn from. It forwards
every session update now, at one call site before any branch below reads it, because the branches
consume what they recognize and a per-branch forward would have carried only those.

**Two shapes on the channel, not one, and the second is a wire fact rather than a convenience.** An
ACP turn's tokens are not in any notification: the `usage_update` arrives while the turn is still
running and says how full the context is, and what this prompt itself cost is in the answer to
`session/prompt`. The recording shows exactly that — `used: 16964, size: 200000` as an update, then
`inputTokens: 15940, cachedReadTokens: 1024` as the result — so the payload is a small union of the
two, and the backend forwards the prompt result whatever its stop reason, since a cancelled turn
still spent them.

`OpencodeContentPresenter` turns both into chunks with the code the legacy runtime rendered with —
`AcpSessionUpdateNormalizer` and the OpenCode tool stream adapter — drops the copy of the answer the
kernel already carries as `output-delta`, and owns the three things no chunk does: the ACP session a
conversation resumes and forks from, the message ids the finished turn is saved with, and the
session's own configuration. That last one is why it has ports rather than only a return value:
commands, config options and current mode arrive as session updates but belong to the tab, not the
transcript, and a flip that dropped them would lose the model selector, the slash commands and the
plan indicator without failing anything.

**The forward sits after the output bound, not before it.** The bound is what keeps a reader from
seeing text that will never be committed, and the content channel is a reader like any other — so a
turn cancelled for overflow forwards nothing, which is its own test.

Two gates were rewritten rather than extended. The trace now freezes *what* was forwarded
(`provider-content:agent_message_chunk`, `provider-content:prompt-result`) rather than that
something was, following the Codex summarizer. And the OpenCode wire-coverage check no longer greps
the backend source for `usage_update`: the normalizer renames every update before anything consumes
it, so a text search would have reported a gap that is closed and missed one that opens. It replays
the recorded notifications through the presenter and asks which produced nothing — proven by
deleting the usage branch and watching it name `usage_update`. **The OpenCode row of that gap is now
empty**, down from two.

The end-to-end composition test runs both halves with no stand-in between them: a turn whose tool
call, usage update and answer are forwarded by the real backend and rendered by the real presenter,
asserting the `Read` card, its output, the badge that has both the window and the prompt's tokens,
and that the answer appears exactly once. Proven by changing the payload shape in the backend and
watching only that test fail — which is the wave-1 lesson applied where it applies: a seam both
sides stub is not covered.

Still not here: **interactions**, where the bridge refuses every permission request. And the
presenter is built but unwired — what constructs a presenter is the tab runtime, which is the next
increment, and its four ports are what that runtime must answer for.

Gates: unit 467 suites / 7,577 tests, integration 5 / 145 (2 suites, 10 tests skipped), typecheck,
lint, and `build:release` clean. The presenter is declared dark in the parity manifest, and the
bundle confirms it: `main.js` contains neither half, because nothing reachable imports them.

### M2-flips wave 4 — OpenCode's interactions (`d11068c`)

ACP asks the client before an edit or a command, so the refusing bridge the backend half shipped
with was fail-closed and useless: a flipped tab would have refused every write OpenCode proposed.
`OpencodeInteractionBridge` is the real one, and the composition now builds the backend with it.

**One kind, not three.** ACP has a single `session/request_permission`, and the legacy runtime
rendered every one of them through the approval callback — a question, a plan-mode switch and a
shell command alike, each described by its own words and answered with the agent's own options.
Kept, rather than split: what a permission is *about* is already carried by the presentation, and an
interaction promoted to a question would be answered by a UI the agent's options do not fit.

**The response ids are minted, not passed through.** The agent picks its own `optionId` — an
arbitrary string — and a control record accepts only constrained, unique identifiers. An option
named `opt one!` would make the record unwritable, and two options of one kind (which OpenCode
offers for path-scoped allowances) would collide into one id that answers with whichever was found
first. So each id is named after ACP's own option kind, suffixed only where there are two, and maps
back to exactly one of the agent's options — which is what the answer is finally expressed in. The
test asserts both halves: that every id matches the store's identifier shape, and that `allow-once`
and `allow-once-2` resolve to different agent options.

Three refusals, each different on purpose. A **dismissed** prompt is `cancelled`, because dismissing
is not choosing and telling the agent the user refused would be a decision nobody made. An **id the
interaction never offered** is a defect upstream, answered with the refusal the agent itself
offered — the safe way to be wrong. And a request that **offered no refusal at all** is cancelled,
because there is nothing else honest to send.

`buildOpencodePermissionPresentation` and `normalizeApprovalInput` moved out of the legacy runtime,
which now delegates to them — two hundred lines of OpenCode's own permission vocabulary (`bash`,
`edit`, `external_directory`, `doom_loop`, `workflow_tool_approval`, and the workflow-tool summary),
so the flip does not produce a second opinion about what is being asked. The runtime's existing
approval tests cover the move, and the module is recorded as wired rather than dark, because the
runtime that reaches it is still the one in production.

The composition test drives it end to end: the fake agent asks before running a command, the
interaction opens through the kernel, the presentation reads `bash` with its two options, the
resolution goes back as the agent's own `optionId`, and the presentation is forgotten. Proven by
mangling the option id in the bridge and watching only that test fail.

**One finding, recorded rather than fixed.** The registry throws `Interaction run became terminal
while resolving` if the provider finishes the turn between `interactionPort.resolve()` and the
kernel's commit of that resolution. The answer has already reached the provider at that point, so
the throw loses a resolution that succeeded, and it reaches whatever asked — a tab would see a
failed approval on a turn that went fine. It cannot happen over a real transport, where the answer
and the response cross a pipe; the first version of the composition test hit it only because the
fake agent resumed on the same microtask drain, and the fake now crosses a task boundary the way a
pipe would. Owner: M3, with the control plane — either commit the interaction without resurrecting
the run, or say in the contract that a resolution is delivered before it is recorded.

Still not here: **the presenter**, which is what puts a prepared interaction on screen and turns the
answer back into a response id. It reads callbacks the tab installs, so it belongs to the runtime
half — the same increment that constructs the content presenter.

Gates: unit 468 suites / 7,588 tests, integration 5 / 145 (2 suites, 10 tests skipped), typecheck,
lint, and `build:release` clean. The bridge is declared dark in the parity manifest; the extracted
presentation module is declared wired, and `main.js` confirms both — it contains the vocabulary and
neither dark half.

### M2-flips wave 4 — the surface an OpenCode approval is shown on (`a3f43df`)

`OpencodeInteractionPresenter` is the half the bridge was missing: what puts a prepared approval on
screen and turns what the person clicked back into an id the run can record. The tab speaks the
legacy callback contract and the kernel speaks response ids, and this is the only place both are
spoken.

**The decision may not be one of the options.** The surface returns either a picked option — whose
value is already the kernel's id, because the options it was handed carry them — or a plain
`allow` / `allow-always` / `deny` / `cancel` it produced itself. ACP names options by kind rather
than by a fixed set, so a plain decision is matched to the option that expresses it: an agent that
offers only `reject_always` still has to be able to hear "deny", and the presenter finds it rather
than looking up an id that was never offered.

**Four ways an approval ends without an answer, and they are not the same.** A prompt the person
dismissed is `cancel`, which aborts the turn. An interaction that ended somewhere else — a run
cancelled while the prompt was up — resolves *nothing*, because the person did not choose to cancel
it, and the presenter can tell the difference only because it holds an abort signal per open prompt.
A tab with no approval callback and a surface that threw while rendering are both refusals: the
agent is blocked on this answer before it does anything at all, so a prompt nobody can see would
hang the turn, and refusing is what the legacy transport answered with.

Not wired yet: the composition constructs no presenter, because a presenter reads the callbacks a
tab installs. That is the runtime half, the last increment before the flip, and it is also what
subscribes this to the bridge's `onSettled` so a prompt comes down when its interaction ends
elsewhere.

Gates: unit 469 suites / 7,597 tests, typecheck, lint clean. Declared dark in the parity manifest.

### M2-flips wave 4 — what a session opens with (`cdf4434`)

Found while planning the runtime half, by reading what the legacy runtime does with a session it has
just created: **OpenCode answers `session/new` and `session/load` with its models, its modes and its
config options, and says them nowhere else.** The legacy runtime syncs its model and mode state from
exactly those two replies (and from the reply to each `setConfigOption`); no notification repeats
them. The backend was discarding both replies and keeping the session id.

A flip on top of that would have shipped a tab whose model selector and mode selector are empty on a
fresh vault and stay empty until the user changes something — the kind of defect that looks like a
rendering bug and is actually a missing wire fact. So the reply is now carried on the content
channel as a third payload kind, and the presenter turns it into one port call. The recovery path
carries it too: a reconnect loads the session again and answers with its own configuration, which
the tab that is still open would otherwise not hear.

**It is reported before the run starts**, because that is when the session is opened — the reply
comes back during dispatch preparation, before the prompt is sent. That is legal precisely because
content is transient: it writes no control record and advances no state machine, so it needs no run
to have begun. Two existing assertions had to learn the same thing rather than be worked around: the
first event of a turn is no longer the one that names the native run, and the overflow test now says
what it always meant — that no *session update* is forwarded past the bound, not that nothing is.

The mode in that reply is deliberately **not** treated as a mode switch. OpenCode reports its own
default agent (`build`) there, and pushing it at the toolbar would overwrite the Safe/Plan/Auto the
user picked before the turn applies theirs — which is the same reason the legacy runtime passes
`emitPermissionSync: false` at exactly these two call sites.

Gates: unit 469 suites / 7,601 tests, integration 5 / 145 (2 suites, 10 tests skipped), typecheck,
lint, and `build:release` clean. The trace freezes the new event, and the composition test asserts
the models and modes reach a real presenter through the kernel.

### M2-flips wave 4 — what a session is set to (`3427f68`)

`OpencodeSessionConfigState` is 390 lines lifted out of the legacy runtime, which now delegates to
it: which model, mode and effort a turn should be dispatched under, and what to keep of the lists a
session reports back. The runtime kept only the `setConfigOption` calls themselves, because those
need a connection; everything about *what* to set and *what it means* moved.

It is more than a cache of the session's settings — it is **the vault's memory of them**. Syncing a
session's reply seeds the discovered models, the per-model thinking options, the visible-model list
and, on a first run, the active model and effort selection itself. An OpenCode vault learns what its
models are by opening a session and being told, which is why the flip could not recompute this per
turn and why the extraction had to keep the seeding rather than only the reading.

Four ports carry what it cannot reach on its own: the settings bag it reads and seeds, the save it
calls only when something actually changed, the selector refresh, and the permission-mode sync. The
last one now translates OpenCode's mode id into Grimoire's permission mode **inside** the state
rather than at each call site, because a mode that maps to no permission mode must reach neither.

The legacy runtime's own tests are what prove the move, retargeted at the object rather than
rewritten — including one that had been seeding the effort state by assignment and now tells the
session what its thinking levels are the way production does, through the reply that reports them.

**Named for the flip, not solved here:** those tests live in `OpencodeChatRuntime.test.ts`, and the
flip deletes that runtime. They must be *moved* onto the extracted module in that commit, not
deleted with it, or the flip silently drops the coverage of 390 lines of settings-seeding.

**Also named for the flip: five call sites construct `OpencodeChatRuntime` for reasons that have
nothing to do with chat** — the model catalog's refresh, the runtime command loader, two in the
settings tab, and one in the chat UI config — all of them using it as a general-purpose "talk to
OpenCode" object. Deleting the runtime in the flip commit means answering all five, most likely
through the shared managed-ACP auxiliary session the ACP directory already has. Wave 4's flip is
therefore larger than wave 3's, and this is the measurement rather than a guess.

Gates: unit 469 suites / 7,601 tests, typecheck, lint, and `build:release` clean. Recorded as wired
in the parity manifest, because the runtime that reaches it is still the one in production.

### M2-flips wave 4 — OpenCode's runtime half (`0dec751`)

`createRuntime` puts a tab on the kernel. Four things are per tab and each for the same reason —
they are about *this* conversation's session: what it is set to (`OpencodeSessionConfigState`), what
it has said (the content presenter), what commands it offers, and which prompt is on screen (the
interaction presenter). The bridge, the request store and the backend stay shared.

**The session's slash commands no longer cost a second process.** They arrive as an
`available_commands_update` on the content channel, and the tab's `runtimeCommands` slot answers
from what the presenter kept — where the legacy path launches an OpenCode process to ask
(`OpencodeRuntimeCommandLoader`), which is one of the five call sites the flip still owes an answer.

**The mode, model and effort are sent every turn, not only when they change.** The legacy runtime
compared against the session it had; here the session a turn lands on is decided at dispatch and may
be one this tab never configured — created by the backend after the saved one went missing. The
applier skips whatever is empty, so the cost of being right is at most three `setConfigOption` calls
the session would have ignored.

**History is bootstrapped only when no session can carry it.** A bound ACP session already holds the
conversation; sending the history again would say everything twice.

**MCP had a gap the flip would have shipped.** The legacy runtime shut the process down on a reload,
so the next turn's session picked the new servers up. Nothing in the kernel path did that: the
launch key did not mention MCP, and a session already loaded is never told about a list that changed
under it. The servers are part of the launch key now — the fingerprint restarts the process, which
is what the key is for — and the tab's `mcp` slot reloads the vault's list. Its other three members
refuse by name: editing servers is a settings surface, not a chat tab.

The two settings writes the content channel starts — a session's models and its modes — are
awaited off the presenter's synchronous ports and their failures logged, rather than left as
unhandled rejections that a tab would show no sign of.

Four tests drive it end to end over the fake agent: a turn a tab can draw (text from the kernel, the
`Read` card from the presenter, the session the tab learned), an approval answered with the agent's
own `optionId`, the vault learning its models from the session the turn opened, and the mode the tab
is set to reaching the session as a `setConfigOption` before the prompt. The last two were proven by
breaking them.

Not here: **the flip itself**. `registration.ts` still points `createRuntime` at
`OpencodeChatRuntime`, and nothing constructs this. What the flip owes beyond the pointer is
recorded in the entry above — five call sites that build the legacy runtime for reasons unrelated to
chat, and the tests that must move onto the extracted modules rather than be deleted with it.

Gates: unit 469 suites / 7,606 tests, integration 5 / 145 (2 suites, 10 tests skipped), typecheck,
lint, and `build:release` clean. The module context is declared dark in the parity manifest.

### M2-flips wave 4 — OpenCode is flipped (`a0166a8`)

`registration.ts` points `createRuntime` at the composition, `main.ts` constructs one per load and
registers the backend with its interaction and recovery ports, and `OpencodeChatRuntime` is deleted.
**Four providers execute through the kernel**, and the first ACP one is among them — which is the
point of this wave, because five more inherit its transport, its launcher, its client adapter, its
content surface and its permission bridge.

**This flip was larger than the three before it, and the entries above measured why.** Five call
sites built the legacy runtime for reasons that had nothing to do with chat: the model catalog's
refresh, the runtime command loader, two in the settings tab, one in the chat UI config. Every one
of them was doing the same thing — opening an OpenCode session and reading its reply — through a
whole chat runtime, because that was the only object that could. `OpencodeMetadataSession` is that
question asked directly: an isolated process on an in-memory database, opened, read, and closed on
every path including the ones that failed. It answers both questions the five needed — which models
exist, and which commands a session offers.

Flipping found three things the new path had dropped, each a real regression and none visible from
the automated gates that were green before it:

- **the conversation's database.** OpenCode keeps sessions in a SQLite file, and a session created
  against one cannot be loaded from another. The legacy runtime passed the conversation's recorded
  path as `OPENCODE_DB`, recorded what the launch resolved, and saved it back into `providerState`.
  The kernel path did none of that: every turn would have run against the vault default, and a
  conversation whose session lives elsewhere would have silently started a new one with its history
  left behind. The path is carried per turn now, reported back by the resolver that decided it, and
  written into the session patch by a new module slot — kept even when the session is invalidated,
  which is what the legacy did and for its recorded reason: the hydrate still resolves through it;
- **the client filesystem.** The legacy runtime answered ACP's `fs/read_text_file` and
  `fs/write_text_file` with workspace containment and a write approval. The composition declared no
  filesystem at all, so the agent would have written around both. `OpencodeAcpFileSystem` — dark
  since the backend half — is wired into the client factory now. The approval is the part that had
  to change shape: a runtime was one tab and could ask its own callback, while the client factory is
  one process for every tab, so the tab is found by the ACP session the write arrived on, and a
  write whose session belongs to no open tab is refused rather than allowed;
- **the spend the vendor did not report.** OpenCode's plan indicator is spend-only, and a vendor
  that omits `cost` from its usage update leaves it still. The legacy read the session total from
  OpenCode's own database at the end of such a turn. That now runs at the same moment, from the
  database the turn resolved.

**What moved rather than died.** Thirteen of the legacy runtime's tests are now
`OpencodeSessionConfigState.test.ts` — the behaviour they cover did not move with the flip, only the
object holding it did. The workflow-approval summary moved onto the interaction presenter, the
launch-argument guard onto the composition (still asserting a Windows path with spaces and non-ASCII
characters is the working directory and never an argument), and the environment-flag guard with it.
The rest of that file — transport retries, session lifecycle, plan updates, permission mapping —
went with the runtime, because the backend, the presenter and the bridge each test the same
behaviour where it now lives.

**Certification.** The owner directed the flip ahead of the smoke matrices, and this is the third
uncertified flip outstanding — wave 2's rendering rows, wave 3's twenty-eight, and now wave 4's
nineteen in [`docs/opencode-flip-smoke-matrix.md`](opencode-flip-smoke-matrix.md). What stands in
for the missing evidence is the same as before: each flip reverts as a single commit, and this one
puts the legacy runtime back with nothing else moved. Unlike Codex, OpenCode has no live harness on
this branch — every row of its matrix needs a person, a vault and a CLI.

Gates: unit 470 suites / 7,587 tests, integration 5 / 145 (2 suites, 10 tests skipped), typecheck,
lint, and `build:release` clean. The parity manifest moves fourteen OpenCode modules and the three
shared managed-ACP ones from pending to wired; `provider-opencode` moves from the dark-bundle
markers to the wired ones, which is the gate that says the backend is actually in `main.js`.

### M2-flips wave 4 — three surfaces that must open anyway (`7034a00`)

A review of the flip's own diff, before its CI finished. The four metadata call sites reach the
composition through `plugin.getOpencodeExecution()`, and that accessor **throws** when the kernel has
not started — which is exactly the window a settings tab or a blank tab can be opened in. The legacy
runtime never threw there: constructing one was free, and two of the three call sites wrapped it in
`try` anyway because a metadata warmup is opportunistic.

So the flip had quietly made three surfaces depend on a started kernel: the settings tab's
per-model metadata, the toolbar's model warmup, and a blank tab's command list. Each is guarded now,
in the words the legacy used — a question left for the first real turn, which asks it anyway. The
command loader's guard has a test: a plugin whose accessor throws still opens the tab, with no
commands rather than an exception.

Gates: unit 470 suites / 7,588 tests, typecheck, lint, and `build:release` clean.

### M2-flips wave 4 — the live half of OpenCode's matrix (`5cb457f`)

Wave 2 built a live harness for Codex and wave 4 shipped without one. This is OpenCode's:
`OpencodeLiveSmoke.integration.test.ts`, thirteen of the nineteen matrix rows driven headlessly
against a real `opencode acp` 1.18.18, skipped unless `GRIMOIRE_OPENCODE_LIVE=1` asks for it. What
it leaves behind is exactly what a person has to look at — whether the card, the diff, the plan and
the badges *render*, two tabs side by side, the toolbar's model switch, "always allow", and a write
outside the vault.

Ten rows were green on the first run. The other two cost five defects, and **every one of them was
invisible to the automated gates that were green**, because a fake agent answers instantly and
answers exactly what the fake was told to answer:

- **the command announcement was never heard.** The metadata session gives a session 250ms to
  announce its commands. The countdown started when the listener was installed — before a cold
  process was launched and initialized, which takes seconds — so the window had always expired by
  the time there was a session to announce anything. Every blank tab's command list came back empty.
  The listener is installed before `session/new` still, because the announcement follows it
  immediately; the countdown now starts after;
- **the tab reported the session it was bound to, not the one the turn ran in.** When the agent no
  longer has the saved session the backend replaces it — and the tab kept reporting the old id, so
  the conversation would have been saved pointing at a session that does not exist, starting over on
  every turn, forever. The presenter's id comes first now: it is read from the reply to
  `session/new` or `session/load`, which is the session the run actually used;
- **resume did not work at all, in three places at once.** `session/load` was never called, because
  `ExecutionLifecycleRegistry.createSession` built the backend's config from three fields and
  dropped `nativeSessionRef`, and the adapter never passed one anyway — its `establish()` had the
  port to ask (`currentSessionId`) and did not. The first three flipped providers hid this: Codex and
  Claude resume through the turn's own reference, and Antigravity is a process per run with nothing
  to resume. OpenCode is the first backend that resumes through its *session*. Underneath both, the
  backend also required `session/load` to echo the id it was given — and a raw JSON-RPC probe against
  the real agent shows the reply is `{configOptions}` and nothing else, so a load that succeeded read
  as "the agent returned another session".

That last one had been half-learned before. `QwenChatRuntime` carries the comment "ACP session/load
responses need not repeat the session id" and reads the requested id instead — while the shared
`AcpLoadSessionResponse` still declared `sessionId` required, and Gemini, Grok, Kimi Code and
MiMoCode all assigned it straight into their session state, where it is `undefined`. Making the
field optional turned that latent bug into four compile errors, and all four are fixed. **A fact
known in one provider and not written into the type it belongs to is a fact the other five do not
have.**

Row 8 now resumes for real: the same session id across a process restart, and the model answers with
the word it was told two turns and one shutdown ago.

**Making resume work made a fifth defect reachable, which is the honest cost of fixing a path
nobody was on.** Row 9 — a saved session the agent no longer has — used to "pass" because the load
never happened. With the load happening, a probe shows OpenCode answers an unknown session with
`Internal error: OpenCode service failure` and `data.service: "session"`: nothing that says the
session is missing. The resume policy is deliberate about that — a binding is dropped only when the
agent says explicitly that it is gone, because a transient failure must not throw a live session
away — so the turn is refused and the binding kept, correctly, and the conversation would repeat
`The turn was rejected before it started, so nothing ran.` on every turn with nothing to act on.
The composition supplied no `describeFailure` at all; it does now, and says what to do:

> OpenCode could not start this turn. If this conversation was resumed from a saved session, that
> session may no longer exist — starting a new chat will create one.

A translation of the classification, not the agent's text, which is what that port's contract allows
and what D7 requires. The fake ACP client now answers exactly what 1.18.18 answers, so the path is
pinned without a CLI.

One thing reported rather than fixed: in 1.18.18 a permission request carries the **path** as
`toolCall.title` where the vocabulary expects a permission id (`edit`, `bash`, `external_directory`),
so the prompt reads "OpenCode wants permission to use /tmp/…/note.md on this path". The same code
served the legacy runtime, so it is not a flip regression — it is a vocabulary written against an
older CLI. Owner: whoever runs the rendering rows, since the fix is product copy and needs a person
to judge it.

Gates: unit 470 suites / 7,591 tests, typecheck, lint, and `build:release` clean, and **all twelve
live rows green** against `opencode acp` 1.18.18, recorded in
[`docs/opencode-flip-smoke-matrix.md`](opencode-flip-smoke-matrix.md).

### M0b — Grok's wire recording, taken before its wave (`28f3691`)

Wave 5 is Grok, chosen at the owner's direction over the journal's nomination of MiMoCode for one
reason: the Grok CLI is installed and signed in on the owner's machine and MiMoCode's was not, so
this is the first wave that can start with the evidence the plan asks for rather than owe it.

`grok agent stdio`, 1.0.5, sixty-three messages: initialize, `session/new`, one prompt. **It is not
one protocol, it is two.** Beside `session/update`, Grok speaks eleven `_x.ai/*` methods — MCP
startup progress and per-server status, the model list, the prompt queue, settings, announcements,
the session list, and a prompt-completion notice — and wraps three of its own session updates in
`_x.ai/session_notification`.

Three findings, all from the recording rather than from reading the code:

- **the three wrapped updates are dropped twice over.** `model_changed`, `response_completed` and
  `turn_completed` arrive wrapped, and `parseGrokSessionNotification` refuses them because it
  requires an inner `method` field that 1.0.5 does not send; even parsed, they are not in the ACP
  update set `handleSessionNotification` admits. `response_completed` carries the turn's token usage
  and `turn_completed` its stop reason, model call count and cost in `costUsdTicks` — which is
  exactly what the shipped runtime goes and reads off Grok's own session log instead. The wire hands
  it over and the provider reads the disk. Owner: wave 5's backend, which should take the wire;
- **`session/new` answers with `models`, not `configOptions`.** OpenCode's opening reply carries
  config options; Grok's carries a model state. The shared `session-config` payload wave 4 built
  covers both, which is the first evidence that it generalizes;
- **Grok manages its own MCP servers.** `_x.ai/mcp/servers_updated` reports the servers from Grok's
  own configuration with their startup status, independently of the `mcpServers` Grimoire passes to
  `session/new`. Wave 5 has to decide what the MCP surface means for this provider before it flips,
  not after.

**The recorder now redacts.** The first capture contained a live API key: Grok reports its MCP
servers with their environment variables, values included. It was never committed — the fixture in
this commit is the second capture, taken with a recorder that redacts by key name (`*key*`,
`*token*`, `*secret*`, `authorization`, …), by `{name, value}` pair, and by value shape, and the
owner was told to rotate the key. **A recording script that only elides long strings is not
sanitized**; the four existing recordings predate this rule and should be re-checked before anyone
publishes them.

Pinned in `wireVocabularyCoverage.test.ts`: the three unadmitted updates measured against
`isSupportedAcpSessionUpdate` itself rather than a source grep, and the ten vendor methods nothing
subscribes to measured against `GROK_SESSION_NOTIFICATION_METHODS`. A twelfth, `_x.ai/mcp_initialized`,
appeared in the first capture and not the second: whether it lands before the turn ends is MCP
startup timing, so it is named in a comment rather than asserted.

Gates: unit 470 suites / 7,594 tests, typecheck, lint clean.

### M0b — MiMoCode's wire recording, partial and labelled (`1af76bf`)

The MiMoCode CLI was installed on the owner's machine mid-session, so its recording was taken while
the recorder was out: `mimo acp` 0.1.13, ten messages. **It mirrors OpenCode exactly** — a
`session/new` that answers with `configOptions`, `available_commands_update`, `usage_update`, a
prompt result carrying usage — which is the first evidence for the claim the roadmap makes about
these two providers rather than a reading of their code.

**It is partial, and says so in its own `limitations` field.** The turn answered nothing: both models
the session offers are refused by the account's endpoint with `400 Not supported model`, which
appears in the agent's log and **not on the wire**. Over ACP the failure is
`stopReason: "end_turn"` with zero tokens and no chunks — a failed turn that looks exactly like a
successful empty one. That is the silent-success failure mode this migration exists to remove, and
the kernel already refuses it: `resultExpectation: 'required'` turns a turn with no result into
`missing-required-result` rather than an empty answer on screen. Recorded now so MiMoCode's wave
starts knowing it.

What the recording is evidence of: the handshake, `session/set_config_option`, and the empty-turn
shape. What it is not: message chunks, tool calls, or anything a turn produces once it can generate.
MiMoCode still owes a recording of a turn that answers.

Gates: unit 470 suites / 7,595 tests, typecheck, lint clean.

### M2-flips wave 4 — a review of the flip, seven items (`ef32886`)

An external review of `c66973b..1af76bf`. **All seven were real**, and five of them were things the
live matrix had run straight past — which is the honest measure of what a live harness does and does
not cover:

- **the conversation's database never reached the launch.** `OpencodeExecutionRequests` asks
  `environment(request.databasePath)`, and the composition constructed it with `() =>
  this.environment()` — a zero-arity lambda, which type-checks. Every resume launched against the
  default database. The whole plumbing added a commit earlier was inert, and row 8 passed only
  because this machine's default database happened to be the right one;
- **the spend fallback was disabled by its own flag.** `sawTurnCost` was set on every usage update
  rather than on a cost that was actually recorded — and OpenCode sends a usage update every turn
  for the context badge, usually with no cost in it. The legacy set it inside the `recordCost`
  success branch. Row 19 asserts an implication and the vendor charged nothing, so it stayed green;
- **two approval options of one kind collapsed into the first.** Carrying `decision` on a decision
  option makes the surface answer with that *word* instead of the option the person picked, and the
  word resolves back to whichever option matches it first. The bridge mints `allow-once` and
  `allow-once-2` precisely because OpenCode offers path-scoped allowances, and the second would have
  been answered as the first. The legacy left `decision` off for this reason;
- **nothing reset at a turn boundary.** `beginTurn` existed and only `forgetConversation` called it,
  so the tool-stream state, the prompt's tokens and — by this file's own comment — the message-start
  dedup all carried into the next turn: a second answer appended to the first one's bubble;
- **the thinking level was dropped on a tab's first turn.** The id a level is set under is named by
  the session, and a turn is composed before the session exists. The legacy applied it after the
  session opened. The turn now carries the *level* alone and the applier resolves the id from the
  reply the session opened with — the same shape as the session configuration wave 4 already
  carries;
- **a blank tab listed no slash commands.** Its runtime exists and has no session, so asking it
  returned nothing and the isolated metadata session was never reached;
- **one `onSettled` subscription leaked per opened tab** — held by the composition's disposer list
  rather than released when the tab closed.

Four of the fixes had no test; they have one each now, and each was proven by breaking the fix it
covers. One of the four found something the review had not: the launch key's new `databasePath`
field was **redundant**, because the artifacts' own key already hashes the resolved database — the
test stayed green with the field removed and went red when the artifact key stopped carrying it. The
redundant field is gone and the test now points at what actually holds the dependency.

Gates: unit 470 suites / 7,600 tests, integration 5 / 145, typecheck, lint, `build:release` clean,
and the twelve live rows re-run green after the fixes.

### M2-flips wave 5 — the backend every managed-ACP provider runs on (`476fd48`)

Wave 4 said the next five waves should each cost "the launch, the three stores and the sink". Grok's
wire recording is what made it worth checking, and the count settles it: of sixty mentions of the
provider in `OpencodeExecutionBackend.ts`, **fifty-seven were the names of injected contracts** and
three were the provider itself — two of them the descriptor.

So the backend moved to `src/providers/acp/execution/ManagedAcpExecutionBackend.ts` and takes its
descriptor through its context. Everything in it is the protocol: the client's lifetime and its
restart fingerprint, the session binding and its reload, the dispatch, the recovery, the
interactions, the result commit, and the content channel. `OpencodeExecutionBackend` is what is left
of OpenCode's — a descriptor and a constructor — and re-exports the contract names its own modules
and tests already use, so nothing else in that provider changed.

The content payload moved with it, to `AcpContentPayload`: the backend that emits the union is
shared, and a second copy of it would be a second thing to keep in step.

**The proof is that nothing moved in the tests.** OpenCode's whole suite — the backend's own
twenty-five cases, the composition's nineteen, the presenter's, the bridge's — runs unchanged
against the shared class and stays green, including the seam tests that drive a turn end to end. A
behaviour-preserving extraction that needed a test rewritten would not have been one.

What a provider still owns after this: its launch, its permission vocabulary, its tool
normalization, and what its presenter does with the content the backend carries. That is what Grok's
own increments will be.

Gates: unit 470 suites / 7,600 tests, typecheck, lint, and `build:release` clean. The shared backend
and the shared payload are recorded as wired in the parity manifest, beside the transport, the
launcher and the client adapter that went live with wave 4's flip.

### M2-flips wave 5 — the envelope Grok speaks its own updates through (`e424c99`)

The first thing wave 5 owes that no earlier wave did. Grok sends three of its own session updates on
`_x.ai/session_notification` rather than `session/update`, and two of them carry what a turn is
worth: `response_completed` its token usage, `turn_completed` its stop reason, model calls and cost.

Two things were in the way, and the recording is what named both.

**The parser refused the shape the CLI sends.** `parseGrokSessionNotification` required an inner
`method` field — an envelope 1.0.5 does not use: its params *are* the notification,
`{sessionId, update}` and nothing else. The existing test asserted that refusal explicitly, which is
what a test written against another version looks like from the outside. It now reads the recorded
notifications out of the fixture and asserts every one of them parses, so the rule and the evidence
cannot drift apart. The enveloped shape is still accepted, because an older CLI wraps it.

This changes nothing for the shipped runtime — it drops those three updates a second time, in the
handler, for not being ACP update types — except for `subagent_finished`, which the wrapped channel
can also carry and which was being lost.

**The shared client subscribed only to the ACP method.** `AcpClientConnection` takes
`vendorSessionNotifications` now: the method names to listen on, and the provider's parser to read
them, which declines by answering `null`. The managed client factory passes it through, so the
composition owns the provider and the factory owns the process. Two tests, one for each half —
delivery and refusal — proven by removing the subscription.

Gates: unit 470 suites / 7,603 tests, typecheck, lint, and `build:release` clean.

### M2-flips wave 5 — Grok's dark backend half (`50e8bcc`)

The second provider on the shared managed-ACP backend, and the first to cost what wave 4 said the
remaining waves should. `GrokExecutionBackend` is a descriptor and a constructor; everything else
here is what Grok owns.

**The launch is a command line, not a directory.** OpenCode is configured by files it reads; Grok
takes its permission policy and its reasoning effort as *process arguments* — `grok agent
[--always-approve] [--reasoning-effort <level>] stdio`. Both therefore belong to the launch key, and
a change to either restarts the process rather than reconfiguring an open session, which is the
opposite of where those two settings live for every provider flipped so far.

**Its own ordering, because it has its own methods.** Model and mode are `session/set_model` and
`session/set_mode` here rather than config options. The mode also has a fall-back the recording
explains: a release that carries its policy on the command line answers `-32601 method not found`,
and what is left is the option the session advertised. `-32602` on either is not a failed turn — it
is the agent saying it has no such mode, and the turn proceeds on the one it has.

**Its own envelope, wired at the client.** The composition builds its client factory with Grok's
notification methods and parser, so the three updates it sends on `_x.ai/session_notification`
arrive at all.

Two things are deliberately not here, each named so a flip cannot land while it is missing: the
**content surface**, where those three updates have to become chunks and a usage badge — and where
the turn's cost, which the legacy runtime reads off Grok's session log, is on the wire waiting — and
**interactions**, where the bridge refuses every permission request.

Two architecture gates fired while this landed, both correctly: a provider with an `execution`
directory owes a topology trace, and every unreachable module owes a manifest entry. Both are
answered rather than relaxed.

Five composition tests, each proven by breaking what it covers: the whole turn, the command line the
launcher would spawn, the restart when the effort changes, the two dedicated setters, and the
fall-back when the release has neither. The effort test found where that setting actually lives —
the coordinator restores the per-provider projection over the top-level value on every snapshot, so
a test that wrote the top-level one was asserting nothing.

Gates: unit 471 suites / 7,609 tests, typecheck, lint, and `build:release` clean.

### M2-flips wave 5 — Grok's content surface, and what a turn costs (`c37b300`)

`GrokContentPresenter` draws a turn the way OpenCode's does — the shared ACP normalization with
Grok's own tool vocabulary over it — plus the three updates only Grok sends, which the recording is
the evidence for and which the shipped runtime drops:

- **`response_completed` carries the turn's tokens, and nothing else does.** Grok's answer to
  `session/prompt` is a stop reason with no usage at all, so a badge fed the way OpenCode's is would
  stay empty for every turn;
- **`turn_completed` carries the bill.** Following it to the end was worth doing: the legacy reads a
  cost off Grok's own session log, and for the recorded turn **there is no cost record in that log**
  — only `costUsdTicks`. So the spend indicator does not move today, and the number it needs was on
  the wire all along;
- **`model_changed`** is how a session says the model moved under the tab, which a `/model` typed
  into the composer does.

**The unit is documented, not guessed.** `costUsdTicks: 69751000` could have been anything; the CLI's
own help settles it — "`total_cost_usd_ticks` is the same value in exact integer ticks (1 USD = 10^10
ticks)… summing per-invocation ticks matches the server's usage export exactly, which float dollars
cannot guarantee." That is $0.0069751 for the recorded turn, the division happens once, and the
integer is what travels until then.

The tests read their expected values **out of the fixture**: the first draft hardcoded the numbers
from an earlier capture and failed against the committed one, which is the useful way to learn that
an assertion about a constant is not an assertion about the transformation. One of them replays every
notification the recording carried, in order, and asserts what comes out is a message, its thinking
and the badge — and nothing at all for the updates that are not content.

Still not here: **interactions**, where the bridge refuses every permission request, and the
**runtime half**. Grok's own MCP surface — eleven `_x.ai/*` methods, of which the servers and their
startup status are two — is untouched and still owed a decision before the flip.

Gates: unit 471 suites / 7,615 tests, typecheck, lint, and `build:release` clean.

### M2-flips wave 5 — interactions, and the second thing that was never one provider's (this commit)

Wave 4 built OpenCode's permission bridge and its approval presenter. Writing Grok's showed the same
thing the backend showed: **only one line of the bridge was ever OpenCode's** — the call that turns a
request into a sentence. The id minting under the control store's identifier rule, the three
different refusals, and the round trip back to the agent's own `optionId` are all the protocol.

So both moved: `AcpPermissionBridge`, which takes a provider's vocabulary as a port, and
`AcpApprovalPresenter`, which was already generic. OpenCode's twenty interaction tests pass
unchanged on them, which is the same proof the backend extraction gave. What Grok's interactions
then cost is a vocabulary and a subclass.

**Grok names a permission by the tool *and* the kind**, where OpenCode names it by the tool alone —
`kind: 'execute'` is what makes a request titled "Shell" a shell command rather than a tool called
Shell. That vocabulary is 218 lines lifted out of the legacy runtime, which now delegates to it.

A test that claimed to pin that distinction did not. The composition's approval row was green with
the kind removed, because the fake's title was `bash` and the vocabulary resolves that on the title
alone — the assertion agreed with its comment only by accident. The fake now sends a title the
vocabulary has no rule for, and the row goes red without the kind.

Gates: unit 472 suites / 7,616 tests, typecheck, lint clean. The shared bridge and presenter are
recorded as wired; Grok's vocabulary is wired too, because the runtime that reaches it is still the
one in production.

### M2-flips wave 5 — what a Grok session is set to (this commit)

`GrokSessionConfigState` is 451 lines lifted out of the legacy runtime, which now delegates to it:
which model, mode and reasoning effort a turn is dispatched under, and what to keep of the lists a
session reports back. The runtime kept the `setMode` / `setModel` / `setConfigOption` calls, because
those need a connection; everything about *what* to set and *what it means* moved. Same shape as
wave 4's, six ports instead of four — Grok's state also reads the model catalog off the managed
`GROK_HOME` on disk, so it needs the workspace root, the resolved CLI path and the debug recorder
that names what it read.

Two things this cost that wave 4's did not:

- **the snapshot is not the whole truth.** The runtime's `getProviderSettings()` overlays what a
  running Grok discovered onto the saved provider snapshot before anything resolves against it. The
  first extraction dropped that overlay, and a model the vault had never discovered became
  selectable — caught by the runtime's own test for exactly that, and restored inside the state
  where every resolution now reads it;
- **a shared test knew where the reading lived.** `AcpManagedMcpRuntime.test.ts` stubs the session
  sync for all five remaining ACP runtimes, and Grok's is no longer on the runtime. It now stubs
  wherever the reading is, which is the one line that tells the next four waves this list is shrinking.

The legacy runtime's own tests are what prove the move — retargeted at the object, not rewritten.
Three of them had been seeding session state by assignment, which the extraction made impossible:
they now tell the state what the session advertised, through the same replies production learns it
from. One of those seeds was written twice before it was right — a fabricated mode option that
advertised only `Default` rewrote the vault's mode catalog and made the test pass for the wrong
reason. Proof the retarget still bites: with `markApplied` ignoring the mode it was given, 14 of the
53 go red.

**Named for the flip, not solved here:** those 53 tests live in `GrokChatRuntime.test.ts`, and the
flip deletes that runtime. They must be *moved* onto the extracted modules in that commit, not
deleted with it — the same obligation wave 4 carried and met.

Gates: unit 472 suites / 7,616 tests, typecheck, `eslint` over `src` and `tests` clean, and
`build:release` clean. Recorded as wired in the parity manifest, because the runtime that reaches it
is still the one in production.

**A gate that lied about its own result.** `npm run lint` through the local RTK filter reported
`LINT=1` with 34 errors in `scripts/*.js` — files the lint script's globs do not cover. Running
`eslint "src/**/*.ts" "tests/**/*.ts" --max-warnings=0` directly exits 0. The filter's exit code is
not the linter's; this is the second time this session a gate was believed from a wrapper rather
than from the tool. Gate proof in this branch means the tool's own exit code.


### M2-flips wave 5 — Grok's catalog contribution (this commit)

`GrokProviderModule` is the fifth module and the first that had nothing new to prove: OpenCode
established the managed-ACP topology, and Grok reaches production through the same one. Its settings
are field-for-field OpenCode's, so the codec is that codec with Grok's four environment keys —
`GROK_AUTH`, `GROK_AUTH_PATH`, `GROK_HOME`, `XAI_API_KEY`, the ones that decide whether a saved
session is still resumable. Which is the outcome wave 4 predicted for the remaining ACP providers,
now measured on a second one.

Two declarations deliberately disagree with the live capability record:

- **rewind is dropped.** `GROK_PROVIDER_CAPABILITIES.supportsRewind` is `true`, which puts a rewind
  button on every Grok assistant message; `GrokChatRuntime.rewind()` answers `canRewind: false` for
  every input. The module declares `unsupported`, so the flip takes a dead affordance with it. **This
  is the one product behaviour Grok's flip changes**, named here so it can be reversed by whoever
  wants the button back — with a rewind port behind it. The test asserts both halves, including the
  runtime's own answer, plus the invariant that outlives it: the capability says `unsupported`
  exactly when no rewind port is contributed;
- **MCP is three fields, not one boolean** — same split OpenCode's module made, for the same reason:
  Grimoire owns `.grimoire/mcp/grok.json` and injects those servers into the session, while
  `supportsMcpTools: false` gates only the chat tab's per-run selector.

Fork stays `native`: `resolveSessionIdForFork` answers with the live session, which is what forking
a Grok conversation actually resumes.

The session patch is where Grok differs from OpenCode in substance rather than in names. OpenCode
carries a database path; Grok carries `sessionDirPath` and `workspacePath`, and keeps both when the
session id is invalidated — the legacy runtime's own rule, because the next session writes to the
same directory and the transcript already there is still this conversation's.

Proof the assertions bite: declaring `rewind: 'native'` reds 2 of 16, a passthrough `label` reds 1,
dropping `XAI_API_KEY` from the hash keys reds 1.

**A gate that was run the wrong way.** `npx jest --selectProjects unit` across the whole suite reds
497 tests with `storage.getItem is not a function` — the project's runner sets up the device-settings
storage, so only `npm run test` is a real result. Single-file break-tests through `npx` are fine and
were used above; a suite-wide number through it is noise.

Gates: unit 473 suites / 7,632 tests, typecheck, `eslint` over `src` and `tests`, and
`build:release` clean. Recorded as **dark** in the parity manifest: nothing constructs it, and
`registration.ts` plus `GrokWorkspaceServices` are still Grok's only wiring.


### M2-flips wave 5 — the third thing that was never one provider's (this commit)

The filesystem an ACP agent reads and writes the vault through is now
`AcpWorkspaceFileSystem`. Wave 5's pattern holds a third time: the containment rule, the line window
a read may ask for and the refusal on an unapproved write are the protocol's, and the five legacy ACP
runtimes carry the same three behaviours copied five times with nothing but the label different.
What a provider supplies is that label and two decisions — where a session is rooted, and whether a
write may happen.

`OpencodeAcpFileSystem` is now four lines over it, and OpenCode's 21 filesystem and composition tests
pass unchanged, which is the same proof the backend, the bridge and the approval presenter gave.
Grok's composition will construct the shared class directly rather than adding a subclass to hold one
string.

Gates: unit 473 suites / 7,632 tests, typecheck, `eslint` over `src` and `tests` clean. Recorded as
wired: it is reachable through OpenCode, which is flipped.


### M2-flips wave 5 — what a provider's non-turn features need from the process (this commit)

Grok's plan indicator is not a turn. It is `x.ai/billing`, asked over the same transport a turn runs
on, and the legacy runtime registers a billing reader when its process comes up and clears it when
the process goes. The composition owns neither the process nor its lifetime, so two seams had to
exist before Grok's runtime half could keep that behaviour:

- **`clientObserver`** on the shared backend — `onClientReady(client)` after `initialize` succeeds,
  `onClientLost()` when the client is closed or replaced. After the handshake because a client that
  has not handshaken answers nothing; withdrawn on close so a feature cannot hold a reference to a
  process that is gone;
- **`vendorRequest(method, params)`** on the managed client — the outbound half of what
  `vendorSessionNotifications` does inbound. Optional, because most agents have nothing to ask that
  ACP has no method for. The alternative was launching a second Grok process to ask what the first
  one already knows.

Both tests were written first and watched fail: the observer's against the shared backend through
OpenCode's suite, which is where the shared backend is exercised, and the vendor request's against
the real JSON-RPC transport over a pipe — it asserts the method and id on the wire, not a spy.

Gates: unit 473 suites / 7,634 tests, typecheck, `eslint` over `src` and `tests` clean.


### M2-flips wave 5 — the badge Grok fills from its own log (this commit)

Grok's wire recording observes seven session updates and **no context-window usage among them**: the
tokens a turn cost arrive on `response_completed`, and how full the context is arrives nowhere. The
legacy runtime reads it out of Grok's own session log after each prompt returns, which is why that
provider's badge has a context reading at all.

Nothing in the kernel path could reproduce that. The content channel is synchronous per payload — a
presenter answers chunks for the payload it is handed — so an asynchronous file read that finishes
after the last payload has no way onto the surface, and the turn is over by the time it lands.

The seam is where the answer is committed: `storeResult` now receives `presentContent`, and the
result and the terminal are emitted after it returns. So a provider that has to *go and read
something* to fill the surface has one bounded place to do it, and what it finds reaches the turn
that earned it rather than the next one. The test asserts the ordering, not the call: the payload
must appear before `terminal` in the run's own event sequence.

Gates: unit 473 suites / 7,635 tests, typecheck, `eslint` over `src` and `tests` clean.


### M2-flips wave 5 — Grok's runtime half (this commit)

A tab's Grok runtime now exists: `createRuntime` builds the session state, the content presenter,
the approval presenter and the module context per tab, over the one backend and the one permission
bridge the composition owns. Same shape as wave 4's, and four things Grok needs that OpenCode did
not:

- **the vault's model catalog is a file, not an answer.** Grok writes what models it has into the
  managed home; `session/new` reports only the session's own. Read when a process comes up, which is
  the moment the legacy runtime read it and the only one where the file is known to be current;
- **the plan indicator asks the live process.** `x.ai/billing` over the same transport a turn runs
  on, registered on `onClientReady` and cleared on `onClientLost` — the two moments the legacy
  runtime used;
- **the badge is filled from the session log.** No Grok turn reports a context window over ACP, and
  many report no cost either. Both readings happen while the answer is committed, through the
  `presentContent` seam, so they reach the turn that earned them;
- **the conversation is saved pointing at a directory.** A Grok session id alone hydrates nothing:
  the transcript is a directory under the managed home, and `sessionDirPath` plus `workspacePath` are
  what the history service and the usage readers both resolve through.

The mode is sent only when the session reported a native one, which is the legacy rule Grok's own
tests pin: a release that carries its policy on the command line has no modes, and Grimoire's toolbar
ids mean nothing to it.

Five tests cover the half end to end, and each was proven by breaking what it covers: dropping
`fillSurface` reds the context row alone; emptying the session paths reds the saved-conversation row
alone; neutral failure wording reds the resume-advice row alone; and reporting the conversation's
session instead of the one the turn ran in reds two.

**The wrapper lied a second time, the other way.** Running these break-tests through `npx jest`
reddened all 11 rows every time — the project's runner sets up device-settings storage, and without
it every test that touches settings dies before it asserts anything. A break-test through `npx` is
as untrustworthy as a green through it.

Gates: unit 473 suites / 7,641 tests, typecheck, `eslint` over `src` and `tests`, and
`build:release` clean. Still **dark**: `registration.ts` points `createRuntime` at
`GrokChatRuntime`, and the flip is the next checkpoint.


### M2-flips wave 5 — what Grok is asked when nobody is talking to it (this commit)

Five surfaces construct a whole `GrokChatRuntime` for something that is not a chat: the model
catalog's refresh, the runtime command loader, two in the settings tab, and the chat UI config's
model warm-up. All of them want one of two answers — which models exist and what a model can think
at, or which commands a session offers — and the runtime's only part in it was opening a session and
reading the reply. `GrokMetadataSession` is that session, isolated by its own managed home under
`.grimoire/grok/metadata`, which is the isolation the auxiliary query runner already uses.

Three things it does that wave 4's does not:

- **selects a model through the method Grok has for it**, `session/set_model`, where OpenCode sets a
  config option;
- **refuses a model the vault has never discovered.** The legacy warm-up checked the catalog before
  sending, and without that check a stale selection is sent to a session that has no such model;
- **carries the vault's permission policy on its command line**, because for this provider a launch
  flag is not optional — there is no session-level mode to fall back to.

**A test that pinned nothing, caught by breaking it.** The row asserting that a metadata question
does not become the vault's model selection stayed green with `seedActiveSelection: true`: seeding
only ever writes an *unset* selection, and the session-open sync in the same call has already set
one. The flag is kept, because it mirrors the legacy warm-up and matters when a session reports no
models at all — but the assertion is gone, replaced by a comment saying why no assertion there could
tell its presence from its absence. Of the three other breaks, dropping the catalog guard reds one
row and never closing the client reds five.

Gates: unit 473 suites / 7,647 tests, typecheck, `eslint` over `src` and `tests` clean. Dark: the
five call sites still build runtimes, and the flip is what moves them.


### M2-flips wave 5 — Grok is flipped (this commit)

`registration.ts` points `createRuntime` at the composition, `main.ts` constructs it and registers
the backend with its interaction and recovery ports, and `GrokChatRuntime` — 1,732 lines — is gone.
Five providers execute through the kernel, and the second ACP one is among them.

Five call sites built that runtime for reasons unrelated to chat: the model catalog, the command
loader, two in the settings tab, one in the chat UI. Each is now `GrokMetadataSession`.

**Flipping found four things the new path had dropped**, each of which is a seam rather than a patch:

- **the answer Grok never sent.** This provider finishes turns whose final message never reaches ACP
  while writing the answer to its own session log; the kernel would have ended those turns with
  `missing-required-result`. `storeResult` now has a sibling, `recoverOutput`, asked only when a turn
  produced nothing — and the recovered answer is emitted on the assistant channel as well as
  committed, because the surface draws an answer from the deltas and a committed-only answer is a
  turn that succeeds with an empty bubble;
- **the mirrored update.** Some releases send the same update on `session/update` *and* under their
  own method. The legacy runtime deduplicated them; the new client delivered both, which prints every
  sentence twice and commits it twice. The vendor-notification declaration now carries a
  `createDeduplicator`, built **per connection** — a filter shared across processes would drop one
  conversation's update because another had just sent the same words;
- **questions.** `ask_user_question` is a server request with its own answer shape, outside the
  interactions the kernel carries. Routed to the tab whose session it arrived on, the same way a
  write approval is, and cancelled rather than guessed when no tab owns that session;
- **the debug vocabulary.** `logGrokDebug` stamps the provider onto every record and had become
  unreachable, which the parity gate caught. The composition writes through it.

**One product behaviour changes**: the rewind button is gone from Grok messages. The live record
advertised rewind; the runtime answered `canRewind: false` to every input. Named in the module, in
its test, and here, so it can be reversed by whoever wants the button back — with a port behind it.

Twenty-five of the deleted runtime's tests moved rather than dying with it: thirteen onto
`GrokSessionConfigState`, nine onto `GrokAcpDynamicConfigApplier` (rewritten, because *what to send*
and *how it is sent* are two objects now), three onto the permission vocabulary. The rest were
covered by helper-level suites that already existed, or by the composition's own rows.

`docs/grok-flip-smoke-matrix.md` is the manual matrix: 21 rows, eight of them differences from
OpenCode's that only a real CLI can show. Flipped ahead of it at the owner's standing direction, so
four manual matrices are now outstanding. What stands in for the evidence is that this reverts as one
commit.

Gates: unit 473 suites / 7,626 tests, integration 5 suites / 145 tests, typecheck, `eslint` over
`src` and `tests`, and `build:release` clean.


### M2-flips wave 5 — the live half of Grok's matrix (this commit)

Thirteen rows of the flip matrix now run headlessly against a real `grok agent … stdio` (CLI 1.0.5),
behind `GRIMOIRE_GROK_LIVE=1`. All thirteen are green. What the run was for is the two things it
found, neither of which a green unit suite could have:

- **Grok says `FS_NOT_FOUND`, not "no such session".** Its session store is a directory, so a
  session that was deleted — or a vault that moved — comes back from `session/load` as
  `-32603 Path not found.` with `data.code: FS_NOT_FOUND`, never naming the session. The shared
  heuristic requires the agent to say "session", so the kernel read it as a hard failure and refused
  the turn, where the legacy resume policy dropped the binding and started a session. The
  composition now recognizes this provider's own shape, for `session/load` alone — the same code
  from a prompt is a real error. Row 9 answers on a new session instead of refusing;
- **the harness deleted the vault it was about to reuse.** Row 8 shuts one composition down and
  starts another on the same vault. OpenCode's equivalent survived that because its database lives
  outside the vault; Grok keeps its session store *inside* it, under the managed home — so the
  first harness's cleanup took the sessions with it and the resume row asked for a session whose
  directory no longer existed. Vaults now outlive the harness that made one, and the row was proven
  by the answer coming back: "cobalt".

Getting to that answer took a protocol probe rather than a guess: a raw JSON-RPC script against the
real CLI showed `session/load` succeeding for a session created the same way, which is what proved
the failure was the harness's and not the product's. The instrumentation used to find it — a printed
load error, the load's own parameters, the client's failed reads — was temporary and is gone.

One row has no number in the matrix table: **1b, the mirrored update**. A release that mirrors an
update onto both channels is invisible when the deduplicator works, so the row asserts the answer's
phrase appears exactly once.

Gates: unit 473 suites / 7,627 tests, integration 5 suites / 145 tests (live suite skipped),
typecheck, `eslint` over `src` and `tests`, and `build:release` clean.


### A six-specialist review of the branch (this commit)

The branch was reviewed end to end at `0f84b41..d9f715e` — kernel architecture, ACP transport,
security, Grok's wave, the three earlier flips, and the gates. Verdict: ready to merge with fixes.
One Critical, about eighteen Important, about twenty-five Minor. The work list is
[`docs/providers-migration-review-backlog.md`](providers-migration-review-backlog.md); the reports it
was drawn from are in this session's transcript, which that file names.

Six of the findings were re-checked against the tree before being written down, and all six hold:

- **nothing ever deletes a control record.** `VersionedRepository.remove` and `DurableStorage.remove`
  have no production caller at all, and startup parses every intent and record ever written — so the
  store grows monotonically in a real vault and start time grows with it. This is the one finding
  that accumulates on users' disks daily, and it is what the next commit should answer;
- **a process that dies while idle wedges the conversation**, because the backend only reacts to a
  lost connection when a run is active. The legacy path handled it, which makes this a fix the
  migration dropped — the failure mode this journal's own rule about harvested fixes exists to
  prevent;
- **`AcpSessionUpdateNormalizer.normalize` can return `undefined`** while typed as if it cannot: the
  switch has no default and no trailing return, and the vendor channel wave 5 added is exactly what
  delivers updates outside its union;
- **`resolveGrokAcpModeId` is dead code**, referenced only by its own test. It is what keeps
  Grimoire's synthetic mode ids off the wire, and issue #52 is that class of bug;
- **`ClaudePlanUsageStore.recordSdkMessage` has no caller**, so Claude's plan indicator is fed
  nothing — the same class wave 2 found and fixed for Codex;
- **the auto-turn callback has two shapes**: the adapter passes a run id, the tab expects a result
  object with chunks.

Nothing was fixed here. The next session starts at the top of that backlog, in the order it names:
C1, then Grok in one pass, then Claude in one pass, then ACP robustness, then hygiene.


### Review C1, first half — the intent that is kept after it is answered (this commit)

Every durable event writes a transaction intent, and nothing ever removed one. The file exists to
survive a crash *between* the steps of a write; once every step is done there is no reader left,
because ids are minted per write and no caller can reproduce one afterwards. So the store grew by one
file per event for the life of a vault, and every start read all of them looking for the pending few.

Now: a completed intent is removed at completion, and `recoverPending` sweeps any it finds — which
covers both the crash between the completion write and its removal, **and every vault that ran an
older build**, whose store is swept on the first start after this.

**What the removal took away, and where it went.** A repeat of a transaction id used to be answered
from the completed file: "already done", without doing the work twice. The existing concurrent-caller
test is exactly that property, and deleting the file broke it — the second caller re-applied the
step. The answer moved into a **bounded** window of 64 finished ids, because a set that grows with
every write is the same defect one layer up; the window only has to cover a retry of an id still in
flight, which is the only repeat that can happen. Proof it is load-bearing: with the window emptied,
the concurrent-caller row goes red.

Each of the three new rows was proven by breaking what it covers: no removal at completion reds the
first, no startup sweep reds the second, an empty window reds the third.

**Not this commit:** the other two halves of C1 — deleting a conversation's control records (D4), and
evicting terminal runs from the registry's in-memory maps.

Gates: unit 473 suites / 7,630 tests, integration 5 suites / 145 tests, typecheck, `eslint` over
`src` and `tests` clean.


### Review C1, second half — deleting a chat deletes its traces (this commit)

D4 says deleting a conversation deletes every control record owned by it, in the same operation,
idempotently, and finished at the next start if it was interrupted. None of that existed:
`deleteConversation` removed the provider session and the metadata and no control record at all.

Two things had to be true before it could:

- **the records had to be findable.** Every composition minted its owner as a per-*tab* opaque id —
  `{kind: 'conversation', ownerId: 'groktab-…'}` — so a conversation had no way to name what it
  owned. The owner is now read when a session is established rather than when the tab is built, and
  it is the conversation's id; the tab's own id stands in only for a session belonging to no chat.
  Which exposed the second thing: **a tab is not a conversation.** Moving a tab to another chat kept
  the first chat's session, so the second's runs would have been recorded under the first's name.
  The adapter now drops its session when the conversation changes, and the next turn establishes one
  under the right owner;
- **removal had to be a transaction.** `removeIfPresent` is written against whatever is on disk
  rather than an expected revision, because a deletion step is replayed by recovery against a record
  it may already have removed. The removals go through the same intent-backed coordinator a write
  uses, so an interrupted deletion is finished at the next start — which the test proves by crashing
  one half-way and then starting a second registry over the same storage.

`deleteOwnedRecords` refuses rather than forcing when a session is still live, per D4's rule about
leases and running work; `main.ts` calls it last, after the tabs holding that conversation have been
reset off it, and reports a refusal instead of throwing — a chat the user deleted is gone from the
vault either way.

**The fallback that had to be minted once.** Writing the owner as `conversation?.id ?? opaqueId(…)`
minted a fresh tab id on every read, so a session and its own runs got different owners and the
registry refused the run — caught by seven composition tests, fixed by hoisting the id.

Four new deletion rows and two owner rows, each proven by breaking what it covers: dropping the live
guard reds the refusal row alone, matching every owner reds the "only those" row alone, removing the
reset reds the tab-move row, and freezing the owner at construction reds six.

**Not this commit:** C1's third part — evicting terminal runs from the registry's in-memory maps.
`deleteOwnedRecords` evicts what it deletes, which is the conversation-lifetime half of it.

Gates: unit 473 suites / 7,636 tests, integration 5 suites / 145 tests, typecheck, `eslint` over
`src` and `tests`, and `build:release` clean.


### Review C1, third half — the memory of work nobody holds (this commit)

The registry's maps are this process's memory of work in progress, and a run stayed in them after it
finished: `disposeSession` dropped the session and its observers and left every run the session had
ever carried, plus their interactions. A working day in one Obsidian session therefore held every
turn it ever ran.

A disposed session's runs and interactions are now dropped with it. Two things make that safe rather
than lossy: disposal already refuses a session with a live run — which is what lets this delete
without checking each one — and the durable records stay, because an honest history of what ran
outlives the tab that ran it. They are removed when the conversation is deleted, and by nothing else.

Interactions are found **by their run rather than by the run's open list**, which the second test is
for: a resolved prompt is no longer listed as open, and it is exactly the one nobody can be shown.
Both rows go red when their eviction is removed.

**The guard that pinned nothing.** The first version skipped runs that were not terminal, and the
break-test showed the branch was unreachable — evicting live runs too kept every row green. It is
gone, and the refusal that makes it unnecessary is named where it used to be.

That closes C1: intents swept, a deleted conversation's records deleted, and the in-memory half
bounded by the tabs that are open rather than by the length of the session.

Gates: unit 473 suites / 7,637 tests, typecheck, `eslint` over `src` and `tests` clean.


### Review G1 and G2 — the mode a session will actually accept (this commit)

**G1.** `resolveGrokAcpModeId` was dead code after the flip: the composition read the vault's mode
and the applier sent it. The vault answers in *Grimoire's* vocabulary — `grimoire-full-access`,
`grimoire-safe`, which are the ids of the fallback modes every vault holds before a session has
spoken — and those are not Grok's. Sending one comes back as `-32602 Invalid params` and aborts the
turn before the prompt, which is issue #52's class, reintroduced by the flip.

The translation is back, and in a better place. It cannot live where the turn is composed: a turn is
composed before its session exists, so nothing there knows what the session will name. It now lives
in the applier, which is the one moment both are known — and the backend passes it the session's
`modes` beside the config options it already passed, for exactly that reason. Three rules, each with
a row that goes red without it: never send an id the session did not name, send nothing when the
session named nothing (a release carrying its policy on the command line — the launch already did),
and send nothing when the session is already in that mode, because a set that changes nothing is a
round trip the turn waits for.

A first attempt put the translation on the session state and it silently sent nothing at all: the
state has no session modes at compose time either. The composition test is what caught it, and the
state's version is gone rather than left beside the real one.

**G2.** `current_mode_update` and `config_option_update` reached the presenter's `default:` and were
dropped. A `/mode` typed into the composer moves the session under the tab; a tab that never hears it
keeps asking for the mode it believes the session is in — and now that the ask is *translated*
against the current mode, a stale one is worse than it was. Both are forwarded to the session state,
the way OpenCode's presenter already forwarded them.

**A default parameter that ate a test.** The applier's helper took
`sessionModes: … | undefined = SESSION_MODES`, so the row for "the session named nothing" passed
`undefined` and got the default — proving the opposite of what it claimed. It takes `null` now.

Gates: unit 476 suites / 7,644 tests, typecheck, `eslint` over `src` and `tests`, and
`build:release` clean.


### Review G3 — a turn the user stopped still spent tokens (this commit)

The surface-filling hook was hung off `storeResult`, which only runs when an answer is committed —
so a cancelled turn read nothing, and for many Grok turns the session log is the only record of what
they cost. The legacy runtime read it when the prompt returned, whatever the stop reason.

`noteTurnEnded` is that moment: the prompt has returned, no terminal has been emitted, and the
provider gets its last look at the turn. `storeResult` goes back to committing an answer and nothing
else. The two Grok readings — the context window it never sends over the wire, and the cost it often
does not — now happen for cancelled turns too, which the composition test proves by stopping one and
finding its badge.

Removing the call reds four rows across two suites, including both of the ones that only exist
because Grok has to go and read things.

Gates: unit 476 suites / 7,645 tests, integration 5 suites / 145 tests, typecheck, `eslint`, and
`build:release` clean.


### Review G4 and G5 — two gates that were measuring the wrong thing (this commit)

**G5.** Grok had no execution-backend conformance suite while Antigravity, Codex, Claude and
OpenCode each had one. It has one now — twelve rows: exactly one terminal, a refused second run, a
bounded result, a required result that never came, an unconfirmed termination, and the rest. The
backend is shared, so this is not a second proof of the backend; it is the proof that *this
provider's* descriptor, ids and timeouts compose into one that still keeps those invariants. That it
runs the real machinery rather than a copy is shown by inverting the missing-result policy, which
reds a row.

**G4.** The wire gate's Grok row asserted that the legacy runtime's ACP predicate rejects
`model_changed`, `response_completed` and `turn_completed` — which it does by definition, before and
after the flip, because those are not ACP updates. It measured nothing. It now replays the recording
through the content presenter, the way OpenCode's row has since wave 4, and the unconsumed list is
**empty**: every update the recording carried draws something. Dropping either vendor update reds it.

Gates: unit 477 suites / 7,658 tests, typecheck, `eslint` over `src` and `tests` clean.


### Review L1, L2 and L3 — the Claude pass (this commit)

**L1.** `ClaudePlanUsageStore.recordSdkMessage` had no caller anywhere. The plan indicator for this
provider is fed from the SDK's own `result` and rate-limit messages and from nothing else, so it was
fed by nothing at all — the same class wave 2 found and fixed for Codex, which Claude never got. The
content presenter now hands every message to an `onUsageMessage` port and the composition records it,
refreshing the indicators when the store took something. Pinned end to end: the fake SDK's result
carries a cost, and the composition test reads it back out of the store.

**L3.** The Stop hook was built with `() => ({ hasRunning: false })` — hardcoded, with a comment
saying the runtime half would own it. So a stop that arrived while a subagent was working ended the
turn under it, which is exactly what the hook exists to prevent. The tab already installs a provider
through `setSubagentHookProvider`; the turn now carries it, because the hook goes into the SDK
options a *turn* is started with and the answer belongs to a *tab*. The composition's own hook stays
as the fallback for a turn that carries none.

**L2.** `claude-wire.json` has been in the tree since M0b with nothing asserting anything about it —
the row this file was created for. It now replays the recording through the content presenter, like
OpenCode's and Grok's rows.

Two attempts at that row measured nothing, and both are worth keeping in mind for the next one:
counting a message as consumed because the usage *port was called* marks everything consumed, since
every message passes through it — so the row asks whether the store **took** something instead. And
counting the session id as consumption marks everything consumed too, because every message carries
`session_id`; `system/init` is therefore listed as unmodelled with the reason written down, rather
than credited for something this row cannot see.

Gates: unit 477 suites / 7,662 tests, typecheck, `eslint`, and `build:release` clean.


### Review A1 and A2 — the two ways an ACP conversation could stop working (this commit)

**A1, the one that wedges a conversation for good.** `onConnectionLost` only did anything when a run
was active: it recovered that run. With nothing running — the agent exits between turns, the machine
sleeps, the CLI is upgraded — the dead client stayed, so the next turn dispatched into a closed
transport and failed `invalidated`, and so did the one after it, and the one after that, because
nothing ever cleared the client. Only a reload fixed it. The legacy path handled this; the migration
dropped it, which is the failure mode this journal's rule about harvested fixes exists to catch.

A client lost while idle is now closed, so the next turn launches a process. The regression test is
the shape of the bug: run a turn, kill the client between turns, run another, and require it to
succeed. Without the close it fails.

**A2.** `AcpSessionUpdateNormalizer.normalize` promised an `AcpNormalizedUpdate` and had no `default`
and no trailing return, so an update outside its union came back `undefined` and the presenter read
`.type` off it. The union is exhaustive only if the wire is — and the vendor channel exists precisely
because it is not: Grok's three updates are why. There is a `default` now, answering
`{type: 'unsupported'}`, and the caller decides.

Gates: unit 477 suites / 7,664 tests, integration 5 suites / 145 tests, typecheck, `eslint` clean.


### Review K1, K2 and S2 — a turn nobody asked for, and a path on Linux (this commit)

**K1, and the second thing it uncovered.** The adapter called the auto-turn callback with a run id;
the only consumer takes an `AutoTurnResult` and reads `result.chunks`, so a backend-initiated turn
would have thrown inside the registry's observer, where the throw is swallowed. The adapter now
*streams* such a run — it is the thing that knows how an envelope becomes a chunk — and hands over
the turn, dropping the stream as it settles.

Writing the test found the rest of it: **the observer was only attached when this tab started a
run**. A turn the backend begins on its own arrives when the tab has asked for nothing, which is
precisely when there was no subscription to hear it. It is attached when the session is established
now; both halves have a row that goes red without them.

**K2 is refused, with evidence.** The review read `wasSent` as reporting `false` for a cancelled
turn. It does not: `wasSent` is false only for `invalidated`, and the terminal policy allows exactly
two reasons there — `pre-dispatch-rejected` and `side-effect-free-rejection`, both meaning the turn
never reached the provider. A dispatch that *might* have landed is `indeterminate`, which reports
true, and a cancelled turn already has a row asserting `wasSent: true`. Nothing changed; the backlog
records it as refuted rather than quietly dropped.

**S2.** The D7 path redaction listed `/Users`, `/Volumes`, `/private`, `/tmp`, `/var` and Windows
drive letters — macOS and Windows. On Linux a home directory went into the debug log verbatim,
usually through a CLI's own stderr. `/home`, `/root`, `/opt`, `/srv`, `/mnt`, `/media`, `/etc` and
`/usr` are redacted too now. The row keeps the error word and drops the paths, because a log that
redacts the message as well is a log nobody can debug from.

Gates: unit 477 suites / 7,666 tests, integration 5 suites / 145 tests, typecheck, `eslint`, and
`build:release` clean.


### Review A3 — what a process said before it failed (this commit)

Two diagnostics the managed launcher lost, both of which the legacy path had:

- **the spawn error.** An `ENOENT` was rethrown raw, so a missing CLI reached the surface as a
  transport failure — and, through the provider's pre-dispatch wording, as advice to start a new chat
  about a CLI that is not installed. `describeAcpSpawnError` is the legacy wording, moved out of
  `AcpSubprocess` so both paths to an ACP process share it: "command not found. Set an absolute CLI
  path in the provider settings — desktop apps do not inherit the shell PATH", or the other thing an
  `ENOENT` means, a working directory that is gone;
- **the process's own last words.** stderr was drained into `void chunk`, so a non-zero exit said
  "exited with code 1" and nothing about the missing module or the rejected credential the CLI had
  just printed. A bounded tail is kept — 4 KB held, 300 characters shown, on one line, because this
  reaches an error message.

Reading stderr with a listener rather than `for await` is the part worth remembering: the iterator
yields on a later tick, so a process that prints and exits in the same breath — which is exactly what
a failing launch does — was described before its own output arrived. The test caught it as a race
and the fix removes the race rather than waiting on it.

That closes the review's prioritized list. Gates: unit 477 suites / 7,668 tests, typecheck, `eslint`,
and `build:release` clean.


### Second review — six findings, all real (this commit)

A second review, this time a single reader over `d9f715e..2c80d7f`: the Grok flip plus the whole
prioritized backlog the first review produced. Six findings, and every one held up against the tree.
Recorded as the second half of
[`docs/providers-migration-review-backlog.md`](providers-migration-review-backlog.md); this entry is
what the fixes taught, not a second copy of the list.

**The one that would have shipped.** Making control records belong to the conversation (D4) gave the
adapter a reason to drop its session when the conversation changes — and `resetSession()` dropped the
session without dropping the observer bound to it. `attachSideChannels` installs at most one, so the
next session got none: content still streamed, because the per-run observer is separate, while every
approval, every question and every backend-initiated turn went nowhere. New Chat and a history
switch in the same tab both take that path, on every flipped provider. `cleanup()` had always done it
correctly, which is the tell — one of two call sites was written and the other was assumed. The new
test watches which session id the adapter observes across a switch, and that the first subscription
is released.

**Three of the six could not be fixed where they were reported.** That is the part worth carrying:

- **deletion cannot ask a surface to have stopped first.** `deleteConversation` cancelled
  fire-and-forget and disposed with `void`, then removed records — so a live run made the removal
  throw while the chat was already gone from the UI, or an idle session was yanked out of the map
  with its ACP process still running. Neither is fixable by adding an `await` at the call site,
  because there is nothing there to await. `deleteOwnedRecords` now cancels the owner's live runs and
  disposes its sessions itself, through the same queue every other session operation takes, and
  `disposeSession` became idempotent because a tab reset and a delete both legitimately ask for the
  same session. The refusal that survives is the **lease**: cancelling reaches a run, and nothing
  reaches a holder still reading the session. The test that asserted the old refusal now asserts the
  new closing, with a second test pinning the lease.
- **a Stop needed evidence, not a better verdict.** `noteTurnEnded` ran only from
  `completeFromPrompt`, and Stop goes through `terminate()`, which reconciled and finished in a
  microtask — so the prompt's own answer always arrived after the terminal. Both ACP reconcilers
  answer `unknown`, so Stop read as "Grimoire could not establish whether this run completed" for the
  one outcome the user asked for and watched happen, and the cancelled turn's cost was lost. ACP
  answers a cancelled turn *on the prompt itself*, so `terminate()` now waits for that answer — the
  control timeout bounds it, and the last look happens on the way past, once, whichever path gets
  there first. The answer is then handed to the reconciler as `RunRecoveryQuery.nativeStopReason`
  rather than short-circuiting it: **a turn reporting itself cancelled says nothing about a process
  whose termination could not be proven**, and those are different questions. The conformance row
  that pins the second one stayed green without being touched, which is what says the distinction is
  real. `acpCancellationEvidence` is the shared helper both compositions read it with.
- **the two ACP fakes were wrong about cancellation.** Both swallowed `session/cancel` and left the
  prompt open forever — an agent no ACP implementation is. Teaching them to answer is what let the
  waiting land without changing a line of the shared conformance suite; the one test that genuinely
  models a disagreement (the agent had already finished when the cancel arrived) says so explicitly
  now instead of by omission.

**A missing CLI is a failed spawn, not a rejected turn.** A3 gave the launcher the right words and
nothing carried them: `start()` mapped everything before dispatch to `invalidated` /
`pre-dispatch-rejected`, which both ACP providers word as a saved session that may no longer exist.
`describeAcpSpawnError` now returns a typed `AcpSpawnError` for the errnos that mean the process
never ran, and the run answers `failed` / `spawn-failed` — the reason the local-shell and Antigravity
backends already gave. Only `ENOENT` is reworded; an error this code cannot explain is classified but
left in its own words.

**The rest.** `followBackendRun` consumed the per-tab metadata port, which would have taken a live
turn's native ids for a turn nobody asked for — latent, and it is the code the K1 fix added. It reads
the port only when no turn of its own is running, and an abandoned backend stream is dropped rather
than rendered into whatever conversation the tab moved to. Five compositions still described
themselves as dark, two JSDoc blocks sat on the wrong symbols, and `autoTurn` was still typed
`(runId: unknown) => void` after K1 changed what it receives.

Every one of the eight new tests was run against the code with its fix removed, and every one went
red — including the two that needed a second attempt, because the first version of each passed
either way. The last-look test passed without the `terminate()` call, because the prompt path takes
the look when the agent answers; the one that pins it is the agent that never answers. And the
abandoned-turn test passed without `abandon()`, because an unsettled stream delivers nothing anyway;
what it actually pins is the guard that refuses to deliver.

Gates: unit 477 suites / 7,677 tests, integration 5 suites / 145 tests, typecheck, `eslint`,
`build:release`.

### The rest of the first review — K3, K4, K5, S1, S3 and the two QA notes (this commit)

The seven rows nobody had started, taken together because they are small and none of them belongs to
a provider. With them the first review is closed: every row fixed, or in K2's case refuted.

**K3 — the session record was a history, and it was rewritten on every event.** `runIds` only ever
grew, so a conversation's hundredth turn wrote a hundred-entry array on every delta of every later
turn. The list is now what is still *unfinished*: a run that reaches a terminal leaves it. Nothing is
lost, because a run record already names its own session and its own owner — which is what deletion
and a restart read. What the list quietly doubled as, though, was this process's memory of every turn
a session ever ran, and disposal needs that; so the entry keeps it as a `Set` of ids that never
leaves the process, rebuilt on a restart from the run records themselves.

**K4 — core reached for the browser's timer, and two rules disagreed about it.** The adapter is
provider-neutral and the boundary gate holds it away from the DOM; Obsidian's own review, though,
wants the browser's timer so one scheduled from a popped-out view belongs to the window it runs in.
Both hold at once only if the browser call sits on the host's side of a port — so `delay` is now a
port, required rather than optional, and `src/app/execution/hostTimers.ts` is where the browser call
lives. The gate gained `window.` beside `document` and `HTMLElement`, and the adapter joined the
strict list. One consequence worth knowing: the gate matches the whole file, comments included, so a
strict module has to explain that rule without writing the word it forbids.

**K5 — `shutdown()` could wait forever.** An admission is held for the whole of `createSession`, the
part inside the provider included, and `waitForAdmissions` waited on it unbounded while every other
wait in that method already had the grace period. A CLI that hung on session creation held the
plugin's unload open with no way out. It now gives up like everything else — and the work it gave up
on refuses to register itself when it finally returns, so a late session closes rather than joining a
registry that has already written its checkpoint.

**S1 — one click could grant everything.** "Always allow" promoted the agent's suggested rules
wholesale, and `{toolName: 'Bash'}` with no pattern is permanent approval of every command Claude
ever runs in the project. The suggestion is the *agent* proposing its own permissions, and the agent
is the party being restrained, so a rule that reaches wider than the action on the card is not a
shortcut — it is the request edited after the click. Promoted rules are now clamped to the approved
action, `replaceRules` is never promoted at all (it can remove denials the person put there), and a
`setMode` that would stop the asking is dropped. The review asked for two things and the second was
the point: the card now *says* what the button grants, from the same call that builds the grant, and
it says "Allows every Bash call for this project" when that is what it means.

**S3 — a conversation's id is a file name, and Grimoire does not mint it.** It is the provider's
session id whenever one was resumed, interpolated into `.grimoire/sessions/<id>.meta.json` unchecked
— and the vault is the user's own notes. Ids are validated now, and metadata goes through the same
recoverable replacement the control store uses, so a write torn by a crash leaves the previous
transcript readable instead of truncated JSON that `loadMetadata` answered as a conversation that no
longer exists. `SessionStorage` takes its durable store as an argument rather than building one:
`src/core` is not where a vault-shaped implementation belongs.

**Q1 — a matrix nobody has run looked exactly like one that passed.** The manual matrices are
deliberately manual, but the only record of when one last ran was its own table four documents deep,
and two of the four had no table at all. All four have one now, `never` is a real answer in the Date
column, and `liveMatrixRecords.test.ts` both enforces that and carries the summary — Claude never,
Codex never, Grok and OpenCode 2026-08-20.

**Q2 — the boundary gate could only see one import syntax.** `import()` and `require()` were
invisible to every rule in that file, which is the shape a violation takes when a static import would
be circular. No violation existed, which is the reason to close it now rather than after one does.

Nine new tests, each run against the code with its fix removed. Gates: unit 478 suites / 7,698 tests,
integration 5 suites / 145 tests, typecheck, `eslint`, `build:release`.

### The fourth live harness, and all four matrices run (this commit)

Claude was the only flipped provider without one. Codex, Grok, OpenCode and Antigravity each had a
harness that drives the mechanical half of their matrix against a real CLI; Claude's matrix — the
longest of the four, twenty-eight rows — had never been run at all, and neither had Codex's.

**Why Claude had none, and what it took.** `jest.config.js` maps
`@anthropic-ai/claude-agent-sdk` to a mock for every suite in the repository, which is right for all
of them except this one. The package is `"type": "module"` with an exports map offering no CommonJS
entry, and ts-jest rewrites `await import(...)` into `require(...)` — which puts the module straight
back through the mapper. The harness loads it by absolute URL through
`tests/helpers/loadEsmModule.js`, a plain `.js` file the transform does not match, and hands it to
the composition through the seam that already existed for exactly this: the optional `queryFunction`
on `createBackendRegistration`. It needs `NODE_OPTIONS=--experimental-vm-modules`, because a dynamic
import inside Jest's VM context is gated on that.

**Ten of the twenty-eight rows now run themselves**, and the first run found two things — both about
the SDK rather than about Grimoire, and both of which had made a row pass while proving nothing:

- **Claude Code decides for itself that a read-only shell command is safe.** `echo` never reaches
  `canUseTool`. The first version of row 2 approved one and read the absent prompt as a missing
  prompt; isolated against the raw SDK, a command that *writes* asks every time. The row asks for one
  now.
- **An unknown model name is not an error.** The SDK accepts `no-such-model-grimoire-live` and
  answers anyway, so the deliberate-failure row was green on a turn that succeeded. It points the CLI
  path at a binary that is not there instead.

A third thing is worth recording as a non-finding: `getSupportedCommands()` answers empty for Claude,
because the workspace half is still registered the legacy way and `listCommands` throws by name —
the gap this matrix already documents. Row 19 asks the question it can actually answer: `/compact`
sent as a turn reaches the provider, which answers in its own words ("Error: No messages to
compact"), rather than being answered locally.

**All four matrices were then run**, three of them as a re-run against the two review passes. That
matters most for Grok and OpenCode: a Stop now waits for the prompt ACP answers a cancelled turn on,
which is the shared backend's cancel path for every ACP provider, and row 6 is green in both. Codex
and Claude are green on their own harnesses. Q1's gate carries the summary, so all four now read
`2026-08-21` instead of two `never`s.

What is left is genuinely manual, and now written down as such:
[`docs/manual-smoke-instructions.md`](manual-smoke-instructions.md) is a document for a person with
Obsidian and a scratch vault, not for a developer — 18 rows for Claude, 14 for Codex, 8 for OpenCode,
7 for Grok, with the fiddly ones spelled out.

Gates: unit 478 suites / 7,698 tests, integration 5 suites / 145 tests plus four live suites run by
hand, typecheck, `eslint`, `build:release`.

### The one thing the Claude harness found that was ours (this commit)

Two of the three things the first Claude run turned up were the SDK's, and are written down in that
matrix. The third was a flag: `allowDangerouslySkipPermissions` is set in **every** permission mode,
including the ones whose whole purpose is to ask, and the comment justifying it pointed at
`ClaudeChatRuntime` — deleted at the flip.

Probed rather than reasoned about, because the answer decides whether it is a defect. It is not: the
CLI refuses `setPermissionMode('bypassPermissions')` on a session that was not launched with the
flag — *"because the session was not launched with --dangerously-skip-permissions"* — so a query
started in normal mode could never be switched to full access without restarting the process and
losing the session. The flag is load-bearing, and tightening it to "only where it is used" would
break the toolbar switch at the moment somebody used it, with nothing in the suite noticing.

So what changed is the part that was actually wrong: the comment now says why, and a test pins both
halves of the trade — the consent is carried in all three modes, and `full_access` is the only one
that reaches `bypassPermissions`. The other side of that safety argument is already enforced
elsewhere: an agent's own `setMode` suggestion riding an approval is refused in
`buildPermissionUpdates`, which was S1.

**A flake worth naming rather than waving through:** one run of the unit suite failed
`GrimoireSettingTab settings hub › renders each top-level tab once and reuses it on later switches`,
a suite this commit does not touch. It passes in isolation and in two consecutive full runs
afterwards. Owner: whoever meets the next red on it — if it repeats, it is shared state between
suites rather than noise. **It repeated, and the guess above was wrong**: see the KER-2/3/4 entry
below for what it actually was.

Gates: unit 478 suites / 7,699 tests, typecheck, `eslint`, `build:release`.

### The third review's kernel cluster — KER-2, KER-3, KER-4, and the flake (this commit)

Three lifecycle and growth edges, none of which questions the design. What they had in common is
the unhappy path: a restart, a sweep, a race.

**KER-2 — consumed and then kept.** D3 retains shutdown checkpoints and settings transitions "until
consumed at next startup". Startup consumed them and left them, so one file per unload accumulated
for the life of the vault, each one listed and read in full by every later startup, and every
terminal rescanned every transition to ask whether a backend was quiescent. Both are removed once
read now, which bounds the pair at what the last unload wrote.

**KER-3 — C1 was only true within one process.** The maps were bounded by the tabs that are open;
a restart went the other way and loaded every run and interaction the vault has ever held, terminal
ones included, with no path to let go of any of it until the conversation was deleted. A start now
keeps live work plus whatever belongs to a session it is about to reopen, and leaves a finished run
of a closed conversation on disk — where deletion and an honest history read it. The second half was
underneath: `VaultDurableStorage.list()` read every file in full to decide it existed, so
enumerating the control store read the control store. It recovers and probes now, which is what the
read was actually for.

**KER-4 — a delete could race a session into existence.** A session registers only after its
provider answers, so a conversation deleted during its first session creation either missed a record
that did not exist yet, or removed the records of a session that went on to register — live, holding
a provider process, owned by a conversation that no longer exists. Creation and deletion are the
only two operations that are about an *owner* rather than a session, and they are exactly the pair
that must not interleave, so they share a queue now.

**The flake, and a correction.** The settings-hub test that failed once during the previous commit
failed again, and the note there guessed shared state between suites. That was wrong. A settings tab
renders behind two nested `requestAnimationFrame` calls, which the test environment polyfills as two
chained macrotasks; the test waited a fixed 50ms for them. Under a full parallel run those did not
reliably land inside it, and the render simply had not happened — reproducible in roughly one run in
four, which is how it was caught. It waits for the render now instead of sleeping through it, and
five consecutive full runs are clean.

Gates: unit 478 suites / 7,725 tests, integration 5 suites / 145 tests, typecheck, `eslint`,
`build:release`.

### CLA-2 and MK-1 — the last two Important of the third review (this commit)

**MK-1** is mechanical: MiMoCode and KimiCode each hand-rolled the approval mappers that already
exist in `src/providers/acp/acpApprovals.ts`, reusing the shared names without importing them. They
import them now. The one behavioural difference between the copies and the original is pinned by a
new row in both suites: a `select-option` decision was checked *last* locally and *first* in the
shared mapper, so a provider offering a fourth option by name was answered differently depending on
which copy ran.

**CLA-2 is closed differently from how it was filed**, and the difference is the point. The finding
was that the legacy runtime's history injection — resume answers with a different session id, so
rebuild the context in the next prompt — was dropped at the flip. True. What the re-check found
underneath it is worse than the lost context: the refused resume left the conversation's binding
*stored*, so the next turn asked for the same missing session and was refused the same way, and the
one after that. A conversation that lost its context is recoverable by anyone who reads it; one that
cannot take another turn is not.

So the wedge is fixed first: the backend tells the tab which session stopped resuming, routed by
execution session id because one backend serves every tab, and the tab lets the binding go through
the one-shot the save path already reads. What deliberately did **not** change is the kernel's record
of what the session was asked for — a refused identity must not adopt the wrong id, and must not
forget the right one either, which an existing row pins.

**Still owed:** re-injecting the conversation history so the next turn keeps its context rather than
only its ability to run. `src/providers/claude/AGENTS.md:17` describes that injection as provider
behaviour and it is not implemented on this path. Owner: M5, with the auxiliary work — it needs the
transcript, an encoder and a size policy, which is a feature rather than a repair.

With these two, **every Important of the third review is closed**: KER-1..4, CLA-1, CLA-2, MK-1,
GQ-1..5, QA-1, QA-2 — plus the settings-hub flake, which was nobody's finding.

Gates: unit 478 suites / 7,728 tests, integration 5 suites / 145 tests, typecheck, `eslint`,
`build:release`.

### The third review closed, and a Kimi wire recording (this commit)

The last six rows, and none of them was fixed by writing code where writing code
was wrong.

**KER-7 had a root cause the finding did not name.** A tab that opens a session
before any conversation is bound owns it, and the adapter only let a session go
when the conversation *changed* — never when the first one arrived. So the
session carried forward under an owner no conversation deletion looks for, and
no clock expires a run record. Both halves are closed: the adapter lets go when
a tab binds its first conversation, the compositions call an unbound tab's
session `internal-service` rather than a conversation's, and a startup sweep
removes what older builds already wrote.

**CLA-7 was two problems with one symptom.** The merge in `save()` is a
read-modify-write that nothing serialized, so two overlapping saves meant the
second read before the first wrote and the loser's permissions vanished; and the
write was direct, so a crash left this file — Claude Code reads it too — as
truncated JSON. Serialized, and staged beside the file then renamed over it.

**CORE-3 is deferred, with evidence.** Unifying the two YAML engines turns six
rows red: documents Obsidian rejects and the `yaml` package accepts, where the
tolerant fallback stops running and the values change with it. That is a
migration of how existing vault files parse, not a tidying job, and the file now
says which engine reads what and why.

**CORE-7 was not a leak but a different capability.** `VaultTextIndex` reads
Obsidian's metadata cache and its cached-read path, which the storage adapter
neither offers nor should grow to — so it took a port. `src/core/context/` no
longer imports the plugin host at all.

**MK-7 is half closed with real traffic.** Kimi Code had no wire recording, which
is a stated precondition of its flip. It has one now, taken from `kimi acp`
0.38.0: `initialize` complete, and `session/new` as the refusal an
unauthenticated CLI gives — itself a shape the flip will meet. Redaction is
inside the recorder rather than a step after it, because the first Grok capture
carried a live key. And both partial recordings now *say* they are partial,
pinned by a new row: a thin recording and a whole one look identical on disk,
and a flip that reads "we have a recording" plans against traffic nobody took.

**The remaining four were already right and needed saying so** — CLA-6's M5 seam,
GK-7's adjacent-only mirror dedup (with the trigger for a window written down:
evidence, not suspicion), ACP-4's fenced duplicate runner with its cost named,
and MK-3/MK-4's pre-flip warmup shapes.

**Every row of all three reviews is now closed**: 1 Critical, 28 Important, 60
Minor, three refuted with evidence and two deferred with it.

Gates: unit 481 suites / 7,678 tests, integration 5 suites / 145 tests,
typecheck, `eslint`, `build:release`.

### Wave 6 opens: both wire recordings taken (this commit)

The plan puts a recording before a flip, and wave 6's two providers were the
reason it had not started: MiMoCode's was partial and Kimi Code's was absent.
Both are taken now, from the CLIs themselves rather than from a sibling's
adapter — `mimo 0.1.13` and `kimi acp` 0.38.0 — by one shared recorder, because
writing it twice for two providers that speak the same protocol is the drift
recordings exist to catch.

**Both are partial, and both say so.** MiMoCode's account still cannot generate:
the turn returns `end_turn` with zero tokens and no assistant content. Kimi
Code's machine is not logged in, so `session/new` answers "Authentication
required" — itself a shape the flip will meet on a fresh install. The handshake,
the session's config options and the empty-turn shape are evidence; the prompt
traffic is not, and a new row in the wire gate pins which recordings are partial,
because a thin one and a whole one look identical on disk.

Three things the recorder got wrong before it was right, each caught by a gate
rather than by reading:

- it called MiMoCode's recording **complete** on the strength of the two updates
  a session emits when it *opens* — a turn that returned nothing was marked as
  answered. Coverage now asks whether the turn produced assistant content;
- it sent `value: null` to `session/set_config_option` and recorded `Invalid
  params` — the shape of a malformed call rather than the round trip a turn
  makes. It sends the option's own current value now;
- its elision appended the marker *after* slicing to the 200-character bound, so
  every elided string came out at 211 — over the bound the fixture gate enforces,
  which said so in fifty-four places.

The first re-recording also replaced MiMoCode's fixture with a thinner one that
had lost `session/set_config_option` entirely. The new one matches the old
coverage exactly — same cases, same updates, same ten exchanges — taken fresh.

### Wave 6, first code: MiMoCode's module and backend, dark (this commit)

The module and the descriptor its backend runs under. Both unreachable, both
listed as such in the parity manifest, and the flip is a later checkpoint —
`registration.ts` still points `createRuntime` at `MimocodeChatRuntime`.

**Derived rather than reasoned out, deliberately.** MiMoCode's settings module
is byte-identical to OpenCode's modulo the provider name, and its capability
record is too; `AGENTS.md` says a change to one of these two is usually a change
to both. So the module is OpenCode's with the names swapped — and then read end
to end, because a derived file inherits *claims* along with code. Two kinds had
to go: the header called this "proof four, the last topology" and said the
composition builds from it, neither of which is true of a sixth module that
nothing constructs.

**The wire recording caught the first inherited untruth before any code used
it.** OpenCode's execution trace lists `set-config:variant:high` among its
dynamic configuration. MiMoCode's session offers `model` and `mode` and no
`variant` — so the derived trace would have declared a capability the provider
does not have, in the file the module test asserts against. The trace is written
from the recording where the recording speaks: two config options rather than
three, plus the two updates the session emits when it opens
(`available_commands_update`, `usage_update`), which OpenCode's trace does not
name.

What the recording still cannot confirm is the answer traffic — that account
does not generate — and the module says so where a reader will meet it rather
than in a doc they may not open.

Gates: unit 482 suites / 7,693 tests, typecheck, `eslint`, `build:release`.

### Wave 6: MiMoCode's provider-owned execution parts (this commit)

Five modules the composition will be built from — the dynamic-config applier,
the filesystem delegate, the interaction bridge, the interaction presenter, the
result sink — plus one that is not dark at all.

**The permission vocabulary was moved, not written.** MiMoCode's legacy runtime
carried its own copy of `buildMimocodePermissionPresentation`, ~200 lines of it,
and now imports it from `execution/MimocodePermissionPresentation.ts`. That
makes the extraction reachable the moment it exists, so it is deliberately *not*
in the dark list beside the other five, and the manifest says why. It also means
the flip cannot produce a second opinion about what MiMoCode is asking for:
there is one copy of those sentences, and both paths read it.

The test asserts the sentences themselves rather than that a sentence exists.
Rewording an approval prompt is a change to the product, and it should have to
be typed into a test to happen. Breaking one word failed three tests — the new
one, the interaction test, and `MimocodeChatRuntime.test.ts`, which is the
evidence that the runtime really delegates rather than keeping a copy.

**The recording decided the effort question rather than the sibling did.**
OpenCode's applier sets mode, model, then a thinking level under whatever config
id the session names. Whether MiMoCode has that third call is not a thing to
reason about: mimo 0.1.13 offers `model` and `mode` and carries its thinking
level *inside the model id* (`.../low`, `.../medium`, `.../high`). So the test
feeds the applier the config options the recorded session actually answered
with, and asserts one call goes out where a guess would have sent two. The other
half is tested too — a session that does report a thought level gets it set —
because MiMoCode's legacy runtime handles both shapes and a later CLI growing
one must not need this rewritten.

One inherited claim corrected before it landed: the filesystem delegate's
comment counted "five legacy runtimes" copied from OpenCode's. Six providers
speak ACP here and I had not counted them, so the comment now says only what was
checked — that MiMoCode's own runtime carries the same three behaviours.

Every module proven by breaking it: reworded prompt, an effort set without
asking the session, the filesystem refusal borrowed from a sibling's label, the
answer smuggled into a result ref, and the bridge wired to no vocabulary. Five
breaks, five caught, restored green.

Gates: unit 487 suites / 7,729 tests, typecheck, `eslint`.

### Wave 6: the three large parts, and a second extraction (this commit)

`MimocodeContentPresenter`, `MimocodeExecutionRequests` and
`MimocodeSessionConfigState`. The first two are dark and listed as such; the
third is not, for the same reason the permission vocabulary is not.

**`MimocodeSessionConfigState` was moved out of the runtime, not written beside
it.** Five fields and seven methods — which model, mode and thinking level a
turn runs under, and what to do with the lists a session reports back — left
`MimocodeChatRuntime`, which now holds one `sessionConfig` and delegates. Before
touching anything I diffed the runtime's copy against OpenCode's extracted class
with the provider names normalised away: the bodies are the same modulo
`this.plugin.*` becoming `this.ports.*`, which is what made the move safe to do
mechanically.

Two things the diff surfaced that a straight copy would have got wrong. The
runtime clears *five* fields when the conversation changes but only *two* when
the process dies, and OpenCode's class exposes only the wide reset; widening the
narrow one would have been a behaviour change wearing a refactor's clothes, so
`forgetProcessSelection` and `forgetSessionModel` exist and say in their comments
why they are narrower. And the port I first wrote handed
`emitPermissionModeSync` an already-resolved permission mode where that helper
expected a mode *id* and resolved it a second time — three of the runtime's own
tests went red on it, which is exactly what they are for.

Seven of the runtime's tests read the moved fields through `as any`. Six now read
them at their new address. The seventh poked three private fields to fake a
session that offers a thinking level; it now seeds them by calling
`syncSessionModelState` with the config option a session would actually answer
with, which is the path `applySelectedEffort` depends on anyway.

**Two modules arrived untested and it showed.** Breaking the content presenter's
double-print guard changed nothing red, because nothing exercised it — so
`MimocodeContentPresenter.test.ts` and `MimocodeExecutionRequests.test.ts` were
written before moving on, with the recorded session's own values in them: the
model id, the `build` mode, the `init`/`review` commands and the 1 MiB context
window `mimo acp` actually reported. Not the answer traffic, which that account
cannot produce; the chunk shapes there are the normalizer's, and the test says so.

One break went uncaught and is worth writing down rather than papering over:
filtering `text` chunks for *both* roles instead of only the assistant's fails
no test — because a user chunk never produces one. The role check is defensive,
not load-bearing, and no test should claim otherwise.

Every other break caught: a widened process reset, a model reset that also drops
the mode, `desiredEffortValue` gated like its sibling, the runtime keeping its
own copy of `resolveSelectedModeId`, the assistant text unfiltered, a prompt held
after dispatch, the wrong subcommand, and the launch key travelling into a
control record unhashed.

Gates: unit 490 suites / 7,756 tests, typecheck, `eslint`.

### Wave 6: the composition, dark, and a harness that had been lying (this commit)

`MimocodeExecutionComposition`, `MimocodeMetadataSession` and
`MimocodeModuleContext`, all dark and all attributed. Nothing constructs a
`MimocodeExecution`: `registration.ts` still points `createRuntime` at
`MimocodeChatRuntime`, and the flip is the next checkpoint and one commit.

**The composition test runs before the flip, not after.** A flip that has to be
reverted to be tested is a flip nobody will revert, so the 21-case seam suite
drives whole turns through the assembled composition with a fake ACP client as
the only stand-in — the launch, the prompt, the permission, the session config,
the resume, the metadata process, the MCP restart. What the fake answers with is
the recorded session's own: the model id, the `build` mode and the 1 MiB window
`mimo acp` reported. Not the turn's answer, which that account cannot generate;
those chunks are the protocol's shape and the header says so.

Two header claims corrected on the way through: the derived file called itself
**Flipped** and "the first ACP provider to reach the kernel". It is neither. And
two reference prefixes — `ocreq`, `ocix` — survived the name substitution
because a substitution only reads words; two providers minting `ocreq` would be
two stores answering to one prefix in a debug log.

**Six breaks, four caught, and the two misses were the point.** Allowing a write
on a session no open tab owns changed nothing red, and neither did pushing the
session's own default agent at the toolbar. Tests were written for both — and
the first refused to fail even then, because the harness ran on `full_access`,
where every write is allowed before anyone is asked.

**Which uncovered the real find.** The second test still would not fail, and the
reason was the harness: its fake plugin has no `saveSettings` and no
`getAllViews`, both of which the session-open handler calls. It threw halfway,
the composition caught and logged it as designed, and every test in the file had
been running against a *half-applied* session — models seeded, modes never asked
about. Which reads exactly like a composition that never asks about modes.

That harness is derived from OpenCode's, and OpenCode is **flipped and live**.
Its suite had the same hole; Grok's, written later, does not. Both are fixed
here, and OpenCode's 19 cases still pass with the handler running to the end —
so the gap cost coverage rather than correctness.

Gates: unit 491 suites / 7,777 tests, typecheck, `eslint`, `build:release`.

### The MiMoCode flip (this commit)

`registration.ts` points `createRuntime` at `plugin.getMimocodeExecution()
.createRuntime()`, `main.ts` constructs and registers a `MimocodeExecution`
beside the other three, and `MimocodeChatRuntime.ts` is deleted — 1,850 lines,
with its 51 KB test file. One commit, and reverting it puts every MiMoCode tab
back on the legacy path: the `.grimoire/control/**` records the kernel writes
are inert to it.

The third ACP provider, and the one that proves the platform: it added nothing
to the shared stack. Same managed backend, same client adapter, same launcher,
same permission bridge. What is MiMoCode's is the `mimo acp` launch, a database
per conversation, and a thinking level that lives inside the model id.

**The four metadata surfaces moved with it.** `MimocodeSettingsTab`,
`MimocodeChatUIConfig`, `MimocodeWorkspaceServices` and
`MimocodeRuntimeCommandLoader` each used to construct a whole
`MimocodeChatRuntime` and drive it as far as a session, only to read the reply.
They now share one isolated metadata session against an in-memory database.
`MimocodeRuntimeCommandLoader` gained the behaviour OpenCode's has and this one
did not: a blank tab has a runtime and no session, and asking that runtime
returns nothing at all — which is how a fresh tab ends up with an empty slash
menu until the first message is sent.

One assertion changed meaning rather than address, and it is worth naming: the
settings tab used to warm metadata by handing the runtime an *encoded* selection
id (`mimocode:deepseek/...`) which the runtime decoded again. The metadata
session takes the raw id, so the test now asserts `{ rawModelId }`. Same model,
one less round trip.

MiMoCode also leaves `AcpManagedMcpRuntime.test.ts`, which now covers three
legacy ACP runtimes rather than four.

**A flake seen once and not reproduced.** One full unit run failed a single test
during this work; its name was not captured, and thirteen subsequent full runs —
ten idle, three under six busy cores — were green. Recorded rather than passed
over: an unexplained failure that stops happening is still an unexplained
failure, and the next person to see one here should know it is the second.

Gates: unit 490 suites / 7,734 tests, integration 5 suites / 145 tests (47
env-gated skips), typecheck, `eslint`, `build:release`.

### The MiMoCode live run: five green, eight red, and the reason is not the flip (this commit)

The harness exists, it ran against a real `mimo acp`, and it is the first live
matrix that mostly failed. That is the honest result and it is recorded as one:
`docs/mimocode-flip-smoke-matrix.md` has a Record row saying which rows passed,
which failed, and why.

**Every failing row fails for the same reason: this account cannot generate.**
Every turn returns `end_turn` with zero tokens, and the surface shows *"The
provider ended the turn without producing a result."* Rows 1, 2, 5, 7, 8, 12,
13 and 15 all need an answer, and there is none to look at.

Two independent controls say this is the account rather than the integration.
The wire recording was taken from `mimo acp` **directly**, with no Grimoire in
the path, and shows the same empty turn — which is why it has said
`coverage: partial` since it was taken. And row 1 of OpenCode's harness, the
same code on the same machine, returned thinking, text and usage in the same
session as MiMoCode's failures.

**What did pass is not nothing.** Row 6 stopped a running turn and left no agent
behind. Row 9 produced the pre-dispatch failure sentence for a session that no
longer exists. Row 8 resumed the conversation and got back *the same session id
it was told* — the resume path, the database carried per conversation, and the
kernel's session binding, all confirmed against the real CLI. Row 17 filled the
catalog with 16 models from an empty vault and row 18 listed 103 announced
commands, both through the isolated metadata session that replaced four
constructed runtimes.

The harness gained one thing OpenCode's does not have: `summarize` now renders
an `error` chunk's text instead of the bare word `error`. Without it the first
run reported twelve rows of `["usage","usage","error"]` and said nothing about
why — the sentence that named the cause was in the chunk it was dropping.

`liveMatrixRecords.test.ts` now reads five matrices, and MiMoCode's date is
2026-08-22. The date answers "when did this last run", not "did it pass" — which
is what that gate has always meant, and this is the first row that makes the
difference visible.

`docs/manual-smoke-instructions.md` deliberately leaves MiMoCode out: asking a
person to check whether a tool card renders, in a build where no turn produces
one, would waste their hour.

Gates: unit 490 suites / 7,736 tests, integration 5 suites / 145 tests (59
env-gated skips), typecheck, `eslint`, `build:release`.

### Kimi Code: everything but the composition, dark (this commit)

Ten execution modules, the provider module, the trace fixture and eight test
files. Eight modules are dark and attributed;
`KimicodePermissionPresentation.ts` and `KimicodeSessionConfigState.ts` are live,
because both were moved out of `KimicodeChatRuntime` rather than written beside
it — the same two, for the same reason, as MiMoCode.

**Before deriving anything, I measured how derivable it was.** Normalized diffs
against OpenCode: `capabilities.ts` and `models.ts` differ in **zero** lines,
`settings.ts` in four (import order), `registration.ts` in five. And the
permission vocabulary — 21 sentences — matches Kimi Code's own legacy runtime
exactly, checked by extracting both and comparing the sentence sets rather than
by reading them.

**`modes.ts` differs in sixteen lines, and that is the one that matters.** Kimi
Code's mode ids are the CLI's own — `auto`, `default`, `plan`, plus `build` and a
legacy `grimoire-yolo` for compatibility — where OpenCode and MiMoCode mint
`grimoire-full-access` and `grimoire-safe`. A derivation that carried the
sibling's ids across would map every permission mode to nothing. Recorded in the
module header rather than left for the flip to discover.

**Kimi Code's recording is the thinnest of the six, and three claims were
rewritten because of it.** `kimi acp` answered `session/new` with
"Authentication required", so no session has ever opened: its models, modes,
config options and answer traffic are all unobserved. The dynamic-config
comment, the content presenter's "reported once at session open" claim and the
presenter test's header all said things MiMoCode's recording supports and Kimi
Code's does not. Each now says what it actually stands on — `KimicodeChatRuntime`
driving this CLI on the legacy path, and the three ACP providers already flipped.

The presenter test also carried MiMoCode's *values* — `xiaomi/mimo-v2.5-pro-ultraspeed`,
a 1 MiB window, the `init`/`review` command pair. Those read as evidence and are
not, so they are gone: the ids are ones Kimi Code's own model tests already use,
and the header says plainly that none of it is observed.

**Six breaks, five caught, and the miss was worth the round trip.** Setting an
effort level without asking the session changed nothing red — because the test
passed an *empty* option list, and the guard returns early before reaching the
check that was broken. A second case now passes a non-empty list with no
thought level in it, which is the shape that reaches the guard. MiMoCode's
equivalent was re-broken to confirm it still catches its own version.

Gates: unit 499 suites / 7,816 tests, typecheck, `eslint`, `build:release`.

### Kimi Code's composition, dark — and a live regression it found (this commit)

`KimicodeExecutionComposition`, `KimicodeMetadataSession`,
`KimicodeModuleContext` and a 22-case seam suite, all dark and attributed. The
fourth ACP provider on the kernel, and the third in a row to add nothing to the
shared stack.

**Six breaks, five caught — and the sixth was a real defect in shipped code.**
Changing the composition's CLI fallback from `kimi` to `kimicode` failed no test,
because the harness's plugin always resolves an absolute path and the `??` never
fires. A test that resolves nothing now exists — and it went red on **MiMoCode**,
which is flipped and live: its composition fell back to `'mimocode'` for a binary
called `mimo`. `MimocodeChatRuntime` used `'mimo'`; the flip changed it, because
a name substitution that replaces `mimocode` everywhere also replaces it where
the string is a command rather than an id.

What that would have cost a user: a MiMoCode tab with no absolute CLI path in
settings — the default — spawning `mimocode`, which does not exist, and the flip's
own `spawn-failed` sentence telling them to set an absolute path. Recoverable,
and wrong.

The property is now pinned for all four flipped ACP compositions, not only the
one it broke on. OpenCode's and Grok's were correct because their binary names
equal their provider ids; both tests were proved by breaking them anyway, since a
test that can only pass is not evidence.

**Kimi Code's own values are absent by construction.** The derived seam suite
carried MiMoCode's model id, its 1 MiB window and its `build` mode; none of that
was observed for a provider whose session has never opened. The one value that is
this provider's own is the mode — `default`, which `modes.ts` names alongside
`auto` and `plan` — and the suite header says the rest are shapes, not evidence.

Gates: unit 500 suites / 7,841 tests, typecheck, `eslint`, `build:release`.

### The Kimi Code flip, and the flake finally caught (this commit)

`registration.ts` points `createRuntime` at the composition, `main.ts`
constructs and registers a `KimicodeExecution`, and `KimicodeChatRuntime.ts` is
deleted with its test. Six providers now execute through the kernel: Codex,
Claude, OpenCode, Grok, MiMoCode and Kimi Code. The four metadata surfaces moved
onto one isolated session, as they did for MiMoCode.

**The flake from two commits ago has a name and a cause.** It was
`*AcpFileSystem › rejects workspace escape before approval or filesystem
access`. That test creates a workspace with `mkdtemp(tmpdir())` and then writes
the file it will try to escape to at `dirname(root)` — which is `/tmp`, shared.
The file name is the same for every provider. With one provider that is
harmless. Adding Kimi Code made three suites write and delete `/tmp/outside-secret.md`
in parallel, each in its own `finally`, and one deletes another's file between
its write and its read.

That explains the single unreproducible failure recorded at the MiMoCode flip:
that commit is the one that made it two. Fixed in all three by giving each test
an enclosing directory of its own, so `dirname(root)` is unique — and the
comment says why, because the next provider to copy this test will copy it whole.

**Kimi Code is flipped and cannot be certified here**, which is not the same as
untested. Its wire recording never opened a session — `kimi acp` answers
`session/new` with "Authentication required" on this machine — so unlike
MiMoCode there was no live run to record, and no matrix is written for it yet: a
matrix whose automated half cannot start would be a document about a machine
rather than about the flip. `docs/mimocode-flip-smoke-matrix.md` stays the model
for it, and the harness derives in an hour once an account exists.

Gates: unit 499 suites / 7,801 tests, integration 5 suites / 145 tests (59
env-gated skips), typecheck, `eslint`, `build:release`, plus four consecutive
full unit runs green after the flake fix.

### Wave 7 opens: two recordings, and one of them is complete (this commit)

Qwen Code and Gemini CLI, recorded from their own CLIs before any of their code
is touched — which is the order the plan asks for and the order wave 6 got right
too. The first difference between the waves is on the command line: both are
spoken to through a **flag**, `--acp`, where the four before them use a
subcommand.

**Gemini CLI's recording is `complete`** — the first since Grok's. It opened a
session, took a prompt and answered with `agent_message_chunk` and
`agent_thought_chunk`. Its session reports four modes of its own (`default`,
`autoEdit`, `yolo`, `plan`) and a model list, and no config options at all: no
`session/set_config_option` round trip appears, because there was nothing to set.

**Qwen Code's is `partial`**, and for the same reason as Kimi Code's:
*"Authentication required: Use Qwen Code CLI to authenticate first."* Its
`initialize` answers with the auth methods it offers, which is evidence of a
shape a flip meets; nothing past the handshake is.

**The coverage gate was blind in one direction, and the first complete recording
found it.** `wireVocabularyCoverage.test.ts` decided "partial" by asking whether
the `coverage` field was *truthy*. That worked only while the field appeared on
partial recordings alone — the four oldest fixtures predate the shared recorder
and carry no `coverage` key, so the test had never seen a complete one that had
it. The shared recorder writes it either way, so Gemini's `complete` was
reported as partial by the gate whose whole job is telling the two apart. Now
read as a value, and proved by marking Gemini partial and watching it go red.

Gates: unit 499 suites / 7,807 tests, typecheck, `eslint`.

### Fourth review — the Critical and the four Majors that ship a defect (this commit)

Thirteen findings, recorded with a status column in
[`docs/wave7-review-backlog.md`](wave7-review-backlog.md). Five closed here, each
verified against the tree first and each fix proved by breaking it.

**G1, Critical — Gemini was sending a mode the CLI does not have.** The toolbar
writes `normal`/`full_access`/`plan` into `selectedMode`; the session I recorded
two commits ago offers `default`, `autoEdit`, `yolo` and `plan`.
`applySelectedMode` forwarded the toolbar's word verbatim, and it is awaited
inside the turn's own try — so turning on Auto-approve and sending a message
ended the turn with an error before the prompt was ever sent. Qwen has had
`mapGrimoireModeToQwen` for this since its own work; Gemini now has
`modes.ts` with both directions, written from the recording rather than guessed.

G2 and G3 are the same seam from the other side: the agent's raw `autoEdit`
was being stored into `selectedMode`, which the toolbar reads back and cannot
render, and `currentSessionModeId` was never reset — so a restarted session
short-circuited and ran in the agent's default while the toolbar said Plan.

**C1, Major — one stray character in `.claude/settings.json` destroyed it.**
`load()` degraded to defaults on a parse failure, which was right for a *read*.
But every mutator is read-modify-write, and `saveUnlocked` swallowed the same
failure and merged onto `{}` — so one "Always allow" click rewrote the user's
file, the one Claude Code itself reads, down to `$schema` and `permissions`,
losing `hooks`, `env`, `model`, `statusLine` and `enabledPlugins`. The read still
degrades; the write now refuses and says which file to fix. The test that
asserted the old behaviour is replaced by one that asserts nothing is written.

**A1, Major — a tab rendered its own turn twice.** `ownsRun` compares against
`this.active`, which is assigned only after `startExecutionRun` resolves — and
that function's own docstring says a run can emit before `startRun` does. In
that window the tab's own `run-started` did not look like its own, so
`followBackendRun` opened a second stream for it and the surface drew the turn
from the generator *and* as an auto-turn. Closed by claiming the id at the
moment it is minted. The test reaches the window the only way it can be reached:
by firing the envelope from inside `startRun`.

**A2, Major — switching conversations mid-turn leaked the kernel session.**
`resetSession()` neither cancelled the live run nor cleared `active`, so
`disposeSession` was refused, the rejection went to `reportCleanupFailure`, and
the session id was already forgotten. It now cancels first and disposes after
the run settles — beside the caller rather than in front of it, because
`resetSession` is synchronous by contract. One thing found while there and fixed
with it: the query generator's `finally` cleared `active` unconditionally, which
after a switch would clear the *next* turn's.

Gates: unit 499 suites / 7,818 tests, typecheck, `eslint`.

### The fourth review closed — the last eight (this commit)

All thirteen rows of [`docs/wave7-review-backlog.md`](wave7-review-backlog.md)
are ✅. Nothing refuted this time: every finding was real against the tree.

**S1 — a conversation could become permanently invisible.** `listMetadata` was
routed through the durable store to recover interrupted writes, but the *file
list* still came from the adapter. `writeAtomic` renames the live file to
`.backup` before renaming the pending one in, so a crash inside that window
leaves no `.meta.json` — nothing lists the conversation, and nothing in the
product ever asks for an id it did not first see listed. Now listed through
`durable.list`, which completes the rename before it reports. The passthrough
double's `list` was a stub returning `[]`, which is why no suite caught it;
it passes through now like the rest of that double.

**K1, K2 — two ways to leave a durable record nothing owns.** `startRun` had no
acceptance guard, so a run admitted while shutdown was giving up wrote a `queued`
record the checkpoint does not name and `disposeSessionForShutdown` does not
terminalize. And `createSessionUnlocked`'s guard ran *after* the session record
was written, so the throw left an `active` session the next start reopens —
spawning a provider session that never existed. Guard moved ahead of the write,
kept after it as well because the write is awaited, and the catch now removes
what it wrote.

**K3 — the sweep broke D5's promise.** `sweepTabScopedRecords` runs before
`loadPersistedControls`, which is the only place an unreadable record decides
the store opens read-only. It skipped what it could not read and deleted
everything else — so a reverted build destroyed a newer build's records on its
way to concluding it was not allowed to write. It now raises on the first
unreadable record, and `start()` stops before anything is removed.

**T1 — the backpressure fix was a flag beside the same unbounded buffering.**
`awaitingDrain` was written and never read to gate a write. Now the lines a
refusing stream would have buffered are queued and flushed on `drain`, in order,
because a response overtaking its request would be a reply to nothing. The test
double had to be corrected too: Node returns `false` from `write` for a chunk it
*took* — a double that dropped it would assert a message loss the real stream
does not have.

**P1, P2 — the permission clamp had two doors left open.** `removeRules` and
`addDirectories` were still forwarded verbatim, so a suggestion riding one
"Allow once" could delete a `deny` the user wrote or grant a directory the
prompt never named; both are dropped now, like `replaceRules`. And `addRules`
with an empty list passed `every` vacuously, claimed to be the rule update and
suppressed the explicit grant — "Always allow" granted nothing and the same call
asked again.

Four existing tests asserted the behaviour that was wrong and are replaced by
tests asserting the behaviour that is right; each is named for what it protects.

Gates: unit 500 suites / 7,823 tests, integration 5 suites / 145 tests (61
env-gated skips), typecheck, `eslint`, `build:release`.

### Wave 7: Gemini CLI's execution parts, dark (this commit)

Six modules and a trace fixture. Five are dark and attributed;
`GeminiPermissionPresentation.ts` is live, because it was moved out of
`GeminiChatRuntime` rather than written beside it — the same pattern the two
wave-6 providers used, for the same reason.

**Gemini derives from Grok, not from the OpenCode family, and I measured that
before assuming it.** Normalized against each other, Gemini's and Qwen's
runtimes differ in 397 lines out of ~1,100 — these two are not clones of each
other and neither is an OpenCode clone. What Gemini *does* share is Grok's
shape: dedicated `session/set_model` and `session/set_mode` where the family
uses `session/set_config_option`, and a mode vocabulary that is the CLI's own.

**The recording decided three things a derivation would have got wrong.**
`session/new` answers with `models` and `modes` and **no `configOptions` at
all** — asserted in the test, not assumed — so this provider's applier has no
third call and no thought-level branch, which also matches
`reasoningControl: 'none'` in its capability record. Its modes are `default`,
`autoEdit`, `yolo`, `plan`. And `supportsNativeHistory: false` means there is no
session log to read an answer back from, so the result sink has no recovery port
at all rather than an empty one — Grok's has one because Grok has something to
read.

The permission presentation is deliberately *not* a vocabulary. OpenCode and
Grok switch on an id the agent sends; Gemini names its tool in the title, and
inventing a switch would mean guessing ids the recording never saw — the turn it
captured needed no permission. The general sentence is what the legacy runtime
has been showing users, and it is what moved.

Six breaks, five caught. The miss was the filesystem label, which nothing
exercised; two tests now cover the refusal and the containment, and the label
break goes red.

Gates: unit 501 suites / 7,838 tests, typecheck, `eslint`, `build:release`.

### Gemini's session config state, moved out — and G2 had a second door (this commit)

`GeminiSessionConfigState` is the seventh extraction of this kind and the
smallest, which is the point rather than an omission: this provider's session
carries no config options, so there is no thinking level to hold, no `configId`
to remember one under, and no per-model option map to seed.

**Reading it end to end found the fourth review's G2 through a door the review
did not name.** The finding was about the `current_mode` update storing the
agent's raw id into `selectedMode`. `syncSessionDiscovery` does the same thing —
and it is the door that opens *first*: `session/new` reports the agent's own
default, so a fresh vault stored `default` into the field the toolbar reads back
through `resolvePermissionMode`, which cannot render it. Fixed with the same
mapping and its own test, and the break goes red.

That is the second time this session that reading a file for extraction found a
defect the review had only half-found. It is the argument for extracting by
reading rather than by moving text.

Gates: unit 501 suites / 7,839 tests, typecheck, `eslint`, `build:release`.

### Gemini's content presenter and requests store, dark (this commit)

The last two provider-owned parts before the composition. Both written from what
this provider actually does rather than from what its siblings do, and three
differences are load-bearing enough to be tested rather than commented.

**No tool stream adapter.** Every OpenCode-family runtime and Grok's normalize a
tool call through one; Gemini has no `normalization/` directory at all. So the
name on a Gemini tool card is the agent's own word — `read`, not the canonical
`Read` its siblings map to. The test asserts both halves: what the name *is*,
and that it is *not* the canonical one. Adding an adapter here would change what
a Gemini user sees, under cover of a migration.

**The commands the session announces are dropped on purpose.** The recording
shows `available_commands_update` arriving, and `capabilities.ts` declares
`supportsProviderCommands: false`. Named in the switch rather than left to the
default branch, so the absence reads as a decision.

**The launch has no artifacts.** `GeminiChatRuntime`'s launch key is the command
and the environment text and nothing else — no managed home, no config file, no
system prompt on disk — so the requests store's environment is the shortest of
the six. And `--acp` is a flag, not a subcommand, which is what separates this
wave from the four before it.

Four breaks, four caught.

Gates: unit 503 suites / 7,855 tests, typecheck, `eslint`, `build:release`.

### The fifth review — the Gemini dark modules, and two the extraction broke (this commit)

A read of the three commits the fourth review did not cover: nine provider-owned modules, a trace
fixture, and the two extractions that changed live code inside `GeminiChatRuntime`. Six findings,
recorded with a status column in [`docs/wave7-review-backlog.md`](wave7-review-backlog.md). Two are
behavioural, and both were introduced by this wave rather than found in it.

**A session that reports where it starts was talking the vault out of what the user picked.** The
extracted state wrote `selectedMode` from the `currentModeId` in `session/new`'s answer. That field
is not decoration: `GeminiChatUIConfig.resolvePermissionMode` answers from it, the settings
coordinator projects that answer over the current value, and `resolveSelectedModeId` reads the
projection — so the mode the *agent* opens in decided what the *next turn asks for*. A vault on Plan,
opening a session that reports `default`, sent no `set_mode` at all: the wish and the session agreed,
because the session had overwritten the wish. The break proves exactly that — with the old line back,
`setMode` is called zero times.

Two modules of this same wave already contradicted each other about it. `GeminiContentPresenter`
documents `onSessionOpened` as deliberately separate from `onCurrentMode` — "pushing it at the
toolbar would overwrite the Safe/Plan/Auto the user picked" — and its test asserts no mode is
reported. The state that `onSessionOpened` feeds did the push one layer down, where both tests stayed
green. Grok's equivalent records the raw id and writes no selection, which is now what this does;
`adoptCurrentMode` is the one door that may move the toolbar, because a `current_mode_update` is a
switch somebody asked for.

**The other was a copy sold as a move.** `permissionMode()` and `fullAccess()` were extracted into
the state and left in the runtime, where they are what gate workspace containment and write
approvals. The comment above them is the record of this question being got wrong once already — an
Auto-approve toggled on another provider switching off this one's containment. Two implementations of
that answer is how it comes back. There is one now, and the test that caught the original failure
runs through it: break the snapshot read and it goes red.

The other four are small: a documented port nothing calls, two comments left pointing at deleted
fields, `"grok-session"` in Gemini's own topology fixture, and a requests test half-built from
another provider's values — a Claude model id, the `acp` subcommand this CLI does not take, and a
database path it has no database for.

Recorded rather than fixed: swapping the inline approval guard for the shared
`normalizeApprovalInput` changed what a scalar `rawInput` becomes, `{}` to `{ value: … }`. It is what
every other ACP provider does, so it converges — but a live behaviour change belongs in the commit
that makes it.

Two breaks, two caught, both landing on the assertion that matters rather than a neighbour.

Gates: unit 503 suites / 7,855 tests, integration 145 (61 env-gated skips), typecheck, `eslint`,
`build:release`.

### Gemini's provider module and its context, dark (this commit)

The piece Gemini never had. Every provider on the kernel contributes a
`ProviderModule` — the backend descriptor, the capability record, the settings
codec and the history contribution the composition is built out of — and Gemini
reached this wave without one, so this is the first flip whose preparation had to
write the module before it could write the composition.

Derived from Grok's, which is the measured answer rather than a preference: this
CLI configures a session through `session/set_model` and `session/set_mode` where
the OpenCode family uses `session/set_config_option`, and the recorded
`session/new` answers with `models` and `modes` and no config options at all.

Four claims are Gemini's own, and each is read off `capabilities.ts` or the
recording rather than inherited:

- **`resume: 'native'` with `transcriptHydration: 'unsupported'`** — a pair no
  sibling on this transport has. `session/load` works; there is no provider
  transcript behind it. History ownership is therefore Grimoire's projection, and
  it is the same fact that leaves the result sink without a recovery port;
- **`reasoningControl: { kind: 'none' }`** — nothing to carry a level in;
- **`commands: { discovery: 'static', chatSurface: 'grimoire' }`** — and this is
  the one place the descriptor and the live boolean deliberately disagree. The
  family asserts `discovery !== 'unsupported'` equals `supportsProviderCommands`;
  for Gemini that assertion would be false and would hide the distinction.
  `supportsProviderCommands: false` is about the *session's* commands — the
  recording captures an `available_commands_update` carrying twenty, and the
  presenter drops every one — while what Grimoire does list is
  `.gemini/commands/**/*.toml`, a vault catalogue. So the workspace has no
  `runtimeCommands` slot: a tab asking for session commands would be answered
  with a list nothing produces;
- **the session patch is the session id and nothing beside it.** Every sibling
  also saves where its session lives — a database path, a managed home — because
  an id alone resolves to nothing there. Gemini writes no launch artifacts, so
  there is no `providerState` to build and its module context takes no ports at
  all.

The environment hash is the six variables that decide *which account answers*,
read off the recorded `initialize` and its four auth methods. The registration's
`/^GEMINI_/i` pattern matches every variable this CLI reads, and hashing the
pattern would invalidate every conversation over a system-prompt path.

Eight breaks, eight caught — including the parity gate, which failed on this
commit's first run because both new modules were unattributed. That is the gate
doing its job rather than a mistake worth hiding: dark modules belong in
`execution-platform-dark`, and the run before this entry proves the manifest is
not decoration.

Gates: unit 504 suites / 7,875 tests, typecheck, `eslint`, `build:release`.

### Gemini's composition and metadata session, dark (this commit)

The last piece before the flip, and the end-to-end turn that has to be green
before the flip is trusted — which is the order this wave promised and the one
wave 1 proved the need for: a seam both sides stub is a seam nobody tests.

The fifth ACP composition, and the fourth in a row to add nothing to the shared
stack. What it contributes is mostly subtraction, and each absence is a fact
about this CLI:

- **no launch artifacts**, so `environment()` writes nothing and the launch key
  is a command line rather than a directory. It is the legacy runtime's key plus
  the MCP servers, for the reason Kimi's carries them: that runtime shut its
  process down on an MCP reload, and a session already open is never told about
  a list that changed under it;
- **no conversation-scoped launch state**, so the requests store's environment
  lambda takes no argument and the module context takes no ports;
- **no session cost fallback**, because the spend indicator is fed from the wire
  or not at all;
- **no `runtimeCommands` slot**, because this provider's commands are the vault's
  and the ones its session announces are dropped.

Two things came out of writing the test rather than the code. The **first turn
of a fresh vault sets no model at all**, and that is correct: the model list is
answered by `session/new`, so a tab's first turn is composed before anything
knows what to ask for. It runs on the agent's own current model — `auto` in the
recording — and the turn that discovers the list is what makes the next one able
to name it. And the **fifth review's G1 fix is now proven end to end**: a vault on
Plan, meeting a session that reports `default`, keeps Plan and sends
`set_mode: plan`. The break for it is the whole finding in one line.

The prompt builders moved out of `GeminiChatRuntime` into
`runtime/buildGeminiPrompt.ts` on the way, because the flip deletes that file and
a turn composed by the kernel has to say exactly what a turn composed by the
runtime said.

Ten breaks, nine caught. **The miss was the turn boundary**: removing
`content.beginTurn()` left every test green, because every turn in the fake
reports the same context window. The case that catches it is a second turn that
reports none — without the boundary it shows the first turn's numbers as its own.
Covered, and red on the break now.

Gates: unit 505 suites / 7,895 tests, integration 145 (61 env-gated skips),
typecheck, `eslint`, `build:release`.

### The Gemini flip (this commit)

`registration.ts` points `createRuntime` at the composition, `main.ts` constructs
a `GeminiExecution` per load and registers its backend with both side ports, the
model catalog moved off a whole chat runtime onto the isolated metadata session,
and `GeminiChatRuntime` is deleted. **Seven providers now execute through the
kernel**; Qwen Code is the last one on the legacy path.

The deletion took a 700-line test with it, and the coverage moved rather than
went. Three files took it:

- `modes.test.ts`, which this provider never had — the mapping that was the
  fourth review's Critical was only ever reached through the runtime;
- `buildGeminiPrompt.test.ts`, for the eight pieces of the vault a turn carries,
  the history a replacement session has to be told and a bound one must not be,
  and the orchestrator frame. Writing it corrected a claim of mine: those
  instructions go **first**, not last;
- `GeminiSessionConfigState.test.ts`, for the model catalogue, the two mode
  doors, and the per-provider permission mode — which the composition test now
  also asserts end to end, because it is what gates containment and write
  approvals.

Unit went 7,861 after the deletion and 7,895 after the replacements, which is
exactly where it stood before: the same number of assertions, one layer closer to
what they are about.

Two things kept rather than tidied. The display name stays **Gemini CLI
(Legacy)**: what is legacy is the CLI — Google replaced it with Antigravity —
not this adapter, and `registration.ts` has said so since before the migration.
And the module's `manifest.displayName` was corrected *to* match it, because
product copy is copied rather than improved in passing.

**Not certified.** The flip is wired and green against a fake agent; nothing here
has met the real CLI since the wire recording. Unlike wave 6's two, that is a
gap this machine can close — Gemini's recording is `complete` — so the live
harness and the smoke matrix are the next commit, not a deferred obligation.

Gates: unit 507 suites / 7,895 tests, integration 145 (61 env-gated skips),
typecheck, `eslint`, `build:release`.

### The Gemini live smoke, and the two shipped defects it found (this commit)

The first wave-7 harness that could run at all, and the first live run since wave 5. It paid for
itself on the first pass.

**Every Gemini turn died with Auto-approve on.** `gemini 0.55.1` advertises four modes in its reply to
`session/new` and refuses two of them: `session/set_mode` for `yolo` and for `autoEdit` answers
`-32603 Cannot enable privileged approval modes in an untrusted folder`. The set is awaited before
the prompt, so the rejection ended the turn before it was sent — and what the user was told was that
the session may no longer exist, which is not what happened. The same shape as the fourth review's
Critical, reached from the other side: the id was right this time and the agent still would not take
it. A refused mode now leaves the turn running under the mode the session has, recorded through a
port the composition logs. The refusals observed are all *toward* asking rather than away from it, so
the session ends up stricter than the toolbar promises — the safe way to be wrong, and still wrong,
which is what the record is for.

**The model list was being read under a name no agent sends.** `AcpModelInfo` declared `id`; the wire
sends `modelId`, and three recordings say so — Gemini's, Grok's and MiMoCode's. Every consumer read
`undefined`. Gemini called `.trim()` on it and threw *inside the session open*, so the metadata
session answered "no models" and the legacy runtime reported a session it could not create; MiMoCode
and Grok pass theirs through a normalizer that drops an entry with no id, so they discovered nothing
over ACP and said nothing about it. Fixed in the shared extractor, which resolves either name into
one. Row 17 went from zero models to six.

**Why no test caught the second one:** every fake wrote `id`, including the one written for this
composition two commits ago — from a reading of the recording that got the modes right and the models
wrong. A fake is only evidence to the extent it is copied from a recording, and this one was copied
selectively. The fakes now use the recorded shape and the extractor has its own case; both breaks go
red.

**The third finding is recorded rather than fixed**, in the obligations above: a prompt that fails
with a vendor error is treated as a dead connection — retried once, then reported as a run whose
outcome could not be established. Shared across five providers, and the account it was found on has
no quota left to prove a fix with.

**Certification is partial, and the blocker is not Grimoire's.** Four rows green — the missing
session, the mode reaching the session, the model catalog, and the spend indicator not contradicting
itself. Everything needing an *answer* is unverified: partway through the run the account answered
`429 You have exhausted your daily quota on this model`. Recorded in
[`docs/gemini-flip-smoke-matrix.md`](gemini-flip-smoke-matrix.md), which
`liveMatrixRecords.test.ts` now reads.

Three breaks, three caught.

Gates: unit 507 suites / 7,903 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### The vendor's own words, back on the five flipped ACP providers (this commit)

The obligation the live smoke opened yesterday, closed. `ManagedAcpExecutionBackend.recover` took the
prompt's rejection as `_error` and never read it, so a `session/prompt` that **failed** was handled as
a connection that **died**: close the process, launch another, send the same prompt again, reconcile
to `unknown`, and tell the tab "Grimoire could not establish whether this run completed."

For a dropped pipe that is right. For a turn the provider refused it was three wrongs at once — the
vendor's message discarded, the prompt charged a second time, and a sentence that means nothing.
`429 You have exhausted your daily quota on this model` is what it looked like in practice.

**The discriminator is exact rather than heuristic.** `AcpJsonRpcTransport` constructs a
`JsonRpcErrorResponse` in one place and only there: when the peer sent an error response. Every
transport failure it raises is a plain `Error`. So `error instanceof JsonRpcErrorResponse` *is* "the
agent answered", and the client is left open on the refusal path, because an agent that refused a
turn is an agent that is still there.

**The words needed a channel, and the terminal is not one.** A `RunTerminalReason` is an enum; a
vendor message is a sentence. So the refusal goes out on the content channel as a fourth
`AcpContentPayload` kind, the presenter keeps it, and the composition hands it back through
`describeFailure` — which the adapter already asks. One error rendered for one failure, the vendor's
words where there are any and the kernel's generic sentence where there are not.

This restores something the flips **lost**: every legacy ACP runtime yielded the provider's error
text, and five compositions had replaced it with a reason code. Applied to all five — Gemini,
Kimi Code, MiMoCode, OpenCode, Grok — and the four family presenters are byte-identical in the patched
region under a normalized diff, with Grok differing exactly where its payload union is wider.

Five breaks, five caught. Two of them are the pair that matters: dropping the `instanceof` so every
failure looks like an answer, and keeping it so none does.

Gates: unit 507 suites / 7,905 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### The refused mode, said out loud (this commit)

The last thing owed on the Gemini flip. A mode the agent will not take no longer kills the turn — that
landed with the live smoke — but the turn then ran under a permission the toolbar did not show, and
the only record of it was a debug log entry. A log nobody opens is not being told.

The applier's input gains the turn's own content channel, which the run already had
(`presentProviderContent`); the refusal goes out on it as a fifth `AcpContentPayload` kind, and
Gemini's presenter renders a warning notice on the turn it happened to:

> Gemini did not switch to Auto-approve: Cannot enable privileged approval modes in an untrusted
> folder. This turn ran in the mode the session was already in.

Three decisions in that sentence. It names the mode in **the toolbar's** vocabulary, because the user
picked Auto-approve and never typed `yolo`. It carries the agent's own reason out of `data.details`,
because `-32603 Internal error` names nothing anyone can act on while "untrusted folder" says exactly
what to do. And it is emitted **once per session** rather than once per turn: the folder is what the
refusal is about, it does not change between turns, and a notice on every one of them is noise a user
learns to skip past. A session that later accepts a mode clears the mark, so a folder that becomes
trusted is reported on again if it stops being.

Five breaks, five caught — including the two that would have made it useless rather than wrong: the
notice repeating every turn, and the notice naming an id the user has never seen.

Gates: unit 507 suites / 7,905 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### Four modules described a model the way none of them behaves (this commit)

Found while measuring Qwen against Gemini, which is the point of measuring: reading two providers side
by side is what makes a claim visible as a claim.

`GeminiProviderModule`'s `modelPresentation.ownsModel` asked whether a model id was in the vault's
visible list. `GeminiChatUIConfig` — the live one, the one the module exists to replace — asks whether
the id carries this provider's prefix. Three siblings said the same thing as the module and their own
configs said the same thing as Gemini's, so **four modules out of seven disagreed with the code they
describe**, all of them repeating one sentence: that a provider-qualified raw id
(`anthropic/claude-...`) makes ownership a settings question rather than a prefix question.

It does not, and the reason is one layer down: the chat never sees a raw id. It sees
`opencode:anthropic/claude-...`, which `models.ts` encodes — so a lookup in a list keyed by raw ids
answers **false for every model the provider has**. The label had the same bug from the same cause,
reading an alias map keyed by raw ids with an encoded one.

Dark today, because a module's `chatUI` has no consumer until M3. What it would have been is a
provider whose model selector owns nothing, on the commit that wired it.

Grok's module already had it right, and its comment named OpenCode as the counter-example it is not.
The three are now what Grok's is, its comment says what is actually true, and each of the four has a
break in both directions: ownership by list, and a label that does not decode.

Eight breaks, eight caught.

Gates: unit 507 suites / 7,906 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### Wave 7 opens its second half: Qwen Code's module, dark (this commit)

The last provider on the legacy path, and the derivation was measured before it was made.

**Qwen derives from Gemini, and the measurement is the argument.** Both CLIs take `--acp` as a flag
where the OpenCode family takes `acp` as a verb; both configure a session through dedicated
`session/set_model` and `session/set_mode`; both name their modes `default`, `plan`, `yolo`.
Normalized against each other the two runtimes differ in 706 lines out of 833 and 1,236 — but the
method surfaces say what that difference *is*: Qwen's is a **strict superset** of Gemini's. Nothing
Gemini has is missing; four things are added.

- **Reasoning effort, applied as a prompt.** `applySelectedEffort` sends `/effort <level>` as a
  `session/prompt` of its own before the turn's. Not a config option and not a dedicated method — a
  slash command in the prompt channel, which no other provider on this transport uses, and which
  costs a round trip the vendor charges for. Five levels, where the family has three;
- **the session's own commands**, which this provider surfaces where Gemini drops them —
  `supportsProviderCommands: true` and `runtimeCommandDiscovery: 'active-session-only'`. So the
  module has the `runtimeCommands` slot Gemini's leaves out, and the context has a port for it: only
  the tab holding the session knows what it announced;
- **ask-user-question**, answered through the runtime's own permission handler;
- **`reloadWorkspaceResources`**, a `ChatRuntime` member Gemini leaves absent.

What it shares with Gemini is every absence: no native transcript, no launch artifacts, and a session
binding that is an id and nothing else.

The environment hash is read off the recorded handshake, which offers **one** auth method — *"Use
OpenAI API key: Requires setting the `OPENAI_API_KEY` environment variable"*. `DASHSCOPE_API_KEY` is
in the list because `registration.ts` anticipates it; the recording has never seen it offered, and
the module says so.

**Nothing here has been observed answering.** `qwen 0.21.15` refused `session/new` with
"Authentication required" — the same position Kimi Code flipped from. The module's own test asserts
that, so a reader meets the limitation before the claims.

Eight breaks, eight caught, including the parity gate on this commit's first run.

Gates: unit 508 suites / 7,927 tests, typecheck, `eslint`, `build:release`.

### Qwen's session config state, moved out — and it carried two defects Gemini's reviews had already found (this commit)

The eighth extraction of this kind, and the first where reading the code for the *move* found the same
two defects twice — because they were the same two, in the provider nobody had reviewed yet.

**A session reporting where it starts was switching the user's permission off, and saving it.** The
fifth review's G1 in Gemini was that the mode a session opens in got written into `selectedMode`,
which the toolbar reads back and the next turn resolves from. Qwen did that *and* pushed it at the
toolbar through `permissionModeSyncCallback` — where `Tab.ts` hands it to `updatePlanModeUI`, which
**commits**. So opening a session in a vault set to Plan wrote Safe into the settings and rendered it.
Every session open and every resume, not only a switch.

**And it announced the mode in the agent's own words.** The same three lines wrote the *translated*
value into the vault and pushed the *raw* one at the toolbar. `Tab.ts` states the contract it was
breaking — "ACP providers emit already-normalized Grimoire modes (full_access / plan / normal).
Unknown values stay Safe" — and two of Qwen's four ids only coerced correctly by accident, because
`LEGACY_YOLO_PERMISSION_MODE` happens to be the string `yolo`. A test asserted the raw id, which is
how a defect survives a review: it had been written down as the expected behaviour.

Both are fixed where the extraction put them: `syncSessionDiscovery` records the raw id and stops,
and `adoptCurrentMode` is the one door that moves the toolbar — translated, once, on an actual switch.

The state also carries what Gemini's has nothing of: a reasoning effort, which this provider applies
by sending `/effort <level>` as a `session/prompt` of its own. `forgetSession` clears it with the
other two, and that one matters most — a level kept across a session change is a whole prompt the new
session never received, charged for.

Four breaks, four caught.

Gates: unit 508 suites / 7,928 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### Qwen's execution modules, dark (this commit)

Seven dark modules and two more extractions. Six of the nine are Gemini's under a different name,
which is what a measured derivation should look like where nothing is actually different — the
prompt builder is byte-identical under a normalized diff. Three are not.

**The applier has a third call, and it is a prompt.** `session/set_model`, then `session/set_mode`,
then `/effort <level>` sent as a `session/prompt` of its own. No sibling on this transport configures
anything by talking to it, and the consequence is that applying a reasoning level **costs a turn the
vendor charges for** — which is why the state forgets it with the session and why the composition is
expected to skip it when nothing changed. It goes last, after the mode, which is the order the legacy
runtime uses and the order that matters: a mode that was going to be refused should not have cost a
turn first. A refused mode still does not stop it, because running at the wrong level is not the
answer to a mode that would not set.

**The presenter refuses to draw a nested agent.** Qwen streams a subagent's own thoughts, messages
and tool calls through the *parent* session, tagged with `_meta.parentToolCallId` and
`_meta.subagentType`. Drawn in the transcript they interleave concurrently running agents and corrupt
the visible answer; the parent Agent tool call stays and its children are dropped. Both halves of the
marking are required — a `_meta` carrying one of them is not a subagent's, and dropping it would
silently lose the conversation's own activity, which is a break of its own.

**And it keeps the commands Gemini drops**, because this provider surfaces what its session announces.

The two extractions moved live code: `buildQwenPrompt.ts` and `QwenPermissionPresentation.ts`. The
second kept a fallback name that reads like a typo and is not — `Qwen Code action` is what the runtime
has been showing users, and product copy is copied rather than tidied. It has its own break.

Seven breaks, seven caught.

Gates: unit 511 suites / 7,963 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### Qwen's composition and metadata session, dark — and the one thing that stops the flip (this commit)

The sixth ACP composition, and the first that cannot be flipped when it is finished.

**`ask_user_question` has nowhere to put its answer.** Qwen sends it down the *permission* channel,
and the legacy runtime replies with structured answers beside the option id. The kernel's
`InteractionResolution` carries `{ interactionId, responseId, resolvedAt }` and nothing else, and the
bridge cannot answer it out of band either — `prepare` is bounded by `controlTimeoutMs` and a person
is not. Both ways of shipping around it are worse than waiting: presenting a question as an approval
asks someone to allow or deny a question, and answering `cancelled` quietly loses a feature. So the
composition refuses it **by name**, the test drives a real question through a real turn and asserts
that no interaction opens and nobody is asked, and the obligation above says what has to land first.

**The effort is the other thing this composition does that no sibling does.** `/effort <level>` is a
`session/prompt`, so it costs a turn — which makes it the one value not sent every turn. Writing the
test found the defect that made the skip impossible: **nothing told the state the session had taken a
level.** There is no `current_effort` update the way there is a `current_mode_update`, so the applier
now reports it and the tab that owns the session records it — after the prompt returns, because a
level the prompt never delivered is one the next turn still has to ask for.

**The `/effort` prompt also broke five inherited tests, and that was the fixture lying rather than the
code.** Every count and every failure injection landed on the configuration prompt instead of the
turn. The fake now answers `/effort` the way an agent does — an acknowledgement, no tool call, no
window, no answer — and the counters count turns. The same lesson as the `modelId` defect: a fake is
evidence only where it behaves like the thing.

And a case for what that prompt must **not** do: whatever the agent says while answering `/effort`
stays out of the conversation. What keeps it out is ordering — the applier runs while the session is
being prepared, before the run has a session reference to match a notification against.

Nine breaks, seven caught on the first pass. Both misses were the session commands, and both were the
same hole: nothing drove them end to end. The second needed a conversation bound to a session of its
own — moving to a tab with no session lists nothing anyway, which hid a stale list rather than proving
it was cleared.

Gates: unit 512 suites / 7,992 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### The first question the kernel has ever carried (this commit)

The obligation that was blocking Qwen's flip, closed — and it needed a core contract rather than a
provider workaround.

**`InteractionResolution` gained a payload, and it is never written down.** An approval is fully
described by the option someone chose; a question is not — Qwen's reply carries structured answers
beside the option id, and until now a response id was the only thing that could come back. The field
is opaque to core, like `requestRef` and `presentationRef`, and **D2 decides the rest**: what a person
typed does not get a second copy in the control store, so the payload travels from the surface to the
provider and is gone.

**Which forces an honest answer to a question nobody had asked: what happens to an answer caught by a
reload?** The registry replays a `resolving` interaction on startup from its persisted record, and
for a question all that survives is the response id. Completing it with that alone would tell the
agent an answer nobody gave. So a question is **cancelled** on recovery instead — what a closed tab
already means, and the only outcome that is true. The test that used to cover the replay path was
using `kind: 'question'` incidentally; it is an approval now, with the question rule beside it.

**The path end to end**: the agent's `ask_user_question` arrives on the ACP permission channel; the
composition's bridge recognizes it by any of the three markings this CLI has used across releases and
prepares `kind: 'question'`; the kernel opens it; the tab's own question callback — which the chat
surface has installed all along and no provider had ever reached — shows it; and the answers come back
on the resolution and are keyed by position for the agent. `ExecutionInteractionPresenter` now answers
with an id **or** an id and a payload, which keeps every existing presenter unchanged.

Three refusals guard it, and the last one was a miss the breaks found: a payload of the wrong shape
reads as **nobody answered** rather than as an empty answer, because `{}` is something the agent would
act on. Nothing exercised that until the helpers got their own test.

Nine breaks. Six red, one hung — a surface with no question callback leaving the turn open, which is
the failure the code comments predict and which the suite catches by never finishing — and the last
two red once the guard was covered.

Gates: unit 513 suites / 8,004 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### The context window Qwen only answers when asked (this commit)

Found by inventorying what the flip would delete. `QwenChatRuntime` calls
`qwen/status/session/context_usage` once per turn, after the prompt returns, because **no
`usage_update` this provider sends carries the parent window** — so a flip that did not port it would
have taken the context badge with it, silently.

The route existed: `ManagedAcpClient.vendorRequest`, the escape hatch Grok's billing already uses, and
`noteTurnEnded`, the sink hook that exists so what a turn's last look finds reaches *that* turn rather
than the next one. The composition keeps the live client through `clientObserver` — held for one
question rather than for a connection — and hands the sink a reader, not a client.

Opportunistic on every path, because the extension is optional: an older Qwen has no such method, and
a window nobody could read is a badge without a number rather than a failed turn.

**Three of the four breaks were green on the first pass, and the reason was the fixture again.** The
fake was still sending a `usage_update`, so the badge got its numbers from the wire and the vendor call
proved nothing. With the update suppressed — which is what this provider actually does — all three go
red. The fourth was a parser guard with no test at all: a window of zero is a division nobody wants,
and nothing said so until the parser got its own file.

The parser and the method name moved out of the runtime rather than being copied, so the legacy path
and the composition read the same one.

Gates: unit 514 suites / 8,011 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### The Qwen Code flip — the last provider (this commit)

`registration.ts` points `createRuntime` at the composition, `main.ts` constructs a `QwenExecution`
per load and registers its backend, the model catalog moved onto the isolated metadata session, and
`QwenChatRuntime` is deleted. **Every provider now executes through the kernel.** M2-flips has no
provider left.

`AcpManagedMcpRuntime.test.ts` is deleted with it: it existed to prove that the ACP runtimes still on
the legacy path passed the vault's MCP servers into their sessions, and there are none.

**The last member the adapter said it did not need.** `reloadWorkspaceResources` was recorded as
absent by contract, on the grounds that "no production call site declares it" — and `QwenSettingsTab`
declares it in three places. The record was wrong, and the flip that would have removed the behaviour
is what found it. The adapter has the member now, delegating to a host port; the composition answers
it by bumping a generation the launch key carries, so the next turn spawns a process that reads the
new skills, commands and agents. A hash of the vault directory on every dispatch would cost more than
the restart it decides, and what the settings surface knows is *that* they changed.

The 1,017-line runtime test went with the file, and its coverage moved rather than went:
`buildQwenPrompt.test.ts` and `QwenSessionConfigState.test.ts` join the seven that already existed.
Unit is 7,992 against 8,011 before the deletion, and the difference is the twenty-odd cases that were
driving a whole runtime to reach something the composition tests now drive end to end.

**Not certified**, and the blocker is the account: `qwen 0.21.15` refuses `session/new` with
"Authentication required", so this flips from Kimi Code's position — wired, green against a fake
agent, and never having met the real CLI past its handshake.

Gates: unit 514 suites / 7,992 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### The sixth review — one defect, found twice (this commit)

A read of the fourteen commits the fifth review did not cover. Seven findings, recorded with a status
column in [`docs/wave7-review-backlog.md`](wave7-review-backlog.md). The two behavioural ones are the
same mistake in two places: **state held by the composition where the session was meant**, in an
object that serves every open tab.

**A reasoning level applied on one tab silenced it on all of them.** The applier is one object for
every tab and it reported a bare level, so every tab's state recorded it — and then skipped its own
`/effort` prompt, which its session had never received. Those tabs ran at the agent's default for the
life of the conversation, and nothing would ever have said so: this provider sends no `current_effort`
update, which is the same absence that made the report necessary. The mark names its session now, and
a tab skips only when it is on that one.

**The context window was read off the wrong connection.** The composition kept one client; the backend
holds **one per execution session**. On every tab but the most recently opened, the vendor request
asked an agent about a session it does not have — a badge that silently stops working. `noteTurnEnded`
hands the sink the connection the turn actually ran on, which is the only one that can answer.

The five smaller ones are claims that stopped being true: a composition still calling itself dark
after its flip, eight files speaking of a deleted runtime in the present tense, an obligation counting
four absent members when one had left with a false reason, and **two test comments asserting evidence
that does not exist** — `qwen 0.55.1` "advertises all four modes… Observed, not imagined", which is
Gemini's version and Gemini's observation about a session Qwen has never opened.

**Three of nine breaks were green on the first pass**, and none of them because the code was right.
The two-tab test did not have two tabs open at once; the defect only appears when both exist before
either runs. And an invariant was gated twice — the setter refused a level without a session and so did
the getter — so neither break could be distinguished. Collapsed to one gate, with the leftover given a
case that makes it load-bearing.

Gates: unit 514 suites / 7,994 tests, integration 145 (73 env-gated skips), typecheck, `eslint`,
`build:release`.

### Gemini's second live run — the first turn this branch has ever completed (this commit)

The account replenished, so the matrix ran again. It answered **one turn** and was exhausted by the
second — which is a measurement rather than a complaint: this account comes back roughly one turn at
a time, and that is what "Gemini can be certified here" is actually worth.

**That one turn certified both fixes the first run produced.** The agent refused `session/set_mode`
for `yolo` exactly as before, in exactly the same words. The turn survived it, answered `OK`, and
carried the notice into the transcript beside the answer:

> Gemini did not switch to Auto-approve: Cannot enable privileged approval modes in an untrusted
> folder. This turn ran in the mode the session was already in.
>
> OK

Row 1 had never passed on this branch.

**And the third finding's fix is confirmed against the real CLI**, by the failure rather than by the
success: where the tab used to say *"Grimoire could not establish whether this run completed"*, it now
says *"You have exhausted your daily quota on this model."* The vendor's own sentence, through the
classification added after the first run — proved by the same quota that blocks everything else.

Five rows green now: the answer, the cancel, the missing session, the mode reaching the session, and
the model catalogue. The seven that need a second answer are still quota-blocked.

The harness renders an error's words now, the way it already rendered a notice's. Reading `["error"]`
in a row report and having to re-run to find out which error is a harness that makes its own evidence
hard to read.

Gates: unit 514 suites / 7,994 tests, typecheck, `eslint`, `build:release`.

### Qwen's live harness, and the defect it found before it could pass a row (this commit)

The last provider gets the harness every flipped provider has. It cannot be certified here — `qwen
0.21.15` refuses `session/new` with "Authentication required" — so this is written so that certifying
it is a command someone types rather than a thing someone builds first.

**It earned its keep on the run that could not open a session.** Every row reported:

> Qwen could not start this turn. If this conversation was resumed from a saved session, that session
> may no longer exist — starting a new chat will create one.

Nothing had been resumed. It was the first turn of a fresh conversation, and the cause was the agent
refusing to authenticate — so the advice would fail identically every time it was followed. That is
the **first thing a new user of any of these providers meets**, and it was a guess.

The channel already existed: the turn refusal added after Gemini's live smoke, which carried a refused
*prompt* in the agent's own words. A refused **session** refuses the turn just as completely and its
reason is the one that matters most, so both travel the same way now — renamed `turn-refused`, because
the name is what the next reader has — across all six ACP providers. Confirmed against the same CLI
that found it: the tab says *"Authentication required: Use Qwen Code CLI to authenticate first."*

**A failed `session/load` deliberately keeps the composition's own sentence.** What an agent says about
a session it cannot load is rarely actionable — OpenCode answers `Internal error: OpenCode service
failure` — while "starting a new chat will create one" names the thing that helps. That split was
accidental before this commit, a consequence of where the error happened to be wrapped; it is stated
and tested now. The agent wins where it knows more; the composition wins where it does.

Four rows in the new matrix are this provider's own and no sibling harness has them: the effort it
applies by talking to the session, the question it asks over the permission channel, the context window
from a method ACP does not define, and the subagent stream it must not draw. Row 21 reports "did not
run" rather than failing when a turn does not reach for a question, because that is the agent's choice
and a red row would be a lie about it.

Three breaks, three caught.

Gates: unit 514 suites / 7,997 tests, integration 145 (89 env-gated skips), typecheck, `eslint`,
`build:release`.

### D7 gets its guard, and the guard corrects the rule (this commit)

The oldest obligation on the list, closed now that the kernel emits log records. It reads every
`recordDebugLog` in the execution path, takes the keys each one logs, and runs D7's bans through them.

**It found two things on its first run.** An event nobody had enumerated —
`execution.connection.lost`, which Claude's composition has been emitting all along — and that
`execution.setMode.refused` was logging `modeId: '[redacted-string]'`. The record added last session
to say *which* mode the agent refused had been saying nothing at all. A mode id is provider
vocabulary, and it is on the safe list now.

**Then the gate had the defect it exists to prevent, and its own comment named it.** "A regex that
silently matched nothing would make every assertion below vacuously true" — and the key extraction
matched nothing, because it required a delimiter after each name that the last key of every call site
does not have. Four of five breaks were green over an empty list. The guard-the-guard assertion
checked that call *sites* were found and stopped there; it checks the keys now, which is the level the
mistake was on.

**And the rule turned out not to be the one I set out to prove.** A break that removed `prompt` from
the sensitive-key pattern stayed green: `prompt` was never *allowed*. D7 rests on **default-deny** — a
string is redacted unless its key is on the safe list — and the sensitive pattern is a second net for
names that might otherwise look harmless. So the safe list is the only thing a reviewer has to read,
and the gate's job is to make adding to it visible. A key nobody has thought about is in the test for
exactly that reason.

What it leaves is stated rather than implied: an error's own message is carried through, because that
is the reason to keep a log at all. A provider that put a prompt into an error message would put it
there — a review question about what providers raise, not a redaction question.

Seven breaks, six caught; the seventh is green because it is not the gate, which is the finding.

Gates: unit 515 suites / 8,012 tests, typecheck, `eslint`, `build:release`.

### Kimi Code's live harness, and the defect it found before it could pass a row (this commit)

The last flipped provider without one. It is deliberately MiMoCode's harness with the names changed,
down to the row numbers: these two mirror each other by instruction, their compositions differ only in
identifiers, and the two files are meant to stay diffable after normalizing the provider name — which
is how drift between them gets found. The normalized diff is two comments long, both of them places
where MiMoCode states something observed that Kimi Code has never been able to observe.

**Row 9 found a shipped defect, and row 9 was green while it was there.** `kimi 0.38.0` with no
account refuses `session/load` the same way it refuses `session/new` — `-32000 "Authentication
required"` — and the tab said:

> Kimi Code could not start this turn. If this conversation was resumed from a saved session, that
> session may no longer exist — starting a new chat will create one.

The same defect Qwen's harness found two sessions ago, surviving on the path that fix deliberately did
not cover. **The carve-out was reasoned and the reasoning was half right.** What an agent says about a
session it cannot *find* is often unactionable — OpenCode answers `Internal error: OpenCode service
failure` — and the composition's advice is what helps there. That was read as *the agent has nothing
to say about a load*, and an unauthenticated CLI is the counterexample: the session is fine, the words
are the whole answer, and starting a new chat fails identically. Both halves are needed, so the
refusal now carries where it came from and the composition says both:

> Kimi Code could not open the session this conversation was resumed from. Kimi Code said:
> Authentication required. Starting a new chat helps only if the session itself is gone.

The agent's words first, and the advice saying out loud what it depends on. Six copies of that
sentence became one, since the fix had to land in all of them. Confirmed against the same CLI that
found it, six breaks caught by the six compositions' tests.

**The row was green because it asserted the wrong noun.** `toContain('session')` — which the
composition's own sentence satisfies whatever the agent said. It asserts the agent's own words now, in
all three sibling harnesses.

**And Antigravity had no matrix at all.** Its harness has existed since wave 1 and its result lived in
the journal, where the records gate could not see it: a provider with a harness and no matrix looked
exactly like a provider with nothing to record, which is the state that gate exists to make visible.
The gate pairs harnesses with matrices now. Its first break went green — the harness reader could
match nothing and the pairing would still pass, the same vacuity the D7 guard shipped with one commit
earlier — so the reader is guarded too.

Antigravity's matrix is written, and it is **the only provider whose automated half is fully green on
this machine**: run today against `agy 1.1.15`, both rows, the cancelled process tree gone by the
operating system's account. `manual-smoke-instructions.md` no longer says five providers.

Gates: unit 515 suites / 8,024 tests, integration 5 / 145 (10 live suites skipped), typecheck,
`eslint`, `build:release`. Live: Kimi Code 2 rows of 12 (the rest need an account), Antigravity 2 of 2.

### M5 opens: the auxiliary query, read against the consumer it has to replace (this commit)

M2-flips is done, so this is the first M5 material: `refactor: route auxiliary work through execution
owners`. Nothing is routed yet — this is the module the routing needs, corrected before it is wired.

**It was cold, and cold is wrong.** `ManagedAcpAuxiliaryQuery` has been dark since wave 4, launching a
process per query and closing it after. Read against `AuxQueryRunner` — the interface titles,
refinement and inline edits actually call — two of its four members are about a conversation that
outlives one call: `reset()`, and inline edit's `continueConversation`, which sends a second message
expecting the first to still be there. Five providers rely on that today: `OpencodeInlineEditService`
holds one runner whose ACP session persists between calls, and `resetConversation()` is what ends it.
A cold query would have answered the follow-up on a session that had never heard of the edit.

Cold was not an accident either — `client/launch:cold` is written into six trace fixtures. It was the
design before anyone read the consumer, and the fixtures say `client/launch:retained` now.

Four more gaps closed the same way, each one a thing a legacy runner does and the dark module did not:
**configuration** (the aux agent applied when the session opens, the model before every turn, both
best effort — an answer under the default model beats no answer), **streaming** (`onTextChunk`, which
the refine dialog renders into), **keyed retention** (one process per purpose, which is what the
legacy runners are as separate instances, counted in one place now), and **disposal** (the backend
closes them at shutdown, and an auxiliary process that will not confirm its own death fails the
shutdown exactly as a chat session does).

What is deliberately *not* carried over: the legacy runners attach the CLI's stderr to a failed
auxiliary error. `ManagedAcpClient` has no stderr, so that is a transport change rather than a policy
one. Recorded below rather than half-built. *(Corrected two entries later: the launcher already keeps
a stderr tail and the transport already rejects pending requests with it, so a process that died
carries its last words. Only a live process's failures differ, and those carry the agent's own
sentence instead.)*

Thirteen breaks, thirteen caught. Two were green first: one break was a no-op against a test whose
ordering made it accidentally correct, and the other found that **the backend's own disposal of the
port had no test at all** — the module's `dispose()` was proven and the wiring to it was not.

Gates: unit 515 suites / 8,035 tests, integration 5 / 145, typecheck, `eslint`, `build:release`.

### The auxiliary path, end to end and still dark — and a gate that was answering the wrong question (this commit)

The second piece of M5's auxiliary checkpoint: the reference space and the seam, so the flip is a
wiring change. Three parts, none of them reachable yet.

**The store.** OpenCode's request store gains an auxiliary reference space beside the chat one — same
space on purpose, because it is the same kernel carrying it and a second one would be a second thing
to keep bounded and a second place a prompt could be retained. It resolves a turn into the launch, the
conversation it belongs to, the fingerprint that says when that conversation's process was started for
other settings, and the two configurations: the agent when the session opens, the model before every
turn.

**The seam.** `ManagedAcpAuxQueryRunner` is `AuxQueryRunner` answered by the kernel. Four lines of
policy, and they are the four things the legacy runners do around a prompt: pass the caller's
cancellation down, stream the answer back, hand over the model, end the conversation on `reset`. A
`reset` whose closing failed must not reach the caller — the title service calls it in a `finally`,
and a process-management error would replace the generated title.

**The backend.** `runAuxiliaryQuery` takes the caller's signal and its text sink; a new
`releaseAuxiliaryConversation` ends one conversation without touching the others. A caller that had
*already* cancelled needed its own line — subscribing to an `abort` that has fired subscribes to
nothing, and the turn would have run to completion for someone who gave up before it started. That was
the one break of ten that stayed green.

**And the parity gate was answering the wrong question.** It reported the dark auxiliary module as
restored — because a live store now names one of its *interfaces*, and the walker counted an
`import type` as an edge. Erased before anything is bundled: naming a dark module's type ships none of
it. The obvious fix broke six wired surfaces, which is the finding: a contract module is nothing but
types and compiles to nothing at all, so "wired" cannot mean "in the bundle" for it. Two graphs now —
what the source refers to, for wired; what the bundle contains, for dark — and the walker's own test
pins the difference in both directions.

Sixteen breaks across the three files; the ones that stayed green each named a missing test rather
than a wrong rule.

Gates: unit 516 suites / 8,050 tests, integration 5 / 145, typecheck, `eslint`, `build:release`.

### OpenCode's auxiliary work, wired but not yet switched (this commit)

The composition half: `OpencodeExecution` builds the auxiliary environment, constructs the query, and
hands out `createAuxRunner(purpose)`. The three services still build an `OpencodeAuxQueryRunner`, so
nothing has moved yet — the switch is one line each and belongs in its own commit.

**The consumer changed the design again, and again by being read.**
`QueryBackedTitleGenerationService` builds a **runner per title** and resets it when the title is done;
inline edit holds one for as long as the edit lasts. So the retained conversation is the *runner*, not
the purpose — keying it by purpose would have put two titles generated at once in one session and let
either one's `reset()` close the process the other was using. The key carries a conversation id minted
per runner now, and the fingerprint stays per launch.

**What the composition owns is the launch**: its own artifacts directory per purpose, its own agent,
its own system prompt — the caller's, because a title is asked for by the prompt that asks for a
title. No MCP servers and no database: an auxiliary turn has no conversation to resume and nothing to
offer a tool.

Eleven breaks. Three stayed green and each named a missing test rather than a wrong rule, and the
first is the one worth keeping: **dropping the managed agent definition from the launch changed
nothing an assertion could see**, because the test checked that the session was set to an agent *id*.
The id is a name; the permissions are what stop an unattended turn from writing to the vault. The
tests read the generated config now — `'*': 'deny'` for a title, and for an inline edit a `read` that
allows the vault and refuses a dotenv.

The parity gate then said the two modules were bundled, which they now are: constructed at load,
reachable, and not what the services call. They have their own surface saying exactly that rather than
a dark entry that would be false.

Gates: unit 516 suites / 8,058 tests, integration 5 / 145, typecheck, `eslint`, `build:release`.

### The first auxiliary flip: OpenCode's titles, refinement and edits (this commit)

`OpencodeAuxQueryRunner` is deleted. The three services ask
`execution.createAuxRunner(purpose)`, and auxiliary work runs on the kernel for the first time in the
product. M5's third checkpoint, for one provider.

**Reading the runner before deleting it found a safety regression the flip would have shipped.** The
legacy runner contained every auxiliary read to the workspace, always. The kernel path would have used
the chat client factory — whose filesystem opts out of containment in full access, because the user
asked for it and is watching the turn that uses it. An auxiliary turn is neither: a title generated
behind a conversation nobody is looking at would have been able to read outside the vault because the
*chat* was set to full access. Auxiliary work has its own factory now, contained whatever the chat is
set to, refusing every write, and refusing every permission prompt because there is no surface to
raise one on.

**The timing mattered too.** The runner touched the plugin only when a query ran; a constructor that
reaches for the composition makes a service depend on a load order it cannot see. `LazyAuxQueryRunner`
keeps the old timing: built when something asks it a question, and never built by a `reset` that has
nothing to end.

Five of the legacy runner's eight cases were already covered by the new path's tests; the three that
were not are carried over rather than lost — the PATH fallback, the refused permission, and the read
outside the workspace, which now has a named policy of its own to be tested against.

The topology record gains a third kind, `kernel-isolated`, because what proves the isolation is
different: a dedicated runner proves it by existing, and a composition that serves both paths proves
it by launching auxiliary work through its own factory into its own artifacts. The gate asserts the
second shape rather than pretending it is the first.

Nine breaks. Two stayed green until the services had a test of their own — nothing asserted which
purpose each service asks for, or that inline edit keeps one conversation across a follow-up, which is
the entire reason the session is retained.

Gates: unit 517 suites / 8,060 tests, integration 5 / 145, typecheck, `eslint`, `build:release`.

### MiMoCode's auxiliary flip, and the defect the mirror found (this commit)

The same flip, on the provider that is not allowed to diverge from OpenCode. `MimocodeAuxQueryRunner`
is deleted; the three services ask the kernel; the topology record says `kernel-isolated`.

Done by normalized diff — `sed` both provider names to one token, then compare — which is what made it
safe to do mechanically and is what found the reason to do it at all. **MiMoCode's auxiliary read had
a defect OpenCode's had already fixed**: `request.limit ? … : lines.length`, where `limit: 0` asks for
no lines and was answered with the whole file. The fix was never mirrored across. It is not mirrored
now either — the file is gone, and the shared `AcpWorkspaceFileSystem` the kernel path uses reads
absence rather than falsiness, so the flip carries the fix.

The two compositions' auxiliary halves are byte-identical after normalizing the provider name, and so
are their stores' auxiliary sections and all three test files. That is the property to keep: the next
change to either belongs in both.

Six breaks, one green — and it was the same green on OpenCode, which had not been broken this way.
**Nothing proved the auxiliary path uses the auxiliary factory.** The policy has its own test and the
permission refusal has one, but the composition tests inject a client factory, so neither real factory
ever runs there: pointing the auxiliary path at the chat one changed no assertion in either provider.
The topology gate reads the wiring line itself now. That is a source match rather than an exercise,
and it is recorded as one below.

Gates: unit 518 suites / 8,076 tests, integration 5 / 145, typecheck, `eslint`, `build:release`.

### Kimi Code's auxiliary flip — the third fork, and the last of the family (this commit)

`KimicodeAuxQueryRunner` is deleted. The three OpenCode forks now run auxiliary work on the kernel, and
their auxiliary halves are byte-identical after normalizing the provider name — compositions, stores,
services and tests.

Kimi Code's runner was **identical to MiMoCode's** after normalization, including the `limit: 0` read
defect, so the flip carries the same fix for a third time without anyone having to port it.

Six breaks, six caught. The one that was green on the first two providers — pointing the auxiliary
path at the chat client factory — is red here, because the topology gate reads the wiring line now.

What is left of this checkpoint: **Grok**, whose runner is the last managed-ACP one, and **Codex**,
which is a different transport and a separate design question.

Gates: unit 519 suites / 8,093 tests, integration 5 / 145, typecheck, `eslint`, `build:release`.

### The model setter Grok needs, and a Jest behaviour worth knowing (this commit)

The first of Grok's three prerequisites, done in the shared module where it belongs rather than inside
its flip: `ManagedAcpAuxiliaryQuery` can now apply the model through `session/set_model` as well as
through a config option. Which of the two an agent answers is a property of its release — the three
OpenCode forks carry the model as a config option, Grok has the dedicated setter — so both travel and
a provider names the one its agent has. Applied before every prompt either way, and best effort
either way.

**One break of four stayed green, and the reason is about the instrument.**
`expect([undefined]).toEqual([])` **passes**: Jest's `toEqual` ignores undefined entries, so a setter
called with an undefined model reads exactly like a setter that was never called. The break that
removed the guard against precisely that was invisible. Both assertions are `toHaveLength(0)` now,
with the reason written beside them.

Worth carrying: anywhere a test asserts `toEqual([])` to mean *nothing happened*, a call that happened
with an undefined argument passes it.

Gates: unit 519 suites / 8,095 tests, typecheck, `eslint`, `build:release`.

### Grok's auxiliary flip — where the launch is the policy (this commit)

`GrokAuxQueryRunner` is deleted, and **every managed-ACP provider now runs its auxiliary work on the
kernel**. Codex is the only auxiliary runner left, and it is a second app-server process rather than
an ACP session.

The three differences this file recorded before the work started all held, and **two more only came
out of reading the runner beside the forks'**. Both are consequences of the same fact — this provider
has no agent definition, so everything the forks put in one has to live somewhere else:

- **the refusal shape.** The forks answer a permission request `cancelled`, and the comment beside it
  says why: a well-formed auxiliary agent never reaches that callback, because its own definition
  denied the tool. Grok's reading profile launches in `ask` mode, so its agent asks about tools it is
  perfectly able to run — and ACP's `cancelled` means the turn was cancelled, which ends it. The
  legacy runner selected the agent's own **reject** option, which is a no it can report and work
  around. `ManagedAcpAuxiliaryQuery` now carries a per-launch refusal; `cancel` stays the default, so
  the three forks are unchanged;
- **the filesystem is per purpose, and it is the client that says so.** The forks build one auxiliary
  client for all three purposes and let the agent definition deny the read. Grok's title and
  refinement purposes were launched with **no `readTextFile` delegate at all** — which the ACP
  handshake carries, so the agent is told there is nothing to read rather than refused per call. The
  auxiliary factory is one object that picks one of two clients by what the launch may read, keyed by
  the startup reference, because that is the only thing a client factory is handed.

**A regression the three fork flips shipped, found by reading Grok's runner next to theirs.** Every
legacy runner falls back to **the model the chat is set to** when the caller names none — and inline
edit and instruction refinement name none unless the user set an override. The fork compositions
resolve only the caller's model, so those two now run on whatever the CLI defaults to: a different
model and a different bill from the one the vault is configured for. Grok's flip keeps the fallback
and pins it; the forks are recorded as an obligation rather than swept in here.

**A cross-provider leak the legacy runner had and this does not.** It read `effortLevel` straight off
the settings bag, which holds whichever provider a tab last selected — so an auxiliary Grok process
could be started with Codex's reasoning effort. The kernel path reads Grok's projected snapshot, the
same one the chat launch reads.

**A gate that emptied itself at the flip.** The managed-ACP artifact-partitioning check filtered on
`auxiliary === 'isolated'`, and Grok was the last provider in that state; deleting the runner left
`it.each` with an empty table. Jest reports that as an error rather than as a pass, which is the only
reason it was noticed at all — the check now covers both isolations and asserts it has a provider to
check.

Eight breaks, eight red: the refusal in the store and in the shared query, every launch reading, the
model fallback removed, the auxiliary artifacts pointed at the chat home, the composition not closing
its own processes, the auxiliary path pointed at the chat factory, and the auxiliary filesystem let
out of the vault.

Gates: unit 521 suites / 8,122 tests, integration 5 / 145, typecheck, `eslint`, `build:release`.

### The model the three fork flips dropped (this commit)

The obligation Grok's flip recorded, closed in its own commit because it changes three providers'
behaviour rather than tidying them. `resolveOpencodeAuxiliaryModelId` and its two twins now take the
projected settings and fall back to **the model the chat is set to** when the caller names none —
which inline edit and instruction refinement do, unless the user set an override. Until now those two
ran on whatever the CLI defaults to.

The three auxiliary halves are still byte-identical after normalizing the provider name: the same
function, the same doc comment, the same call. Three breaks, three red, one per provider — and each
test is the fallback rather than the decode, so removing the decode would not satisfy it.

Gates: unit 521 suites / 8,128 tests, typecheck, `eslint`, `build:release`.

### M4 opens: the conversation record, and the vault that already exists (this commit)

**Dark.** `SessionStorage` still writes what it always wrote; nothing is routed. What exists now is the
half M4 cannot be built without: a conversation record with a schema envelope and a revision, a
repository over it, and the step that makes the vaults already in the field readable.

**The case M4 exists for, stated plainly.** A title generated in the background, a message appended in
one window and a rename in another all read the conversation, change part of it, and write the whole
of it back. On the legacy path the last one to finish wins and takes the others' changes with it,
because `saveMetadata` is an atomic write of whatever the caller was holding. A save here names the
revision it was built from, and a stale one is refused.

**Adoption is the piece the plan's schema versioning cannot reach.** D5 migrates a record with a
*known older* `schemaVersion`; every conversation in every existing vault has **no envelope at all**,
so there is no version to migrate from. Read as-is it is `corrupt`, and D5 then opens the store
read-only — for every conversation the user has, at once. So `VersionedRepository` gained an explicit
adoption step: a file with no envelope is read as revision 1, and **not rewritten until something
legitimately writes it**, which is the other half of what D5 asks. Guarded so it can only ever apply
to a file this store did not write: a damaged record that *does* carry an envelope stays corrupt
rather than being silently reset to revision 1, which would be the overwrite the whole store exists
to stop.

**The file keeps its name.** `<id>.meta.json` is what every vault holds, so the repository takes a file
suffix rather than renaming every conversation a user has to `<id>.json`. The upgrade from bare object
to enveloped record is then a compare-and-swap of that file's own contents. The listing matches on the
full suffix, and a suffix a record id could contain is refused — otherwise one record's path is
readable as another's id, which is how a listing invents records that do not exist.

**`decode` validates and does not rewrite.** The control store's schema rebuilds its payload field by
field, which is right for a record whose shape it owns. A conversation carries a provider's own state
bag and whatever a later release adds, and D5 says a store never discards what it does not understand
— so only the fields every reader depends on are checked, and the rest is passed through. Breaking
that is one of the tests.

**One break of nine stayed green, and it was a gap.** Removing the envelope guard on adoption changed
nothing, because the conversation adopter *also* checks that the file names its own conversation. The
guard belongs to the shared repository and so does its test: an adopter that accepts anything, against
a damaged enveloped record. It goes red now.

Still owed before this milestone can be called done, and deliberately not in this commit: routing the
`main.ts` save sites through the repository with the revisions they read, the typed history hydration
result at each call site, and the storage-layout documentation — which does not change until the
routing lands, because nothing writes an enveloped record yet.

Gates: unit 524 suites / 8,192 tests, integration 5 / 145, typecheck, `eslint`, `build:release`.

### M4 routes the saves: a writer writes what it changed (this commit)

**Live.** Every conversation write goes through the record store. The file is in the same place under
the same name, with the conversation inside a versioned envelope, and the layout is documented in
`AGENTS.md` and D5 as the plan requires.

**The change that matters is not the envelope.** It is that `updateConversation`, `renameConversation`
and the two reconciliation loops now say *what they changed* — a title, a status, a session binding,
the stream's message list — and only that reaches the file. The callers were already passing deltas;
`main.ts` was merging each one into a shared in-memory conversation and writing the whole thing back.
So a background title generator holding the conversation as it was before the turn put those messages
back, and an environment change clearing a session binding across every conversation wrote each one as
it had been at load. Neither is hypothetical, and neither is visible in a single-window test — which
is why this is the milestone the plan called load-bearing.

**`merge` rather than a revision check, and the difference is the point.** `save` and `mutate` are for
a caller whose copy *is* the record and must be refused if it moved underneath. A caller carrying a
change rather than a copy cannot lose what another writer put there, so there is nothing for a
revision check to protect — the read and the write share one queue slot, and the change lands on
whatever is current.

**Two findings from routing, neither looked for.**

- **The record store rejected the conversation.** `toSessionMetadata` sets absent fields to
  `undefined` rather than omitting them, and the legacy `JSON.stringify` dropped those keys on the way
  out; the store's serializability check refuses them outright. So `decode` round-trips through JSON —
  which *is* that same drop, applied where it can be read rather than relied on downstream. It
  discards nothing a reader could have seen.
- **A test double was reporting absence as `undefined`.** A bare `jest.fn()` resolves `undefined`,
  which is neither a file nor the absence of one — the store read it back as `"undefined" is not valid
  JSON` and refused the write as a damaged conversation. Fixed in the double rather than by loosening
  the contract, which is `string | null`.

**Three of eight breaks stayed green on the first pass, and all three were gaps.** Reverting
`updateConversation` and `renameConversation` to whole-object writes changed nothing, because the
tests drove `SessionStorage` directly — the storage composes two writers correctly whatever the plugin
tells it, and the plugin's half is *what it tells it changed*. **A seam both sides stub is not
covered**, again, and in the same shape as wave 1. The third was the delta filter: passing every field
through instead of the ones the caller set was invisible for the same reason. All three go red now,
pinned at the plugin.

Deliberately not here: typed history hydration, which is the milestone's other bullet;
`loadMetadata` still answers a record it cannot read as "no conversation", which is the silence those
outcomes exist to replace. Recorded as an obligation rather than half-built.

Gates: unit 525 suites / 8,202 tests, integration 5 / 149, typecheck, `eslint`, `build:release`.

### M4 closes: hydration says what happened, and the conversation shows it (this commit)

The milestone's second bullet, and the silence M0a characterized: `hydrateConversationHistory`
answered `void`, so **a conversation whose session the provider no longer has looked exactly like a
conversation with nothing in it**. The user opened it, saw an empty transcript, and had no way to tell
the difference.

All nine providers answer `ProviderHistoryHydration` now, and the mapping is not uniform because the
providers are not. Claude already counted `missingSessionCount`, `errorCount` and `successCount` and
threw all three away — every session unreadable is `corrupt`, all of them missing is `stale`, some of
them is `partial`. Codex has four ways to lose a fork's source and each of them is `stale` with its
own reason. The three no-transcript providers answer `absent`, which is the distinction the surface
acts on: **a conversation that never had a provider-side history is not one that lost it**, and an
empty new chat must not be captioned.

**The row is in the conversation, above the first message, where the missing turns would have been.**
A toast was the cheaper option and the wrong one: a conversation reopened tomorrow is missing exactly
as much as it is today, so what says so has to be part of it. Three of the six outcomes are shown and
three are not — `complete` loaded, `absent` had nothing to lose, `recovered` closed the gap.

**Three of six breaks stayed green, and two were gaps rather than gates.** Removing the controller's
pass-through typechecks, because the parameter is optional — nothing tested the controller. And a
fork calling a missing session `complete` was invisible, because no test drove the branch where the
store is asked and answers with nothing. Both are pinned now, the second across all four ACP providers
at once so the three forks cannot drift.

**A failure I introduced and did not see for three commands.** The controller change made two existing
tests throw — the plugin double had no `getHistoryHydration` — and I ran `lint`, `build:release` and
a *filtered* test pattern before the full suite. The break-test that found it was looking for
something else. Filtered runs are for iterating; the full suite is what says the tree is green.

Copy landed in all ten locales rather than English with nine fallbacks, because the coverage gate
requires it and because a fallback is the same invisibility this row exists to remove.

Gates: unit 527 suites / 8,240 tests, integration 5 / 151, typecheck, `eslint`, `build:release`.

### M3 opens: one validated inventory, and the drift it found on arrival (this commit)

`ProviderCatalog` holds the nine `ProviderModule`s, validates them at construction, and is installed
where the modules live so core reaches it without importing a provider. **What it validates is what
types cannot**: that a module's settings, workspace, auxiliary, capability and execution
contributions all claim the same provider; that no two modules share an id, an order, or an execution
backend; and that a settings codec survives a round trip of its own defaults. Capability enums are
deliberately not re-checked — they are compile-time unions over compile-time constants, and a runtime
guard there is ceremony. The one capability field that *was* unverifiable, `capabilities.workspace`,
is a named key union now, so a typo is a compile error instead of a silently missing settings section.

**The first thing the validator did was fail.** Three modules — MiMoCode, Kimi Code and Qwen —
declared the `manifest.order` of the provider they were forked from. Nothing had noticed, because
nothing compared the manifests to the registrations that actually ordered the product, and the three
tests that claimed to do so had the number copied into the assertion: `declares its identity and
ordering *from the registration it replaces*`, asserting `order: 30`. A test that names a source it
never reads is the recurring shape on this branch. The catalog refuses a duplicate order outright,
which is why the fix could not be forgotten.

**Rows 1 and 2 moved, and they had to move together.** `displayName` and `blankTabOrder` are gone
from `ProviderRegistration`; the manifest declares them and `ProviderCatalog` publishes them. Moving
one without the other would have left the two inventories able to disagree about the same provider,
which is precisely the state that produced the wrong orders. `ProviderRegistry` is no longer an
inventory at all: it answers about registrations it holds, asks the catalog which providers exist,
and **refuses a registration for an id the catalog does not hold** — a tenth provider used to be one
`register` call away from existing in nothing and answering for nothing.

The inventory document keeps the moved rows rather than deleting them, in a table of their own with
where they live now, and the fitness test asserts the two tables still add up to the sixteen fields
the registration ever declared. A row that vanishes from an inventory is indistinguishable from a
contribution that was dropped.

**Three breaks, three real gates.** Restoring Kimi Code's duplicate order fails the plugin at import
across dozens of suites with the two provider names in the message; renaming Claude in its manifest
fails four suites including the chat status line that shows the name; deleting a moved row from the
inventory fails the accounting test. None stayed green, which is the first time this session's
break-tests found no gap.

Gates: unit 529 suites / 8,274 tests, integration 5 / 151, typecheck, `eslint`, `build:release`.

### Enablement moves, and the writer stops rewriting what it did not change (this commit)

Inventory rows 3 and 4. `isEnabled` and `setEnabled` are gone from `ProviderRegistration`; the
catalog reads and writes enablement through each provider's own settings codec, from the same
`providerConfigs` entry the legacy accessors used.

**The write is the part worth reading.** Every provider's legacy `setEnabled` called
`update<Provider>ProviderSettings(settings, { enabled })`, which re-encoded the *whole* config
through that provider's normalizers before storing it — so switching a provider off also rewrote its
CLI path, its visible models, its aliases, and anything else a normalizer touched on the way past.
The catalog encodes the settings before and after `withEnabled` and stores only the keys that
differ, which for all nine is exactly `enabled`. Same rule M4 put on conversation writes, arriving
here for the same reason: a writer that stores the copy it is holding overwrites decisions it never
made.

The test that proves it is generic rather than nine hand-written ones: each provider's stored config
gets a string field in a form its own encoder would normalize away, plus a key the codec does not
model at all, and after the toggle both must survive untouched. Breaking the delta into a
whole-config write fails it for eight of the nine — the ninth, Qwen, has nothing its encoder
reshapes, which is itself worth knowing.

**A guess corrected by the suite**: a fresh vault does not have every provider disabled, it has
Codex enabled, because the default chat provider ships enabled. Pinned as product copy now rather
than left to be re-derived.

`ProviderRegistry` no longer answers which providers are enabled either; `resolveSettingsProviderId`
and `resolveProviderForModel` ask the catalog. Four of the sixteen registration fields have moved.

Gates: unit 529 suites / 8,291 tests, integration 5 / 151, typecheck, `eslint`, `build:release`.

### The capability gate was measuring four providers, and both extra findings were real (this commit)

Row 6 was next, and reading the gate that would have to hold it stopped the move. The projection
parity test — the one that proves the descriptor still produces the record the UI reads — compared
**four** providers. It was written when four modules existed and stayed that way after the other
five landed, so five providers' UI gating could have drifted with nothing to say so. Widened to all
nine, it failed twice.

**Grok, declared.** Its module says `rewind: 'unsupported'` while the live record says the provider
can rewind — the divergence Grok's flip wrote down: the legacy runtime answered `canRewind: false`
for every input, so every assistant message carried a button whose menu could only fail. A tab with
a live service already reads the descriptor and has no button; a tab without one still reads the
record. Moving the gating finishes the removal.

**Gemini, not declared, and not a defect in either statement.** Its module says
`commands.chatSurface: 'grimoire'` and the live record says `supportsProviderCommands: false`, and
both are true of different questions. `chatSurface` says what Grimoire puts in the chat input, and
Gemini's vault `.gemini/commands/**` do reach a dropdown; `supportsProviderCommands` gates loading
the *provider session's* commands, which Gemini drops. One boolean, two questions — and moving the
gating onto the descriptor would switch Gemini's session commands on as a side effect nobody decided.
**So row 6 does not move in this commit.** The projection has to stop conflating the two first, and
that is a design decision, not a mechanical move.

Both are recorded as a checked table beside the assertion rather than as a failing test or a silent
skip, with a second test that fails when an entry stops being a real divergence — an exemption list
that cannot outlive its reason.

**What did move is the field the projection could not check.** `reasoningControl` was declared
twice — in the legacy capability record and in each module's chat-UI contribution — with only the
legacy one live, and the projection took it as an *argument* from the caller, so the one field it
copied was the one field it never verified. It is a capability now, on the descriptor, and the
projection derives it like everything else. All nine agreed, which is luck rather than design: the
duplicate had no gate.

The contract's third reasoning kind was `toggle`, a word invented while writing it, next to a
product vocabulary that has said `token-budget` since before the migration. No provider declares
either, which is exactly why nothing noticed. Renamed to the product's word.

`toLegacyCapabilities` moved out of the adapter into `src/core/providers/legacyCapabilities.ts`,
where the catalog can reach it without importing a 1,900-line runtime module, and the adapter's
`reasoningControl` host port is gone along with the nine compositions that supplied it.

Gates: unit 529 suites / 8,302 tests, integration 5 / 151, typecheck, `eslint`, `build:release`.

### The command capability was one field answering two questions (this commit)

The thing that blocked row 6 in the previous commit, decided rather than deferred. The descriptor
now has three command fields instead of two: `discovery` (what the provider can list),
`chatSurface` (what Grimoire puts in the chat input), and **`sessionCommands`** (whether Grimoire
loads the commands the provider's own session announces).

Gemini is why. Its vault `.gemini/commands/**` reach the input dropdown while the twenty commands
its ACP session announces are dropped, and a single boolean could only have been wrong about one of
the two. Every other provider answers both the same way, which is why eight of nine never showed the
seam.

The legacy `supportsProviderCommands` maps from `sessionCommands` now, which is the only one of the
three it has ever gated — `getSdkCommands` returns before it reaches a catalog when the boolean is
false. Mapping from `discovery` would have turned Codex's on at its flip; mapping from `chatSurface`
was about to turn Gemini's on at row 6.

One divergence is left in the parity table, Grok's rewind, and it is the declared one.

Gates: unit 529 suites / 8,302 tests, integration 5 / 151, typecheck, `eslint`, `build:release`.

### Row 6 moves, and nine capability files are deleted (this commit)

Capability gating reads the module descriptor now. `ProviderCatalog.capabilities()` projects it into
the record the chat feature has always consumed, `ProviderRegistration.capabilities` is gone, and
the nine `src/providers/<id>/capabilities.ts` files with it — the first deletion of a whole legacy
contribution family on this branch.

**What replaces the thing being deleted is the interesting part.** A projection checked against a
descriptor is a projection checked against itself, so the nine records were copied verbatim into
`tests/fixtures/providerCapabilityBaseline.ts` before their sources were removed. The parity test
compares every field of every provider against it; editing a value there is declaring a product
change, and the fixture says so at the top. Five per-provider `capabilities.test.ts` files went with
the sources — they asserted the same values field by field for five providers, which the baseline
now does for nine.

Grok's rewind is the one declared divergence left, and moving the gating is what finishes it: a tab
with a live service already had no rewind button, a tab without one read the legacy record and had
one. Both read the descriptor now.

The parity manifest's capability surface names what reads the declarations rather than the
declarations themselves, because a module belongs to exactly one surface and the nine modules are
claimed by `provider-chat-execution`.

**Two breaks, both real.** Changing a value in the baseline fails the parity test and the module's
own agreement test; changing a value in a descriptor fails four suites, including the built-in
command test that gates the fork command — a UI surface, not a mirror.

Gates: unit 524 suites / 8,257 tests, integration 5 / 151, typecheck, `eslint`, `build:release`.

### One provider could take down every provider's workspace (this commit)

App-level inventory row 3, and the row understated it. `ProviderWorkspaceRegistry.initializeAll()`
was a `for` loop that awaited each provider's initializer in turn, with no `try`, publishing into a
static map, with no teardown at all. Three consequences, all reachable:

- **one provider took down every provider.** An initializer that threw propagated out of the loop
  and out of `onload`'s try, so every provider *after it in the iteration order* was never built —
  no command catalog, no model list, no CLI resolution, no settings tab. Which providers those were
  depended on object key order;
- **a failure was permanent** until the next plugin load, because nothing could ask again;
- **nothing was released at unload**, and the static map outlived the instance that filled it, so
  the next load read the previous load's services until its own initializer overwrote them.

`ProviderWorkspaceManager` owns the lifecycle now, one instance per plugin load. Initialization is
concurrent and isolated, a failure is recorded through a port and stays retryable, and `disposeAll`
is the half that never existed — including for a workspace that finishes *after* teardown started,
which is released rather than published.

**Two absences are deliberate and stated in the class.** Initialization is still eager: every
consumer reads its service synchronously, so laziness arrives with the move of those consumers onto
the module slots, not before. And there is no generation fence, because nothing recycles a workspace
yet — a mechanism with no producer is the dark machinery this migration is unwinding.

The registry keeps its synchronous accessors and loses its lifecycle: it builds one provider's
services on request and publishes what the manager gives it. Its comment describes the loop it used
to have rather than naming it, because the fitness test reads this file for that name.

**Four breaks, four red.** A sequential unguarded startup fails the isolation test; a teardown that
releases nothing fails three; removing `disposeAll` from `onunload` fails the integration test that
loads and unloads the real plugin; and bypassing the manager in `main.ts` fails four, including two
that were not written for it.

Gates: unit 525 suites / 8,269 tests, integration 5 / 153, typecheck, `eslint`, `build:release`.

### Environment keys were nine regular expressions saying the same thing (this commit)

Inventory row 7, at a different home than the table predicted. It named `ProviderSettingsCodec`'s
runtime-input declaration, but `runtimeInputKeys` are *settings* field names and these are
*environment variable* names — two questions that happened to sit next to each other in the first
reading. The codec declares `environmentKeyPrefixes` now, and `ProviderCatalog.environmentKeyOwner`
answers who owns a key.

**Prefixes rather than regular expressions.** All nine registrations wrote `/^PREFIX_/i` and nothing
ever needed more, while a contract that accepts an arbitrary expression is a contract where the core
runs provider-supplied code over every key a user types into their environment settings.

**One behaviour is now pinned that was previously an accident of ordering.** Antigravity and Gemini
CLI both claim `GOOGLE_`, `GEMINI_` and `VERTEX_`, first match in presentation order wins, and
Antigravity is presented first — so every Google key scopes to Antigravity. That was true before and
is unchanged; what is new is a test that says so, because reordering the two providers would
silently rescope every such key a user has already typed.

Gates: unit 525 suites / 8,287 tests, integration 5 / 153, typecheck, `eslint`, `build:release`.

### The third source of provider defaults, and what it had already lost (this commit)

App-level inventory row 2. `getBuiltInProviderDefaultConfigs()` was a hand-maintained map of nine
`DEFAULT_<PROVIDER>_PROVIDER_SETTINGS` constants standing beside the two registries — a third place
for a provider's defaults to be declared, which is a third place for them to drift. Each provider's
settings codec is the one declaration now, and the function derives from the catalog.

**Compared before replacing, and eight of nine agreed exactly.** Antigravity's hand-maintained
default omitted `discoveredModels`; its codec encodes an empty list, and its own reader normalized
the missing key back to an empty list on every load. So the shipped settings file gains one key
whose value it was already read as — stated rather than discovered later.

**Nothing was watching the shipped settings shape**, which is how that omission survived. The keys
each provider seeds are written out in a test now, rather than derived from the codecs the test is
checking, alongside the fact that a fresh vault enables exactly one provider. Adding a key to a
codec's `encode` fails it, which is the point: that is a change to the file every user's vault gets.

The freshness the old function had is kept and stated: a caller seeding settings will mutate them,
so every call returns new objects.

Gates: unit 525 suites / 8,298 tests, integration 5 / 153, typecheck, `eslint`, `build:release`.

### `features(context)` was two contracts wearing one name (this commit)

The split the previous entry named as the next move. `ProviderModule` has `declarations` — what a
provider says about itself, reachable without a plugin — and `runtimePorts(context)`, which keeps
the two ports that only mean something for a running conversation.

**The consumer had already voted.** `ExecutionChatRuntimeAdapter` is the only thing that has ever
consumed that factory, and it reads exactly two members from it: `history` and `rewind`. `chatUI` is
a module-level constant in all nine providers and reads nothing from a context. Keeping the two
groups together is what made every UI-facing row unreachable without a plugin, and so unable to
leave the legacy registration.

**Two providers were reaching a plugin to answer questions that need none.** Claude's task-result
summary and subagent display went through the module context to a `ClaudeTaskResultInterpreter` the
context constructed with no arguments; Codex's subagent recognition went through the context to
`codexSubagentLifecycleAdapter`, a module-level constant the context file already imported. Both are
read directly now, and both context members are deleted.

**One test was proving a stub.** Claude's task-result test asserted `title: 'Reviewer'` — the value
its own fake context returned. It runs against the real interpreter and a real payload now, and
fails when the title stops being read from the payload.

The adapter's `TSettings` type parameter went with the split: the runtime ports are not generic, so
nine `RuntimeAdapter` subclasses were passing a type argument nothing used.

Gates: unit 525 suites / 8,301 tests, integration 5 / 153, typecheck, `eslint`, `build:release`.

### The first row the split unblocked (this commit)

Row 5, `getPreloadedContextFiles`, moved the moment `declarations` became reachable without a
plugin. Only Grok declares it — it has no agent definition, so its system prompt is a vault file
passed on the command line, and the chat context surface shows what went in. The catalog answers an
empty list for the other eight.

Small, and worth the entry for what the test says: the assertion is *which* providers preload
something, not that Grok does. A test naming only Grok would still pass if a second provider quietly
started preloading a file.

Gates: unit 525 suites / 8,301 tests, integration 5 / 153, typecheck, `eslint`, `build:release`.

### Every row still on the registries is a rework, not a move (this commit)

Nine rows have moved, and each of the last four arrived somewhere the inventory did not predict.
That stopped looking like coincidence, so the remaining fourteen were read against their target
slots before touching any of them. **Thirteen of the fourteen are shape mismatches**, and the reason
is the same in every case: the `ProviderModule` contract was designed as a *better* contract, not as
a destination for the legacy one.

| Row | What the feature layer consumes | What the module slot offers |
|---|---|---|
| 3, `cliResolver` | `resolveFromSettings(settings): string \| null`, synchronous, called from every launch path | `resolve(): Promise<{ executable, source, diagnostics? }>` |
| 1, `commandCatalog` | `getDropdownConfig()`, `listDropdownEntries({ includeBuiltIns })`, and more | `list(): Promise<ProviderCommandDescriptor[]>` |
| 2, `agentMentionProvider` | `searchAgents(query)` | `list()` / `refresh()` |
| 4, `modelCatalog` | `refreshModels({ plugin, settings }): Promise<boolean>` | `list()` / `refresh(): Promise<ProviderModelDescriptor[]>` |
| 5, `usageProvider` | `getCachedUsage(context)` plus `refreshUsage(context)`, both taking the plugin | `read(): Promise<ProviderUsageSnapshot \| null>` |
| 10, `settingsTabRenderer` | a context carrying `HTMLElement`, section builders and command settings | `render(host: THost)`, host deliberately opaque |
| 8, `chatUIConfig` | twenty-odd members: reasoning options, service tiers, mode selectors, permission mapping, model metadata discovery taking the plugin | three: model presentation, permission toggles, icon |
| 14, `historyService` | workspace-global, asked about any conversation | runtime-bound, answers `null` for any conversation but the tab's own |
| 15, `taskResultInterpreter` | five low-level readers `SubagentManager` calls directly | one `interpret(toolName, payload)` |
| app-level 1, `workspaceCapabilities` | five resource kinds, each `{ inventory, manager, runtimeCommandDiscovery }` | one `CapabilitySupport` per key, different key set |

Only `mcpStorage`/`mcpServerManager` and `runtimeCommandLoader` were not read closely enough to
classify, and `tabWarmupPolicy` is already an M5 row.

**This is a milestone-scope finding, not an implementation detail.** M3 as written says "move
registry consumers to the catalog one contribution row at a time", and for the rows that were
genuinely declarations — identity, ordering, enablement, capabilities, environment ownership,
defaults, preloaded files — that is exactly what happened, nine times. What is left is not a set of
moves. It is re-implementing UI-shaped consumers against better contracts, and the two ways to avoid
that both cost more than they save: widening the module ports to match the legacy interfaces would
put plugin, DOM and settings-bag vocabulary into `ProviderModule.ts`, which its own boundary gate
forbids and which is the stop condition the plan states for projections; and leaving the rows where
they are means the registries survive.

M5 already owns that rework: it rebuilds the chat surface against projections and calls the renderer
"a thin replaceable layer". The rows above are the same work, on the same consumers, at the same
layer. **Recommended: close M3 at the catalog and the workspace lifecycle owner, and move the
remaining rows into M5 with the consumers they belong to** — including the "delete both registries"
exit gate, which cannot be met before its consumers are rewritten. This is a plan change and it is
recorded here as a proposal, not applied to
[`provider-execution-migration-plan.md`](provider-execution-migration-plan.md).

Gates: unchanged; this commit is documentation.

### M3 closes at a revised scope, and the plan says why (this commit)

The re-sequencing the previous entry proposed, decided by the owner: **M3 ends at the catalog and
the workspace lifecycle owner.** The thirteen rows that turned out to be re-implementations rather
than moves go to M5, with the consumers that read them, and so do registry deletion, lazy workspace
initialization, the generation fence, and the settings transaction coordinator with row 9's
reconciler.

What M3 delivered, and what its exit gate now says:

- one validated catalog holding all nine modules, rejecting a duplicate id, order or execution
  backend at construction;
- provider identity, ordering, enablement, capability gating, environment-key ownership, the shipped
  default configs, and preloaded context files come from it, with no second source declaring any of
  them;
- `ProviderModule.features(context)` split into what a provider declares and what a runtime binds,
  which is what made the declaration rows reachable without a plugin;
- provider workspaces have a lifecycle owner: concurrent isolated initialization, a recorded and
  retryable failure, and asynchronous disposal at unload.

**One product behaviour changed, and it was declared before this milestone.** A Grok tab with no live
service no longer shows a rewind button. A tab *with* a live service already had none since Grok's
flip, because the runtime answered `canRewind: false` for every input; the legacy record said
otherwise, and moving the gating onto the descriptor is what made the two agree. The exit gate names
it rather than claiming nothing moved.

`provider-execution-migration-plan.md` and `provider-contribution-inventory.md` carry the revision;
the three `src/core/**` plugin-import exemptions now name M5, and three stale in-code notes pointing
at M3 were corrected to the milestone that will actually do the work.

Gates: unit 525 suites / 8,301 tests, integration 5 / 153, typecheck, `eslint`, `build:release`.

### Creating a conversation stopped overwriting one (this commit)

The first of M4's two recorded obligations. A conversation created from a live provider session is
keyed by that session id, which is how its transcript is found again — and when the vault already
held a conversation under that id, the new one was written straight over it: empty message list,
default title, fresh timestamps. `createMetadata` merged, and a merge from a freshly built
conversation is an overwrite of everything a real chat had.

`ConversationRepository.create` refuses an id the store already holds, inside the same queue slot as
the write, so two creations of one id cannot both find it absent. The plugin catches the refusal and
creates under a fresh id instead, keeping the session in the conversation's `sessionId` field so
resume still works and the existing conversation is left alone. A refusal and a retry rather than a
lookup first, for the same reason: a check-then-write loses the race with another window.

The in-memory list is appended to after the write now, so an id the store refused never reaches it.

**The integration test needed a vault that remembers.** The shared adapter mock answers
`exists: false` and `read: ''`, which is fine for tests that only watch calls and makes every stored
conversation invisible to one that needs a collision. Fifteen lines of in-memory adapter, and the
assertion is at the product level: the old conversation still has its title.

Gates: unit 525 suites / 8,304 tests, integration 5 / 154, typecheck, `eslint`, `build:release`.

### M4 shipped a defect on this branch: every conversation came back empty (this commit)

Found while reading the second M4 obligation, and much worse than the obligation. `listMetadata()`
— the reader that fills the conversation list at startup — parsed each file with `JSON.parse` and
handed the result on. Since M4 the file holds a versioned envelope, so what it handed on was
`{ schemaVersion, recordId, revision, updatedAt, payload }`.

**That object passed the shape guard.** `isSupportedSessionMetadata` rejects only an unknown
`providerId`, and an envelope has none. So every conversation written since M4 came back from the
listing with **no id, no title, no messages, and the default provider** — the whole history, silently
replaced by placeholder rows, on the next plugin load.

The listing reads through the record store now, which is what unwraps the envelope, adopts a bare
legacy file, and refuses one this build must not act on. The legacy directory is still parsed
directly, because those files are exactly what the envelope replaced.

**Nothing caught it, and the reason is worth keeping.** Three M4 checkpoints, an integration suite
that watched every write, and a unit suite of eight thousand tests — and not one of them read a
conversation *back* through the file listing. Every assertion about persistence was made against the
writer or against the store's own API. The test added here reloads the plugin into a vault that
remembers and asks for the conversation by id; breaking the listing back to file parsing fails it
and leaves all 8,304 unit tests green.

Gates: unit 525 suites / 8,304 tests, integration 5 / 155, typecheck, `eslint`, `build:release`.

### The history list stops hiding what it cannot read (this commit)

M4's second obligation, and the last one. A conversation whose record this build must not act on — a
damaged file, or one written by a newer release — was skipped by the listing. The file stayed on
disk and the chat simply vanished from the history, indistinguishable from one the user deleted.

`listConversations()` reports them beside the readable ones, and the history dropdown renders them
as their own block above the list: no title to search, no timestamp to group by, nothing to open,
and a sentence saying which of the two it is. They are answered separately from
`getConversationList()` on purpose — folding a conversation with no title, no messages and no
provider into that list would make every consumer of it, tab titles and search and delete-all,
guard against something that cannot be opened.

The same silence typed hydration removed from the transcript, removed from the list. Copy landed in
all ten locales, because a fallback is that silence again in another language.

Gates: unit 525 suites / 8,306 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### Bang-bash mode stops owning a process the plugin cannot end (this commit)

An M5 item, and the one that closes the composition-boundary gate's last feature exemption. Bang-bash
mode spawned its own child through `child_process` from inside the chat feature: a 30-second
`exec` with a 1MB buffer, owned by nothing. Unloading the plugin left it running.

It is a run on the kernel now, through `LocalShellBackend` — which was built at M1, tested, and had
never had a consumer. **The first internal-service backend in production**: the association is
`{ kind: 'internal', service: 'shell' }` rather than a provider, which is the case the kernel's
identity model was designed for and had never exercised. One session per plugin load, owned by the
application rather than by a conversation, because a shell command does not belong to a chat and
closing the tab that typed it should not make the process someone else's problem.

**Output does not travel as events.** The backend reports lifecycle through the event stream and
hands raw bytes to an output observer, so the composition buffers per run and decodes with a
*streaming* decoder — a pipe splits wherever it likes, and decoding each chunk alone turns one
multi-byte character into two replacement characters. That break stayed green until a test wrote an
arrow as `[0xe2]` then `[0x86, 0x92]`.

**One field is gone and it is worth saying so.** `BangBashResult.exitCode` was a number the status
panel stored and never rendered; a terminal event reports a kind and a reason, not an exit status.
Rather than invent one, the outcome says `failed` and carries a message only for the failures whose
reason is not already on stdout — a timeout, an output limit, a process that could not start. A
non-zero exit explains itself in the command's own output, and a Grimoire sentence there would sit
in front of the shell's.

Gates: unit 525 suites / 8,306 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### M5's chat projection, dark, and the rule that keeps it that way (this commit)

The reducer the chat surface will consume instead of the adapter's chunk stream: what a conversation
looks like, derived from what the kernel recorded — messages, turns, interactions, queued commands,
persistence state. Harvested from the first attempt's Phase 7 as material and rebuilt against this
branch's contracts, with its test.

Dark on purpose and listed as pending in the parity manifest, the way M1's kernel and M4's record
store were: its first consumer is the chat execution coordinator, and building the coordinator is
the next step. What is *not* deferred is the rule.

**The stop condition is a gate now, not a sentence.** The plan says projections carry no DOM types,
CSS class names, element structure or layout vocabulary, because that is what makes a later UI
redesign a renderer swap instead of another architecture event. Two rules hold it: the projection is
on the composition-boundary gate's strict list, which already forbids DOM globals, `obsidian`,
providers and process launches — and a second rule reads the file for the markers that arrive as
*field names* rather than as imports, which no import check can see. `readonly cssClass: string`
passes every import rule ever written.

**One thing the harvest had was left out.** The v1 projection also folded in a durable
`ExecutionRunRecord`, so a run recovered at startup could reach the surface without replaying its
events. `RunProjection` here has no reducer for one, and adding it now would be a slot with no
producer. It arrives with its consumer, and the reason is written where the event would have gone.

**A sharp edge found by porting.** The reducer's switch had no default, and `noImplicitReturns` is
off in this repository — so a kind added to the union without a case would fall out and return
`undefined`, erasing the whole conversation with nothing to catch it. Two of the ported tests hit
exactly that. It ends in a `never` assignment, which makes the omission a compile error, plus a
return that makes a malformed event a no-op rather than a blank chat.

Gates: unit 526 suites / 8,314 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### The chat execution coordinator, dark, and the terminal nobody could see (this commit)

The projection's first consumer, and M5's centre: turn acceptance, dispatch, the persistence
barrier, and queued-input release. Harvested from the first attempt's Phase 7 as material and
rebuilt against this branch's contracts — which is where the value was, because three of that
attempt's parts had no producer here and reading each one out is what removed it.

**The v1 coordinator took a result materializer. There is nothing on this branch that could
implement one.** A `ResultRef` here is a *reference*: every provider's projection sink commits one
without writing the answer, because D2 forbids a second copy of a provider transcript, and the open
obligation above records that no result reference can be resolved back to the turn that produced it.
So the injected port would have been a slot with nothing behind it. What the coordinator persists
instead is the answer it watched arrive — accumulated from the run's own `output-delta` envelopes,
which is the same source the chat surface renders from today, and the same one `ExecutionRunStream`
folds into chunks.

**The v1 coordinator subscribed to record notifications. This branch publishes envelopes.** `observe`
is a real subscription on the registry, so a run's state is derived from what the ingestor committed
rather than from a record delivered beside it — which is also why no `run-record` event is fed to the
projection here. That event's producer is startup restore, which this step does not do, so the
reducer note the projection commit wrote still stands.

**The v1 coordinator retried a revision conflict four times. M4 removed the conflict.** A writer here
applies a change rather than a copy, inside the store's own queue slot. The gap that exposed:
`ConversationRepository.merge` takes *fields*, and appending a message is not a field — it is the
current messages plus one, which a caller computing it outside the slot computes from a copy another
writer may have moved past. `apply` is that operation, with the concurrent-append test that goes red
without it.

**A defect the coordinator made reachable, found by composing rather than by reading.** A terminal
the registry reaches on its own — a pre-dispatch rejection, a recovery, a cancellation the provider
never acknowledged — never passes the ingestor, so it is published carrying *the position it
follows* rather than a new one. `reduceRunProjection` read that as a replay and dropped it. The run
then stays running in every projection consumer forever: the answer is never saved, the input never
unlocks, and the control store holds a settled run the surface cannot see. The envelope now says
`synthesized: true` and the ordering guard excuses exactly that one case, with the event id still
making a second delivery a no-op — the same shape as the transient-envelope rule directly above it,
which was found the same way. The registry's own comment already claimed the envelope was "marked as
such"; the mark was the event id, which no consumer can read without matching a string.

**Two more the port found.** A provider that answers inside `startRun` — a warm CLI does, and every
in-process backend does — publishes its first envelopes before the coordinator has a run to attribute
them to, and the projection drops an envelope for a turn it does not have: the opening tokens of a
fast turn were silently gone, in v1 too. They are held and flushed when the turn reaches the
projection. And the kernel publishes no envelope for an interaction it resolves, because the provider
reports its own closing; the person who clicked has already answered, so the committed record is read
back and shown rather than leaving a resolved question on screen until a provider mentions it.

**Composed against the real kernel and the real store, with the provider as the only fake.** Wave 1's
lesson is that a seam both sides stub is not covered, so the test drives `ExecutionLifecycleRegistry`,
`ConversationRepository` and `DeterministicFakeBackend` together, and reads the answer back through a
store reopened over the same vault rather than through the writer's own cache. Six gates were proved
by breaking them: the synthesized-terminal guard (the turn never completes), the pre-dispatch buffer
(the answer is empty), the persistence hold (a failed write releases the queue anyway), the
interaction read-back, `apply`'s slot (one append reverts the other), and both halves of the new
boundary rule.

**Still dark, and the build says so**: nothing imports it, and the release bundle does not contain it —
tree-shaken out, while the `synthesized` marker beside it is in there, because that one is a fix to a
path production already runs. It is listed as pending in the parity manifest; its own first consumer
is the renderer that maps a projection onto the existing chat DOM, which is the next step.

What this step deliberately does not do, each with its reason: **startup restore** — the coordinator
adopts no run the kernel already owns, because `getRunsForOwner` and `getSessionsForOwner` do not
exist on this registry and the projection's run-record event has no producer without them;
**reconciliation** — an indeterminate run's later verdict is appended to the control store with no
notification, so nothing can observe it; **agent-scoped output** — a subagent's deltas are a surface
of their own rather than this turn's answer. The first two are the same missing thing: an observation
channel for records, which is what restore needs and what the reconciled-result half of the
projection is waiting for.

Gates: unit 527 suites / 8,335 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### The projection carries live content, which is the decision the renderer waited on (this commit)

The question the previous entry left open, answered where it had to be. A projection filled only at
the persistence barrier can render a turn's *state* — thinking, tools, progress, interactions — and
not a word of the answer until the turn is over, and there were exactly two ways out: fold the
transient content into the projection, or run a second channel of chunks beside it. The second is
*chunks appended as they arrive* under a new name, which is the consumption this whole step exists
to replace, so it was never really two.

**The rule this looks like it breaks is one rule read at two altitudes.** `RunProjection` refuses
transient content because a projection of a *run* records what happened, and partial text is not a
fact about the run — the committed result is. A projection of a *chat* is what a person is looking
at, and while the turn is running the partial text is the whole of it. Nothing about D2 changes:
that rule is about what is persisted, and live content is never written anywhere.

Three properties it has, each with a test that goes red without it:

- **coalesced**, so a turn's worth of token traffic is not a turn's worth of array entries: one item
  per stretch of the same kind, ordered against the `provider-content` items the provider sent
  between them — which is what keeps a tool call in the place the model put it;
- **this turn's own**, so a session-scoped envelope and an agent-scoped one are both refused. A
  subagent's words in the parent turn's answer would be persisted as the parent's answer;
- **closed at the terminal**, so content that arrives after the barrier has run cannot leave the
  projection and the stored message disagreeing about what the turn said.

**The coordinator lost its private accumulator in the same commit, and that is the point rather than
tidying.** It kept a `Map<RunId, string>` of the answer as it streamed; the projection now holds the
same thing, and two accumulators over one stream are two answers that can differ — the surface
rendering one and the barrier persisting the other. The barrier reads the turn, so what is stored is
what was shown, and the composition test asserts exactly that: the partial answer reaches an attached
listener mid-run, the conversation still holds only the question, and the message written at the end
is the text the listener had been reading.

Reasoning is kept apart from the answer for the same reason it is on the legacy path: it is not what
gets persisted as the message.

Gates: unit 527 suites / 8,341 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### A reload stopped orphaning the turn the kernel is still running (this commit)

A hole in what the two commits above shipped, closed before building on top of them. A run is
durable and the surface watching it is not: a reload, a reopened tab or a second window arrives at a
conversation whose turn is still going inside the kernel, and the coordinator had no way to take it
over. Nothing rendered it, nothing ran its persistence barrier, and the answer it was still
producing was written nowhere — the exact failure the durable kernel exists to prevent, reintroduced
one layer above it.

**It needed less than the plan assumed.** The listed next step was an observation channel for
control records, because the first attempt subscribed to record notifications. Reading what adoption
actually needs shortened it to two queries: `getRunsForOwner` and `getSessionsForOwner`. Live updates
after adoption already arrive — the registry publishes envelopes for everything it ingests and for
the terminals it states itself — so what was missing was only the *starting position*, and a record
is a query rather than an event. The notification channel is still owed, for reconciliation, and it
is now owed for one thing instead of three.

**Both queries answer for this process, not for the vault**, and say so: C1 bounds the registry's
maps to live work plus whatever a reopened session brought back, so what comes back is what a
surface can still attach to. That is the only thing a caller can do with the answer.

**`applyRunRecord` adopts the record's position along with its state**, which is the part that is
easy to leave out and impossible to see afterwards. Without `lastSequence` the projection sits at
zero and every envelope still in flight behind the record replays into it — a tool call counted
twice, an interaction reopened. The unit test that proves it applies an envelope from *before* the
adopted position and asserts nothing moved.

**Only unfinished runs are adopted.** A terminal run this process still holds is finished work: its
events went to whoever was listening at the time, and the control store keeps facts rather than a
transcript, so adopting one would add a turn whose answer this coordinator can never supply — beside
the message that already holds it.

The scope test is the one that matters most here and it is the one a single-conversation suite cannot
have: a query that answered for every owner reads identically from inside one conversation's test and
puts another chat's running turn into this one. There are two conversations in it now.

**A structural thing adoption revealed.** `ActiveTurn` carried the whole `SubmitChatTurnCommand`, and
an adopted run has no user message, no request ref and no backend choice — those belong to a turn
somebody asked for. Carrying a command for it would have meant inventing the three fields that are
not true, so the identity a turn needs (conversation, command id, result expectation) is flat now and
the submitted command is what is optional.

**And the session's own mistake, recorded because it is the second time.** A break test was reverted
with `git checkout -- <file>` on uncommitted work and took the whole change with it, not the injected
defect — the same mistake the 2026-08-24 entry recorded, made again on a file that had been backed up
for an earlier break and not for this one. Back up before every break, and restore from the backup.

Gates: unit 527 suites / 8,348 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### The renderer: what changed, as the calls a surface makes (this commit)

The plan's "thin replaceable layer that maps projections onto the current DOM", with the DOM behind
a port. What is in the module is the part that is the same whatever the surface is made of —
deciding what changed — and what is behind `ChatRenderTarget` is the part specific to this
application's chat column. That split is what makes a later redesign a new target rather than a new
architecture, and the renderer is on the same boundary gate as the projection and the coordinator
because of it.

**Its vocabulary was read out of the consumer, not designed.** `StreamController` opens a text block
on the first append, appends into it, and finalizes it when the next kind of content arrives —
`flushPendingTools`, `finalizeCurrentTextBlock`, `finalizeCurrentThinkingBlock` are all that one
decision, made by watching the chunk type change. The port says it once, with the block index: a new
index opens a block and the target finalizes whatever it had. That is the same decision taken where
the ordering is already known instead of re-derived from the content.

**A projection is a state and a chat column is an incremental thing**, which is the whole reason this
is a class with a previous value rather than a `replace(model)` call. Redrawing a conversation on
every token would lose scroll position, selection and every rendered code block. The first attempt's
renderer did replace wholesale and never had to face it, because it had no live content to replace
with — which is the second time that attempt's shape turned out to be a consequence of something it
was missing rather than a design to copy.

**The diff is cheap because the reducer is written the way it is.** An untouched turn is the same
object and an untouched message list is the same array, so a render during a stream compares a
handful of references and touches one block. The composition test is what holds that: a two-delta
answer through the real kernel produces one `openTurnBlock`, one `extendTurnText`, one `endTurn` —
no redraw, and no `appendMessage` at all.

**One decision is asked before anything is drawn.** Whether every difference is something to *add* —
same conversation, transcript extended rather than rewritten, turns in place, each turn's content
grown the way a projection grows. If any of that fails the view is redrawn from nothing. Asking once
up front is what stops the pass from discovering halfway through that a change had no increment and
leaving the column half updated; the first draft threw from inside the walk and would have done
exactly that, with no catch anywhere.

**The rule the previous entry predicted, now enforced.** A turn drawn live has its answer on screen
block by block, and the message the barrier then writes holds the same words: the renderer skips a
message whose id is a rendered turn's `assistantMessageId`, and shows every other message that
arrives. Breaking that rule fails two tests, one of them the end-to-end one.

The composition harness moved to `tests/unit/features/chat/chatExecutionHarness.ts` so the renderer's
suite and the coordinator's share one composition. Two copies of "the real kernel, the real store, a
fake provider" is two definitions of composed, and the value of composing is gone the moment they
disagree.

Still dark: nothing constructs a renderer, no target implements the port, and the release bundle does
not contain it. What is left for the chat step is the target itself — an adapter over
`MessageRenderer` and the block helpers `StreamController` already owns — and the provider-content
half of it, where `ProviderContentPresenter` turns an opaque payload into something to draw.

Gates: unit 528 suites / 8,360 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### Reconciliation reaches the surface, and the slot that never could is gone (this commit)

Two dead slots in the projection, opposite answers, and reading which was which is the whole entry.

**`reconciliation-record` had no producer and now has one.** A reconciliation is the one durable
record with no other way out of the kernel: a run's every state reaches a reader as an envelope —
either an event the ingestor accepted or a terminal the registry states — and this is neither. It is
later evidence about a run that already ended indeterminate, written straight to the store by
whoever gathered it. Without a channel the surface keeps saying "could not establish whether this run
completed" about a run the recovery has since established. `observeReconciliations` is that channel,
shaped like `observe` and separate from it because the two answer different questions; the
coordinator subscribes to both at the session, and the renderer reports the outcome *after* the
terminal rather than instead of it — the turn did end without an answer, and this is evidence about
it, not a correction of it.

**`reconciled-result-materialized` had no producer and never can have one.** It carried a
`MaterializedChatResult` per reconciliation, harvested from an attempt that had a service able to
resolve a `ResultRef` back to an answer. Nothing on this branch can, and not by omission: every
provider's sink commits a reference without writing the answer because D2 requires it. So the slot is
deleted rather than left waiting for a producer the persistence decisions forbid, and the reason is
written where it stood. The outcome itself — succeeded, failed, cancelled — is on
`run.reconciledOutcomes`, and that is the whole of what evidence establishes.

The general record-notification channel the plan expected is still not built, and after this it is
not owed either: runs and interactions reach a reader through envelopes, adoption reaches them
through queries, and reconciliation now has a channel of its own. A union with one member and a
discriminator nobody reads twice would have been the copy of the first attempt's shape rather than
this branch's answer.

#### What reading the render target found, before building it

The next step was going to be the target. Three things came out of reading its consumers first, and
each would have been discovered halfway through writing it:

- **`ProviderContentPresenter` returns `StreamChunk[]`, which the target may not consume.** The
  structural deletion gate searches for `\bStreamChunk\b` and the plan says a neutral projection
  content type "receives a new projection-specific name". So the content half of `StreamChunk` needs
  its own name and owner before a target can be written against it. The *shape* is right — it is what
  the surface already renders — so this is a split and a rename, not a redesign:
  `StreamChunk = <content> | <lifecycle>`, where the lifecycle half is what the projection replaced
  (`done`, `error`, `status`, `user_message_start`, `assistant_message_start`) and is what gets
  deleted;
- **the producers are the provider routers, and they are the part deliberately kept.** Eight content
  presenters, 2,252 lines, each delegating to a normalizer proven against real transcripts —
  `CodexNotificationRouter` alone is a thousand. The rename lands on them. They also emit lifecycle
  chunks that the presenters partly filter today (Codex drops its own error chunk and keeps the
  words, because the kernel already renders one error for a failed run), so the split has to be made
  where that filtering is, not above it;
- **the projection carries no usage, and the context-window meter is a baseline surface.** `usage` is
  emitted nineteen times across production and reaches the surface as a chunk; the kernel carries no
  token counts and neither does the chat projection. A target driven only by a projection cannot draw
  the meter. That is a contract decision — does a turn's usage belong on the projection, or does the
  target read it from the provider content it is already being handed — and it is the third
  prerequisite rather than a detail of the target.

Gates: unit 528 suites / 8,362 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### The content vocabulary has a name, and the type checker said where the line is (this commit)

The first of the render target's three prerequisites, done as far as it goes today and stopped where
the evidence said to stop.

`StreamChunk` is now `ChatContentItem | ChatTurnLifecycleChunk`. The content half is what a provider
is *saying* — text, thinking, tool calls and their results, progress, notices, subagent traffic,
compaction boundaries, usage — produced by normalizers proven against real transcripts and unchanged
in shape. The lifecycle half is the five variants the execution projection now states as facts:
`user_message_start` and `assistant_message_start` are a turn's boundaries, `status` is the thinking
indicator's text, `error` is the terminal's reason, `done` is the terminal itself. That is the split
M5's seam deletion acts on, and naming it is what the plan asks for: a content type that still needs
streamed rendering gets a projection-specific name rather than being retained under ambiguous
ownership.

**Then the port was narrowed to the content half, and the type checker refused — which is the finding.**
All eight flipped providers' presenters failed to assign, and not over `done` or `error`, which each
of them already filters: over **turn framing**. `user_message_start` and `assistant_message_start`
travel the content channel today and `InputController` reads them to split a *steered* turn into
separate messages. So the port cannot become content-only before the reader that needs framing is
gone, and that reader is what the flip deletes. The narrowing is part of the flip rather than a step
before it, and the comment on the port now says so instead of leaving the next attempt to rediscover
it by compiling.

**`usage` sits on the content side, which is the answer to the question the previous entry left open.**
It looks like a fact about the run and is not: no part of the kernel carries token counts, and the
only thing that knows them is the provider payload it arrives in. So the context-window meter is fed
from content the target is handed, not from a projection field — and what is still owed is the write
path, since the barrier persists messages and `lastResponseAt` and the legacy save wrote
`conversation.usage` too.

The classification is pinned by a gate rather than by this paragraph, because a variant drifting to
the wrong side is a variant the deletion either takes with it or leaves behind, and neither is visible
by reading the union. The same gate holds the framing readers at exactly one file — a second one
appearing mid-flip is two opinions about where a turn begins, in the period when the projection is
becoming the answer. Its parser is guarded too: the first version terminated the union at the first
`;` and reported three variants of thirteen, and both rules passed on that empty-ish set.

Gates: unit 529 suites / 8,366 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

#### A fourth prerequisite the target has, found by reading who already presents an interaction

Recorded against the renderer's port rather than discovered by whoever writes the target: **an
approval is already on screen before the projection mentions it.** Every flipped provider has an
interaction presenter — `CodexInteractionPresenter` and its eight siblings — triggered by its own
backend when the interaction opens, rendering through the legacy approval callbacks the surface
installed, and returning a response id the kernel records. The presentation is provider-owned because
the ref is opaque and only the provider knows what its own question looks like; the *answer* already
flows back through the kernel, so there is no conflict about who resolves.

There is a conflict about who *shows*. A projection-driven surface wants the question shown from the
projection, so that a tab reopened mid-question shows it — which is the whole point of the
interaction being a durable record. A target that implements `showInteraction` today would open a
second dialog beside the presenter's. Which trigger survives is settled by the flip that replaces the
legacy approval callbacks, and the port now says so where an implementer will read it.

That makes four prerequisites the render target had, three of them found by reading its consumers
before writing it and none of them visible from the port's own signature: the content vocabulary
(split, this commit), usage (answered — content, with its write path still owed), the two indicators
(six call sites to read), and this.

Gates: unit 529 suites / 8,366 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### The render target: the first piece of this path allowed to touch a DOM (this commit)

`ChatSurfaceRenderTarget` implements the renderer's port over `StreamController`, `MessageRenderer`
and `ChatState`. Every call is an operation the chat column already performs, in the order it
performs it — the target decides nothing about *what* changed, which the renderer did — so what is
here is a translation, which is the shape the plan asks for when it calls the renderer a thin
replaceable layer.

**The ports are narrow views of three real classes, and a test casts each one into its port.** A
method renamed on any of them would otherwise leave this compiling against a shape nothing
implements, and nothing would say so until the flip wired it up — the same gate the coordinator has
against the registry, for the same reason.

**It synthesizes two lifecycle chunks and no others, both from the kernel's terminal.** `done`,
because the legacy controller closes a turn on it and its finalization is private; `error`, because
that is the failed ending this column already shows. The direction is what makes them right: a
content presenter that emitted either would be a provider claiming a turn ended, which each presenter
filters out. `status` and the two message-start boundaries are absent, because a projection-driven
surface takes those from the run's state and the turn's own beginning — which is exactly the split
the commit below this one named.

**The indicators, after reading the six call sites the previous entry said to read.** The mapping is
smaller than the six suggested: a turn's beginning shows the thinking indicator and starts the
silence timer, its terminal hides and stops them, content arriving hides the thinking indicator
already inside `appendText`, and the only thing left for `setTurnState` is the pause — a person
reading a permission prompt is not a provider that has gone quiet, and counting it as one reports a
turn waiting on a human as stalled.

**Two defects the tests caught in the first draft**, both the kind that only a recorded call order
shows: `beginTurn` rendered the assistant bubble *twice*, because it called the append pair and then
called `addMessage` again to get the element back; and the renderability recovery was documented but
unwired, so an unexpressible change threw out of `render` instead of redrawing — that one was in the
renderer and is fixed in the commit above.

**Tested against recording doubles rather than a DOM**, on purpose: the target is a translation —
which operation, with what, in what order — and what those operations then do to the column is
`StreamController`'s own behaviour with three thousand lines of tests of its own. Testing it through
here would test it twice and this not at all.

Still dark, and the release bundle does not contain it. What turns it on is the attachment that binds
a tab to a coordinator, and that is the flip: `InputController` and `StreamController` stop owning
the turn, which is a smoke matrix rather than a gate.

Gates: unit 530 suites / 8,379 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### The whole chat path, composed and proven before the flip touches it (this commit)

`ChatProjectionAttachment` is the last dark piece: one tab's subscription to one conversation's
projection. With it the path exists end to end — a provider talking, the kernel ingesting, the
coordinator reducing, the renderer diffing, the target calling the column's own operations — and the
composition test drives all of it with two fakes: the provider, and the DOM. Wave 1's rule is that a
seam both sides stub is not covered, and this is M5's chat seam, run **before** the flip rather than
after it. That order is the one thing wave 1 got right that everything since has depended on.

The test asserts the call sequence a whole turn produces, and the sequence is the artifact: the
conversation drawn, the question appended, one assistant bubble, three blocks in the order the model
produced them — text, the provider's own item, text — one ending, both indicators stopped. Then the
property the whole path exists to keep: **the answer the column drew and the answer the vault holds
are the same one.**

**The attachment's shape came from a test that could not be written.** The first draft was a static
factory returning the attachment once the conversation had loaded — and the race it documented, a tab
closed mid-load, was unreachable through it, because the caller had nothing to close until the load
finished. Constructed first and opened after, the window is real and the test closes the tab inside
it. The same generation counter answers the second case: a tab opened on another conversation while
the first is still loading must not draw the first one's projection into the second one's column.

**A coincidence the tests were passing on, and what it turned into.** The end-to-end sequence held
partly because the harness's `assistantMessageIdForRun` and the target's own minting happened to
produce the same string. They are not required to: the live bubble is minted by the target and the
stored message is named by the provider's result id whenever the run commits one. A second test makes
them differ, and the column still draws one answer — the renderer skips the stored message by the
turn's record of what it drew, not by comparing ids. So the rule holds, and what the test now records
is the divergence itself: **the id of the bubble on screen is not the id of the message in the vault**,
which is what a rewind addresses before a reload versus after one. That belongs to the flip.

**The reload is drawn too**, in the same composition: a run outliving the column that watched it, a
tab opened onto the conversation afterwards, the turn shown in progress with a bubble of its own, and
the barrier running for a turn no ticket in this process is waiting on. That is the whole of what
adoption was for, seen from the surface for the first time.

Gates: unit 531 suites / 8,388 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### The drawn answer and the stored answer become one message (this commit)

The first of the flip's four open questions, closed on its own so the flip does not have to carry it.
A turn's answer had two identities: the bubble a surface draws was minted by the target, and the
message the barrier stores was named by the provider's result id whenever the run committed one.
Everything that addresses a message by id — rewind, fork, the action buttons, `state.messages` —
therefore meant one thing before a reload and another after it.

**A turn now names its answer before a word of it arrives.** `assistantMessageId` is on the turn
projection from `turn-started` rather than appearing at the barrier, the target draws under it, and
the barrier stores under it. That also answers the second question — who creates the assistant
message — without a rule: the coordinator names it, the target draws it, the barrier stores it, and
there is nothing left to arbitrate.

**The provider's result id was doing a job it is still needed for**, so it moved to the field that
asks that question. `ChatMessage` has both `id` and `assistantMessageId`, and the second is
documented as the *provider-native* identifier a rewind or a fork resumes at; the barrier was writing
the result id into both. They are two questions and now have two answers.

Found because a test was passing on a coincidence. The end-to-end sequence held partly because the
harness's `assistantMessageIdForRun` and the target's own minting produced the same string; the test
written to separate them recorded the divergence as a finding, and the finding turned out to be a
defect worth fixing rather than a decision worth deferring. That test now asserts the invariant
instead, and goes red from either end — a barrier that mints its own id, or a target that does.

Gates: unit 531 suites / 8,388 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

### What a turn cost travels back, because nothing else carries it (this commit)

The third of the flip's four questions. Token counts reach the surface as *content* — no part of the
kernel carries them, and the only thing that knows them is the provider payload they arrive in — so
`conversation.usage`, which the legacy save wrote and every context meter reads, would have been lost
with the surface that saw it. The target reports it and the barrier persists it: a call rather than a
projection field, because a field would have to be fed from the target anyway and then read from
there again.

**What is reported is what the controller kept, not what the chunk carried.** `StreamController`
already drops a usage report from another session and an aggregate that counts a subagent's tokens as
the parent's; a second copy of those rules in the target is a second copy that can disagree, so the
target reads back what the controller was left holding.

**A turn that reports nothing leaves the last turn's usage alone.** Writing the absence through would
erase what the previous turn established, which is what a provider that simply says nothing about
tokens would have caused on every turn.

**Two harness defects this found, both of the same shape.** The composition harness's conversation
mapping silently dropped `usage` in both directions — and a mapping that drops a field a turn writes
reads exactly like a turn that does not write it, which is what the first red said. And the edit that
fixed it validated its last change before writing any of them, so an assertion failure discarded the
two that had already succeeded: the same lesson as the `git checkout` one, in a different tool. One
change per write.

Gates: unit 531 suites / 8,392 tests, integration 5 / 156, typecheck, `eslint`, `build:release`.

## Current blocker

**Single resume pointer. Everything below this line is the current state; nothing above it
overrides it.**

Active branch: `providers-migration`. Last synced with `main`: 1.1.7 (`0f84b41`).

### Where the session of 2026-08-25 ended

**M3 is complete, at a scope the owner revised mid-session.** `ProviderCatalog` is the one validated inventory of
the nine modules, and `ProviderWorkspaceManager` owns both halves of the workspace lifecycle.
Registration rows 1, 2, 3, 4, 5, 6 and 7 and app-level rows 2 and 3 are gone from their old homes,
and `features(context)` has been split into what a provider declares and what a runtime binds; the
two registries hold what is left.

**Every checkpoint this session found something live, and none of it was found by reading the code
that changed — it was found by the gate that had to hold the change.**

- three modules carried the `manifest.order` of the provider they were forked from, and the three
  tests titled *"declares its identity and ordering from the registration it replaces"* had the
  number copied into the assertion instead of reading the registration;
- switching a provider off re-encoded its whole config through that provider's normalizers, so a
  toggle rewrote the CLI path and the model lists on the way past;
- the capability parity test compared four providers of nine. Widened, it failed twice: Grok's
  declared rewind divergence, and a Gemini command capability where one boolean was answering two
  different questions;
- provider workspace startup was a loop with no `try`, so one initializer throwing cost every
  provider *after it in the iteration order* its command catalog, model list, CLI resolution and
  settings tab — and the order came from object keys. Nothing was released at unload, and the static
  services map outlived the instance that filled it;
- nine registrations each wrote `/^PREFIX_/i` for their environment keys, which is a contract that
  runs provider-supplied expressions over every key a user types.

**The recurring shape is one to keep**: a gate that measures a subset reads exactly like a gate that
measures everything. Four of the five above were found by widening a gate's *scope*, not by
tightening its rule.

**One row was deliberately not moved and then unblocked in its own commit.** Capability gating would
have switched Gemini's session commands on as a side effect, because `chatSurface` and
`supportsProviderCommands` answer different questions. Recorded as a checked divergence, decided in
the next commit by giving the descriptor a third command field, then moved.

#### Four target homes the inventory named are wrong, and reading them is why

Written down here because each was found by reading the destination before moving, and each would
have been an afternoon spent building the wrong seam:

- **Row 14, `historyService`, does not belong in `features(context)`.** The module's `history` port
  is deliberately *runtime-scoped*: every provider's context answers `null` for a conversation id
  that is not the tab's own, and Codex's factory says so in a comment — a lookup across the
  workspace "would answer for a conversation this runtime does not serve". The legacy
  `historyService` is workspace-global, and its four consumers ask about any conversation. The two
  are different contracts wearing one name. Its real home is a **workspace slot**, served by the
  manager, like commands and models;
- **row 8, `chatUIConfig`, cannot move as `ProviderChatUiContribution` stands.** The legacy
  interface has twenty-odd members — reasoning options, service-tier and mode toggles, permission
  mapping, model metadata discovery taking the plugin — against three in the module contribution.
  Expanding the contribution to match would give `ProviderModule.ts` plugin and UI vocabulary, which
  its own boundary gate forbids. This row needs a decision about where provider *presentation*
  lives, not a move;
- **row 5's slot has no provider filling it.** No module declares `context`, so preloaded context
  files exist only on the registration today;
- **app-level row 1, `workspaceCapabilities`, is not `capabilities.workspace`.** The legacy record
  is five resource kinds each carrying `{ inventory, manager, runtimeCommandDiscovery }`; the
  descriptor's map is one `CapabilitySupport` per key over a different key set. The richer one
  cannot be projected from the coarser one.

What *is* still true: `chatUI` is a module-level constant in all nine modules and never reads the
context, and rows 15 and 16 use the context only for plugin-owned services rather than for the bound
conversation. So `features(context)` is really two contracts — static provider declarations and
runtime-scoped ports — and splitting it is the move that unblocks the rest.

#### What to pick up next, in order

**M3 is closed.** Everything below is M5 or later.

1. **The flip.** Every dark piece of the chat path now exists and is composed end to end in
   `ChatProjectionAttachment.test.ts` — projection, live content, coordinator, adoption, renderer,
   target, attachment. What is left is turning it on inside a tab, and it is small next to what it
   replaces. Four things have to be settled in that checkpoint rather than discovered during it:
   - ~~**the id of the bubble and the id of the stored message differ**~~ and ~~**who creates the
     assistant message**~~ — **both closed in the entry above**: a turn names its answer at
     `turn-started`, the target draws under that id and the barrier stores under it. What is left of
     the second is only that `InputController` also creates one today, and stops at the flip;
   - ~~**usage's write path.**~~ **Closed in the entry above**: the target reports what the
     controller kept and the barrier persists it, leaving the last turn's usage alone when a turn
     reports none;
   - **which interaction trigger survives**, per the note on the port: the provider's presenter has
     the dialog on screen already, and the projection wants to show it from state so a reopened tab
     shows the question.
   This is the flip, so it is a smoke matrix rather than a gate, and per the standing rule it is
   certified against a live provider before the next thing lands.
2. **`InputController` and `StreamController` stop owning the turn**, once a target exists. That is
   the flip, and it is the one that needs a smoke matrix rather than a gate: 2,100 lines of
   incremental append and 2,150 of turn acceptance come out, and every provider's chat behaviour is
   downstream of them.
   The thirteen provider rows handed over from M3 are re-implementations of the same UI-shaped
   consumers, so doing them first means rewriting each consumer twice.
3. ~~**An observation channel for control records.**~~ **Closed in the entry above**, and closed
   smaller than it was written: adoption needed queries, reconciliation needed a channel of its own,
   and the third waiting slot was one that can never have a producer and is deleted.
4. **The workspace context assembly comes *after* those consumers, not before.** It looked like the
   next step until reading the rows: every provider's `workspace.initialize(context)` needs a
   context built from the plugin, eight have a `create<Provider>ModuleContext`, and the machinery is
   straightforward — but no workspace row can move onto it until its consumer is reworked, so
   building it first would be a mechanism with no reader. `cliResolution` looked like the cheapest
   first row until reading it showed the module port is async while every launch path calls the
   legacy resolver synchronously. Pick a row by reading its consumer first; that is what this
   session taught five times over.
5. **Rows 15 and 16 need `SubagentManager` before they can move.** The split made
   `declarations.taskResults` and `declarations.nativeAgents` reachable, but the legacy
   `ProviderTaskResultInterpreter` the feature layer consumes is five low-level methods
   (`hasAsyncLaunchMarker`, `extractAgentId`, `extractStructuredResult`, `resolveTerminalStatus`,
   `extractTagValue`) against the module port's single `interpret`. `SubagentManager` reads the
   low-level ones directly, so this is an M5-shaped rework, not a row move.
6. **Row 8, `chatUIConfig`, is an M5 row.** The legacy interface is twenty-odd
   UI members — reasoning options, service-tier and mode toggles, permission mapping, model metadata
   discovery taking the plugin — and `ProviderModule.ts` may not acquire plugin or UI vocabulary. The
   plan's own M5 calls the renderer a thin replaceable layer; this row belongs to that step. Worth an
   explicit decision and an inventory correction rather than an attempt.
7. **Row 9, `settingsReconciler`.** Unblocked but not small: `ProviderSettingsCoordinator` projects,
   clones and merges the settings record per provider, and the codec's `reconcile` works on decoded
   provider settings. Re-expressing that is a settings-behaviour risk, so it wants a fresh session
   and its own characterization tests.
8. **Row 14 and app-level row 1**, then delete both registries. Laziness in
   `ProviderWorkspaceManager` lands with these, since it is the synchronous consumers that force
   eager initialization today. App-level row 1 is a shape mismatch of its own: the legacy
   `ProviderWorkspaceCapabilities` is five resource kinds each carrying
   `{ inventory, manager, runtimeCommandDiscovery }`, and the descriptor's `workspace` map is one
   `CapabilitySupport` per key over a different key set.
9. **The rest of M5**: durable agents, `ApplicationRuntime` as the composition root, seam deletion.
   Auxiliary work and bang-bash are done.
10. **M4's obligations are closed**, and one of them found a defect M4 had shipped on this branch:
   the conversation list was reading the versioned envelope as if it were the conversation.

**Still waiting on the owner rather than on code: D9, redo.** Certification remains account-bound —
Gemini one turn per replenishment, MiMoCode, Kimi Code and Qwen not certifiable on this machine.

### Where the session of 2026-08-24 ended

**M5's auxiliary checkpoint is closed and M4 is complete.** Six commits: Grok's and Codex's auxiliary
flips, the model fallback the earlier fork flips had dropped, and M4's three checkpoints.

**No provider owns an auxiliary runner any more.** Claude's auxiliary path is the only one outside the
kernel and is meant to be — cold by design, its own service rather than a `QueryBacked*` one. The
runner adapter turned out to know no protocol, only its name did: it is
`src/app/execution/KernelAuxQueryRunner.ts` now and five providers share it.

**Neither of the last two providers was a fork of the pattern, and both said so before the work
started.** Grok has no agent definition, so its permission mode rides on the command line, only its
reading purpose is given a filesystem, and a permission request is refused with the agent's own reject
option rather than a cancellation — a cancellation ends the turn, which would abandon an inline edit
instead of telling it no. Codex has neither an agent definition nor a client-side filesystem: every
property that makes a turn auxiliary is on `thread/start`.

**M4 landed in three checkpoints and the middle one is the load-bearing one.** A writer now writes
*what it changed* rather than the copy it is holding, which is what stops a background title generator
from putting back the messages a stream had just appended. The record store's adoption step is what
lets it read the vaults already in the field: every conversation out there has no envelope at all, and
D5's schema migration cannot reach a record with no version to migrate from.

**What this session got wrong, twice, in the same shape.** A break-test reverted with
`git checkout -- <file>` on uncommitted work destroyed a whole change rather than the injected defect,
and had to be redone from scratch. And a real break survived `lint`, `build:release` and a *filtered*
test run for three commands before the full suite caught it. Both are now habits rather than
recollections: back up to a scratch file before breaking, and run the whole project before calling
anything done.

**Nine breaks stayed green across the session, and every one was a gap rather than a passing gate.**
The recurring cause is the same one wave 1 recorded: a test that drives one half of a seam cannot see
the other half being reverted. Assume a green break is a missing test until proven otherwise.

#### What that session left to pick up (M3 started, the rest still open)

1. **M3 — the provider catalog.** The plan's next milestone and now unblocked: replace the split
   registries, move the four legacy prompt encoders — `ProviderModule` still has no `prepareTurn` slot,
   and the adapter routes it through a host port meanwhile — and close the three `src/core/**` modules
   that import the plugin type, enumerated in `executionCompositionBoundaries.test.ts`.
2. **Then the rest of M5**: the projections, durable agents, and the seam deletion. Safe to start now
   in the order the plan gives, because the revisioned saves M5 was said to be unsafe without are live.
3. **Two obligations from M4**, either of which is a small commit of its own: creating a conversation
   over an id that already exists still replaces it, and the history list has no error state for a
   record this build cannot read.

**Still waiting on the owner rather than on code: D9, redo**, unchanged. And certification remains
account-bound rather than code-bound — Gemini one turn per replenishment, MiMoCode, Kimi Code and Qwen
not certifiable on this machine.

### Where the seventh session of 2026-08-23 ended

**Every provider executes through the kernel, every one has a live harness, and every one has a
matrix that says when it last ran.** M2-flips is done; what remains is certification, and it is
account-bound rather than code-bound.

**D7 has its guard**, the oldest obligation on the list, and it corrected the rule it was written to
prove: redaction rests on default-deny, not on the sensitive-key list, so the safe list is the only
thing a reviewer has to read.

**Kimi Code's harness found a shipped defect on its first run**, on the path Qwen's fix deliberately
did not cover — a resumed conversation told to start a new chat when the CLI was simply not logged in.
Fixed for all six ACP providers and confirmed against the CLI that found it. **Antigravity's matrix
was missing entirely** and its harness result had been living in this file; the records gate pairs the
two now, and Antigravity is the only provider fully green on this machine.

**Two gates shipped with the same defect this session and both were caught by breaking them**: a
reader that matches nothing makes every assertion above it vacuous. Break the reader, not only the
rule.

**M5 has started, and its auxiliary checkpoint has taken every managed-ACP provider.** It began with
the auxiliary query rather than the projections because that module was already dark and waiting — and
reading it against `AuxQueryRunner` found it had been built **cold** when the consumer needs a
conversation: inline edit's `continueConversation` is a second turn on the first turn's session.
Corrected, then built end to end and flipped for **OpenCode, MiMoCode, Kimi Code and Grok**, whose
four `*AuxQueryRunner` files are deleted. The three forks' auxiliary halves are byte-identical after
normalizing the provider name — compositions, stores, services and tests — and that is the property to
keep. **Grok's is not, and was not meant to be**: it has no agent definition, so its permission mode
rides on the command line, its reading purpose is the only one given a filesystem, and a permission
request is refused with the agent's own reject option rather than a cancellation. **Codex is the last
auxiliary runner**, and it is a second app-server process rather than an ACP session.

**Two defects came out of reading each runner before deleting it**, neither found by looking for one.
The kernel path would have let an unattended title read outside the vault whenever the *chat* was set
to full access, because it would have inherited the chat's client factory; auxiliary work has its own
now, contained whatever the chat is set to, refusing every write and every permission prompt. And
MiMoCode's and Kimi Code's auxiliary reads carried a `limit: 0` bug that OpenCode's had already fixed
and nobody had mirrored — the flip carries it away by deleting the file.

**A Jest behaviour worth remembering, found by a break that would not go red:**
`expect([undefined]).toEqual([])` **passes**. Anywhere a test asserts `toEqual([])` to mean *nothing
happened*, a call that happened with an undefined argument passes it. Use `toHaveLength(0)`.

#### What that session left to pick up (all done)

1. **Stop before the projections and decide the order.** The plan puts **M3** (provider catalog) and
   **M4** (revisioned persistence) before the rest of M5, and M4 is not merely earlier but
   load-bearing: *"M5's multiple views and durable agents are unsafe without revisioned saves already
   live underneath them."* Finishing M5's auxiliary checkpoint out of order was safe because it
   touches no persistence; the projections and durable agents are not.
2. **Codex's auxiliary work** is a separate design question — a second app-server process and its own
   thread, not an ACP session — and is the last piece of this checkpoint.

**One thing waiting on the owner rather than on code: D9, redo.** Re-running a request is free and
needs no new state; undoing a rewind cannot be built on the control store, because D2 forbids a second
copy of a provider transcript and the file backup is discarded after a successful rewind. Which of the
two the product wants is the open question.

~~**Grok is not a fork of the same CLI, and the diff against Kimi Code's was read before this was
written.**~~ **Flipped in the commit above**, and all three held — with two more that only came out
of reading the runner: the refusal shape, and the filesystem being per purpose. The original entry
follows. Three differences, each of which changes the work — do not mirror it the way the three forks
were mirrored:

1. **No managed agent and no config file.** Where the forks write an agent definition whose
   permissions deny writing, Grok passes a `permissionMode` to its launch artifacts —
   `readonly → 'ask'`, `passive → 'plan'`. So there is no `sessionConfiguration` to apply, and what
   makes an auxiliary turn safe is the launch, not the session. `GrokAuxiliaryAgents.ts` would be the
   wrong shape to copy; the mapping belongs beside the artifacts instead.
2. ~~**The model is applied with `session/set_model`, not `session/set_config_option`.**~~ **Done** —
   the shared query carries both setters, and a provider names the one its agent has by setting
   `modelId` rather than a `model` config option.
3. **`GROK_HOME` and the reasoning effort are launch-time.** The home is derived from the auxiliary
   subdirectory — a partitioning the forks do not have and the kernel path must keep — and the effort
   is passed as a process argument rather than set on the session.

~~Codex is further still: a second app-server process and its own thread, not an ACP session at
all.~~ **Flipped**, and it stayed true: its auxiliary work is a second app-server process and its
own thread, and what contains it is the thread rather than a client or a directory.

**Owed on the auxiliary path:** nothing exercises the real auxiliary client factory. The composition
tests inject one, so what proves an auxiliary turn is contained is the filesystem policy's own test
plus a source match on the wiring line. A test that drives the real factory needs a fake process
launcher rather than a fake factory — the launcher is built inside `createClientFactory`, so it is a
seam that does not exist yet. **Grok added a second thing behind that seam**: which of two clients a
launch gets, and therefore whether the agent is told it can read at all. The flag the choice is made
from is asserted end to end; the choosing is not. Owner: whoever adds the auxiliary rows to a live
smoke matrix, which is the other place this would be caught.

**Claude's auxiliary path is different and should not be swept in with them**: `ClaudeAuxiliaryQuery`
is cold by design, its inline edit is its own service rather than a `QueryBacked*` one, and nothing
about a retained session applies.

**The stderr gap recorded in the entry above is smaller than it was written, and needs no transport
change.** Checked rather than assumed: `NodeManagedAcpProcessLauncher` already keeps a stderr tail and
puts it in `describeExit`, the transport rejects every pending request with that error, so an
auxiliary turn whose process died reaches the caller with the CLI's last words attached. What the
legacy runner does and this does not is attach a stderr snapshot to failures where the process is
still *alive* — and those are JSON-RPC errors carrying the agent's own sentence, which is the better
of the two. Nothing owed; the earlier note overstated it.

### Where the sixth session of 2026-08-23 ended

**Every provider executes through the kernel, and every one of them now has a live harness** except
Kimi Code. M2-flips is done; what remains is certification, and it is account-bound rather than
code-bound.

**The sixth review closed seven findings**, recorded in
[`docs/wave7-review-backlog.md`](wave7-review-backlog.md). The two behavioural ones were the same
mistake twice — **state held by the composition where the session was meant**, in an object that
serves every open tab. A reasoning level applied on one tab silenced it on all of them; the context
window was read off whichever connection had opened last. Both would have been invisible: the first
because this provider reports no level back, the second because a badge with no number looks like a
provider that has none.

**Gemini's second live run certified the fixes from the first.** The account came back, answered one
turn, and was exhausted by the second — which is now measured rather than assumed: **about one turn
per replenishment**. That one turn is the first this branch has ever completed end to end, and it
carried the refusal notice beside the answer. The quota error that blocked the rest certified the
third fix by failing: the tab shows *"You have exhausted your daily quota on this model."* where it
used to show a sentence that meant nothing.

**Qwen's harness found a defect before it could pass a single row.** A user with no credentials was
told a saved session may have gone and to start a new chat — advice that fails identically every time.
The agent had said "Authentication required" and nobody was carrying it. Fixed for all six ACP
providers and confirmed against the same CLI that found it.

**Four defects this session, and none was found by looking for one.** Reading a module against the
config it replaces. Reading a fake against the recording. Reading a runtime against the composition
meant to delete it. Running a harness that could not possibly pass. The pattern is the same every
time: **exercise the thing against reality and read what comes back**, rather than deciding in advance
what it should say.

**What is left.** Certification: Gemini one turn at a time, MiMoCode and Kimi Code and Qwen not at all
here. Then M5, which owns auxiliary execution, result provenance and the redo decision — and which is
now the only milestone with open obligations attached.

### Where the fifth session of 2026-08-23 ended

**Every provider executes through the kernel.** Codex, Claude, OpenCode, Grok, MiMoCode, Kimi Code,
Gemini CLI and Qwen Code. **M2-flips has no provider left**, and no legacy `*ChatRuntime` remains on
this branch.

**The blocker cleared first, and it was a kernel contract.** `InteractionResolution` gained an opaque
`payload` that is never persisted — D2 forbids a second copy of what a person typed — so Qwen's
`ask_user_question` opens as `kind: 'question'`, the first of that kind the product has carried, and
its answers reach the agent. The rule that falls out of never persisting it is written down and
tested: a question caught mid-resolution by a reload is **cancelled**, because the response id alone
would tell the agent an answer nobody gave.

**Inventorying what the flip would delete found one feature per pass**, three passes running:

- the **context window** this CLI answers only when asked
  (`qwen/status/session/context_usage`) — no `usage_update` it sends carries it, so a flip that did
  not port it would have taken the badge silently. Routed through `vendorRequest` and `noteTurnEnded`,
  both of which already existed for Grok;
- **`reloadWorkspaceResources`**, recorded as absent by contract because "no production call site
  declares it" — `QwenSettingsTab` declares it three times. The record was wrong;
- and before those, the **subagent stream** Qwen sends down the parent session, which the presenter
  drops so concurrent agents do not interleave into one transcript.

**The habit that found all three, and the four wrong module descriptions before them: read the two
things side by side.** A module against the config it replaces. A fake against the recording. A
runtime against the composition meant to delete it. Every defect this session cost nothing to find
once two things were actually compared, and nothing was found by looking for it.

**What is left.** Nothing is dark: the parity manifest's `execution-platform-dark` entry holds one
module, `ManagedAcpAuxiliaryQuery.ts`, waiting on M5. Certification is the open work, and it is
account-bound rather than code-bound: Gemini can be certified one live run per day and still owes its
answer rows; MiMoCode, Kimi Code and Qwen cannot be certified here at all. The obligations above name
their owners — the oldest now being **M5**, which owns auxiliary execution, result provenance and the
redo decision.

### Where the fourth session of 2026-08-23 ended

**Qwen Code is built to the flip and stopped one step short of it, on purpose.** Its module, context,
nine execution modules, metadata session and composition are in, dark, with an end-to-end turn green
over a fake agent. Seven providers execute through the kernel; Qwen is the eighth and last.

**The flip is blocked by one thing, and it is a kernel contract rather than a provider gap.** Qwen
sends `ask_user_question` down the ACP permission channel and answers it with **structured answers**;
`InteractionResolution` is `{ interactionId, responseId, resolvedAt }` and has nowhere for them to
ride. The composition refuses a question by name, a test drives a real one through a real turn and
asserts that no interaction opens and nobody is asked, and the obligation is recorded above with its
owner. Shipping around it would mean asking a person to allow or deny a question, or losing a feature
quietly. **Do not flip Qwen until a resolution can carry a payload.**

**What was found by building it.** Qwen carried the fifth review's G1 in a worse form than Gemini —
the mode a session reports at open was *committed* to the toolbar, so a vault on Plan was switched to
Safe and saved, on every open — and the fourth review's G2 beside it, pushing the agent's raw id at a
callback whose contract says it must be normalized. Both are fixed in the extraction, and a test that
asserted the raw id is the reminder of how a defect survives a review: it had been written down as
the expected behaviour.

**The `/effort` prompt is this provider's whole shape.** Setting a reasoning level is a
`session/prompt` the vendor charges for, so it is the one value not sent every turn — and the skip
needed a report the applier did not have, because there is no `current_effort` update. It also broke
five inherited tests, which was the fake lying rather than the code: it answered configuration like a
turn.

**What is left, in order.** The resolution payload (M5, the obligation above), then the Qwen flip,
then its live harness — which will run from Kimi Code's position, since `qwen 0.21.15` refuses
`session/new` with "Authentication required". Gemini's matrix is re-runnable once a day and still owes
its answer rows.

**The habit that paid twice today**: read the two things side by side. The normalized diff proved
Qwen's runtime is a strict superset of Gemini's, which made the derivation safe to do mechanically;
the same habit applied to a module and the config it replaces turned one wrong line into four; and
applied to a fake and a recording, it is what the `modelId` defect cost to learn.

### Where the third session of 2026-08-23 ended

**Wave 7 is past its midpoint. Gemini is flipped and certified as far as an account allows; Qwen Code
— the last provider on the legacy path — has its module, its context and its session config state.**

**Gemini's two open items are closed.** A mode the agent refuses no longer kills the turn *and* no
longer runs silently: the turn carries a warning notice naming the mode in the toolbar's vocabulary
with the agent's own reason behind it, once per session rather than once per turn. And the obligation
the live smoke opened — a vendor error on the prompt handled as a dead connection, retried, then
reported as a run whose outcome could not be established — is fixed for **all five** flipped ACP
providers: a `JsonRpcErrorResponse` means the agent answered, so the turn ends with the vendor's own
words instead of a reason code. That restores something the flips had lost.

**Two defect classes turned out to be plural.** Neither was found by looking for it:

- reading Gemini's module against its own chat UI config showed that **four modules out of seven**
  described model ownership the way none of them behaves — by a settings list rather than the id
  prefix — which at M3 would have shipped a provider whose model selector owns nothing;
- extracting Qwen's session state found the fifth review's G1 *and* the fourth review's G2 alive in
  it, the first in a worse form than Gemini's: the mode a session reports at open was pushed at the
  toolbar, where `updatePlanModeUI` **commits** it, so a vault on Plan was switched to Safe and had
  it saved on every session open.

**What is left for Qwen, in order.** The remaining execution modules — the applier (model, mode, and
a `/effort` prompt no sibling has), the filesystem, the permission presentation, the interaction
bridge, the result sink, the content presenter, the requests store, and `buildQwenPrompt` out of the
runtime. Then the composition, then the flip. Two things to decide on the way: the **ask-user-question
interaction**, which would be the first `kind: 'question'` the kernel has ever carried, and whether
the `/effort` prompt should stay a whole charged turn.

**Qwen cannot be certified here** — `qwen 0.21.15` refuses `session/new` with "Authentication
required" — so it flips from Kimi Code's position. **Gemini can**, one live run per day: the
2026-08-23 run found three defects and a second pass the same day returned nothing but quota errors.

**The technique that paid this session**: reading two providers side by side. The normalized diff said
Qwen's runtime is a strict superset of Gemini's, which is what made deriving it safe — and the same
habit, applied to a module and the config it replaces, is what turned one wrong line into four.

### Where the second session of 2026-08-23 ended

**Wave 7 is half done: Gemini is flipped.** Seven providers execute through the kernel — Codex,
Claude, OpenCode, Grok, MiMoCode, Kimi Code, Gemini. **Qwen Code is the last one on the legacy path.**

**The fifth review is closed**, six findings, recorded with a status column in
[`docs/wave7-review-backlog.md`](wave7-review-backlog.md). Two were behavioural and both were put
there by wave 7 rather than found in it: a session reporting where it starts was talking a vault out
of the permission mode its user picked, and an extraction that copied `permissionMode`/`fullAccess`
instead of moving them left two implementations of the question that gates workspace containment.

**Gemini needed a `ProviderModule` before it could have a composition** — it reached the kernel
without one, which no earlier flip had to deal with. Then the composition, then the flip, then the
live harness, in that order.

**The live harness is the thing worth reading.** It found three defects, two of them shipped:

- `session/set_mode` for `yolo` and `autoEdit` is refused in a folder Gemini has not been told to
  trust, and the refusal was killing every Auto-approve turn before the prompt was sent;
- the shared model extractor read `id` where the wire sends `modelId`, which broke model discovery
  for **three** providers — Gemini fatally, MiMoCode and Grok silently;
- and the one left open: a prompt that fails with a vendor error is handled as a dead connection,
  retried once, and reported as a run whose outcome could not be established. Shared across five
  providers.

The second of those is the lesson to carry: **a fake is evidence only to the extent it was copied
from a recording.** This composition's fake was written from the Gemini recording two commits before
the run, and got the modes right and the models wrong — so every unit test passed against a shape no
agent sends.

**Certification is partial and the blocker is the account.** Four rows green; everything needing an
answer stopped at `429 You have exhausted your daily quota on this model`. Re-run
`GRIMOIRE_GEMINI_LIVE=1 npm run test -- --selectProjects integration --testPathPatterns GeminiLiveSmoke`
on a day with quota; the matrix is [`docs/gemini-flip-smoke-matrix.md`](gemini-flip-smoke-matrix.md).

**What is left, in order.** Re-run Gemini's matrix when there is quota, and give the refused-mode
record a surface — the toolbar still says Auto-approve while the session is in Default. Then the
shared prompt-error obligation above, which is now the oldest thing blocking a clean flip. Then
**Qwen Code**, the last provider: its recording is `partial` ("Authentication required"), so it
starts from Kimi Code's position — buildable and flippable, not certifiable here. Its runtime is
genuinely its own, 397 normalized lines from Gemini's, so measure before deriving.

### Where the first session of 2026-08-23 ended

**Wave 6 is complete and wave 7 is half-built.** Six providers execute through the kernel: Codex,
Claude, OpenCode, Grok, MiMoCode, Kimi Code. Two ACP runtimes remain on the legacy path — Qwen Code
and Gemini CLI — and Gemini's replacement is built up to the composition.

**Neither wave-6 flip is certified, and neither blocker is Grimoire's.** MiMoCode's account cannot
generate: its matrix ran, five rows green and eight red, recorded in its own Record table. Kimi Code
is not authenticated, so its harness has never been run and no matrix is written for it. Do not
re-run the recorder or a harness hoping this changed — that was tried on 2026-08-22 and produced only
a new temp path in a fixture diff.

**The fourth review is closed.** Thirteen findings, nothing refuted, recorded with a status column in
[`docs/wave7-review-backlog.md`](wave7-review-backlog.md). Three would have been felt by a user: every
Gemini turn died with Auto-approve on, one stray character in `.claude/settings.json` destroyed it,
and a conversation could become permanently invisible after an interrupted write.

**Wave 7's recordings are taken, and Gemini's is `complete`** — the first since Grok's. It opened a
session, took a prompt and answered. Qwen's is `partial`: "Authentication required". So Gemini is the
one provider of this wave that can be certified live here, which is why it was built first even
though the plan lists Qwen before it.

**What is left for Gemini, in order:** `GeminiExecutionComposition` and `GeminiMetadataSession` under
`src/app/execution/gemini/` with `GeminiModuleContext` beside them — derive from **Grok's**, not from
the OpenCode family's, because that is the shape this provider matches; then the flip as one
revertible commit; then the live harness and matrix, which for once will have something to say.
Watch for the parts Gemini does *not* have: no launch artifacts, no config options, no tool stream
adapter, no native history to read a result back from.

**Then Qwen Code**, which starts from Kimi Code's position: authenticated nowhere here, so buildable
and flippable but not certifiable. Its runtime is genuinely its own — 397 normalized lines apart from
Gemini's — so measure before deriving, as this session did for every provider.

**Two techniques worth repeating.** The normalized diff (`sed` both providers' names to one token,
then diff) is what makes a derivation safe to do mechanically and shows exactly where it is not. And
break the code in five or six places before trusting any test suite: this session's most valuable
findings — a live CLI-name regression in MiMoCode, a three-suite temp-file race, a harness running
against a half-applied session, a coverage gate blind to complete recordings — all came from breaks
that refused to go red.

### Where the session of 2026-08-22 ended

**Wave 6 is mid-build.** Both wire recordings are taken (partial, and labelled so). MiMoCode has its
provider module, its execution descriptor and five provider-owned execution parts, all dark and all
listed in the parity manifest's `execution-platform-dark` entry — except
`MimocodePermissionPresentation.ts`, which was moved out of the legacy runtime and is live now.

**All of MiMoCode's provider-owned execution parts now exist.** Eight modules under
`src/providers/mimocode/execution/`: the backend descriptor, the content presenter, the dynamic-config
applier, the execution requests store, the filesystem delegate, the interaction bridge and presenter,
the permission vocabulary, the projection result sink and the session config state. Six are dark and
attributed in the manifest; `MimocodePermissionPresentation.ts` and `MimocodeSessionConfigState.ts`
are live, because both were moved out of `MimocodeChatRuntime` rather than written beside it.

**MiMoCode is flipped.** Four providers now execute through the kernel: Codex, Claude, OpenCode,
Grok and MiMoCode — five. `MimocodeChatRuntime` is deleted, the four metadata surfaces share one
isolated session, and the eleven modules that replaced it are listed as wired in the parity manifest.

**What is left for MiMoCode: an account that generates.** The harness, the matrix and the record all
exist and the run happened — five rows green, eight red because no turn produces an answer on this
account. Everything up to the answer is confirmed against the real CLI. One headless run on a
generating account settles rows 1, 2, 5, 6, 7, 8, 12, 13 and 15; until then MiMoCode is flipped but
**not certified**, and the matrix says so in its own Record table rather than in this file only.

**Wave 6 is complete: both providers are flipped.** Six execute through the kernel — Codex, Claude,
OpenCode, Grok, MiMoCode, Kimi Code. Two ACP runtimes remain on the legacy path, Qwen Code and
Gemini CLI, and `AcpManagedMcpRuntime.test.ts` is down to those two.

**Neither wave-6 flip is certified, and neither blocker is Grimoire's.** MiMoCode's account cannot
generate: its matrix ran, five rows green and eight red, and says so in its own Record table. Kimi
Code is not authenticated: `kimi acp` refuses `session/new`, so its harness has **never been run**
and no matrix is written for it. Both are flipped anyway, deliberately. What is confirmed for both is
everything up to the answer; the answer traffic is not.

**What is left, in order:** an account for each of the two, then their harness runs and matrices.
After that, wave 7 — Qwen Code and Gemini CLI, the last two ACP providers — and then M5, which is
where the auxiliary services (titles, refinement, inline edits) leave `*AuxQueryRunner` for the
kernel's own auxiliary port. `ManagedAcpAuxiliaryQuery.ts` has been dark since wave 4 waiting for it.

Two techniques worth repeating on the next provider. The normalized diff — `sed` both files' provider
names to one token and diff — is what made the config-state move safe to do mechanically. And break
the composition in five or six places *before* trusting a derived test suite: this wave's most
valuable finding came from a break that refused to go red.

### Where the session of 2026-08-21 ended

**All three reviews are closed** — 1 Critical, 28 Important, 60 Minor, three refuted with evidence
and two deferred with it. The third review's own record is the second half of
[`docs/providers-migration-review-backlog.md`](providers-migration-review-backlog.md), with a status
on every row.

**Two reviews, both worked through.** The first review's prioritized order is done and the second
review's six findings are fixed, with both recorded in
[`docs/providers-migration-review-backlog.md`](providers-migration-review-backlog.md) under a status
column. From the first: C1 (all three parts), the Grok pass (G1–G5), the Claude pass (L1–L3), ACP
robustness (A1–A3), and the hygiene items K1 and S2; K2 was refuted with evidence rather than fixed.
From the second: R1–R6, all six confirmed against the tree before being touched.

**What R1 means for anything already installed:** a build from before this commit loses permission
prompts after a New Chat or a history switch in the same tab, for every flipped provider. It is the
reason not to hand out a build from that range.

**Both review backlogs are closed.** The last pass took the seven rows nobody had started — K3, K4,
K5, S1, S3, Q1 and Q2 — so every row of both reviews is fixed, or refuted with evidence in K2's case.

**Every automatable row of every matrix has been run**, all four on 2026-08-21, including the Claude
harness written for this commit. `liveMatrixRecords.test.ts` carries the dates.

**What is still owed is a person, not a commit:** the rows that are about what the screen shows or
about actions only a hand can take — 18 for Claude, 14 for Codex, 8 for OpenCode, 7 for Grok.
[`docs/manual-smoke-instructions.md`](manual-smoke-instructions.md) is the instruction for whoever
sits down with a vault; it needs Obsidian and about an hour, and no knowledge of this codebase.

Wave 5 is complete: **Grok executes through the kernel**, its legacy runtime is deleted, and thirteen
live rows are green against CLI 1.0.5. Four ACP providers remain on the legacy path — MiMoCode, Kimi
Code, Qwen, Gemini — and MiMoCode is the next wave: its CLI is installed and it mirrors OpenCode
closely enough that the shared backend, bridge, presenter and filesystem should cover most of it.

**Wave 6's recording precondition is met.** Both MiMoCode and Kimi Code have wire recordings taken
from their own CLIs, and both are labelled partial with the reason — MiMoCode's account does not
generate, Kimi Code's machine is not logged in. What that means for the flip: the handshake, the
session's configuration and the empty-turn shape are evidence, and the prompt traffic will be met
first by the live smoke harness rather than by the recording. That is a weaker start than Grok had
and it is written down here rather than discovered later.

**Still owed, and it is a person rather than a commit:** the four manual smoke matrices (Codex,
Claude, OpenCode, Grok — the rendering rows only a person can run), and a generating MiMoCode account
or a logged-in Kimi Code one to complete either recording.

### Where the session of 2026-08-19 ended

Fourteen commits, all pushed, CI green on all four jobs at `3b01158`. In order:

| What | Commits |
|---|---|
| **wave 1 certified** — the `agy` process tree proven gone after a cancel, by a live suite that fails when termination is disabled | `5b6fc7d` |
| **the Windows job guardian** — compiled once and cached per user; found silently writing nothing on its first CI run, then measured: 3.2–6.9s for the first compile on a machine, ~0.5s for a later one, ~0.4s to load the cache | `a65bdc9`, `22313f8`, `102c965`, `38f9f3f`, `364d7a4` |
| **an external review of the Codex flip answered** — eight items, all real: the transient dedup window, a dropped `turn/started`, a swallowed refusal, and five smaller | `77ad8a3` |
| **wave 3 (Claude) built and flipped** — dark half in four increments, then the flip with `ClaudeChatRuntime` deleted | `3df7a3a`, `2976714`, `fe4870d`, `b7a6424`, `f8c4ad2`, `ec519a7` |
| **wave 4 (OpenCode) backend half** — the first ACP provider on the kernel | `3b01158` |
| **wave 4's content surface** — every session update and the prompt's own answer forwarded, and the presenter that draws a tab from them | `1ad9421` |
| **wave 4's interactions** — the real permission bridge, the presentation vocabulary extracted from the legacy runtime, and an approval answered end to end through the kernel | `d11068c` |
| **wave 4's approval surface** — the presenter that shows a prepared interaction and answers it in the kernel's ids | `a3f43df` |
| **what a session opens with** — the models, modes and config options `session/new` answers with, carried to the surface instead of discarded | `cdf4434` |
| **what a session is set to** — 390 lines of model, mode and effort state lifted out of the legacy runtime, which delegates to it | `3427f68` |
| **wave 4's runtime half** — `createRuntime` over the adapter, the four per-tab pieces, and the MCP restart the kernel path was missing | `0dec751` |
| **wave 4 flipped** — OpenCode on the kernel, `OpencodeChatRuntime` deleted, the five legacy call sites answered by one isolated metadata session | `a0166a8` |
| **three surfaces that must open anyway** — the metadata call sites guarded against a kernel that has not started | `7034a00` |
| **the live half of wave 4's matrix** — thirteen rows against a real `opencode acp`, and the five defects the first run found | `5cb457f` |
| **wave 5 begins: Grok's wire recording** — two protocols, three dropped updates, and a recorder that redacts | `28f3691` |
| **MiMoCode's wire recording** — partial and labelled: it mirrors OpenCode, and its failed turn looks like a successful empty one | `1af76bf` |
| **a review of the flip** — seven findings, all real, five of which the live matrix ran straight past | `ef32886` |
| **wave 5: the backend goes shared** — fifty-seven of sixty provider mentions were injected contract names, so the managed-ACP backend is now one class with a descriptor port | `476fd48` |
| **wave 5: Grok's own envelope** — the parser that refused the shape the CLI sends, and a client that now subscribes to a vendor's methods | `e424c99` |
| **wave 5: Grok's dark backend half** — a launch that is a command line, its own setters, and the two flags that restart a process rather than configure a session | `50e8bcc` |
| **wave 5: Grok's content surface** — the three updates only Grok sends, and the bill that was on the wire while the runtime read the disk | `c37b300` |
| **wave 5: interactions** — the permission bridge and the approval presenter go shared, and Grok's vocabulary is what is left | `c66973b`'s successor, `da74f9c` before it |
| **wave 5: what a Grok session is set to** — 451 lines lifted out of the legacy runtime, and the settings overlay the first extraction dropped | `da74f9c` |
| **wave 5: Grok's catalog contribution** — the fifth module, and the rewind the live record advertised while the runtime refused it | `0110840` |
| **the ACP filesystem goes shared** — containment, the line window and the refusal were never one provider's | `c50faea` |
| **reaching the owned process from outside a turn** — a client observer and a vendor request, for a plan indicator that is not a turn | `1e14c1b` |
| **filling the surface from what a provider must go and read** — `presentContent` while the answer is committed, because Grok reports no context window at all | `9525be6` |
| **wave 5: Grok's runtime half** — the per-tab pieces, the catalog that is a file, and the badge read from a session log | `eacbfa6` |
| **one isolated session for the questions that are not chat** — five surfaces that built a whole runtime to ask two questions | `ae94c5f` |
| **wave 5 flipped** — Grok on the kernel, `GrokChatRuntime` deleted, and the four things flipping found the new path had dropped | `2b96e70` |
| **the live half of wave 5's matrix** — thirteen rows against a real `grok agent … stdio`, and this provider's own resume shape | `028cf67` |

Five providers now execute through the kernel: Antigravity, Codex, Claude, OpenCode, Grok.

**What is owed, and by whom:**

- **two smoke matrices, both needing a person in a vault** — Codex's rendering rows and Claude's
  twenty-eight. Wave 3 flipped ahead of wave 2's certification at the owner's direction; what stands
  in for the missing evidence is that each flip reverts as a single commit;
- **three smoke matrices, all needing a person in a vault** — Codex's rendering rows, Claude's
  twenty-eight, and OpenCode's nineteen. Every flip after wave 1 went ahead of its certification at
  the owner's direction; what stands in for the missing evidence is that each reverts as a single
  commit.

Completed: **M0a** (parity gate, contribution inventory, adapter contract, the two contract suites,
topology and shared-resource records, persistence decisions), **M1** (execution kernel, narrow
control-record persistence, local-shell internal backend, cross-platform CI with Windows
process-tree conformance green), **M2-proofs**, **M2-adapter**, and **M0b** for the four proof
providers. In progress: **M2-flips** — waves 1 to 4 (Antigravity, Codex, Claude, OpenCode) shipped and
running in production; wave 1 certified, the other three not.

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

**Wave 1 (Antigravity) is certified.** All five smoke-matrix items are automated gates or
timestamped in the vault log. The last of them — that the `agy` process tree is actually gone after a
cancel — is the live suite described in the entry above, and it is a gate that fails when
termination is disabled rather than one that passes because the CLI finished on its own.

**Wave 2 (Codex) is flipped and uncertified. Eight rows of its matrix run live and all eight pass;
the command that runs them is in the matrix document under "the half that runs itself".**

**Next, in order:**

1. **wave 2's rendering rows** — everything in [`docs/codex-flip-smoke-matrix.md`](codex-flip-smoke-matrix.md)
   that the live harness cannot answer: whether the tool card, the diff, the plan, the plan-limit and
   context badges, and two tabs side by side actually *look* right in a vault on a release build.
   That is what certifies wave 2;
2. **wave 3's rendering rows** — [`docs/claude-flip-smoke-matrix.md`](claude-flip-smoke-matrix.md),
   twenty-eight of them, in a vault on a release build. Rows 14–16 first: Claude is the first flip
   with a rewind, and row 16 — a rewind that fails with the files restored — is what the backup port
   added in that entry exists for;
3. **wave 4's rendering rows** — [`docs/opencode-flip-smoke-matrix.md`](opencode-flip-smoke-matrix.md).
   Thirteen of its nineteen rows now run themselves and are green; what is left is what a person has
   to look at: rows 3, 4, 10, 11, 14, 16 and the *appearance* of row 5. Row 12's wording is a known
   defect — the permission prompt names a path where it should name an action;
4. **M2-flips wave 5 — Grok**, whose wire recording is taken (the entry above). It inherits what
   wave 4 built — the transport, the launcher, the client adapter, the content surface, the
   permission bridge and the metadata session — and owes three things none of the first four did:
   the `_x.ai/session_notification` envelope and the three updates inside it, a decision about what
   Grok's self-managed MCP servers mean beside the ones Grimoire injects, and the transcript
   recovery and `utf8Stream` semantics that landed on `main` after the v1 baseline. Then the four
   remaining ACP providers — MiMoCode (its CLI is installed as of this session, so its recording is
   takeable), Kimi Code, Qwen and Gemini.

**Three matrices are outstanding at once**, which is the state the owner accepted when wave 3 flipped
ahead of wave 2's certification and again when wave 4 flipped ahead of both. Each flip reverts as a
single commit.

The Windows job guardian is done: compiled once, cached per user, green on `windows-latest`, and
measured — the entry above has the numbers and what they say about the flake.

Wave 1's last row is done: the `agy` process tree is proven gone after a cancel by the live suite in
the entry above.

Two open items carried from the reviews: a plan turn that produces nothing reads as a silent success
(the expectation is declared before `sawPlanDelta` is known), and a Codex result reference cannot be
resolved back to the turn that produced it (M5, with result provenance).

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
| What the backend and every tab runtime share, and the runtime over it | `CodexExecutionComposition.ts` | dark |
| What the module can answer about a tab's conversation, over the running plugin | `CodexModuleContext.ts` | dark |

**Next: the flip.** `registration.ts` points `createRuntime` at the composition, `main.ts`
constructs it, initializes its workspace and registers the backend **with its interaction and
recovery ports**, the parity manifest and the `darkBundle` markers move, and `CodexChatRuntime` is
deleted in the same commit. The end-to-end turn is written and green, which is the order this wave
promised: before the flip, not after. After it lands, the manual smoke matrix for Codex is what
certifies it — and wave 1's is still open, which is what "no second flip may land" above means.

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
wave 2 "must not start", which the wave-2 table above contradicted. **Wave 1 is certified as of the
live-cancel entry above**; the rule this paragraph states is satisfied, not waived, and the Codex
flip landed before it — which is why the certification order is written down rather than assumed.

**M0b is satisfied for the four proof providers**, recorded from live CLIs on the owner's machine.
The remaining five providers need their own recordings before their own flips.

Open obligations, each with an owner:

- **a Codex result reference cannot be resolved back to the turn that produced it.** The sink is
  given the run and nothing else, so it commits a `projection` reference; Codex's own JSONL could
  locate the answer, and the backend holds the thread and turn ids it would take, but does not pass
  them. Nothing resolves a result reference today, which is why this is recorded rather than built.
  Owner: M5, with result provenance;
- **the Windows process-ownership gate was flaky, and the cost behind it is now measured.** The
  guardian is compiled once and cached per user, green on `windows-latest`. The numbers are in the
  entry above the blocker: the first compile on a machine costs ~6.9s, a later one ~0.5s, and
  loading the cached assembly ~0.4s — so the stall that missed a 15s deadline was the launch paying
  the cold compiler, and the suite's first case now warms the cache before anything is timed. What
  is left is **evidence over runs**: a red on this test is re-run once and investigated if it
  repeats, and if it repeats with a warm cache the cause is not the compile. Owner: whoever meets
  the next red. The older reading of this obligation follows:
  `CodexPersistentProcessOwnership.integration.test.ts` failed on a **documentation-only commit**
  (`634fe7c`) — the descendant did not publish its pid within 15s — and passed on re-run of the same
  commit, with the three commits before it green on identical code. So it is timing on a shared
  Windows runner, not a regression. Worth noting before changing the number: this bound is 15s while
  the local-shell equivalent waits 5s, so raising it further without measuring what the wait actually
  costs would be guessing. The gate this weakens is the one M2-flips depends on most — process
  ownership on every desktop platform — and treating a red Windows job as noise is how a real
  failure gets waved through. Owner: wave 2, before the Codex flip, since that is the provider whose
  ownership this test covers;
- **the wire recordings show six Codex notifications that no backend consumes**, including the ones
  carrying plan indicators and raw response items, pinned in `wireVocabularyCoverage.test.ts` so the
  gap cannot grow. OpenCode's two are closed by wave 4's content surface, and that check now replays
  the recording through the presenter rather than grepping the backend for a wire name the
  normalizer has already renamed. **The Claude row of this obligation was never pinned**: the
  recording observes seven message types and that file asserts nothing about them, so the "four
  Claude message types" this entry used to claim was an unmeasured number. Owner: each provider's
  flip — and Claude's is owed a gate shaped like OpenCode's replay, since wave 3 has already
  flipped;
- ~~**three providers still need wire recordings** — Kimi Code, Qwen, Gemini.~~ **All nine are taken.**
  Gemini's is `complete`; Kimi Code's and Qwen's are `partial` because neither machine is
  authenticated, and MiMoCode's because its account cannot generate — each says so in the file rather
  than by being thin. What is still owed is the *answer* traffic those three would show, which is an
  account rather than a recorder. The recorder that took them redacts: see the Grok entry for what the
  first capture contained;
- ~~**the three fork auxiliary flips dropped the chat's model.**~~ **Closed in the commit below this
  entry**, in the shape the entry asked for: one commit, the same change three times, the halves still
  identical. The original entry follows: Every legacy `*AuxQueryRunner` falls
  back to the model the chat is set to when the caller names none, and inline edit and instruction
  refinement name none unless the user set an override; `OpencodeExecutionComposition`,
  `MimocodeExecutionComposition` and `KimicodeExecutionComposition` resolve only the caller's model,
  so those two purposes now run on whatever the CLI defaults to. Found by reading Grok's runner beside
  theirs, and Grok's flip keeps the fallback with a test that goes red without it. Owner: the three
  forks, in one commit of their own — their auxiliary halves are byte-identical and must stay that
  way;
- **a conversation created over an id that already exists replaces it.** Preserved from the legacy
  path rather than changed inside a persistence milestone: a conversation may be created under a
  provider's own session id, so refusing the collision could break resuming into one, and adopting
  the existing record would change what `createConversation` returns. What it does today is write an
  empty conversation over one that has history. Owner: whoever owns conversation creation, with the
  product answer for what resuming into an existing conversation should do;
- **`loadMetadata` answers a record this build cannot read as "no conversation".** A future or corrupt
  record now has a name — D5's read-only, migration-required state — and nothing surfaces it: the
  conversation disappears from the history list exactly as it did before. **Not closed by the typed
  hydration commit**, and the reason is worth stating: a hydration outcome is shown *inside* a
  conversation, and a conversation whose metadata cannot be read never reaches the list to be opened.
  It needs a surface of its own. Owner: whoever builds the history list's own empty and error states;
- **awaiting an owner decision: redo.** Recorded as D9 in the persistence decisions. Re-running a
  request is free and needs no new state; undoing a rewind cannot be built on the control store,
  because D2 forbids a second copy of a provider transcript without exception, and the file backup
  is discarded after a successful rewind. Which of the two the product wants is the open question;
- the provider backends that carry them must absorb the UTF-8 stream decoding (`utf8Stream`) and
  Grok transcript recovery semantics that landed on `main` after the v1 baseline. Owner: the Grok
  and ACP backends, at their harvest;
- ~~**a vendor error on the prompt becomes "could not establish whether this run completed".**~~
  **Closed in the commit below this entry.** A `JsonRpcErrorResponse` is now the discriminator — the
  transport constructs one only when the peer sent an error response, and raises a plain `Error` for
  every transport failure — so a refused turn ends as `provider-failure` with the agent's own words,
  and a dropped pipe keeps the retry that makes it invisible. The original entry follows:
  `ManagedAcpExecutionBackend.recover` takes the rejection as `_error` and never reads it, so a
  `session/prompt` that *failed* is handled as a connection that *died*: the process is closed, a new
  one is launched, the same prompt is sent again, and the run is then reconciled to `unknown`. Found
  live on 2026-08-23 with `429 You have exhausted your daily quota on this model` — the vendor's
  message discarded, the turn charged twice against a quota already gone, and the tab told nothing it
  could act on. Shared across the five flipped managed-ACP providers. The fix is to classify a
  protocol-level rejection apart from a transport-level failure; it is recorded rather than built
  because the account that found it has no quota left to prove a fix with today. Owner: the managed-ACP
  backend, before the next flip. Smaller and beside it: an ACP `fs/read_text_file` for a file that does
  not exist surfaces as a bare internal error, indistinguishable from a containment refusal, and
  Gemini abandons its write tool rather than raising the permission request when it sees one;
- ~~**an interaction resolution has no room for an answer, and Qwen's flip waits on it.**~~
  **Closed in the commit below this entry.** `InteractionResolution` gained an opaque `payload` that
  is never persisted, the registry cancels a question caught mid-resolution rather than replaying it
  without its answer, and Qwen opens the first `kind: 'question'` interaction the product has ever
  carried. The original entry follows:
- **an interaction resolution has no room for an answer, and Qwen's flip waits on it.** Qwen sends
  `ask_user_question` down the ACP permission channel, and `QwenChatRuntime` answers it with
  **structured answers** beside the option id. `InteractionResolution` is
  `{ interactionId, responseId, resolvedAt }` — there is nowhere for those to ride — and the bridge
  cannot take the round trip itself either, because `prepare` is bounded by `controlTimeoutMs` while
  a person answering is not. So the composition refuses a question by name rather than presenting it
  as an approval, which would ask someone to allow or deny a question, or answering it `cancelled`,
  which would lose a feature the legacy runtime has. **This is the one thing between Qwen and its
  flip.** The fix is an optional opaque payload on the resolution, which reaches
  `ExecutionControlSchemas` and the control records, so it is a milestone rather than a patch. Owner:
  M5, before the Qwen flip;
- ~~D7 (diagnostic redaction) has no automated guard.~~ **Closed in the commit below this entry**, now
  that the kernel emits log records. `diagnosticRedaction.test.ts` reads every `recordDebugLog` in the
  execution path, takes the keys each one logs, and holds the rule D7 actually rests on: a string is
  redacted unless its key is on the service's safe list. What it leaves is stated rather than implied —
  an error's own message is carried through, because that is the reason to keep a log at all, and a
  provider that put a prompt into an error message would put it there. That is a review question about
  what providers raise, not a redaction question;
- `ProviderModule` has no slot for `prepareTurn`, which the adapter contract maps as a module
  contribution. The adapter routes it through a host port meanwhile. Owner: M3, when the four legacy
  prompt encoders move;
- **three** `ChatRuntime` members are absent by contract, each with its reason in
  `adapterMemberCoverage.test.ts`: `getAuxiliaryModel` and the two subagent loaders. Two have left
  that list with a false reason attached: `resetSession`, and `reloadWorkspaceResources` — recorded as
  having "no production call site" while `QwenSettingsTab` called it in three places, which the Qwen
  flip found by asking what it was about to delete.
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
