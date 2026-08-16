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
- M0a and M1 are complete. Landed checkpoints are listed below; every later milestone row in the
  status table is still untouched.

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
| M1 — execution kernel, dark-launched | Complete | `dca2f84`, `cc6081e`, `ec1303f`, `86f0585`, `a689af8` |
| M2-proofs — four topology proofs, dark | In progress — 1 of 4 (Antigravity) | this commit |
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

## Current blocker

**Single resume pointer. Everything below this line is the current state; nothing above it
overrides it.**

Active branch: `providers-migration`. Last synced with `main`: 1.1.7 (`0f84b41`).

Completed: **M0a** (parity gate, contribution inventory, adapter contract, the two contract suites,
topology and shared-resource records, persistence decisions), **M1** (execution kernel, narrow
control-record persistence, local-shell internal backend, cross-platform CI with Windows
process-tree conformance green), and **M2-proofs**.

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

**Blocked on one decision, recorded in the entry directly above:** the kernel has no channel for
streamed output, so an adapter over it can only deliver the answer at the terminal, and today's
providers stream per delta. Three options with costs are written up; the recommendation is a
transient content event. The rest of M2-adapter is unaffected and can proceed either way.

**Next action:** **M2-adapter** — the `ChatRuntime` adapter over the kernel, still dark, with
`createSubject` in `adapterContractTarget.test.ts` grown to cover `prepareTurn`, `steer`,
`setResumeCheckpoint`, `buildSessionUpdates`, and `consumeSessionInvalidation`, which remain paper
mappings. **M0b is still open and blocks the first flip, not the adapter:** the checked-in traces are
semantic case catalogues, not sanitized wire recordings.

Open obligations, each with an owner:

- **M0b is not done.** The checked-in `tests/fixtures/provider-traces/*.json` are semantic case
  catalogues — topology, identity, event cases, cancellation, empty-required-result — not sanitized
  wire recordings. They are enough to pin backend semantics and to anchor the semantic freeze, which
  has already landed; they are not the golden traces the plan requires, and recording those needs
  live CLIs. Owner: M0b, **before the first flip**;
- **awaiting an owner decision: redo.** Recorded as D9 in the persistence decisions. Re-running a
  request is free and needs no new state; undoing a rewind cannot be built on the control store,
  because D2 forbids a second copy of a provider transcript without exception, and the file backup
  is discarded after a successful rewind. Which of the two the product wants is the open question;
- the provider backends that carry them must absorb the UTF-8 stream decoding (`utf8Stream`) and
  Grok transcript recovery semantics that landed on `main` after the v1 baseline. Owner: the Grok
  and ACP backends, at their harvest;
- D7 (diagnostic redaction) has no automated guard. Owner: M1 follow-up, once the kernel emits log
  records;
- the target contract suite covers `query`, `cancel`, terminals, and turn metadata only.
  `prepareTurn`, `steer`, `setResumeCheckpoint`, `buildSessionUpdates`, and
  `consumeSessionInvalidation` remain paper mappings until `createSubject` grows. Owner:
  M2-adapter;
- eight `src/core/**` modules import a concrete provider and three import the plugin type, all
  enumerated in `executionCompositionBoundaries.test.ts`. Owners: M3 for the registry and bootstrap
  entries, M5 for the auxiliary services.

Standing rules that outlive any milestone:

- the old runtime path is frozen for new product features; `ChatRuntime` gains no members, enforced
  by the freeze test. Bug fixes are allowed and must be absorbed by later harvested slices;
- milestones are **not** merged to `main`, per the owner's decision. The mandatory mitigation is to
  sync `main` into the branch at every milestone gate and whenever `main` ships a release, recording
  the synced commit in that checkpoint's entry.
