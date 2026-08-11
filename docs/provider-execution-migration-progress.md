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
| Phase 5 — remaining provider modules/backends | Complete | MiMoCode/Kimi Code `6c4700cf`; Grok `104c88dd`; Qwen `d5042ec5`; Gemini `593b38d0`; immutable catalog pending checkpoint SHA |
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

## Phase 5 Grok implementation

- Added a Grok-owned managed-ACP execution backend and provider module without importing
  `ChatRuntime` or inheriting another provider lifecycle. The adapter retains the frozen execution
  contract while keeping provider extensions local to Grok.
- Extended the protocol-generic managed ACP client only with optional direct-question and opaque
  extension notification/request hooks. The shared layer does not interpret billing, mirrored
  notifications, or native agents.
- Added standard/extension notification deduplication before lifecycle processing. Thinking, tool,
  usage, and agent activity prevent unsafe redispatch but do not satisfy a required assistant
  result; a completed prompt without final assistant text terminates as `missing-required-result`.
- Added durable direct-question interactions with the same bounded preparation, idempotent
  resolution, cancellation, and fail-closed behavior as approvals.
- Added provider-owned usage projection and the `x.ai/billing` request bridge. Usage failures stay
  outside execution ownership, while provider-native JSONL remains the authoritative history and
  fallback source.
- Added provider-native subagent adoption from stable spawn IDs, polling results, and asynchronous
  completion notifications. Mirrored or repeated evidence is applied once; child results receive a
  separate persisted `ResultRef`, status, and native key before the parent terminal is published.
- Added Grok-owned dynamic mode/model/effort ordering, filesystem containment and approved writes,
  normalized settings, configured-model and native-history ports, sanitized traces, registry
  identity coverage, and the frozen common lifecycle conformance suite.
- Added all Grok execution suites to the macOS, Linux, and Windows CI execution-contract matrix.
  Managed process ownership continues to use the already verified cross-platform launcher: POSIX
  process groups on macOS/Linux and Windows Job Objects.
- Production composition remains unchanged and continues to use the legacy runtime path until
  Phase 9.

The independent Grok architecture and lifecycle review is approved with no material blockers. Its
findings added four permanent constraints:

1. Agent evidence admitted during parent result commit or reconciliation is drained before the
   parent terminal.
2. Admission closes synchronously before unload drains already-admitted bounded work, preventing an
   unbounded provider stream from blocking shutdown.
3. Closing admission does not discard child results that were already queued behind another commit;
   reentrant post-fence evidence is rejected.
4. Native terminal status and result extraction are deduplicated separately, so an asynchronous
   completion without output can be enriched once by a later polling result.

## Phase 5 Qwen implementation

- Added a Qwen-owned managed-ACP execution backend and provider module without importing
  `ChatRuntime` or inheriting another provider lifecycle. Shared ACP code gained only typed native
  model/mode forwarding; Qwen alone owns ordering, effort control, question metadata, commands,
  usage, and nested-agent interpretation.
- Added the exact model → mode → effort → user-prompt transition. Effort remains a Qwen-native
  `/effort <level>` control turn, is cached per owned client/session only after confirmed success,
  and cannot leak its notifications into the user's result. Rejection or timeout prevents user
  prompt dispatch and closes the owned client before another run is admitted.
- Preserved Qwen's native session boundary: `session/load` may confirm the requested session without
  repeating its ID; an explicit conflicting ID is rejected; only a positively classified missing
  session permits replacement. A provider-owned replacement prompt may carry the existing Grimoire
  projection once into that new native session; normal resume never injects it again. Visible
  provider transcript hydration remains unsupported and no duplicate visible history is synthesized.
- Added provider-owned structured-question normalization on top of Qwen's question-shaped ACP
  permission metadata. Questions and approvals use the same durable, bounded, idempotent
  interaction lifecycle while preserving Qwen's indexed native answer response.
- Added session-keyed runtime command projection from `available_commands_update`. Command state is
  never treated as static provider inventory and is cleared when the owning client closes.
- Added authoritative usage inputs from standard ACP usage notifications, prompt response usage,
  and the optional `qwen/status/session/context_usage` extension. Projection failure remains outside
  execution ownership and no quota or context value is inferred.
