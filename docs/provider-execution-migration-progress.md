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
| Phase 4D — managed ACP/OpenCode topology | Complete | `cb631f53` |
| Semantic freeze review | Complete | `892eec78` |
| Phase 5 — remaining provider modules/backends | In progress | MiMoCode/Kimi Code managed-ACP family ready for checkpoint |
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
- Four real provider topology implementations through Phase 4D, kept off the production
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

## Semantic freeze implementation

- The deterministic fake now has an opt-in automatic lifecycle driver while retaining its existing
  manual fault-injection behavior.
- One shared 11-case common-semantics suite runs unchanged against the fake, Antigravity, Codex,
  Claude, and OpenCode.
  It covers pre-dispatch cancellation, targeted idempotent cancellation, timeout, output limits,
  unload, required/optional/absent results, duplicate completion, unconfirmed termination, durable
  duplicate ingress, stale generation/incarnation, wrong-session delivery, post-terminal rejection,
  and settings-generation fencing.
- Core-only causal ordering, gaps, durable deduplication, interaction ownership, idempotent
  resolution, settings recovery, and crash boundaries remain in the provider-neutral lifecycle
  registry suites. Provider adapters cannot override those rules.
- Initialization sharing, connection recovery, reattachment, and restart behavior remain
  topology-specific and are bound to each real backend's sanitized trace tests. The common suite does
  not claim uniform behavior where the providers have materially different ownership models.
- The generic run scope now uses `nativeRunRef`; the earlier `turnId` name was removed before freeze
  because Claude and managed ACP runs are not Codex turns.
- A semantic-freeze fitness test binds the four module descriptors to sanitized topology, history,
  identity, result, and agent-fidelity traces. Agent evidence records exact observation source,
  result extraction, cancellation, status-query, and reattachment claims and points to backend-bound
  event/control cases. A positive allowlist requires explicit review for every field added to the
  provider-facing core execution boundary without forbidding neutral future work-graph vocabulary.
- The five-way conformance and semantic-freeze suites are included in the macOS, Linux, and Windows
  CI execution matrix.

The independent semantic-freeze review is approved. Its findings led to three final constraints:

1. Only genuinely common lifecycle semantics are frozen across all five backends. Initialization,
   reconnect, reattachment, and restart recovery remain mandatory topology-specific evidence.
2. Agent observation, stable identity, result extraction, cancellation, status query, and
   reattachment are independent capability dimensions, each tied to nonempty backend event/control
   evidence when claimed.
3. The provider-facing execution surface uses a transitive positive allowlist covering data fields,
   operational methods and parameters, callback signatures, exported contracts, and branded IDs.

Freeze decision: lifecycle semantic changes must now record their reason in this log and update the
fake plus all four topology proofs. The freeze is internal and does not promise public source or
binary compatibility.

## Phase 5 managed-ACP family implementation

- Added separate MiMoCode-owned and Kimi Code-owned execution backends. Each adapter owns its
  lifecycle and provider policy; neither inherits another provider backend or imports `ChatRuntime`.
  Shared ACP code remains limited to the managed client, protocol types, session-error
  classification, process composition, and filesystem path containment primitives.
- Added one provider module per adapter with normalized settings codecs, immutable capability
  descriptors, workspace contributions, configured-model ports, and provider-native SQLite history
  ports. The module order remains aligned with the existing provider inventory.
- Added provider-owned dynamic mode/model/effort ordering and filesystem delegates for both
  providers, including explicit containment and approved-write behavior.
- Added MiMoCode's provider-specific empty-result policy. It reads the native database only after a
  prompt completes without output, correlates the stored error to the stable native session/run,
  classifies ordinary provider failures, and persists a supported base-model fallback through an
  injected settings port. Applying a fallback does not redispatch the failed turn; the user must
  explicitly retry, so a potentially side-effecting prompt is never duplicated.
- Kept Kimi Code's empty-result semantics provider-local without inventing MiMoCode's stored-error or
  fallback behavior.
- Added sanitized provider traces, backend-to-registry identity tests, the frozen 11-case conformance
  suite, dynamic configuration, filesystem containment, module/history, and MiMoCode fallback-policy
  tests for the family.
- Added every new managed-ACP family suite to the macOS, Linux, and Windows execution-contract CI
  matrix. The shared process launcher and termination ownership remain covered by the existing host
  matrix.
- Production composition remains unchanged and continues to use the legacy runtime path until
  Phase 9.

The independent managed-ACP family review is approved with no material blockers. It confirmed that
Kimi Code's normalized lifecycle diff against the approved OpenCode adapter is empty, while MiMoCode
adds only provider-owned database/error/fallback inputs and bounded one-flight empty-result
classification. It also verified stable identity, transient-session preservation, safe retry,
result/cancellation arbitration, quarantined process ownership, native history, honest agent
capabilities, and the three-platform CI matrix.

## Verification evidence

- Phase 4C checkpoint gate: 432 unit suites / 7,218 tests; 7 integration suites / 222 tests;
  typecheck, lint, release build, and artifact hashes passed.
- Final Phase 4D gate: 440 unit suites / 7,268 tests and 7 integration suites / 222 tests passed
  outside the restricted sandbox; typecheck, lint, release build, and `git diff --check` passed.
- The restricted-sandbox run failed only where existing tests require a home-directory temporary
  path and a loopback server. The same full gate passed unrestricted.
- Current focused Phase 4D gate after the review fixes: 9 suites / 55 tests, typecheck, focused
  ESLint, and `git diff --check` passed.
- Current semantic-freeze gate: the five identical conformance runs pass 5 suites / 55 tests; the
  conformance plus architecture fitness selection passes 7 suites / 67 tests; typecheck and
  `git diff --check` pass.
- Final semantic-freeze checkpoint gate: 442 unit suites / 7,306 tests and 7 integration suites /
  222 tests passed; typecheck, lint, release build, and `git diff --check` passed. Independent
  architecture review approved the boundary with no remaining material blocker.
- Release artifacts match exactly across repository root, `dist/grimoire`, and the configured test
  vault: `main.js` `4d9c3680…`, `styles.css` `c079364c…`, `manifest.json` `5058df46…`.
- Current Phase 5 managed-ACP family gate: 13 new provider suites / 92 tests and 6 architecture/shared
  family suites / 50 tests pass; typecheck, focused ESLint, and `git diff --check` pass. Independent
  review approved the slice with no material blocker.
- Final managed-ACP family checkpoint gate: 455 unit suites / 7,398 tests and 7 integration suites /
  222 tests pass; typecheck, full lint, release build, and `git diff --check` pass.
- Release artifacts remain byte-identical across repository root, `dist/grimoire`, and the configured
  test vault after the checkpoint build: `main.js` `4d9c3680…`, `styles.css` `c079364c…`, and
  `manifest.json` `5058df46…`.

## Next steps

1. Close independent review and checkpoint the MiMoCode/Kimi Code managed-ACP family slice.
2. Continue Phase 5 with Grok, Qwen, and Gemini while preserving provider-specific ACP semantics.
3. Complete the immutable nine-provider catalog inventory and run the full Phase 5 exit gate.
4. Implement durable agents/work graphs after every current provider module/backend is constructible
   through the new catalog.
