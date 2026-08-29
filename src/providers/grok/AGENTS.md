# Grok Build Provider Agent Instructions

`src/providers/grok/` adapts xAI Grok Build CLI through ACP and Grimoire-managed launch artifacts.

## Scope

- Grok Build is opt-in.
- Runtime behavior, model discovery, history parsing, launch artifacts, agent storage, command loading, and settings UI stay provider-owned.
- Shared ACP transport and session normalization belong in `src/providers/acp/`.

## Rules

- Preserve Grok Build-native behavior and file formats where possible.
- Launch Grok with `grok agent stdio`, not the `acp` subcommand used by other providers.
- Use `GROK_HOME` for Grimoire-managed launch artifacts under `.grimoire/grok/`.
- Resolve CLI paths from per-host settings only; fall back to the `grok` command on `PATH` when no configured binary exists.
- Keep auth and session discovery env-driven (`GROK_AUTH_PATH`, `GROK_HOME` in provider env vars). When Grimoire redirects `GROK_HOME` to `.grimoire/grok/`, bridge auth with `GROK_AUTH_PATH` resolved from provider env plus process env, not from the managed home path.
- Grok sessions persist as JSONL under `<GROK data dir>/sessions/`; history hydration still needs runtime discovery before it can replace the scaffold store.
- Do not project Grok provider state into generic chat UI code. Use provider helpers and shared contracts.
- When changing launch artifacts or command loading, verify against current Grok Build runtime output rather than inferred schemas.
- Refresh the Grok model catalog from live `grok models` whenever the chat picker or settings catalog asks. Do not TTL-skip that path; join an in-flight CLI refresh instead.
- Plan indicators prefer the Grok-native `x.ai/billing` ACP extension and its unified weekly or monthly usage window. The authenticated billing endpoint and legacy credits protobuf remain compatibility fallbacks. `GrokPlanUsageStore` still aggregates ACP/session/API-key spend for the current month when cost data exists.

## Session resume

- On `session/load` failure, decide with `isAcpSessionGone`. Grok Build answers a session it no longer has with a bare `-32603 Path not found` (`FS_NOT_FOUND`), which no error-text rule can tell apart from an auth or configuration failure - but it advertises `sessionCapabilities.list` and answers `session/list`, so the listing is the reliable answer. A session the agent no longer lists is soft-failed into a fresh one; anything else - transport, authentication, configuration, or an agent that cannot list - propagates with the binding intact. Preserve session and workspace paths.
- A dropped session is recorded in `providerState.sessionDropped` and read back on load, because the in-memory flag is consumed by the first save. Never replay the transcript into a replacement session: history bootstrap is for a cold resume that never held a session id.

- **Not wired on the kernel path yet.** `isAcpSessionGone` has no caller in `src/`:
  `ManagedAcpExecutionBackend` still classifies a failed `session/load` with the
  text-matching `isAcpMissingSessionError`, and the seam it would plug into
  (`isMissingSessionError`) is a synchronous predicate while the helper is `async`.
  So a `session/load` that answers a bare `Internal error` still fails the turn rather
  than soft-failing into a fresh session. The bullet above describes the intended
  behaviour, not this branch's — see the `main` sync entry in the migration journal.
