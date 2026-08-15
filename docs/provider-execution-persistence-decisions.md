# Persistence, Retention, and Redaction Decisions

The M0a decision record the migration plan requires before any kernel code lands. It settles what
the new execution lifecycle is allowed to write to a user's vault, how long it keeps it, what
happens when the user deletes a conversation, how records are versioned, and what may appear in
diagnostics.

It exists at M0a rather than at M4 for one reason: **the durable control store reaches production at
the first M2 flip, not at M4.** The first flip brings the lifecycle registry, its event ingestion,
and its control records into the running plugin. Deciding retention afterwards would mean deciding
it about data users already have.

Canon: [`provider-execution-migration-plan.md`](provider-execution-migration-plan.md). Storage
ownership is recorded in the repository's root `AGENTS.md` storage boundary table, which the first
flip updates in the same commit that creates the store.

## D1 — Where control records live

`.grimoire/control/` — Grimoire-owned, provider-neutral, one directory created at the first flip.

Provider-native transcripts, databases, session ids, branches, and history roots remain
authoritative and untouched. The control store never becomes a second transcript: it records
ownership, generations, state-machine positions, terminals, and the references needed to recover,
and nothing that duplicates what the provider already stores.

Rejected: writing control records beside session metadata in `.grimoire/sessions/`. Session metadata
is a conversation-scoped user artifact with its own compatibility promise; mixing kernel bookkeeping
into it would put both under one schema and make the revert rule in D6 unenforceable.

## D2 — What may be persisted

Permitted:

- logical ids, owner links, backend generations, session incarnations, attempts, and state-machine
  positions;
- dispatch intents, and accepted provider-native opaque identities needed for recovery;
- terminal outcomes, bounded result references, and reconciliation evidence;
- projection and conversation revisions;
- shutdown and settings-transition checkpoints.

Forbidden, without exception:

- secrets, credentials, and tokens;
- hidden reasoning;
- environment digest inputs;
- arbitrary raw protocol payloads;
- a second copy of any provider transcript;
- local shell output, which is a bounded result delivered to its projection and never written to a
  durable journal or to advanced debug logs.

The line is that a control record must be sufficient to establish *what happened and who owns it*,
and insufficient to reconstruct *what was said*.

## D3 — Retention

| Record kind | Retained until | Rationale |
|---|---|---|
| Run control records (owner, generation, state, terminal) | its owning conversation is deleted | Recovery and honest history need the terminal, not the content |
| Dispatch intents | the attempt reaches a terminal, then 7 days | An unknown dispatch must never launch again automatically; the window exists so a crash mid-dispatch is still resolvable on restart |
| Reconciliation evidence for `indeterminate` runs | its owning conversation is deleted | An indeterminate run may acquire proof later; discarding the record would make the append-only reconciliation rule unenforceable |
| Result references | its owning conversation is deleted | References, not payloads |
| Shutdown and settings-transition checkpoints | consumed at next startup, or 7 days | Purely operational |
| Agent instance and attempt records | its owning conversation is deleted | Durable work is conversation-owned until the post-migration work graph exists |

No time-based expiry other than the two 7-day operational windows. Retention is otherwise tied to
the conversation lifetime, so a user's mental model — "deleting the chat deletes its traces" — stays
true without a second retention concept to explain.

## D4 — User deletion

Deleting a conversation deletes every control record owned by it, in the same operation, including
records for runs that never reached a terminal. Deletion is idempotent and survives interruption:
it writes an intent, removes the records, then clears the intent, and a partially completed deletion
is finished on next startup rather than left half-applied.

Deletion never touches provider-native data. Removing a provider's own transcript stays the
provider history service's job through its existing deletion path, unchanged by this migration.

An active run whose conversation is deleted is cancelled through the registry first; its records are
removed once cancellation is confirmed or the run reaches `indeterminate`. Records are never removed
while a lease is held, because that would strand a live resource with no owner.

## D5 — Schema versions

Every record carries `schemaVersion`, starting at `1`.

- A record with a **known older** version migrates through explicit, idempotent steps at read time,
  and is rewritten at the next legitimate write rather than eagerly on startup.
- A record with an **unknown future** version opens read-only and surfaces a migration-required
  state. The plugin never guesses, never discards, and never downgrades a record it does not
  understand.
- Writes are atomic. Multi-record operations write an intent plus a recoverable completion marker,
  so a crash leaves either the old state or the new one, never a mixture.

## D6 — Revert safety

Control-store files must be **inert to the old runtime path**. A release that shipped a flip may be
followed by a release that reverts it, and the old path must neither read these files nor break on
their presence.

This is enforced structurally rather than by intent: the old path has no reader for
`.grimoire/control/`, and the directory's presence is not a precondition for anything the old path
does. A revert therefore leaves orphaned control records that the next flip forward reads again —
which is why D3 ties retention to conversation lifetime rather than to plugin state.

## D7 — Diagnostic redaction

Advanced debug logging (`.grimoire/logs/YYYY-MM-DD.jsonl`, written only when the user enables it)
may record control-plane facts — ids, generations, state transitions, terminals, error classes — and
must never record prompt text, provider payloads, tool inputs and outputs, local shell output,
secrets, or absolute paths outside the vault.

Error messages surfaced from providers are already normalized before display; the same normalized
form is what may be logged. Raw provider errors are not.

## D9 — Redo, and why it splits in two (open)

Rewind is settled: `ProviderRewindPort` exists as of M2-proofs 3, and Claude is the only provider
that can perform one — the other eight runtimes return `canRewind: false`. Redo is not settled,
because the word covers two features with very different costs.

**Re-run — free, and already expressible.** Running the same request again is a new run over the same
`requestRef`: the request record already carries it, and the control store already persists the run.
Every provider supports it, because it is an ordinary dispatch. No new persisted state, no new
contract, no provider capability. If redo means "regenerate this answer", it is an M2-adapter wiring
question and nothing more; this is the reading to prefer unless the product wants the other one.

**Undo-the-rewind — needs a decision, and collides with D2.** Restoring what a rewind removed needs
two things Grimoire deliberately does not keep:

- the file backup. `createClaudeRewindBackup` copies the changed files to `os.tmpdir()` and keeps
  them only long enough to roll back a rewind that *failed*; after a successful rewind they are
  discarded;
- the removed transcript. The provider deletes it, and D2 forbids "a second copy of any provider
  transcript" without exception — so the control store cannot hold it, by a rule that exists to keep
  a control record insufficient to reconstruct what was said.

So undo-the-rewind cannot be built by extending the control store. It would need a separate,
explicitly scoped rewind journal outside `.grimoire/control/`, with its own retention and its own
deletion story, and it would be Claude-only. That is a product decision about what Grimoire stores
about a user's conversation, not a migration decision, which is why it is recorded here as open
rather than answered.

## D8 — What is deliberately not decided here

- The concrete record shapes and their field names: M1, designed against the contribution inventory.
- The conversation revision model and its conflict handling: M4.
- Anything about the post-migration work graph, which has no records in this migration.

## Enforcement

`tests/unit/architecture/persistenceDecisions.test.ts` pins the decisions that can be checked
mechanically today: the storage location, that the forbidden-content list is stated, and that the
repository's storage boundary documentation gains its `.grimoire/control/` row no later than the
commit that creates the store. The rest become conformance and repository-suite obligations at M1
and M4, listed in the plan's test strategy.
