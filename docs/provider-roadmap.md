# Provider Roadmap

This file tracks future provider integrations and the implementation sequence for agents working on Grimoire. It is not a promise that every listed provider is ready to ship; each provider still needs current runtime discovery before code is written.

> **Architecture.** A provider is **declared once** in `src/providers/BuiltInProviderCatalog.ts`
> and implements an **execution backend** that the kernel drives, presented to chat surfaces by
> `ExecutionChatRuntimeAdapter`; its workspace slots come from
> `ApplicationRuntime.workspaceFor(providerId)`. What the kernel guarantees a surface, and what a
> backend must therefore provide, is in
> [`provider-execution-adapter-contract.md`](provider-execution-adapter-contract.md); what the kernel
> may write to a vault is in
> [`provider-execution-persistence-decisions.md`](provider-execution-persistence-decisions.md).
>
> The checklist below is the **shape**, not the wiring: what a provider must decide and record
> before code is written.

## Provider Implementation Checklist

1. Capture the current CLI/runtime behavior first.
   - Record the startup command, auth model, model-listing surface, session lifecycle, cancellation behavior, tool events, usage/cost metadata, and transcript/history format.
   - Prefer real wire traces and local runtime output over inferred schemas.
2. Decide the adapter boundary.
   - Use `src/providers/acp/` only for protocol-generic ACP behavior shared by at least two providers.
   - Keep provider-specific launch specs, settings, history parsing, model discovery, and UI config inside `src/providers/<provider>/`.
3. Add the provider-owned contracts together.
   - a `*ProviderModule.ts` declaration, and its row in `BuiltInProviderCatalog`
   - `capabilities.ts`
   - `settings.ts`, with its codec on the module
   - `models.ts` or model discovery state
   - `ui/*ChatUIConfig.ts`
   - an execution backend and its composition, under `execution/`
   - a content presenter, where the provider says anything the surface must draw
   - workspace services
   - plan usage provider, even if the initial implementation only returns `null`
4. Keep storage boundaries explicit.
   - Use provider-native files only when preserving CLI compatibility.
   - Use `.grimoire/<provider>/` for Grimoire-owned data.
   - Do not add legacy migrations unless a release explicitly asks for them.
5. Add focused tests before broad release work.
   - the catalog declaration and default enablement
   - settings projection and normalization
   - launch spec and cancellation
   - stream/tool normalization
   - history hydration
   - usage/cost indicator behavior
   - **the wiring, not only the module.** A provider's helper can be complete,
     tested and called by nothing: assert on what the backend is launched with
     and what chunks a tab receives, which is the one thing a module test cannot
     say. Every wiring defect found so far had green module tests.

## Current Integration Notes

- Command Code is an opt-in headless integration. It uses NDJSON over a process per turn, with explicit native session resume, rather than ACP.

- Claude Code, Codex, OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, and Reasonix are current integrations. Their runtime capabilities differ, but each has a registered provider adapter; OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, and Reasonix use ACP-based runtime paths where their CLI supports them.
- Antigravity CLI and Gemini CLI (Legacy) are current Google integrations with more limited runtime surfaces. Keep Antigravity as the recommended Google path and Gemini only for legacy-compatible accounts; treat provider-specific enhancements as runtime-limited until their CLIs expose richer event streams, safer approval flows, and stronger session/tool metadata.
- Context visibility should stay provider-neutral. The Context tab should show both user-pinned files and provider runtime file loads when Grimoire can infer them from tool events, while avoiding provider-specific assumptions in shared feature code.

## Integrated Provider: Command Code

Verified against installed `command-code 1.53.0` on 2026-09-13:

