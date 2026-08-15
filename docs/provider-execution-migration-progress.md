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
- M0a is complete. Landed checkpoints are listed below; every later milestone row in the status
  table is still untouched.

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
| M0b — golden traces (amortized; 4 topologies before freeze, rest at their flip) | Not started | — |
| M1 — execution kernel, dark-launched | Not started | — |
| M2-proofs — four topology proofs, dark | Not started | — |
| M2-adapter — presentation seam, proven without a flip | Not started | — |
| M2-flips — nine production flips with legacy deletion | Not started | — |
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
clean, `lint` clean, `build:release` passed with no artifact drift.

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
`typecheck` clean, `lint` clean, `build:release` passed with no artifact drift, `git diff --check`
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

## Current blocker

M0a is complete on `providers-migration`, including the post-review corrections above. The old
runtime path is frozen for new product features: no new methods on `ChatRuntime` — the freeze test
enforces the member set — and bug fixes must be absorbed by later harvested slices.

Branch policy, per the owner's decision: milestones are **not** merged to `main`; all work stays on
`providers-migration`. The plan's mitigation is mandatory — sync `main` into the branch at every
milestone gate and whenever `main` ships a release, and record the synced `main` commit in that
checkpoint's entry, so divergence stays a measured number.

The next action is M1, the execution kernel dark-launched, harvested per the plan's source map
(Phase 1 `1ae6a620`, Phase 2 `347586ff` narrow kernel records only, Phase 3 `1220271a`), with the
`ProviderModule` contract designed against the contribution inventory rather than harvested from v1.
M0b runs alongside and blocks nothing until the M2-proofs freeze.
