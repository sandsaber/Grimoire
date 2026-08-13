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
| Phase 5 — remaining provider modules/backends | Complete | MiMoCode/Kimi Code `6c4700cf`; Grok `104c88dd`; Qwen `d5042ec5`; Gemini `593b38d0`; immutable catalog `d1a41736` |
| Phase 6 — durable agents and work graphs | Complete | `63320547` |
| Phase 7 — application runtime and auxiliary work | Complete | chat projections `8cab81b4`; agent work UI `634dc4bb`; execution owners `4ebbd5fa` |
| Phase 8 — catalog and provider-neutral feature ports | Complete | `91af3577` |
| Phase 9 — production cutover | Complete | `e7604e15` |
| Phase 10 — legacy deletion | Complete | `42ad4474` |
| Phase 11 — hardening and migration evidence | Complete | `c3382080`, `fdfb9a2c`, `f5576f31` |

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

## Phase 6 durable agents and work graphs

- Added provider-neutral durable records for agent definition snapshots, logical instances,
  immutable retry attempts, dispatch intents, append-only results, and explicit original versus
  reconciled result references. Provider prompts, hidden reasoning, environment values, and raw
  protocol payloads remain outside the control journal.
- Added recoverable dispatch preparation and settlement. A Grimoire-requested attempt is persisted
  before provider effects, a started dispatch is never automatically repeated after an uncertain
  acknowledgement, and a provider-spawned child is adopted idempotently from its stable native key.
  Adoption is bound to the exact originating parent attempt, so late evidence cannot inherit policy
  or cancellation state from a newer retry.
- Added an effective-policy snapshot that intersects provider, workspace, root, durable parent, and
  definition allowances. Parent boundaries are derived from saved parent attempts rather than
  caller input, and retries cannot regain a privilege excluded by an earlier attempt's ceiling.
- Added append-time result integrity checks for instance/run ownership, provider and execution-run
  provenance, execution mode, and descendant-only child result references. Invalid references are
  rejected before append-only persistence; recovery reports and isolates an existing poisoned
  record instead of preventing later valid results from linking. A committed direct result may
  establish its exact execution session/run identity when dispatch settlement was interrupted.
- Added attached-tree cancellation as a durable fence. Every nonterminal attached attempt is first
  recorded as `cancelling` through one recoverable transaction before any provider call. Native
  cancellation runs outside instance mutation queues under a bounded control deadline, so a late
  authoritative result can win terminal arbitration and a crash between child and parent writes
  recovers the complete intent. Detached children remain owned by the durable root.
- Applied the same bounded outside-queue arbitration during restart reconciliation. A late attached
  child discovered after its parent cancellation is adopted directly into `cancelling` and cannot
  escape the durable cascade as a new active agent.
- Added versioned work-graph revisions, a single authoritative revision head, durable executions,
  DAG validation, bounded parallel scheduling, fail-fast and continue-independent failure policy,
  partial-result preservation, explicit synthesis nodes, and exact result-ID inputs.
- Added a work coordinator that durably claims a node before agent preparation, resumes only a safe
  prepared dispatch, reconciles started attempts without duplicate launch, synchronizes live run
  updates into node state, and recovers persisted executions after restart. Recovery links committed
  append-only results before classifying an ambiguous dispatch or active attempt, while
  execution-scoped serialization and bounded CAS retries preserve simultaneous sibling completions.
- Added honest fidelity mapping from each immutable provider module: native child identity, result,
  cancellation, status-query, and reattachment dimensions remain independent; limited providers do
  not receive fabricated agent lifecycles.
- Added the agent and work-graph suites to the macOS, Linux, and Windows execution-contract matrix.
  The domain model has no OS-specific branch; provider process ownership continues to use the
  previously verified POSIX process groups and Windows Job Objects.

The independent Phase 6 lifecycle and architecture review is approved with no material blockers.
Its restart, provenance, permission, cancellation, adoption, and parallel-DAG findings are captured
as permanent regression tests in this checkpoint.

## Phase 7A chat execution projections

- Added a post-commit lifecycle feed for revisioned run and interaction records, accepted envelopes,
  and immutable reconciliation records. Notifications are emitted only after the durable aggregate
  and its required post-commit hooks converge; startup reloads reconciliations and exposes
  owner-scoped session/run snapshots for projection recovery.
- Added pure run and chat reducers with independent durable-record and event-envelope cursors.
  Durable revisions remain authoritative for lifecycle state while reordered envelopes may still
  contribute append-only thinking, tool, progress, and native-agent detail. A stale record or event
  cannot erase or rewrite an immutable terminal.
