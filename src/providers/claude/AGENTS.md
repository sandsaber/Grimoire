# Claude Provider Agent Instructions

`src/providers/claude/` wraps `@anthropic-ai/claude-agent-sdk` behind Grimoire's execution kernel — `ClaudeExecutionBackend`, presented by `ExecutionChatRuntimeAdapter` — and maintains Claude Code-compatible vault files.

## Runtime Rules

- Preserve provider-native SDK semantics before adding Grimoire-side behavior.
- Persistent query stays alive across turns when possible. Restart only when effective prompt, disabled tools, plugin set, settings source set, CLI path, Chrome enablement, or external context paths require it.
- Dynamic changes such as model, permission mode, MCP servers, and effort level should use SDK update APIs when supported.
- `createCustomSpawnFunction()` works around Obsidian/Electron process issues. Be careful with Node path resolution and AbortSignal realms.

## Stream and History Gotchas

- The SDK can deliver assistant text twice: streamed deltas and complete assistant messages. Keep deduplication based on whether stream text was seen.
- Usage combines assistant-message input counts with result-message context-window authority. Do not aggregate subagent usage into main-agent context usage.
- Plan indicators come from `ClaudePlanUsageStore`: SDK `rate_limit_event` windows, optional `.grimoire/claude/statusline-usage.json`, and SDK result `modelUsage` cost. Keep quota windows and spend as separate readouts when both exist.
- SDK amnesia is detected when the returned session ID differs from the requested resume ID. The next turn may need full conversation history injection.
- Forks legitimately return new session IDs. Do not treat the first fork session init as amnesia.
- SDK session files are tree-structured. Rewind and re-prompt create branches; branch filtering must preserve tool results belonging to retained ancestors.

## Storage Rules

- `.claude/settings.json` is Claude Code-compatible. Grimoire manages permissions but must preserve Claude CLI-owned fields.
- `.claude/mcp.json` stores CLI-compatible `mcpServers` plus Grimoire metadata in `_grimoire.servers`.
- Grimoire reads Claude Code plugin discovery state but does not write plugin enablement. Users manage Claude plugins through Claude CLI.
- Slash command IDs use reversible encoding: dashes as `-_`, slashes as `--`.

## Known Exceptions

- `DISABLED_BUILTIN_SUBAGENTS = ['Task(statusline-setup)']` because the statusline setup agent has no meaning in Obsidian.
- `EnterPlanMode` is auto-approved by the SDK and never reaches `canUseTool`; `ExitPlanMode` does go through approval.
