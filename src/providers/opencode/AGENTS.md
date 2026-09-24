# OpenCode Provider Agent Instructions

`src/providers/opencode/` adapts OpenCode V1 through ACP and V2 through its native local API, with Grimoire-managed launch artifacts.

## Scope

- OpenCode is opt-in.
- Runtime behavior, model discovery, history parsing, launch artifacts, agent storage, command loading, and settings UI stay provider-owned.
- Shared ACP transport and session normalization belong in `src/providers/acp/`.
- `OpencodeClientFactory` selects V1 ACP or the V2 native API. Keep V2 wire adaptation in `OpencodeV2Client` and project it into the existing managed execution contract; do not add provider branches to shared chat code. See [`docs/opencode-v2-compatibility.md`](../../../docs/opencode-v2-compatibility.md).

## Rules

- Preserve OpenCode-native behavior and file formats where possible.
- Keep Grimoire internal IDs such as `grimoire-*` out of user-facing product copy.
- Do not project OpenCode provider state into generic chat UI code. Use provider helpers and shared contracts.
- When changing launch artifacts or command loading, verify against current OpenCode runtime output rather than inferred schemas.
- Plan indicators are spend-only today. `OpencodePlanUsageStore` aggregates native runtime/session cost for the current month; do not invent a cross-vendor quota window unless OpenCode exposes one.
- V2 servers must remain owned by the execution lifecycle, bound to loopback, and authenticated with an ephemeral password. Wait for managed agents and their confinement policies before opening a session. Never replace a missing Safe mode with Build.

## Session resume

- Persist `sessionId`, `providerState.databasePath`, and `providerState.sessionDropped` after turns.
- On ACP `session/load` failure, the decision belongs to `isAcpSessionGone`: it asks the agent through `session/list` rather than reading the answer out of the error text, which OpenCode does not put there. A session the agent no longer lists is soft-failed into a fresh one; anything else - transport, authentication, configuration, or an agent that cannot list - propagates with the live and persisted binding intact. Log the failure via debug and **keep** `databasePath` so SQLite hydrate and `OPENCODE_DB` still resolve.
- A dropped session is recorded in `providerState.sessionDropped` and read back on load, because the in-memory flag is consumed by the first save. Never replay the transcript into a replacement session: history bootstrap is for a cold resume that never held a session id.
- Use shared helpers in `src/providers/acp/acpSessionResume.ts` rather than inventing a fourth wipe policy.
- V2 translates native session-not-found errors into the managed missing-session contract and provides native session listing for reconciliation. Authentication and transport failures must not be converted into missing sessions. History reads support V1 `message`/`part` and V2 `session_message`/`session_v2` without rewriting either schema.

- **The decision and the notice are both wired.** `ManagedAcpExecutionBackend` asks
  `isAcpSessionGone` on every failed `session/load`, so a refusal whose words say nothing
  is settled by asking the agent through `session/list`, and a session it no longer lists
  soft-fails into a fresh one. `isMissingSessionError` overrides that decision and takes
  the whole probe, so a provider adds what its own CLI says and defers to the shared
  question for everything else. The resume outcome travels on the content
  channel, which is what reaches the tab the run belongs to, and this provider records it:
  `sessionDropped` answers the notice on every render, is written into `providerState` so
  the tab that opens the conversation next still knows, and comes back off the moment a
  resume succeeds.