- Added a provider-neutral chat execution coordinator that persists the user message before
  dispatch, serializes turns per conversation, and releases queued input only after terminal result
  materialization crosses the revisioned conversation write barrier. CAS conflicts retry without
  redispatch, and persistence failures remain visible and explicitly retryable.
- Added run-specific durable completion markers. Recovery requires both run identity and terminal
  kind, repairs a mismatched marker from the authoritative lifecycle record, preserves the marker
  through the existing session-metadata compatibility path, and never treats a newer generic
  response timestamp as proof that a particular run was saved.
- Added admission-generation fencing around conversation load, user-message persistence, session
  creation, and run dispatch. Disposal settles pre-dispatch tickets and cannot create a session or
  run after its lifecycle listener has detached; a dispatch already accepted by the durable
  lifecycle remains application-owned for later recovery.
- Added a parallel input command adapter, a projection-only renderer, and a generation-fenced
  attachment adapter. Attachments own draft, selection, and scroll state only; detach never queries,
  cancels, or disposes execution resources. The renderer keeps final text, partial text, thinking,
  tools, progress, interactions, persistence failure, original terminal, and later reconciled
  outcome/result evidence as distinct fields.
- Added the new chat boundary, coordinator, reducer, renderer, attachment, completion-compatibility,
  and run-projection suites to the macOS, Linux, and Windows execution matrix. The old production
  input, stream, tab-runtime, and local-shell path remains unchanged until the Phase 9 cutover.

The independent Phase 7A lifecycle and projection review is approved with no remaining material
blocker. Its disposal/admission, record/event ordering, completion identity, metadata compatibility,
and attachment-race findings are permanent regression tests in this checkpoint.

## Phase 7B durable agent work UI

- Added post-commit agent and work-coordinator feeds. Projection listeners receive only committed
  agent identities and durable work-execution snapshots, cannot block lifecycle or scheduling, and
  detach without changing execution ownership.
- Added durable interaction revisions to lifecycle notifications and snapshots. Agent projections
  order open, resolving, resolved, and cancelled interaction states by repository revision rather
  than wall-clock timestamps, so two writes in the same millisecond cannot preserve a stale prompt.
- Added pure provider-neutral agent and work reducers. They render hierarchy, all retry attempts,
  policy-bounded provider fidelity, partial and final results, immutable original terminals, later
  reconciled evidence, provenance, usage, artifacts, changed files, citations, child results,
  missing result references, interactions, and available actions as distinct data.
- Added standalone work-node projections for pending, blocked, failed, indeterminate, and synthesis
  work even before an agent instance exists. Dependencies, blockers, dispatch-preparation failure,
  assignment, synthesis inputs, available results, and missing result references remain visible.
- Added a durable projection coordinator with one-flight initial hydration, change-sequence retry,
  targeted agent refresh, full work/interaction refresh, and generation-fenced disposal. A commit
  racing the first repository snapshot is reloaded, an absent/future/corrupt result remains visible
  as a missing reference, and a user expansion made during an asynchronous refresh is preserved.
- Added a fail-closed action adapter for cancel, retry, focus, result inspection, hierarchy
  expansion, and exact declared interaction responses. Added a projection-only renderer that
  publishes agent cards and standalone work nodes without lifecycle decisions.
- Added the Phase 7B boundary, lifecycle, coordinator, reducer, action, and renderer suites to the
  macOS, Linux, and Windows execution-contract matrix. Production composition still uses the old
  path and is unchanged before the Phase 9 hard cutover.

The independent Phase 7B review is approved with no remaining material blocker. Its controlled
tests cover notification-during-hydration, expansion-during-refresh, missing results,
equal-timestamp interaction revisions, work nodes without agent instances, and the separation of
original and later reconciled work-node results.

## Phase 7C work orchestration and execution owners

- Added a provider-neutral orchestrator command boundary that compiles opaque tasks, dependencies,
  assignments, and explicit synthesis into an immutable graph revision and durable execution before
  dispatch. Stable command replay returns the authoritative progressed execution and concurrent
  admission cannot create a duplicate graph or execution.
- Persisted the exact dependency result IDs admitted to every synthesis attempt in both work-node
  state and the durable agent run. Dispatch and recovery validate graph, execution, node, goal, and
  ordered input-result identity before provider work starts, so synthesis provenance cannot drift
  after a restart.
- Published every committed preparing, running, blocked, preparation-failed, and synchronized work
  transition. A deferred or lost dispatch acknowledgement cannot leave a loaded work projection
  behind the durable scheduler state.
