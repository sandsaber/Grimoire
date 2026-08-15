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
- **No milestone work has started. Nothing from the plan is implemented on this branch.**

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
| UI verification layers documented (existing bundle-load/view-open smokes cited as gate layer 2), presentation-agnostic projection rule + stop condition, "After the migration" section (WorkGraph, UI evolution as renderer swap) | Complete | this commit |
| M0a — parity gate and adapter contract | In progress — baseline recorded | this commit |
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

### M0a — baseline gate recorded (this commit)

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

## Current blocker

M0a is in progress on `providers-migration`. The baseline gate is recorded; the next action is
checking in the import-graph walker as `tests/helpers/moduleReachability.ts` with its own test,
ported from `origin/codex/provider-architecture-research`.
