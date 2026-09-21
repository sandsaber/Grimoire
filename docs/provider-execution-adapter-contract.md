# Presentation Adapter Contract

What the execution kernel guarantees a chat surface, and what a provider's backend must therefore
provide. The class is `ExecutionChatRuntimeAdapter` in `src/core/runtime/execution/`; this file is
the reasoning its doc comment points at.

## What the adapter is

One provider-neutral class presenting the execution lifecycle to chat surfaces, and specifically
**as a client of `ExecutionLifecycleRegistry`** — never of a bare backend or session. The guarantees
a chat turn rests on (exactly one terminal, deduplication, generation fencing, honest
`indeterminate`) are registry and ingestor functions. An adapter wired straight to a backend would
either lack them or re-implement core policy locally, and both are defects.

Dependency direction is strict and one-way: the adapter imports the lifecycle; the kernel never
imports a presentation type. New capabilities land as projections or capability ports, not as
members of the adapter.

## Cancellation and completion

**`cancel()` dispatches `run.cancel()` and returns.** It does not close the generator. The run stays
non-terminal until the registry records `cancelled` after confirmed cancellation, or `interrupted`,
or `indeterminate`. The surface may show the interruption immediately — that is presentation state —
but the lifecycle does not claim the provider stopped until it did.

**The generator closes on one fact only: the run reaching a terminal.** Iterator end is *evidence of
a terminal*, never a substitute for one. Transport loss enters `disconnected` and `recovering`
without closing the generator, so a dropped socket does not render as a completed turn.

The lifecycle has six terminals and a surface draws two, so the mapping is deliberately lossy and
explicit:

| Run terminal | What the adapter emits before closing the generator |
|---|---|
| `succeeded` | nothing; the generator closes |
| `failed` | `{ type: 'error', content }` |
| `cancelled`, `interrupted` | nothing; the surface's own cancel path renders the interruption |
| `invalidated` | `{ type: 'error', content }` — the turn never reached the provider, and saying nothing renders an empty assistant message where the explanation belongs |
| `indeterminate` | `{ type: 'notice', level: 'warning', content }` stating the run's fate is unknown — the honest form of an outcome that must never be drawn as success |

`invalidated` is not the same fact as a presentation that moved on. A tab closing or a conversation
switching means the *view* left; this terminal means the turn was rejected before anything ran,
and the second one needs saying. Antigravity's fail-closed permission check on the shipped default
mode is the case that made it visible.

**Provider wording for a classified failure.** The kernel refuses to forward provider error text,
and its neutral sentence per cause cannot name a provider's own setting. A host may supply a
`describeFailure(reason)` port that returns better wording for a classification the kernel already
made, or `undefined` to keep the neutral one. It carries no provider diagnostics, so it raises no
redaction question, and it can be localized for the same reason.

**`consumeTurnMetadata()`** is the one channel that carries per-turn facts back to the surface. The
adapter fills it from the run's terminal record: accepted native message identities, whether the
turn was actually dispatched, and plan completion. It is safe to call after any terminal, including
after an exception, and it consumes — a second call returns empty.

## What a surface may depend on

| Dependency | Obligation |
|---|---|
| `prepareTurn()` returns the persisted content and request facts synchronously | Prompt encoding is provider-owned and synchronous; it is never a lifecycle round trip |
| `query()` is an async generator consumed with `for await` | Ingress events are normalized inside the adapter; the kernel never sees provider payloads and the surface never sees the wire |
| A generation change or a local cancel flag ends the loop | Generation fencing is registry-side too; the local check is a presentation guard |
| `cancel()` is synchronous and unacknowledged | Keep the signature; the truth is the run's |
| `steer()` returns a boolean | Capability port; absent when the provider cannot steer, never a no-op returning `false` |
| `setResumeCheckpoint()` is called before send | Held until the next run is created and cleared after dispatch |

Capability ports are declared by the provider module and **absent when unsupported**. A present port
that no-ops is a lie the surface cannot detect; an absent one is a fact it can read.

## Process lifetime

A provider process belongs to a kernel session, not to a turn. Claude's persistent SDK query and
every ACP client are launched by the first turn and held warm for the next one; Codex shares one
app-server across sessions; Command Code and Antigravity spawn per turn. Three things end a held
process, and a backend that holds one must be reachable by all three:

| Event | What happens |
|---|---|
| The tab lets the session go — close, conversation switch, settings change | `ExecutionChatRuntimeAdapter.cleanup()` / `resetSession()` cancel, wait a bounded time, then `disposeSession(id, { force: true })`. Force terminalizes a run past the wait as `indeterminate` and lets an unanswered interaction go, because the surface that would have answered it is gone. A refusal here was how idle `claude` processes outlived their tabs by days (#216) |
| The session sits idle past `sessionIdleTimeoutMinutes` | The registry calls `ExecutionSession.suspend()`, which closes the process and keeps the session and its native reference; the next turn relaunches and resumes, the way a reload does. Backends that hold a process between turns implement `suspend()`; the others leave it absent. `0` disables the timer |
| Plugin unload | `shutdown()` terminalizes and disposes everything, owners or not |

`suspend()` is a no-op while the process owns live work the kernel cannot see — Claude's detached
native tasks — so the backend, not the registry, has the last word on whether the process can go.

## Stop conditions

Any of these is a defect in the change that introduces it, not a workaround to keep:

- a backend would hold a provider process between turns without implementing
  `ExecutionSession.suspend()`, or a surface path would drop a session id without disposing the
  session — both leave a process with no owner and nothing that will ever end it;
- the adapter would drive a backend or session without going through
  `ExecutionLifecycleRegistry`, or would re-implement ingestion, deduplication, or terminal policy
  locally;
- the generator would close on anything other than a terminal fact;
- a provider's chat backend and its auxiliary path (title, refine, inline edit) contend for the
  same provider session or process.

## Enforcement

`tests/unit/features/chat/runtime/adapterContractTarget.test.ts` holds the terminal mapping and the
two closing rules against the real `ExecutionRunStream`. `executionCompositionBoundaries.test.ts`
holds the dependency directions and the completeness of the provider module contract.