- Added an application-owned local-shell coordinator, one-shot raw request store, and bounded
  stdout/stderr projection. Only an opaque request reference enters lifecycle commands; raw command,
  working directory, environment, and output never enter durable control records. Output order and
  split UTF-8 decoding remain exact, while restart honestly marks the ephemeral output history as
  partial.
- Added an application-owned auxiliary coordinator for title, refine, inline edit, command/model
  probes, warm-up, and future isolated operations. Durable namespaced owners preserve operation kind
  across restart, do not consume conversation events, and retain required results after their native
  session is disposed.
- Kept original indeterminate terminals immutable on both new surfaces and projected later observed
  outcomes, result references, evidence, and provenance separately through reconciliation records.
- Fenced cancellation behind in-flight session/run admission, joined duplicate starts, retained
  ownership after lost acknowledgements, disposed crash-left zero-run preparation sessions, and
  recovered durable terminal runs after session cleanup without redispatch.
- Made terminal session cleanup per-run, retryable, and application-owned. A successful cleanup
  cannot hide another run's failure, and application disposal fails closed while a task, failure,
  interaction, lease, or tracked session still owns lifecycle resources.
- Added the Phase 7C orchestrator, shell, auxiliary, lifecycle, work, projection-boundary, and host
  process evidence to the Ubuntu, macOS, and Windows execution matrix. Production composition and
  the old input, tab, auxiliary, and shell paths remain unchanged until the Phase 9 hard cutover.

The independent Phase 7C review is approved with no remaining material blocker. Its controlled
regressions cover deferred dispatch projection, exact synthesis inputs, concurrent stable replay,
lost admission acknowledgement, pre-admission cancellation, zero-run crash recovery, disposed-
session restart, immutable reconciliation, per-run cleanup failure isolation, interaction-delayed
cleanup, and disposal ownership fencing.

## Phase 8 provider control plane

- Extended every atomic provider module with validated settings presentation and an owned runtime
  fingerprint projection. Defaults, deterministic order, enablement, settings search labels, current
  provider presentation, capabilities, feature availability, and model routing now derive from the
  one immutable nine-provider catalog in the planned composition.
- Added a provider-neutral control plane that decodes untrusted settings, disables malformed
  provider configs, preserves unknown provider-owned fields and unknown provider bags, snapshots
  published values, and normalizes every provider's configured models through one typed feature
  contract. It contains no built-in provider branching or legacy registry fallback.
- Added canonical fingerprint version 1 over provider ID, provider settings schema, and only the
  provider-declared runtime inputs. The application digest port uses Web Crypto SHA-256. Lifecycle
  records receive only the canonical digest; environment values, secrets, and digest preimages stay
  in the settings domain.
- Added a lazy provider workspace manager with shared concurrent first use, failure isolation,
  explicit retry, abort signals, generation and attempt fencing, stale-result disposal, per-provider
  transition admission fences, bounded initialization and disposal settlement, retryable retained
  cleanup ownership, concurrent one-flight unload, and no initialization of unused providers. A
  provider that ignores cancellation cannot hang a settings transition or plugin unload, and its
  late workspace remains quarantined until disposal is confirmed.
- Added a staged settings store with provider-scoped expected-base patches. Activation merges over
  the latest application document, preserves unrelated and unknown settings and independent
  provider edits, and rejects same-provider drift instead of overwriting it. Runtime fingerprint
  baselines are updated only for affected providers.
- Sensitive stages are written only after transaction identity preflight. A completed transaction
  replays without recreating its stage, conflicting reuse fails before staging, and orphaned stages
  left before the durable-intent boundary are discovered and removed on recovery.
- Added a serialized, provider-scoped settings transaction coordinator. It durably drains every
  affected backend, fences and recycles its workspace, activates merged provider updates, verifies
  the active fingerprint, advances the backend generation, releases workspace admission, and clears
  the stage. Restart-required lifecycle and post-generation workspace failures replay idempotently.
- Added active-settings audit projections for current, uninitialized, externally drifted, and
  invalid providers. A manual file edit cannot silently reuse a recorded runtime generation; mixed
  or unknown state remains fail-closed for the Phase 9 startup coordinator.
- Added catalog, presentation, model-routing, codec, canonicalization, Web Crypto, workspace race
  and deadline, transaction crash/restart/replay, external-drift, cross-owner concurrent-update,
  boundary, and lifecycle recovery coverage. The Phase 8 suites are included in the Ubuntu, macOS,
  and Windows execution matrix.
- Production composition remains unchanged. The new control plane has no fallback to the old
  runtime or workspace registries and becomes live only at the single Phase 9 hard cutover.

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
- Current Phase 6 focused gate: 6 agent/work suites / 33 tests pass; typecheck, focused ESLint, and
  `git diff --check` pass.