- Added opaque nested-agent evidence from Qwen's parent-tool/subagent metadata. It prevents unsafe
  redispatch and produces parent tool activity, but does not fabricate a child identity, result,
  cancellation, status query, or reattachment capability. Nested child text is excluded from the
  parent result.
- Fenced connection loss during initialize/load/model/mode/effort as side-effect-free preparation
  failure. Recovery events are admitted only after the user prompt is dispatched, so a control-turn
  disconnect cannot leave the durable session in a recovering state without a started run.
- Reject malformed structured-question arrays as a whole so native answer indexes cannot shift.
  Usage and active-command projection cleanup are failure-isolated, so one optional projection
  cannot retain stale state owned by another.
- Bound Qwen's topology and opaque-agent declaration into the semantic fitness suite. Qwen auxiliary
  workflows remain unsupported and no trace or backend surface claims an auxiliary runner.
- Added Qwen-owned settings, model, no-visible-history, active-command, filesystem, lifecycle,
  registry-ingestion, structured-question, conformance, and sanitized trace coverage. The Qwen
  suites and the shared cross-platform managed-process owner now run on macOS, Linux, and Windows.
- Production composition remains unchanged and continues to use the legacy runtime path until
  Phase 9.

The independent Qwen architecture and lifecycle review approved the checkpoint with no remaining
material blocker. The Qwen slice is committed as `d5042ec5`.

## Phase 5 Gemini implementation

- Added a Gemini-owned managed-ACP backend and provider module without importing `ChatRuntime`,
  `LegacyProviderContext`, or another provider backend. Shared ACP code remains limited to transport,
  client, and process ownership primitives.
- Preserved native resume while handling Gemini's actual `session/load` contract: a successful load
  may omit `sessionId`, an explicit conflicting ID is rejected, and only a positively classified
  missing session permits replacement with one hidden Grimoire-context bootstrap prompt.
- Added a provider-owned history replay fence. Gemini CLI streams restored native transcript entries
  as ACP notifications around `session/load` without a replay-complete marker. A bounded native
  JSON/JSONL resolver mirrors Gemini's emission rule and supplies the exact expected count; the
  fence consumes exactly that inventory, rejects missing or additional entries, and closes the
  managed client before a user turn if native history or load cannot be bounded. The resolver
  understands the current project registry, ownership-marker, and legacy hash layouts, while raw
  restored transcript bytes never become the new run's output or durable result. File reads use a
  descriptor-scoped `limit + 1` buffer and directory iteration stops at its configured cap, including
  when a live native file grows after its initial metadata read.
- Added exact model → mode → user-prompt ordering through Gemini's native ACP controls. Confirmed
  state is cached only per owned client/session, failures prevent dispatch, and mode-update output is
  fenced from the user result.
- Kept capabilities conservative: provider-file command and agent definitions are inventory only;
  there is no runtime agent observation, child identity, result, cancellation, status query, or
  reattachment claim. Runtime questions, auxiliary work, transcript hydration, fork, rewind,
  steering, and compaction remain unsupported.
- Added durable approval bridging, bounded result commit/recovery/cancellation, native usage input,
  provider-owned filesystem containment, conformance, registry-ingestion, sanitized trace, settings,
  module, and replay-fence coverage. Gemini suites are included in the macOS/Linux/Windows execution
  matrix and reuse the already-proven POSIX process-group and Windows Job Object owner.
- Production composition remains unchanged and continues to use the legacy runtime path until
  Phase 9.

The independent Gemini architecture and lifecycle review approved the checkpoint with no remaining
material blocker.

## Phase 5 immutable provider catalog

- Added one provider-owned composition entry point containing the private frozen inventory of all
  nine validated modules. The core catalog still imports no provider or application code, and the
  unchanged production registries remain the live path until Phase 9.
- Added catalog fitness coverage for exact provider, display, order, backend, settings, workspace,
  capability, and feature identities; frozen publication; one module file per built-in provider;
  and exactly one production catalog construction site.
- Added temporary parity checks against the unchanged production provider/default inventories. The
  gate exposed and corrected manifest drift before cutover: current Claude and legacy Gemini labels
  remain unchanged, and Gemini remains ahead of Qwen while the new catalog retains unique ordering
  slots.
- The new catalog is not derived from either legacy registry or the legacy default table. Those old
  sources can neither contribute to nor override the new inventory and remain scheduled for removal
  after the hard cutover.
