# Gemini Provider Agent Instructions

`src/providers/gemini/` adapts Gemini CLI through ACP using `gemini --acp` over stdio JSON-RPC.

## Current Scope

- Gemini is opt-in and disabled by default.
- Chat execution runs through the kernel: `GeminiExecution` (`src/providers/gemini/execution/`) owns the backend, the permission bridge and the isolated metadata session, and `ApplicationRuntime.createRuntimeFor('gemini')` reaches it through the composition. `GeminiChatRuntime` is gone — see `docs/provider-execution-migration-progress.md` for the flip.
- Per-turn prompts include Grimoire context from the active note, editor selection, browser selection, canvas selection, vault search, and project workspace.
- Model and mode discovery come from the reply to `session/new`, which answers with `models` and `modes` and no config options at all, and are stored in provider settings for the UI. Grimoire's three permission modes and the CLI's four (`default`, `autoEdit`, `yolo`, `plan`) are translated in `modes.ts`; neither set may be forwarded as the other.
- Auxiliary workflows such as title generation, instruction refinement, and inline edit are unsupported until a Gemini auxiliary runner exists.
- Plan indicators are spend-only today. `GeminiPlanUsageStore` records ACP cost when Gemini CLI reports it; daily quota remains unavailable until a reliable CLI/API source is wired.

## Boundaries

- Keep Gemini-specific runtime behavior in `src/providers/gemini/`.
- Keep protocol-generic JSON-RPC behavior in `src/providers/acp/`.
- Grimoire-owned MCP servers live in `.grimoire/mcp/gemini.json` and are injected into ACP session creation and loading. Do not rewrite Gemini's native MCP configuration.
- Gemini project skills, commands, and agents use `.gemini/skills/`, `.agents/skills/`, `.gemini/commands/**/*.toml`, and `.gemini/agents/*.md`. Use structured TOML/YAML parsing and preserve unknown fields when editing managed files.
- Prefer live ACP wire traces over guessed event shapes when expanding support.

## Launch

The runtime launches:

```bash
gemini --acp
```

Custom CLI paths are stored per host under `providerConfigs.gemini.cliPathsByHost`. If no custom path exists, Grimoire launches `gemini` from PATH.

## Session resume

- On `session/load` failure, decide with `isAcpSessionGone` rather than treating any failure as proof the session is gone. Gemini CLI reports a missing session as `-32603 Internal error` with `data.details` naming the reason, which the shared message patterns recognise; it exposes no session listing, so anything unrecognised - transport, authentication, configuration - propagates with the binding intact.
- A dropped session is recorded in `providerState.sessionDropped` and read back on load, because the in-memory flag is consumed by the first save. Never replay the transcript into a replacement session: history bootstrap is for a cold resume that never held a session id.

- **The decision is wired; the notice is not.** `ManagedAcpExecutionBackend` asks
  `isAcpSessionGone` on every failed `session/load`, so a refusal whose words say nothing
  is settled by asking the agent through `session/list`, and a session it no longer lists
  soft-fails into a fresh one. `isMissingSessionError` overrides that decision and takes
  the whole probe, so a provider adds what its own CLI says and defers to the shared
  question for everything else. What is still missing is the surface: no composition
  implements the `sessionDropped` port, so `ExecutionChatRuntimeAdapter.isSessionDropped()`
  is `false` and a conversation whose session was replaced resumes without the notice.