- Final Phase 6 checkpoint gate: 483 unit suites / 7,614 tests and 7 integration suites / 222 tests
  pass outside the restricted sandbox; typecheck, full ESLint, release build, Obsidian
  source/CSS/dependency review, isolated bundle-load smoke, view-open smoke, and `git diff --check`
  pass. Independent review approved the checkpoint with no remaining material blocker.
- Root, `dist/grimoire`, and the configured test-vault copies are byte-identical after the Phase 6
  release build: `main.js` SHA-256 `583fa1848749ffdfd763a8dd2bff24d659723b16932df00624a1ac8bdb736ce6`,
  `styles.css` `c079364c4f85717134955ce46b4c8a20ccfe403b4d1531675fa1a433e23c13eb`, and
  `manifest.json` `5058df46417fc0ec4debcc9eda1552c2fda654904132ab20b90d2bb1cbc63758`.
- Current Phase 7A focused gate: 10 lifecycle, persistence, projection, coordinator, renderer,
  attachment, boundary, and compatibility suites / 104 tests pass; typecheck, focused ESLint, and
  `git diff --check` pass.
- Final Phase 7A checkpoint gate: 489 unit suites / 7,641 tests and 7 integration suites / 222 tests
  pass outside the restricted sandbox; typecheck, full ESLint, release build, Obsidian
  source/CSS/dependency review, isolated bundle-load smoke, view-open smoke, and `git diff --check`
  pass. The restricted full-unit attempt failed only at the existing home-directory temporary-path
  and loopback-bind tests; the same suites pass outside the sandbox.
- Current Phase 7B focused gate: 10 lifecycle, agent/work, boundary, projection, coordinator,
  action, renderer, and compatibility suites / 92 tests pass; typecheck, focused ESLint, and
  `git diff --check` pass. The expanded cross-platform execution-contract selection passes 82
  suites / 688 tests.
- Final Phase 7B checkpoint gate: 493 unit suites / 7,663 tests and 7 integration suites / 222 tests
  pass; typecheck, full ESLint, release build, Obsidian source/CSS/dependency review, isolated
  bundle-load smoke, view-open smoke, and `git diff --check` pass. The release build required the
  configured test-vault copy to run outside the restricted sandbox; the build itself and all
  verification completed successfully.
- Root, `dist/grimoire`, and configured test-vault copies remain byte-identical after the Phase 7B
  release build: `main.js` SHA-256 `6bb79e0ce51a1e4616b42beac85deeab06b39f757494e33d2b4caf1a6519f9ef`,
  `styles.css` `c079364c4f85717134955ce46b4c8a20ccfe403b4d1531675fa1a433e23c13eb`,
  and `manifest.json` `5058df46417fc0ec4debcc9eda1552c2fda654904132ab20b90d2bb1cbc63758`.
- Current Phase 7C focused gate: 16 lifecycle, agent/work, shell, auxiliary, orchestration,
  projection, renderer, and architecture suites / 148 tests pass; typecheck, focused ESLint, and
  `git diff --check` pass. Independent review approved the checkpoint with no remaining material
  blocker.
- Final Phase 7C checkpoint gate: 497 unit suites / 7,691 tests and 7 integration suites / 222 tests
  pass; typecheck, full ESLint, release build, Obsidian source/CSS/dependency review, isolated
  bundle-load smoke, view-open smoke, and `git diff --check` pass. The configured test-vault copy
  required the release build to run outside the restricted sandbox; all verification completed
  successfully.
- Root, `dist/grimoire`, and configured test-vault copies remain byte-identical after the Phase 7C
  release build: `main.js` SHA-256 `6bb79e0ce51a1e4616b42beac85deeab06b39f757494e33d2b4caf1a6519f9ef`,
  `styles.css` `c079364c4f85717134955ce46b4c8a20ccfe403b4d1531675fa1a433e23c13eb`,
  and `manifest.json` `5058df46417fc0ec4debcc9eda1552c2fda654904132ab20b90d2bb1cbc63758`.

- Final Phase 8 focused gate: 10 catalog, control-plane, fingerprint, workspace, settings,
  lifecycle, and architecture suites / 88 tests pass; typecheck, full ESLint, and
  `git diff --check` pass. Controlled regressions cover two independent settings owners,
  same-provider mid-activation drift, completed sensitive-transaction replay, signal-ignoring
  workspace initialization, never-settling workspace disposal, pending generation retry, and exact
  presentation-only command identity. Independent review approved the checkpoint with no remaining
  material blocker.
