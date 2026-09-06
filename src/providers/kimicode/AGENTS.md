# Kimi Code Provider Agent Instructions

`src/providers/kimicode/` adapts Kimi Code CLI through ACP and Grimoire-managed launch artifacts.

## Scope

- Kimi Code is opt-in.
- Runtime behavior, model discovery, history parsing, launch artifacts, agent storage, command loading, and settings UI stay provider-owned.
- Shared ACP transport and session normalization belong in `src/providers/acp/`.

## Rules

- Preserve Kimi Code-native behavior and file formats where possible.
- Keep Grimoire internal IDs such as `grimoire-*` out of user-facing product copy.
- Do not project Kimi Code provider state into generic chat UI code. Use provider helpers and shared contracts.
- When changing launch artifacts or command loading, verify against current Kimi Code runtime output rather than inferred schemas.
- Plan indicators are spend-only today. `KimicodePlanUsageStore` aggregates ACP/session cost for the current month; do not invent a cross-vendor quota window unless Kimi Code exposes one.

## Session resume

- Persist `sessionId`, `providerState.databasePath`, and `providerState.sessionDropped` after turns.
- On `session/load` failure, decide with `isAcpSessionGone`: it asks the agent through `session/list` rather than reading the answer out of the error text, which Kimi Code does not put there. A session the agent no longer lists is soft-failed into a fresh one; anything else - transport, authentication, configuration, or an agent that cannot list - propagates with the binding intact. Preserve `databasePath`.
- A dropped session is recorded in `providerState.sessionDropped` and read back on load, because the in-memory flag is consumed by the first save. Never replay the transcript into a replacement session: history bootstrap is for a cold resume that never held a session id.

- **The decision is wired; the notice is not.** `ManagedAcpExecutionBackend` asks
  `isAcpSessionGone` on every failed `session/load`, so a refusal whose words say nothing
  is settled by asking the agent through `session/list`, and a session it no longer lists
  soft-fails into a fresh one. `isMissingSessionError` overrides that decision and takes
  the whole probe, so a provider adds what its own CLI says and defers to the shared
  question for everything else. What is still missing here is the surface: this
  provider implements no `sessionDropped` port, so a conversation whose session was
  replaced resumes without the notice. OpenCode and MiMoCode are wired; this one is not.
