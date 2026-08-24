# Provider Capability and Topology Records

The M0a record of how each provider actually executes, and of every resource its chat path shares
with its auxiliary path. Required by
[`provider-execution-migration-plan.md`](provider-execution-migration-plan.md) before any backend is
harvested.

**The source of truth is `tests/fixtures/providerExecutionTopology.ts`**, not this page. The tables
below are rendered from it by hand and asserted against it by
`tests/unit/architecture/providerExecutionTopology.test.ts`, so the two cannot drift apart. The M2
flip's auxiliary-contention check reads the fixture directly.

## Why the shared-resource half exists

A flipped provider runs new chat execution beside legacy auxiliary execution — title generation,
instruction refine, and inline edit stay on the old path until M5. The plan permits that mixed state
with one hard rule: the two paths must not contend for the same provider session or process. That
rule is only checkable against an inventory of what they share, which is what the fixture is.

Sharing is classified in three ways. `read-only` and `partitioned` are safe. A single `contended`
entry is a stop condition for that provider's flip, and the fitness test asserts there are none
today.

## Topology

| Provider | Process topology | Session boundary | Resume | Concurrency |
|---|---|---|---|---|
| Antigravity | process per run | none | reconstructed | one process per run; concurrent turns are concurrent processes |
| Claude | persistent SDK stream | native SDK session | native | one SDK query stream per conversation runtime |
| Codex | persistent daemon | native thread | native | one app-server process multiplexing threads and turns |
| Gemini | managed ACP subprocess | ACP session | native | one ACP session per conversation runtime |
| Grok | managed ACP subprocess | ACP session | native | one ACP session per conversation runtime, with provider extensions |
| Kimi Code | managed ACP subprocess | ACP session | native | one ACP session per conversation runtime |
| MiMoCode | managed ACP subprocess | ACP session | native | one ACP session per conversation runtime |
| OpenCode | managed ACP subprocess | ACP session | native | one ACP session per conversation runtime |
| Qwen | managed ACP subprocess | ACP session | native | one ACP session per conversation runtime |

These are the four topologies the plan requires the contract to survive: stateless process
(Antigravity), multiplexed daemon (Codex), persistent SDK stream (Claude), and managed ACP
(OpenCode and family). The contract freezes only after all four pass conformance and real trace
parity.

## Capability record

The M2 flip smoke matrix must exercise "every capability the provider declares", which needs one
place to read them. That place is the fixture: each record's `capabilities` field re-exports the
provider's own `capabilities.ts` declaration.

`src/providers/<provider>/capabilities.ts` stays canonical — the fixture holds a reference, never a
copy, so the two cannot disagree. Nothing is duplicated into this document either, for the same
reason: a capability table rendered by hand is a table that drifts.

Practically, that means a flip's smoke matrix is derived, not written: read the provider's record,
take the declared flags (`supportsPlanMode`, `supportsRewind`, `supportsFork`, `supportsTurnSteer`,
`supportsProviderCommands`, `reasoningControl`, and the rest), and exercise each declared one once,
on top of the four every provider gets — new session, cancel, history, model selection.

## Auxiliary execution

| Provider | Auxiliary execution | Owner |
|---|---|---|
| Antigravity | no-op | `auxiliary/AntigravityNoopServices.ts` |
| Claude | isolated | `runtime/claudeColdStartQuery.ts` |
| Codex | isolated | `runtime/CodexAuxQueryRunner.ts` |
| Gemini | no-op | `auxiliary/GeminiNoopServices.ts` |
| Grok | kernel-isolated | `app/execution/grok/GrokExecutionComposition.ts` |
| Kimi Code | kernel-isolated | `app/execution/kimicode/KimicodeExecutionComposition.ts` |
| MiMoCode | kernel-isolated | `app/execution/mimocode/MimocodeExecutionComposition.ts` |
| OpenCode | kernel-isolated | `app/execution/opencode/OpencodeExecutionComposition.ts` |
| Qwen | no-op | `auxiliary/QwenNoopServices.ts` |

Three providers — Antigravity, Gemini, and Qwen — register auxiliary services that do nothing.
Their flips cannot produce auxiliary contention at all, which makes them the cheapest providers to
flip on this axis.

The six with real auxiliary execution each isolate it by construction, verified in code rather than
assumed:

- **Claude** runs auxiliary queries cold, with `persistSession: false`, so an auxiliary turn never
  writes a session the chat path reads;
- **Codex** starts a second app-server process and its own thread for auxiliary work — the class
  that does it says so in its own documentation comment, and owns its process, transport, and
  thread id;
- **OpenCode, MiMoCode and Kimi Code** run auxiliary work on the execution kernel and keep no runner.
  Each composition launches it through **its own client factory**, into
  `.grimoire/<provider>/auxiliary/<purpose>/` artifacts instead of the chat path's
  `.grimoire/<provider>/`, as an agent whose permissions deny writing. The client factory is the part
  worth reading twice — a chat turn in full access opts out of workspace containment because the user
  asked for it and is watching, and an auxiliary turn is neither, so it is contained whatever the
  chat is set to and writes nothing at all;
- **Grok** is on the kernel too, and keeps the same partitioning — the managed `GROK_HOME` is derived
  from that auxiliary subdirectory, so even the provider home is separate. What is built differently
  is everything the forks put in an agent definition, because Grok has none. The permission mode
  rides on the command line (`ask` for the purpose that reads, `plan` for the two that do not), so a
  change to it restarts the process rather than reconfiguring a session; and because there is no
  agent to deny a read, the purposes that read nothing are launched with **no filesystem delegate at
  all**, which the ACP handshake carries. A permission request that reaches the client anyway is
  answered with the agent's own reject option rather than a cancellation, so an inline edit is told
  no and carries on instead of being abandoned.

## Shared resources

Every provider's full inventory lives in the fixture. The recurring entries are:

| Resource | Sharing | Why it is safe |
|---|---|---|
| Provider CLI binary and user-level configuration | read-only | Both paths resolve and launch the same binary; neither writes its configuration |
| Launch artifacts and managed home | partitioned | Chat writes under `<provider>`, auxiliary under `<provider>/auxiliary/<purpose>` |
| Subprocess, transport, and session id | partitioned | The auxiliary runner owns its own; nothing is borrowed from the chat runtime |
| Provider session or thread storage | partitioned | Auxiliary work runs cold or on its own thread, never the chat session |

Providers without auxiliary execution still carry one explicit row saying so. "Nothing is shared" is
almost always an unexamined claim, and the fitness test rejects an empty list for exactly that
reason.

## What this record does not claim

The declarations above are read from code, not from live runs. Real wire traces are M0b's job: the
four topology-proof providers need theirs before the semantic freeze in M2-proofs, and each
remaining provider needs its own before its flip. Where a declaration and observed behavior
disagree, the plan requires a failing characterization test rather than an edit to the table.