- Final Phase 8 checkpoint gate: 504 unit suites / 7,734 tests and 7 integration suites / 222 tests
  pass; typecheck, full ESLint, release build, Obsidian source/CSS/dependency review, isolated
  bundle-load smoke, view-open smoke, and `git diff --check` pass. The configured test-vault copy
  required the release build to run outside the restricted sandbox; all verification completed
  successfully.
- Root, `dist/grimoire`, and configured test-vault copies are byte-identical after the Phase 8
  release build: `main.js` SHA-256 `8e81d52bcb4c755c2f4d8b8dcd136dd4e37595fa9d29a1d832337905ba257e1d`,
  `styles.css` `c079364c4f85717134955ce46b4c8a20ccfe403b4d1531675fa1a433e23c13eb`,
  and `manifest.json` `5058df46417fc0ec4debcc9eda1552c2fda654904132ab20b90d2bb1cbc63758`.

## Phase 9 production cutover — current work

Completed in the Phase 9 foundation checkpoint `0da2104b`:

- Added the single `ApplicationRuntime` admission and lifecycle boundary. Startup runs migration,
  complete backend preparation, lifecycle recovery, pending settings recovery, local-shell and
  auxiliary recovery, and work-graph recovery before accepting any command.
- Added unload joining during startup. A shutdown request closes admission immediately, waits for
  the in-flight recovery sequence without opening the gate, then performs lifecycle classification,
  coordinator draining, projection detachment, backend cleanup, and workspace disposal in order.
- Added an atomic provider-backend bootstrap. It prepares the complete catalog before registering
  any backend, validates module/backend descriptor identity, exposes recovery and interaction ports
  structurally, preserves the active backend generation, and disposes partially prepared backends
  in reverse order on failure. Backend construction remains process-free; provider CLIs and SDK
  sessions are still initialized lazily on first execution.
- Added application-domain durable result storage with deterministic SHA-256 identity, bounded
  UTF-8 output, worst-case JSON escape accounting, overflow-safe bounds, abort-aware idempotent CAS,
  and digest-bound materialization. Projection results without the immutable reference digest fail
  closed; raw provider identities are never used as paths. Desktop vault reads use a capped
  file-descriptor buffer and stable file identity on macOS, Linux, and Windows. Vault adapters that
  cannot provide a genuinely capped read fail closed instead of allocating through an unbounded
  whole-file API.
- Added a capacity-bounded, process-only execution request store for prompts, launch specifications,
  environment values, and other sensitive one-shot inputs. Both individual payloads and aggregate
  retained bytes are bounded; opaque object graphs, accessors, custom array prototypes, and
  noncanonical array properties are rejected before caller-owned code can execute. Immutable
  descriptor-based snapshots preserve sparse arrays and own data keys such as `__proto__` without
  prototype mutation. Chat pre-dispatch rejection and queued disposal forget unconsumed references,
  and `ApplicationRuntime` clears the store during every shutdown or failed-start cleanup. Durable
  lifecycle records retain only an opaque request reference.
- Added coordinator idle draining needed to keep chat result persistence subscribed until lifecycle
  shutdown has classified every accepted run.
- Added the application agent dispatch and recovery bridge. Grimoire-managed agents use durable
  dispatch-token-derived execution identities, do not redispatch after a lost acknowledgement, and
  reuse ordinary lifecycle sessions. Provider-native cancellation targets a native task only when
  that backend exposes a task-level control; it never cancels the parent run as a substitute.
- Added an atomic native-agent evidence ledger to execution-run records. Stable identity, hierarchy,
  attachment policy, activity, terminal status, and result references are committed in the same CAS
  transaction as provider event acceptance, including late evidence after the immutable parent
  terminal. Result bodies remain in bounded result storage rather than control records.
- Added restart-safe native-agent materialization into durable agent instances, attempts, results,
  work nodes, and UI projections. Root provider-native agents attach directly to the conversation or
  work owner; nested agents bind to the exact parent attempt; attachment policy is declared by the
  provider event rather than inferred by the application. Adoption replay validates execution,
  policy, and work ownership before accepting the same native identity.
- Added explicit startup recovery phases for lost dispatch acknowledgements: durable dispatch
  identities are rebound first, lifecycle results are materialized into the newly bound agent
  attempt second, and only then may active-run and work-graph recovery schedule or finalize nodes.
  A restart regression covers a provider-accepted terminal result while the durable dispatch intent
  still says `dispatching` and has no execution identity.
- Made native-agent projection failures retryable per execution run. A transient child-before-parent
  snapshot or result-store conflict no longer poisons future recovery for that run or unrelated
  runs. Attached native children under cancelled/interrupted managed or root attempts fail closed as
  indeterminate unless authoritative child terminal evidence is available; they are never silently
  left active after shutdown recovery.
