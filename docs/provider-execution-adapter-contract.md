# Presentation Adapter Contract

The M0a specification of the seam every provider flip depends on. It maps every member of the
existing `ChatRuntime` contract ([`ChatRuntime.ts`](../src/core/runtime/ChatRuntime.ts)) onto the new
execution lifecycle, so the mapping is settled on paper before any backend is ported. The v1
attempt discovered its seam problems during the cutover; that is the failure this document exists to
prevent.

Canon: [`provider-execution-migration-plan.md`](provider-execution-migration-plan.md). This
document is subordinate to it and to
[`provider-contribution-inventory.md`](provider-contribution-inventory.md).

## What the adapter is

One provider-neutral class implementing `ChatRuntime` on top of the execution lifecycle, and
specifically **as a client of `ExecutionLifecycleRegistry`** — never of a bare backend or session.
The guarantees each flip exists for (exactly one terminal, deduplication, generation fencing, honest
`indeterminate`) are registry and ingestor functions. An adapter wired straight to a backend would
either lack them or re-implement core policy locally, and both are stop conditions.

Dependency direction is strict and one-way: the adapter imports the new lifecycle; the new core
never imports `ChatRuntime`.

The adapter is under feature freeze from the day it exists. No new capability may be exposed
through `ChatRuntime`. New capabilities land as projections or capability ports. The adapter and the
old contract are deleted together at the M5 seam-deletion checkpoint.

## Contract size

`ChatRuntime` declares **32 members** (the plan's "~27" was an estimate; the count is pinned by a
test so this document cannot drift from the interface). Their mapping falls into four kinds:

| Mapping kind | Count | Meaning |
|---|---|---|
| Session or run operation | 14 | Served by `ExecutionSession` / `ExecutionRun` through the registry |
| Capability port | 11 | Served by a narrow port the provider module declares, absent when unsupported |
| Provider module contribution outside execution | 3 | Not a lifecycle concern; the module supplies it directly |
| Explicit absence | 4 | No production consumer; the adapter implements the minimum the type requires and nothing more |

## The two questions the plan requires answering here

### 1. Synchronous `cancel()` and generator end against asynchronous run terminals

**What happens today.** `InputController.cancelStreaming()`
([InputController.ts:1566](../src/features/chat/controllers/InputController.ts)) sets
`state.cancelRequested = true`, calls `runtime.cancel()` — which returns `void` and is never awaited
or acknowledged — and hides the indicators. The `for await` loop at
[InputController.ts:565](../src/features/chat/controllers/InputController.ts) breaks on the *next*
chunk. Cancellation is therefore optimistic and entirely local: the UI declares the turn interrupted
without any evidence that the provider stopped.

Generator end is worse. When the loop exits normally, the `finally` block treats the turn as
finished unconditionally — `finalizeProgressBlocks(..., 'completed')`, `completedAt`, the duration
footer, the conversation save, the queued-message pump
([InputController.ts:638-729](../src/features/chat/controllers/InputController.ts)). Nothing
consults a terminal fact. `consumeTurnMetadata().wasSent` exists but only decides whether the resume
checkpoint is cleared. **Iterator end is the completion signal.** That is the defect the migration
fixes, and it is why the characterization suite and the target suite must be separate.

**The mapping.**

- `cancel()` dispatches `run.cancel()` and returns immediately. It does **not** close the generator.
  The run stays non-terminal until the registry records `cancelled` after confirmed cancellation, or
  `interrupted`, or `indeterminate`. The optimistic UI state stays exactly as it is today — the user
  still sees the interruption immediately — but the lifecycle no longer lies about what happened.
- The generator closes on one fact only: the run reaching a terminal. Iterator end therefore becomes
  *evidence of a terminal*, rather than a substitute for one. Transport loss enters `disconnected`
  and `recovering` without closing the generator, so a dropped socket no longer renders as a
  completed turn.

**Keeping six outcomes representable through a two-outcome UI.** The lifecycle has six terminals;
today's UI observes two (finished, interrupted). The mapping is deliberately lossy and explicit, and
it uses only chunk types that already exist in `StreamChunk`, so no `ChatRuntime` member and no
metadata field is added:

| Run terminal | What the adapter emits before closing the generator |
|---|---|
| `succeeded` | nothing; the generator closes |
| `failed` | `{ type: 'error', content }` — the same surface the current `catch` renders |
| `cancelled`, `interrupted` | nothing; the controller's existing cancel path already renders "Interrupted" |
| `invalidated` | nothing; matches today's `wasInvalidated` path, which skips finalization |
| `indeterminate` | `{ type: 'notice', level: 'warning', content }` stating the run's fate is unknown — the honest form of the outcome that today is silently rendered as success |

Richer presentation of `indeterminate` and of later reconciliation is an M5 projection concern, not
an adapter concern. The adapter's obligation is that the outcome is never *misrepresented*, not that
it is fully rendered.

**Consequence for `consumeTurnMetadata()`.** The controller already calls it in `finally` on every
turn, which makes it the one existing channel that carries per-turn facts back to the UI. The
adapter fills it from the run's terminal record: accepted native message identities, whether the
turn was actually dispatched (`wasSent`), and plan completion. Its declared type is not widened.

### 2. What `InputController` actually depends on

Read from the call sites, not inferred from the interface:

| Dependency | Evidence | Adapter obligation |
|---|---|---|
| `prepareTurn()` returns `persistedContent`, `isCompact`, and `request.currentNotePath`, and the controller writes them onto the user message before sending | [InputController.ts:556-560](../src/features/chat/controllers/InputController.ts) | Prompt encoding stays provider-owned and synchronous; it must not become a lifecycle round-trip |
| `query()` is an async generator of `StreamChunk`, consumed with `for await` | [InputController.ts:565](../src/features/chat/controllers/InputController.ts) | Ingress events are normalized to `StreamChunk` inside the adapter; core never sees provider payloads |
| The loop breaks on a generation change and on `state.cancelRequested`, not on any provider signal | [InputController.ts:567-574](../src/features/chat/controllers/InputController.ts) | Generation fencing must be registry-side too; the local check stays as a presentation guard |
| `consumeTurnMetadata()` is called exactly once per turn, inside `finally` | [InputController.ts:607](../src/features/chat/controllers/InputController.ts) | Must be safe to call after any terminal, including after an exception, and must consume — a second call returns empty |
| Generator end ⇒ turn finished, saved, and the queue pumped | [InputController.ts:638-729](../src/features/chat/controllers/InputController.ts) | The behavior the target suite deliberately changes: close only on a terminal |
| `cancel()` is synchronous, unacknowledged, and paired with a local flag | [InputController.ts:1566-1575](../src/features/chat/controllers/InputController.ts) | Keep the signature; move the truth to the run |
| `steer()` returns a boolean the controller branches on | [InputController.ts:1276](../src/features/chat/controllers/InputController.ts) | Capability port; absent when the provider cannot steer |
| `setResumeCheckpoint()` is called before send, from persisted conversation state | [InputController.ts:542](../src/features/chat/controllers/InputController.ts) | Adapter holds it until the next `createRun` and clears it after dispatch |

`ConversationController` adds two: `consumeSessionInvalidation()` then `buildSessionUpdates()` on
save ([ConversationController.ts:452,478](../src/features/chat/controllers/ConversationController.ts)),
and `cancel()` on conversation switch ([ConversationController.ts:125](../src/features/chat/controllers/ConversationController.ts)).

## Member-by-member mapping

Every member has a verdict. There are no "decide later" rows — that is the M0a exit gate.

### Identity and capability

| # | Member | Mapping | Notes |
|---|---|---|---|
| 1 | `providerId` | module contribution | From `ExecutionBackendDescriptor.association.providerId`; association metadata, not execution identity |
| 2 | `getCapabilities()` | capability port | Reads `ProviderCapabilityDescriptor`. Adapter reads the descriptor at M2; UI gating moves to the descriptor at M3 |
| 3 | `prepareTurn(request)` | module contribution | Provider-owned prompt encoding, synchronous. Explicitly **not** a session or run operation |

### Session lifecycle

