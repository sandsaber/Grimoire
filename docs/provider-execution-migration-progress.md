# Provider Execution Migration Progress

This log records the implementation state of
[`provider-execution-migration-plan.md`](provider-execution-migration-plan.md). Update it before
every checkpoint commit. The architecture plan remains the source of truth for acceptance criteria;
this file records what has actually landed and what remains open.

## Branch

- Migration branch: `codex/provider-architecture-research`
- Baseline: `710a43cf` (`origin/main` when the migration branch was created)
- Production composition remains on the legacy runtime path until Phase 9.
- The branch has not been pushed.

## Checkpoint status

| Scope | Status | Checkpoint |
|---|---|---|
| Architecture research and migration plan | Complete | `2cecc5cb`, `7b6dd063` |
| Phase 1 — composition boundaries | Complete | `1ae6a620` |
| Phase 2 — persistence foundation | Complete | `347586ff` |
| Phase 3 — lifecycle kernel and internal shell | Complete | `1220271a` |
| Phase 4A — stateless Antigravity topology | Complete | `07939092` |
| Phase 4B — multiplexed Codex topology | Complete | `309f1558` |
| Phase 4C — persistent Claude SDK topology | Complete | `9dda0ebc` |
| Phase 4D — managed ACP/OpenCode topology | Complete | `feat(opencode): add managed ACP execution backend` |
| Semantic freeze review | In progress | Not committed |
| Phase 5 — remaining provider modules/backends | Pending | — |
| Phase 6 — durable agents and work graphs | Pending | — |
| Phase 7 — application runtime and auxiliary work | Pending | — |
| Phase 8 — catalog and provider-neutral feature ports | Pending | — |
| Phase 9 — production cutover | Pending | — |
| Phase 10 — legacy deletion | Pending | — |
| Phase 11 — hardening and migration evidence | Pending | — |

## Completed architecture foundation

- Core execution identity, backend/session/run ownership, event ingestion, durable lifecycle records,
  interactions, result references, reconciliation, settings transitions, and shutdown checkpoints.
- Revisioned persistence with durable compare-and-swap, transaction-intent recovery, schema fencing,
  and byte-preserving legacy fixtures.
- Provider-module, capability, settings-codec, workspace, feature-port, and catalog boundaries.
- Internal local-shell backend with POSIX process groups on macOS/Linux and Windows Job Object
  ownership, bounded termination, and explicit indeterminate cleanup.
- Three real provider topology implementations through Phase 4C, kept off the production
  composition path until cutover.

## Phase 4D delivered scope

- Added an owned managed-ACP process composition using the existing ACP JSON-RPC connection and
  the cross-platform process-tree supervisor. OpenCode owns execution lifecycle and policy; shared
  ACP modules are limited to transport/process/client and isolated-query building blocks.
- Added initialize/new/load behavior, exact saved-session loading, explicit missing-session
  replacement, transient-load rejection, restart fingerprints, dynamic mode/model/effort ordering,
  approval bridging, bounded required-result commits, recovery, and isolated auxiliary sessions.
- Added OpenCode-owned settings codec, capability descriptor, model port, provider-native SQLite
  history port, filesystem containment, and approved writes.
- Added process ownership retention for unconfirmed cleanup, factory-level unload cleanup,
  pre-dispatch generation fencing, one-flight client closing, late permission cleanup, auxiliary
  cleanup verification, and cancellation/result arbitration.
- Added a sanitized OpenCode trace fixture and focused backend, conformance, adapter, filesystem,
  dynamic-configuration, history/module, architecture-boundary, and cross-platform launcher tests.
- Added the managed ACP/OpenCode suites to the macOS, Linux, and Windows CI execution matrix.

## Phase 4D review closure

The independent Phase 4D review is approved. It verified the following fixes; the broader
semantic-freeze matrix remains the next gate:

1. Implemented: one native run identity is retained for every event; conflicting provider identity
   becomes indeterminate, and registry ingestion is covered through result and terminal.
2. Implemented: any provider notification latches observable activity; tool activity followed by
   transport loss reconciles without redispatch.
3. Implemented: unconfirmed clients remain quarantined; a later run cannot launch a second process
   tree until targeted cleanup is confirmed.
4. Implemented: lifecycle and provider policy moved into the OpenCode adapter. Shared ACP code now
   exposes composed building blocks instead of an inherited execution runtime.
5. Expand the shared lifecycle conformance matrix and run it against the deterministic fake plus all
   four topology proofs before declaring semantic freeze.

## Verification evidence

- Phase 4C checkpoint gate: 432 unit suites / 7,218 tests; 7 integration suites / 222 tests;
  typecheck, lint, release build, and artifact hashes passed.
- Final Phase 4D gate: 440 unit suites / 7,268 tests and 7 integration suites / 222 tests passed
  outside the restricted sandbox; typecheck, lint, release build, and `git diff --check` passed.
- The restricted-sandbox run failed only where existing tests require a home-directory temporary
  path and a loopback server. The same full gate passed unrestricted.
- Current focused Phase 4D gate after the review fixes: 9 suites / 55 tests, typecheck, focused
  ESLint, and `git diff --check` passed.
- Release artifacts match exactly across repository root, `dist/grimoire`, and the configured test
  vault: `main.js` `4d9c3680…`, `styles.css` `c079364c…`, `manifest.json` `5058df46…`.

## Next steps

1. Run the semantic-freeze matrix across fake, Antigravity, Codex, Claude, and OpenCode.
2. Record the freeze decision and require cross-topology conformance updates for future lifecycle
   semantic changes.
3. Continue Phase 5 in managed-ACP family order: MiMoCode, Kimi Code, then Grok, Qwen, and Gemini.
4. Implement durable agents/work graphs only after the execution contract is frozen.
