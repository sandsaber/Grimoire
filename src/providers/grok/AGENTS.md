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