- Launch: `command-code --print --output-format json --skip-onboarding --no-auto-update`, with the prompt on stdin and the local vault as cwd. A selected model adds `--model`; a conversation resumes only its saved ID through `--resume`, never the global latest session.
- `event` envelopes carry text deltas, tool lifecycle updates and model usage. Only a final `result` with `subtype: success`, a required answer, and confirmed process exit completes a chat turn. A `max_turns` result is a failure even when text was streamed. The transcript in `run_end.nextState` is never forwarded or persisted in lifecycle control records.
- The execution kernel owns chat runs and process-tree cancellation. Grimoire stores the rendered conversation and native session ID; Command Code owns authentication, configuration, transcripts, skills and MCP. Deleting a Grimoire conversation does not delete the CLI transcript.
- Effort metadata is read per selected model through an invalid `--effort grimoire-probe` validation with empty stdin; it exits before inference and config writes. A temporary `--mod` calls the native session-scoped `cmd.setEffort`, because a valid `--effort` writes global user config in CLI 1.53.0. Grimoire checks the effective effort reported by `model_request_end`. CLI default leaves native resume semantics intact. In the 1.53.0 catalog, validation succeeded for all 70 models: 44 offered adjustable levels, while all three free models reported none.
- Models come from `--list-models`; IDs stay opaque. Reported input tokens include cache reads. Context windows are estimates unless the user supplies a custom limit; account quotas and prices are not inferred.
- **Safe** uses a Grimoire-owned, per-run approval bridge over private local IPC and a native mod. A Node launcher installs a synchronous execution guard before importing the verified 1.53.0 CLI. The print gate is lifted with `--yolo`, but each non-read tool must receive a one-time UI approval; missing or skipped hooks stop the process before tool execution. Native deny and ask rules still apply. Native subagents are blocked in Safe because their loops do not inherit the guard hooks. **Auto-approve** uses native `--yolo` without Grimoire prompts. Interactive questions remain unsupported.
- Images, plan controls, slash commands, managed MCP/skills/agents, auxiliary execution, fork, rewind, steering, and transcript hydration are outside this initial adapter.

Evidence: `tests/fixtures/commandcode/headless.ndjson` retains sanitized observed tool/usage/result frames. Unit tests run the shared execution conformance contract. The opt-in `CommandcodeChatProjectionLiveSmoke.integration.test.ts` drives the actual chat projection, reads a synthetic vault file, persists the conversation, reloads the kernel, and verifies native recall in the same session. Run it with `GRIMOIRE_COMMANDCODE_LIVE=1`; it requires an authenticated CLI and explicitly selects the free `poolside/laguna-s-2.1-free` model. Add `GRIMOIRE_COMMANDCODE_PAID_EFFORT_LIVE=1` to explicitly opt into DeepSeek V4 Flash and verify high-to-max effort changes across reload; this makes paid requests.

