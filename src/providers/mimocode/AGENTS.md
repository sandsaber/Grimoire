# MiMoCode Provider Agent Instructions

`src/providers/mimocode/` adapts MiMoCode through ACP and Grimoire-managed launch artifacts.

## Scope

- MiMoCode is opt-in.
- Runtime behavior, model discovery, history parsing, launch artifacts, agent storage, command loading, and settings UI stay provider-owned.
- Shared ACP transport and session normalization belong in `src/providers/acp/`.

## Rules

- Preserve MiMoCode-native behavior and file formats where possible.
- Keep Grimoire internal IDs such as `grimoire-*` out of user-facing product copy.
- Do not project MiMoCode provider state into generic chat UI code. Use provider helpers and shared contracts.
- When changing launch artifacts or command loading, verify against current MiMoCode runtime output rather than inferred schemas.
- Plan indicators are spend-only today. `MimocodePlanUsageStore` aggregates ACP/session cost for the current month; do not invent a cross-vendor quota window unless MiMoCode exposes one.

## Session resume

- Persist `sessionId`, `providerState.databasePath`, and `providerState.sessionDropped` after turns.
- On `session/load` failure, decide with `isAcpSessionGone`: it asks the agent through `session/list` rather than reading the answer out of the error text, which MiMoCode does not put there. A session the agent no longer lists is soft-failed into a fresh one; anything else - transport, authentication, configuration, or an agent that cannot list - propagates with the binding intact. Preserve `databasePath`.
- A dropped session is recorded in `providerState.sessionDropped` and read back on load, because the in-memory flag is consumed by the first save. Never replay the transcript into a replacement session: history bootstrap is for a cold resume that never held a session id.

- **Not wired on the kernel path yet.** `isAcpSessionGone` has no caller in `src/`:
  `ManagedAcpExecutionBackend` still classifies a failed `session/load` with the
  text-matching `isAcpMissingSessionError`, and the seam it would plug into
  (`isMissingSessionError`) is a synchronous predicate while the helper is `async`.
  So a `session/load` that answers a bare `Internal error` still fails the turn rather
  than soft-failing into a fresh session. The bullet above describes the intended
  behaviour, not this branch's — see the `main` sync entry in the migration journal.
