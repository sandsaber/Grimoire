# Execution data lifecycle

Status: accepted for the execution-platform migration.

## Durable ownership

Provider-native transcripts remain authoritative and are never copied into the
execution control store. Grimoire persists only identities, lifecycle state,
dispatch evidence, interaction state, bounded result references, revisions,
and recovery checkpoints required to own work safely.

Active, disconnected, recovering, cancelling, and indeterminate records are
retained until recovery or explicit user deletion resolves their ownership.
Terminal control records may be compacted after their conversation projection,
result references, and reconciliation evidence are durably committed. Agent
results and work-graph decisions follow the owning conversation or user-created
task rather than a time-only deletion policy.

## Deletion

Deleting a Grimoire conversation removes its Grimoire-owned projection,
execution control records, work graph, agent instances, and result references
through one recoverable deletion intent. Provider-native history is deleted
only through an explicit provider operation whose outcome is recorded; it is
never removed as an implicit side effect of deleting a projection.

Unknown dispatch outcomes are not automatically retried or discarded. User
deletion may hide them only after the application records that recovery and
reattachment are no longer requested.

## Schemas and recovery

Every durable envelope has a positive `schemaVersion` and record revision.
Known older versions migrate idempotently. Unknown future versions open
read-only, remain byte-preserved, and surface a migration-required state. A
multi-record mutation writes an intent before effects and an idempotent
completion marker after every required record is durable.

Lifecycle schemas begin with the execution aggregate, and work/agent/result
schemas begin with those aggregates. The shared persistence substrate does not
predict their domain fields in advance.

## Diagnostics and redaction

Lifecycle diagnostics contain stable Grimoire test or product identities,
normalized timestamps, state transitions, bounded error classes, and opaque
native correlation IDs only when recovery requires them. They exclude prompts,
hidden reasoning, environment values or digest inputs, secrets, personal paths,
arbitrary protocol payloads, and local shell output. Advanced debug logging
uses the same allowlist and never weakens these storage rules.
