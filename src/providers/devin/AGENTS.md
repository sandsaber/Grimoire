# Devin Provider Agent Instructions

`src/providers/devin/` adapts Devin CLI (Cognition) through ACP using `devin acp` over stdio JSON-RPC.

## Current Scope

- Devin is opt-in and disabled by default.
- Chat execution runs through the kernel: `DevinExecution` (`src/providers/devin/execution/`) owns the backend, the permission bridge and the isolated metadata session, and `ApplicationRuntime.createRuntimeFor('devin')` reaches it through the composition.
- Per-turn prompts include Grimoire context from the active note, editor selection, browser selection, canvas selection, vault search, and project workspace.
- Model and mode discovery come from the `configOptions` in the reply to `session/new` and `session/load`. **The session is the source, not `devin models list`**: that command lists what an account could be configured to use, while the ACP session offers only what it will take, and `session/set_config_option` answers `-32002 Model not found` for anything else. Different accounts offer different lists; that is expected.
- Modes: `accept-edits` (Code, the default), `smart`, `ask`, `plan`, `bypass`. Grimoire's Safe maps to `accept-edits`, Auto-approve to `bypass`, Plan to `plan`. In `accept-edits` Devin auto-approves file writes and asks only for shell commands; what makes it safe is that every write goes through the client's `fs/write_text_file`, where `AcpWorkspaceFileSystem` asks the tab. The mode a session *reports when it opens* is recorded and never adopted: only a `current_mode_update` moves the toolbar.
- Permission requests carry no title, kind or `rawInput`. A shell command has `toolCall._meta["cognition.ai/editableCommand"]`; a plan exit or an edit in Plan mode has the id alone. The `tool_call` update with the same id always precedes the request (observed 2026-09-09), so the composition remembers the last sixty-four and the bridge reads title, kind and diff path from it. Six options are offered for a command (`allow_once`, four `allow_always` variants, `reject_once`), three for a plan exit (`plan_accept_edits`, `plan_bypass`, `reject_once`); the shared decision mapping picks the first of a kind.
- Plan mode writes the plan to `~/.devin/plans/<id>.md` through `fs/write_text_file`. `DevinAcpFileSystem` reads and writes that directory directly, without containment or approval: it is Devin's state, not the vault's. Devin then asks to exit Plan mode; in Plan mode a vault edit is a permission request too.
- **Safe mode ceiling.** Devin classifies some commands as read-only by name and runs them unasked — `echo no > file` is one, `printf` asks. Told no on a write, it wrote the file with `echo`. The fix is ACP terminal delegation, which no provider drives yet; see `modes.ts`.
- The context window rides on `usage_update` (`used`, `size`). `_meta["cognition.ai/totalCreditCost"]` beside it is a running total for the session; the presenter feeds the spend store the difference since the last total it saw, and the first total a session reports is a baseline, not a charge. `totalAcuCost` and the token detail under `cognition.ai/*` are not read.
- `_cognition.ai/*` notifications (`output`, `agent_stopped`, `thinking_complete`, `mcp/serversChanged`) are ignored by the transport. `session_info_update` is ignored by the normalizer.
- No reasoning control, no question interaction, no agent definitions, no command files: see `DevinProviderModule` for why each is declared absent.
- Auxiliary workflows such as title generation, instruction refinement, and inline edit are unsupported until a Devin auxiliary runner exists.
- Plan indicators are spend-only. `DevinPlanUsageStore` records ACP cost when the CLI reports it; account quota is not inferred.

## Boundaries

- Keep Devin-specific runtime behavior in `src/providers/devin/`.
- Keep protocol-generic JSON-RPC behavior in `src/providers/acp/`.
- Grimoire-owned MCP servers live in `.grimoire/mcp/devin.json` and are injected into ACP session creation and loading. Devin's own `~/.config/devin/mcp_config.json` is read by the CLI and never touched; `mcpCapabilities` says stdio only.
- Devin project skills use `.devin/skills/*/SKILL.md`; the CLI also scans `.agents/skills` and `.cognition/skills`. A skill is a slash command — there is no separate command file format.
- Authentication is `devin auth login` (browser). Credentials in `~/.local/share/devin/credentials.toml` remain Devin-owned.
- Prefer live ACP wire traces over guessed event shapes when expanding support.

## Launch

```bash
devin acp
```

`RUST_LOG=warn` is set unless the environment already carries one: the CLI writes INFO tracing to stderr on every dispatch. Custom CLI paths are stored per host under `providerConfigs.devin.cliPathsByHost`; otherwise `devin` is resolved from PATH, then `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`.

## Session resume

- `session/load` replays the transcript as `user_message_chunk`, `agent_message_chunk`, `tool_call` and `tool_call_update` before answering. Grimoire keeps its own projection and does not read the replay back.
- A missing session answers `-32016 "Session not found"` with `data["cognition.ai/errorKind"] = "session_not_found"`; `isAcpMissingSessionError` recognises the message, and `session/list` is also answered, so both halves of `isAcpSessionGone` are available. A dropped session is recorded in `providerState.sessionDropped` and read back on load.