- Added catalog, Antigravity module, and Codex module suites to the existing macOS/Linux/Windows
  execution matrix so every built-in module and sanitized provider trace participates in the Phase 5
  cross-platform gate.

The independent catalog review is approved with no material blockers. It confirmed that the
inventory contains exactly nine explicit modules, public snapshots are immutable, contribution
identities and ordering remain aligned, top-level import performs no process launch or I/O, the
legacy production composition remains unchanged, and every module suite participates in the
macOS/Linux/Windows execution matrix.

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
- Final Grok focused gate: 8 execution/architecture suites / 68 tests pass; all existing Grok unit
  coverage passes 36 suites / 298 tests. The full checkpoint gate passes 461 unit suites / 7,455
  tests and 7 integration suites / 222 tests, plus typecheck, full lint, release build, and
  `git diff --check`. Independent review approved the slice with no remaining material blocker.
- Release artifacts remain byte-identical across repository root, `dist/grimoire`, and the configured
  test vault after the Grok checkpoint build: `main.js` `4d9c3680…`, `styles.css` `c079364c…`, and
  `manifest.json` `5058df46…`.
- Current Qwen gate: all Qwen plus shared managed-ACP adapter coverage passes 17 suites / 123 tests;
  the focused execution and semantic-fitness selection passes 9 suites / 64 tests; typecheck,
  focused ESLint, and `git diff --check` pass.
- Final Qwen checkpoint gate: 468 unit suites / 7,507 tests and 7 integration suites / 222 tests pass
  outside the restricted sandbox; typecheck, full lint, release build, and `git diff --check` pass.
  Independent review approved the slice with no remaining material blocker. The restricted run's
  only failures were the existing home-directory temporary-path and loopback-bind tests; the same
  suites passed unrestricted.
- Release artifacts remain byte-identical across repository root, `dist/grimoire`, and the configured
  test vault after the Qwen checkpoint build: `main.js` `4d9c3680…`, `styles.css` `c079364c…`, and
  `manifest.json` `5058df46…`.
- Read-only inspection of the installed Qwen Code 0.21.7 package confirms ACP support for
  `session/set_model`, `session/set_mode`, `/effort` levels `low` through `max`, typed active-session
  command updates, structured-question metadata, the context-usage extension, and nested
  parent-tool/subagent metadata. No live provider request or quota-consuming probe was used.
- Final Gemini checkpoint gate: 476 unit suites / 7,575 tests and 7 integration suites / 222 tests
  pass outside the restricted sandbox; typecheck, full lint, release build, and `git diff --check`
  pass. Independent review approved the slice with no remaining material blocker. Gemini execution,
  provider, shared managed-ACP, and semantic-fitness coverage passes 18 suites / 122 tests.
- Release artifacts remain byte-identical across repository root, `dist/grimoire`, and the configured
  test vault after the Gemini checkpoint build: `main.js` `4d9c3680…`, `styles.css` `c079364c…`, and
  `manifest.json` `5058df46…`.
- Read-only inspection of the installed Gemini CLI 0.54.4 package confirms native `session/load`,
  omitted load-response session identity, streamed history notifications, native model/mode control,
  approvals, usage metadata, and active-command notifications. The new capability descriptor keeps
  active commands unsupported to preserve current product behavior. No live provider request or
  quota-consuming probe was used.
- Final Phase 5 gate: 477 unit suites / 7,581 tests and 7 integration suites / 222 tests pass;
  typecheck, full ESLint, release build, Obsidian source/CSS/dependency review, isolated bundle-load
  smoke, view-open smoke, and `git diff --check` pass.
- Root, `dist/grimoire`, and the configured test-vault copies are byte-identical after the Phase 5
  release build: `main.js` SHA-256 `4d9c36808986ef196a859b6e819570a0e6b8debd9759f4e5cff5a3cd0d774d67`,
  `styles.css` `c079364c4f85717134955ce46b4c8a20ccfe403b4d1531675fa1a433e23c13eb`, and
  `manifest.json` `5058df46417fc0ec4debcc9eda1552c2fda654904132ab20b90d2bb1cbc63758`.

## Next steps

1. Implement durable agents/work graphs after every current provider module/backend is constructible
   through the new catalog.
2. Continue with the application runtime and provider-neutral feature ports only after the durable
   work model is proven.