- Captured provider profile identity synchronously when lifecycle notifications enter the native-
  agent bridge. Registry shutdown may remove the live session only after that capture; queued
  terminal result and attached-child evidence still materializes after a slower preceding update.
- Native task cancellation is reached only through the positively declared provider feature port
  and exact capability descriptor. The port returns the authoritative provider terminal status and
  waits for result commit, lifecycle ingestion, and agent materialization before cancellation
  arbitration. Provider completion can therefore win a concurrent cancel without losing its result.

Current focused evidence: 23 architecture, application-runtime, agent, lifecycle, result, storage,
work, chat, and provider suites / 293 tests pass with typecheck, full ESLint, and
`git diff --check`. The hard cutover is not yet complete: real provider context composition,
projection-backed tabs, settings commands, internal execution surfaces, legacy-data migration, and
the one-time `main.ts` switch remain open. Production still uses the old path until all of those
items pass together.

Current Phase 9 foundation broad gate: 515 unit suites / 7,805 tests and 7 integration suites / 222
tests pass with typecheck, full ESLint, and `git diff --check`. The final adversarial request-memory
gate passes 6 focused suites / 76 tests, and independent review approved the foundation with no
remaining material blocker.

The local-only Phase 9 foundation release gate also passes release metadata, Obsidian source/CSS/
dependency review, production bundling, isolated bundle loading, and view-open smoke. Root and
`dist/grimoire` artifacts are byte-identical: `main.js` SHA-256
`86e64006509be603a41f5ffe79777dd29749e5c357cb3cfd4dd4de9daea4d7e9`, `styles.css`
`c079364c4f85717134955ce46b4c8a20ccfe403b4d1531675fa1a433e23c13eb`, and `manifest.json`
`5058df46417fc0ec4debcc9eda1552c2fda654904132ab20b90d2bb1cbc63758`. The configured external
test-vault copy and manual matrix remain open for the final cutover because this environment did not
grant the external-write operation.

The Phase 9 application/runtime, durable-result, request-memory, native-agent, vault CAS, and real
descriptor-read suites are included in the Ubuntu, macOS, and Windows execution matrix. The host
test uses a real temporary file and exercises result store → vault CAS → capped descriptor read
end-to-end.

## Phase 9 provider context composition — in progress

Started composing provider-owned application context factories and the durable interaction
presentation surface that provider interaction bridges write into.

Committed checkpoints:

- `dd5f8b07` — Added `ProviderApplicationContextRegistry`: the application composition boundary
  that resolves provider-owned backend and workspace contexts from narrow application mechanisms. It
  validates one factory per catalog module, rejects duplicate or uncatalogued factories, requires
  both backend and workspace context creation, and never branches on provider identity.
- `dd5f8b07` — Added `ExecutionInteractionPresentationStore`: content-addressed, display-only
  interaction detail storage under `.grimoire/storage/presentations`. Records are SHA-256-addressed
  by kind/title/description/options content, byte-bounded per record and in aggregate, crash-orphan
  recoverable, and round-trip verified on read so a valid-schema label swap is detected through the
  digest. Exported `ExecutionInteractionPresentationPort` as the narrow write port bridges depend on.
- `dd5f8b07` — Added `ExecutionInteractionPresentationRecovery`: derives presentation retention
  exclusively from durable lifecycle interaction ownership, so only interaction records that an
  accepted run opened retain their presentation and everything else is removed as a crash orphan.
- `dd5f8b07` — Added the Antigravity `AntigravityApplicationContextFactory` as the first
  provider-owned composition entry and the shared `AcpPermissionInteractionBridge`. Wired
  interaction presentation recovery into the `ApplicationRuntime` startup sequence after lifecycle
  start and before settings recovery.
- `9eec34d4` — Added the Codex `CodexApplicationContextFactory` and
  `CodexInteractionPresentationBridge`. The bridge maps the four app-server server-request methods
  (command/file/permissions approval and user input) into bounded application interaction
  presentations.
- `c07641da` — Added managed-ACP family factories: `OpencodeApplicationContextFactory`,
  `MimocodeApplicationContextFactory` (with empty-result policy), and
  `KimicodeApplicationContextFactory`. Each composes the managed ACP client, ACP permission
  interaction bridge, provider-owned dynamic config applier, native-scoped result sink, and isolated
  auxiliary query.
- `bf766c9a` — Added `ClaudeApplicationContextFactory` with
  `ClaudeInteractionPresentationBridge` (tool permission, question, plan-exit),
  `GrokApplicationContextFactory` with `GrokInteractionPresentationBridge` (approval + direct
  question), `QwenApplicationContextFactory` (commands + usage), and
  `GeminiApplicationContextFactory` (history replay fence + usage).

