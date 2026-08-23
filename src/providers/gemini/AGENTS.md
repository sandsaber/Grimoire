# Gemini Provider Agent Instructions

`src/providers/gemini/` adapts Gemini CLI through ACP using `gemini --acp` over stdio JSON-RPC.

## Current Scope

- Gemini is opt-in and disabled by default.
- Chat execution runs through the kernel: `GeminiExecution` (`src/app/execution/gemini/`) owns the backend, the permission bridge and the isolated metadata session, and `registration.ts` points `createRuntime` at it. `GeminiChatRuntime` is gone — see `docs/provider-execution-migration-progress.md` for the flip.
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