References: [headless mode](https://commandcode.ai/docs/headless), [CLI reference](https://commandcode.ai/docs/reference/cli).

## Integrated Provider: Qwen Code

Current integration:

- Qwen Code is opt-in and owns its runtime, settings, model discovery, history boundary, and UI under `src/providers/qwen/`.
- Grimoire launches `qwen --acp` and reuses `src/providers/acp/` for the standard JSON-RPC transport and session update normalization.
- Models and ACP modes are discovered from live sessions. Raw model identifiers remain opaque provider-owned values instead of a duplicated static catalog.
- Qwen's `default`, `yolo`, and `plan` modes map to Grimoire's Safe, Auto-approve, and Plan controls. Other Qwen automatic modes remain conservative in the shared Grimoire projection.
- Provider-native session IDs are persisted for resume. Messages, tool activity, plan updates, commands, model/mode changes, and usage are normalized when Qwen emits them.
- Qwen ACP permission choices are mapped to Grimoire's approval surface; structured `AskUserQuestion` requests use the shared inline question UI with single-select, multi-select, and freeform answers. Delegated file access remains workspace-confined outside Auto-approve mode.
- The Qwen effort picker exposes Low, Medium, High, XHigh, and Max (High by default). Grimoire sends `/effort <tier>` before a normal turn and caches it per session; supported effective tiers remain model- and provider-dependent.

Current boundaries:

- Authentication and configuration remain owned by Qwen Code. Configure it through the CLI, `~/.qwen/settings.json`, or Qwen-owned environment variables before refreshing models or starting a chat.
- Grimoire manages an isolated Qwen project MCP list in `.grimoire/mcp/qwen.json` and injects it into ACP sessions without reconciling Qwen's native CLI configuration. Fork and rewind workflows remain unsupported.
- Token or spend indicators depend on optional ACP usage updates. Qwen account quotas are not inferred when the CLI does not report them.

## Integrated Provider: Devin

Current integration (#108):

- Devin is opt-in and owns its runtime, settings, model discovery, and UI under `src/providers/devin/`. It is Qwen's shape minus the three Qwen-only pieces: no `/effort` prompt, no `context_usage` vendor request, no ask-user-question.
- Grimoire launches `devin acp` with `RUST_LOG=warn` and reuses `src/providers/acp/` for transport and session update normalization. The wire recording is `tests/fixtures/provider-traces/wire/devin-wire.json` (`devin 3000.6.14`, 2026-09-09, complete).
- Models and modes come from the `configOptions` in `session/new`, and are set back through `session/set_config_option`; `session/set_model` answers `-32601`. What the session offers depends on the account, which is expected — `devin models list` is not the source.
- Modes `accept-edits`, `smart`, `ask`, `plan`, `bypass` map Safe → `accept-edits`, Auto-approve → `bypass`, Plan → `plan`. Safe is made safe by the ACP write delegate, not by the mode; see the ceiling in `src/providers/devin/modes.ts`.
- Permission requests carry only `toolCall._meta["cognition.ai/editableCommand"]`; six options are offered.
- Resume is native: `session/load` replays the transcript, a missing session answers `-32016 Session not found`, and `session/list` is available.

Current boundaries:

- Authentication is `devin auth login`; credentials stay Devin-owned.
- Skills are read from `.devin/skills` and `.agents/skills`; a skill is Devin's slash command, and there is no command file or agent file for Grimoire to manage.
- Plan indicators are spend-only. Auxiliary execution (titles, refinement, inline edit) is not wired.

## Integrated Provider: Reasonix

Current integration (#180):

- Reasonix is opt-in and owns its runtime, settings, model discovery, and UI under `src/providers/reasonix/`. It is Devin's shape, minus the tool-call memory that provider needs, plus a vendor notification for the tokens.
- Grimoire launches `reasonix acp` and reuses `src/providers/acp/` for transport and session update normalization. The wire recording is `tests/fixtures/provider-traces/wire/reasonix-wire.json` (`reasonix v1.38.3`, 2026-09-09, complete), and two probes of the same day drove a tool-using turn and a Plan turn.
- Models and modes arrive in ACP's own vocabulary: `session/new` answers with `models`, `modes` (`normal`, `plan`, `goal`) and `configOptions` (`model`, `effort`, `tool_approval`, `quality_floor`). Both `session/set_model` and `session/set_mode` are answered; the model goes through the config option because it reports back what the session holds.
- **One Grimoire mode is two calls.** The session mode and the approval posture are separate axes, so Safe is `normal` + `tool_approval: ask`, Plan is `plan` + `ask`, and Auto-approve is `normal` + `yolo`. Because Safe and Auto-approve share that mode, two things follow: a reported `normal` must never demote somebody out of Auto-approve, and a refused posture must fail the turn rather than be reported, since it is the only thing separating the two.
- Permission requests carry `title`, `kind`, `rawInput`, `locations` and usually `_meta["reasonix.io"]`, so the bridge needs no tool-call memory. Three of the four probed shapes arrive as `kind: "other"`, so what tells them apart is `_meta.tool` and the fields of `rawInput`, never the kind. The `ask` tool arrives here too, with N answers and no `_meta`.
- Reasonix sends no `usage_update`. `ReasonixSessionNotifications` turns `_reasonix.io/session/status_update` into one, with the turn's tokens under `_meta` and no context-window size, because the status states none.
- Resume is native: `session/load` replays the transcript and answers with the same discovery `session/new` gives; a missing session answers `-32602 "session/load: unknown session <id>"`, which `isAcpMissingSessionError` recognises.

Current boundaries:

- Authentication and model configuration are `reasonix setup` and `~/.reasonix/config.toml`; API keys are named by `api_key_env` and read from the environment.
- Skills are read from `.reasonix/skills` and `.agents/skills`. `.reasonix/commands/*.md` are slash commands the CLI reads and Grimoire does not manage; the session announces whatever they define.
- Reasoning effort is driven, and discovered: the levels a model takes come from the session's `effort` config option, because the provider block serving the model decides them. The picker heads them with `auto`, and a level the session did not offer is never sent.
- Not driven yet, each a separate piece of work: `_reasonix.io/session/steer`, and image attachments the handshake declares unsupported.
- Plan indicators are spend-only, and a turn is priced only when the configured model provider has a price.

## Other Candidates

- Google consumer provider work should extend `src/providers/antigravity/`; Antigravity CLI is Grimoire's recommended Google provider. Keep `src/providers/gemini/` available only for legacy Gemini CLI compatibility with Standard, Enterprise, Google Cloud, and paid API-key users. Both Google providers should receive the same Grimoire per-turn context shape (active note, editor/browser/canvas selections, vault search, and project workspace), even though Antigravity currently carries it through `agy --print` and Gemini carries it through ACP prompt blocks. Until AGY exposes an approval-capable runtime, keep Antigravity Safe/normal mode fail-closed and launch `agy --print` only from explicit Auto-approve/full-access mode.
- GitHub Copilot CLI: validate whether it exposes a stable agentic CLI/runtime surface suitable for non-interactive Obsidian embedding.
- Additional ACP providers: prefer shared ACP helpers only after confirming event compatibility with OpenCode and any confirmed ACP provider.
- Local model CLIs: treat as a separate milestone because tool execution, files, and usage indicators usually differ from hosted provider CLIs.