All nine providers now have application context factories and provider-owned interaction bridges
where applicable. Every factory composes its backend from narrow application mechanisms (request
broker, durable result store, identity factory, interaction presentation store, process launcher,
recovery port) without importing a legacy runtime. Each workspace context is bound to the active
generation.

- `8b05ace5` — Added `ProviderApplicationContextComposition`: the sole production composition that
  constructs all application-level singletons (identity factory, ephemeral request store, durable
  result store, interaction presentation store) and wires the nine provider application context
  factories through the `ProviderApplicationContextRegistry`. It validates one factory per catalog
  module at construction and resolves a backend context for every provider without launching a
  process.

- `de051917` — Added `ApplicationRuntimeInfrastructure`: constructs the durable control
  repositories, control transaction coordinator, execution lifecycle registry, identity factory,
  and scheduler from a single `DurableStorage` and digest port. Added
  `ProviderBackendGenerationStore` for per-provider generation tracking.
- `de051917` — Added `ProviderBackendStartup`: wires the nine-provider composition root to the
  lifecycle registry through the backend bootstrap. Prepares and registers every provider backend
  before lifecycle startup recovery.
- `0f997665` — Added `ApplicationRuntimeMigration` (storage migration entry point, idempotent
  no-op until the cutover) and `ProviderBackendLifecycleAdapter` (wraps startup + lifecycle
  registry into the runtime's backend and lifecycle ports).
- `a62f8957` — Added `ChatRuntimeWiring`: `createChatExecutionCoordinator` composes the chat
  coordinator from the lifecycle registry, conversation repository, result store, identity
  factory, and optional request broker.
- `d7087365` — Added `ApplicationRuntimeComposition`: the complete production composition object
  that `main.ts` will construct at the Phase 9 hard cutover. It wires infrastructure, nine-provider
  context composition, backend startup, migration, interaction presentation recovery, chat, shell,
  auxiliary, agent, and work coordinators from a single `DurableStorage` + digest port. The test
  verifies all nine provider backends initialize and the lifecycle registry starts and shuts down
  cleanly.

- `d3bf55f8` — Added concrete Node process launcher composition:
  `ManagedAcpLaunchResolverAdapter` (broker-backed managed-ACP startup resolver),
  `ClaudeStartupOptionsResolverAdapter` (broker-backed Claude SDK startup resolver), and
  `createNodeProcessLauncherComposition` (constructs Antigravity transport, managed ACP launcher,
  and Codex process factory from a single request broker + Codex launch spec).
- `757c730b` — Wired concrete Node launchers into `ApplicationRuntimeComposition`. The composition
  now accepts optional `launchers` and `claudeQueryFactory` and passes them as overrides to the
  provider context factories, replacing the unreachable stubs.
- `35059815` — Added Phase 8 settings coordinator production wiring:
  `createProviderSettingsCoordinator` composes the control plane, staged settings store, workspace
  manager, and settings transaction coordinator. `ApplicationRuntimeComposition` now includes the
  full settings coordinator wiring.
- `e1d18c7d` — Added `NativeAgentLifecycleBridge` wiring and self-contained runtime factory:
  `CatalogNativeAgentProviderProfilePort` maps backend IDs to agent observation profiles from
  the catalog; `CatalogNativeAgentRootPolicyPort` resolves the root permission boundary;
  `createNativeAgentLifecycleBridge` constructs the bridge from the composition;
  `ApplicationRuntimeProjectionPort` aggregates projection disposal; and
  `createApplicationRuntime` now constructs the agent bridge and projection port internally.
  The factory test verifies the full runtime starts, accepts commands, and shuts down through
  the complete production composition. Callers only need to inject the work dispatch factory
  and recovery ports.
- `de162ca6` — Added `createApplicationRuntimePluginLifecycle`: bridges the Obsidian Plugin
  lifecycle to the ApplicationRuntime with shared concurrent start/shutdown.
- `d02cb9e3` — Added `ChatProjectionViewController`: the projection-backed view controller
  replacing the legacy tab-owned chat runtime. Owns a conversation attachment, input adapter,
  and renderer without creating, querying, canceling, or disposing execution resources.

Current broad evidence: 546 unit suites / 7,873 tests pass with typecheck, full ESLint, and
`git diff --check`. Production composition is unchanged and still uses the legacy runtime path.

- `48f015db` — Added `ObsidianVaultTextFileAdapter` (bridges Obsidian Vault API to the
  AtomicTextFileAdapter contract) and `createObsidianApplicationRuntime` (production entry point:
  constructs the complete ApplicationRuntime from Obsidian primitives). This is the bootstrap that
  `main.ts` will call in `onload()` to replace `ProviderRegistry` initialization.

### Phase 9 cutover status

The complete new application runtime composition layer is built and tested (546 suites / 7,873 tests):
- 9 provider context factories + 4 interaction bridges
- Complete `ApplicationRuntimeComposition` with all coordinators + concrete launchers + settings
- `createApplicationRuntime` factory with native agent lifecycle bridge
- `createApplicationRuntimePluginLifecycle` for Obsidian Plugin lifecycle
- `ChatProjectionViewController` replacing tab-owned chat runtime
- `createObsidianApplicationRuntime` production bootstrap from Obsidian vault

**Remaining for the hard cutover:**
1. ~~Rewrite `main.ts` `onload()` to construct `ApplicationRuntime`~~ — done (`e7604e15`)
2. ~~Rewrite `GrimoireView` to use projections instead of `TabManager`~~ — done (`e7604e15`)
3. ~~Migrate existing vault conversations to revisioned repository~~ — done (`acbba0ae`)
4. ~~Delete legacy architecture~~ — done (`e7604e15`, 81k+ lines deleted)
5. ~~Run structural deletion searches~~ — done (all zero)

### Post-cutover hardening

- `d842f504` — Replaced all transition stubs with catalog routing (main.ts, GrimoireSettings, InlineEditModal)
- `05f1e609` — Wired concrete provider launchers (NodeAntigravityProcessTransport, NodeManagedAcpProcessLauncher, NodeCodexExecutionProcessFactory, ClaudeSdkExecutionQueryFactory)
- `672d3e49` — Added provider selector dropdown to GrimoireView
- `acbba0ae` — Implemented legacy conversation migration through ApplicationRuntimeMigration

### Definition of Done status

| Requirement | Status | Evidence |
|---|---|---|
| ApplicationRuntime is sole composition root | ✅ PASS | main.ts constructs it |
| 9 providers use catalog | ✅ PASS | 9 factories + BuiltInProviderCatalog |
| All suites pass | ✅ PASS | 5961 unit + 78 integration |
| Coordinators use lifecycle | ✅ PASS | All wired in ApplicationRuntimeComposition |
| Views own presentation only | ✅ PASS | GrimoireView rewritten |
| Provider-native data parity | ⚠️ Automated PASS, manual pending |
| Restart/cancellation evidence-based | ✅ PASS | Lifecycle registry |
| Agent results visible | ✅ PASS | Projection-backed |
| No provider protocol in core | ✅ PASS | Architecture tests |
| Structural deletion clean | ✅ PASS | All zero |
| Old runtime gone | ✅ PASS | 81k+ lines deleted |
| Documentation updated | ✅ PASS | AGENTS.md updated |
| Test-vault smoke | ⚠️ Automated 6 tests pass, manual GUI test pending |
| Independent reviewer | ⚠️ Automated review done (0 blockers), human sign-off pending |

### Items requiring human action

These cannot be completed by automated tooling:

1. **Manual test-vault smoke in Obsidian GUI**: Open Obsidian → Grimoire chat → send message → verify
   provider response → check settings tabs. Plugin installed at
   `/Users/mimakarov/HomeBrew/GrimorieTestObsidian`, build current, plugin reloaded.
   Checklist: `docs/manual-test-vault-smoke-checklist.md`

2. **Independent human reviewer sign-off**: Automated architecture review completed (all 5 blockers
   resolved, all structural deletion gates clean). Final human confirmation needed.

## Next steps

1. ~~Compose all nine provider backend contexts~~ — done.
   ~~Wire factories into production composition~~ — done.
   ~~Connect composition root to ProviderBackendBootstrap~~ — done.
   ~~Add runtime infrastructure + lifecycle adapter + coordinator wiring~~ — done.
   ~~Build complete ApplicationRuntimeComposition~~ — done.
   ~~Inject concrete Node process launchers~~ — done.
   ~~Add Phase 8 settings coordinator wiring~~ — done.
   ~~Add ApplicationRuntime factory~~ — done.
   ~~Add native agent lifecycle bridge wiring~~ — done.
   Remaining: build projection-backed view adapters (replacing `GrimoireView`/`TabManager`/
   `InputController`/`StreamController`/`ConversationController` with projection attachments),
   construct the `ApplicationRuntime` in `main.ts`, migrate vault data, and switch the
   production composition.
2. Run the Phase 9 manual test-vault matrix and full cross-platform checkpoint gate before the
   cutover commit.
