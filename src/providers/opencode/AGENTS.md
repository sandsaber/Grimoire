# OpenCode Provider Agent Instructions

`src/providers/opencode/` adapts OpenCode through ACP and Grimoire-managed launch artifacts.

## Scope

- OpenCode is opt-in.
- Runtime behavior, model discovery, history parsing, launch artifacts, agent storage, command loading, and settings UI stay provider-owned.
- Shared ACP transport and session normalization belong in `src/providers/acp/`.

## Rules

- Preserve OpenCode-native behavior and file formats where possible.
- Keep Grimoire internal IDs such as `grimoire-*` out of user-facing product copy.
- Do not project OpenCode provider state into generic chat UI code. Use provider helpers and shared contracts.
- When changing launch artifacts or command loading, verify against current OpenCode runtime output rather than inferred schemas.
- Plan indicators are spend-only today. `OpencodePlanUsageStore` aggregates ACP/session cost for the current month; do not invent a cross-vendor quota window unless OpenCode exposes one.

## Session resume

- Persist `sessionId`, `providerState.databasePath`, and `providerState.sessionDropped` after turns.
- On ACP `session/load` failure, decide with `isAcpSessionGone`: it asks the agent through `session/list` rather than reading the answer out of the error text, which OpenCode does not put there. A session the agent no longer lists is soft-failed into a fresh one; anything else - transport, authentication, configuration, or an agent that cannot list - propagates with the live and persisted binding intact. Log the failure via debug and **keep** `databasePath` so SQLite hydrate and `OPENCODE_DB` still resolve.
- A dropped session is recorded in `providerState.sessionDropped` and read back on load, because the in-memory flag is consumed by the first save. Never replay the transcript into a replacement session: history bootstrap is for a cold resume that never held a session id.
- Use shared helpers in `src/providers/acp/acpSessionResume.ts` rather than inventing a fourth wipe policy.
