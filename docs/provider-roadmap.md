# Provider Roadmap

This file tracks future provider integrations and the implementation sequence for agents working on Grimoire. It is not a promise that every listed provider is ready to ship; each provider still needs current runtime discovery before code is written.

> **Architecture status.** The canonical execution architecture and its replacement sequence are
> defined in [`provider-execution-migration-plan.md`](provider-execution-migration-plan.md) (with
> reasoning in [`provider-architecture-research.md`](provider-architecture-research.md)). This
> roadmap describes the **current, pre-migration** integration path. The checklist below produces a
> `registration.ts` + `*ChatRuntime` provider — code the migration's M2 milestone deletes. Once the
> plan's M0a checkpoint lands, the old runtime path is frozen for new product features: do not add
> methods to `ChatRuntime`, and a new provider integration either waits for the presentation seam
> or implements an execution backend per the plan's "Adding a provider" rules. Check
> [`provider-execution-migration-progress.md`](provider-execution-migration-progress.md) for the
> current milestone before starting provider work.

## Provider Implementation Checklist

1. Capture the current CLI/runtime behavior first.
   - Record the startup command, auth model, model-listing surface, session lifecycle, cancellation behavior, tool events, usage/cost metadata, and transcript/history format.
   - Prefer real wire traces and local runtime output over inferred schemas.
2. Decide the adapter boundary.
   - Use `src/providers/acp/` only for protocol-generic ACP behavior shared by at least two providers.
   - Keep provider-specific launch specs, settings, history parsing, model discovery, and UI config inside `src/providers/<provider>/`.
3. Add the provider-owned contracts together.
   - `registration.ts`
   - `capabilities.ts`
   - `settings.ts`
   - `models.ts` or model discovery state
   - `ui/*ChatUIConfig.ts`
   - runtime and launch environment
   - workspace services
   - plan usage provider, even if the initial implementation only returns `null`
4. Keep storage boundaries explicit.
   - Use provider-native files only when preserving CLI compatibility.
   - Use `.grimoire/<provider>/` for Grimoire-owned data.
   - Do not add legacy migrations unless a migration milestone explicitly asks for them.
5. Add focused tests before broad release work.
   - Provider registration and default enablement
   - Settings projection and normalization
   - Runtime launch spec and cancellation
   - Stream/tool normalization
   - History hydration
   - Usage/cost indicator behavior

## Current Integration Notes

- Claude Code, Codex, OpenCode, MiMoCode, Kimi Code, Grok Build, and Qwen Code are current integrations. Their runtime capabilities differ, but each has a registered provider adapter; OpenCode, MiMoCode, Kimi Code, Grok Build, and Qwen Code use ACP-based runtime paths where their CLI supports them.
- Antigravity CLI and Gemini CLI (Legacy) are current Google integrations with more limited runtime surfaces. Keep Antigravity as the recommended Google path and Gemini only for legacy-compatible accounts; treat provider-specific enhancements as runtime-limited until their CLIs expose richer event streams, safer approval flows, and stronger session/tool metadata.
- Context visibility should stay provider-neutral. The Context tab should show both user-pinned files and provider runtime file loads when Grimoire can infer them from tool events, while avoiding provider-specific assumptions in shared feature code.

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

## Other Candidates

- Google consumer provider work should extend `src/providers/antigravity/`; Antigravity CLI is Grimoire's recommended Google provider. Keep `src/providers/gemini/` available only for legacy Gemini CLI compatibility with Standard, Enterprise, Google Cloud, and paid API-key users. Both Google providers should receive the same Grimoire per-turn context shape (active note, editor/browser/canvas selections, vault search, and project workspace), even though Antigravity currently carries it through `agy --print` and Gemini carries it through ACP prompt blocks. Until AGY exposes an approval-capable runtime, keep Antigravity Safe/normal mode fail-closed and launch `agy --print` only from explicit Auto-approve/full-access mode.
- GitHub Copilot CLI: validate whether it exposes a stable agentic CLI/runtime surface suitable for non-interactive Obsidian embedding.
- Additional ACP providers: prefer shared ACP helpers only after confirming event compatibility with OpenCode and any confirmed ACP provider.
- Local model CLIs: treat as a separate milestone because tool execution, files, and usage indicators usually differ from hosted provider CLIs.