| # | Member | Mapping | Notes |
|---|---|---|---|
| 4 | `onReadyStateChange(listener)` | session operation | Readiness-filtered `session.subscribe`, returning the unsubscribe. Sole call site passes an empty callback ([Tab.ts:364](../src/features/chat/tabs/Tab.ts)) — keep the subscription honest anyway |
| 5 | `setResumeCheckpoint(id)` | run operation | Buffered onto the next `ExecutionRequest`; cleared after dispatch |
| 6 | `syncConversationState(state, paths)` | session operation | Session configuration update; a change fences the backend generation |
| 7 | `reloadMcpServers()` | capability port | MCP port. Reconfiguration fences the generation |
| 8 | `reloadWorkspaceResources?()` | capability port | Workspace port. No production call site today; stays optional and absent unless declared |
| 9 | `ensureReady(options)` | session operation | `backend.createSession()` plus readiness; idempotent, returns whether the session is usable |
| 16 | `isReady()` | session operation | Read off `getSnapshot()`; never a probe with side effects |
| 13 | `resetSession()` | session operation | Dispose and re-establish with a fresh `sessionInstanceId`. **Explicit absence in practice**: no production call site |
| 14 | `getSessionId()` | session operation | Provider-native, opaque id from the snapshot; never synthesized by core |
| 15 | `consumeSessionInvalidation()` | session operation | One-shot read of the generation-fencing flag |
| 19 | `cleanup()` | session operation | Until M5 it disposes the session, preserving today's "closing a tab cancels its work". At M5 it becomes detach-only, per the plan's intentional-change list |

### Run lifecycle

| # | Member | Mapping | Notes |
|---|---|---|---|
| 10 | `query(turn, history, options)` | run operation | `session.createRun()`; ingress events normalized to `StreamChunk`. Closes only on a terminal |
| 11 | `steer?(turn)` | capability port | Steering port; absent when unsupported, not a no-op returning `false` |
| 12 | `cancel()` | run operation | Fire-and-forget `run.cancel()`; see question 1 |
| 27 | `setAutoTurnCallback(cb)` | run operation | Backend-initiated turns surface as runs owned by the same conversation, delivered through the callback with their own metadata |
| 28 | `consumeTurnMetadata()` | run operation | Filled from the run's terminal record; see question 1 |

### Interactions

All four are `InteractionBroker` subscriptions keyed by interaction kind. The broker owns ownership
and idempotent resolution; the adapter only bridges the callback shape.

| # | Member | Mapping |
|---|---|---|
| 21 | `setApprovalCallback(cb)` | interaction subscription — approval |
| 22 | `setApprovalDismisser(fn)` | interaction dismissal for the same kind |
| 23 | `setAskUserQuestionCallback(cb)` | interaction subscription — question |
| 24 | `setExitPlanModeCallback(cb)` | interaction subscription — plan decision |
| 25 | `setPermissionModeSyncCallback(cb)` | session-state observation of provider permission mode |

### History, commands, models

| # | Member | Mapping | Notes |
|---|---|---|---|
| 17 | `getSupportedCommands()` | capability port | Commands port; honors the provider's discovery kind (static, active-session, ephemeral, unsupported) |
| 18 | `getAuxiliaryModel?()` | capability port | Model-routing port |
| 20 | `rewind(userId, asstId, mode)` | capability port | Rewind port; only Claude declares it today |
| 29 | `buildSessionUpdates(params)` | capability port | History port producing the conversation patch; opaque `providerState` stays opaque |
| 30 | `resolveSessionIdForFork(conv)` | capability port | History port |

### Native agent observation

| # | Member | Mapping | Notes |
|---|---|---|---|
| 26 | `setSubagentHookProvider(get)` | capability port | Native-agent observation port; passthrough until M5 |
| 31 | `loadSubagentToolCalls?(id)` | explicit absence | Optional, no production call site |
| 32 | `loadSubagentFinalResult?(id)` | explicit absence | Optional, no production call site |

## Stop conditions specific to this seam

Return to the owning contract milestone rather than working around any of these:

- the mapping would need a **new** `ChatRuntime` member, or a widened declared type, to keep a
  surface working;
- the adapter would drive a backend or session without going through `ExecutionLifecycleRegistry`,
  or would re-implement ingestion, deduplication, or terminal policy locally;
- the generator would close on anything other than a terminal fact;
- a flipped provider's new chat backend and its legacy auxiliary path (title, refine, inline edit)
  contend for the same provider session or process — checked mechanically against the M0a
  shared-resource inventory;
- the adapter outlives the M5 seam-deletion checkpoint.

## Freeze

From the M0a checkpoint, the old runtime path is frozen for new product features. Bug fixes remain
allowed and must be absorbed by later harvested slices. A new provider integration either waits for
the presentation seam or implements an execution backend per the plan's "Adding a provider" rules.
