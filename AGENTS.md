# Agent Instructions

Grimoire is a private, pre-release Obsidian plugin that embeds agentic CLI assistants in a vault-native workspace. It is not a standalone CLI. The plugin shell must stay provider-neutral while provider adapters wrap external tools such as Claude Code, Codex, OpenCode, Qwen Code, and Antigravity CLI.

Repository documentation and user-facing product copy should be in English unless the task explicitly targets localized UI text.

## Instruction Layout

- `AGENTS.md` is the canonical shared instruction file for coding agents.
- `CLAUDE.md` files exist so Claude Code can load the same instructions. They should import the nearest `AGENTS.md` and contain only Claude-specific additions.
- Keep root instructions durable. Put path-specific details in nested `AGENTS.md` files next to the code they govern.
- If a design handoff directory is named by the user, treat it as the source of truth for that task. Keep temporary handoff/debug artifacts untracked unless the user explicitly asks to commit them.

## Provider Directories

- `src/providers/claude/` - Claude Code SDK adapter and Claude-compatible vault files.
- `src/providers/codex/` - Codex app-server adapter and Codex-owned workspace services.
- `src/providers/antigravity/` - Antigravity CLI print-mode adapter and Google's official Gemini CLI replacement.
- `src/providers/gemini/` - Legacy Gemini CLI ACP adapter and Google-owned runtime, history, settings, and UI behavior.
- `src/providers/grok/` - Grok Build ACP adapter and xAI-owned runtime, history, settings, and UI behavior.
- `src/providers/opencode/` - OpenCode ACP adapter and launch/workspace artifacts.
- `src/providers/mimocode/` - MiMoCode ACP adapter and launch/workspace artifacts.
- `src/providers/kimicode/` - Kimi Code ACP adapter and launch/workspace artifacts.
- `src/providers/qwen/` - Qwen Code ACP adapter and Qwen-owned runtime, history, settings, and UI behavior.
- `src/providers/acp/` - Shared ACP transport and normalization helpers.

Read the nested `AGENTS.md` in a provider directory before changing provider-specific runtime, storage, history, settings, or UI behavior.
OpenCode and MiMoCode intentionally mirror each other closely; when changing launch, ACP runtime, workspace, storage, history, settings, or UI behavior in one provider, check and usually apply the same change to the other provider unless the CLIs intentionally differ.

## Architecture Rules

- `ApplicationRuntime` is the sole application-scoped execution composition root. It owns the catalog, repositories, lifecycle registry, coordinators, workspace manager, internal backends, startup recovery, and shutdown.
- Keep `src/core/` provider-neutral. Shared execution/runtime/settings contracts belong there only when at least two providers need the behavior.
- Keep provider-specific protocol, storage, CLI resolution, history parsing, model discovery, settings UI, and launch artifacts inside `src/providers/<provider>/`.
- Register provider execution backends through `ProviderApplicationContextFactory` and the immutable `builtInProviderCatalog`.
- Register provider workspace services through `ProviderApplicationContextComposition`.
- Feature code must consume provider-neutral contracts and projections. Do not read provider-specific `Conversation.providerState` fields directly from `src/features/`.
- Tabs and views own presentation only. They submit commands through the runtime and render projections. They never create, query, cancel, or dispose execution resources.
- Preserve provider-native behavior first. Prefer adapting official CLI/runtime semantics over reimplementing provider features inside Grimoire.
- Use `.grimoire/` for Grimoire-owned vault data. Do not add legacy storage migration behavior unless a migration milestone explicitly asks for it.

## Key Paths

| Path | Purpose |
|------|---------|
| `src/main.ts` | Obsidian plugin entry point, view registration, commands, lifecycle. Constructs ApplicationRuntime in onload(). |
| `src/app/runtime/` | Application runtime composition: infrastructure, provider context factories, coordinator wiring, lifecycle adapter, plugin lifecycle bridge, Obsidian vault bootstrap. |
| `src/app/` | Settings defaults and plugin-level storage helpers |
| `src/core/` | Provider-neutral execution lifecycle, providers catalog, MCP, security, storage, tools, shared types |
| `src/providers/` | Provider adapters: execution backends, application context factories, settings codecs, workspace services |
| `src/features/chat/` | Projection-backed chat view, chat execution coordinator, projections, rendering |
| `src/features/inline-edit/` | Inline edit modal and provider-backed edit services |
| `src/features/settings/` | Shared settings shell plus provider-owned settings tabs |
| `src/shared/` | Reusable UI components, modals, mention UI, icons |
| `src/style/` | Modular CSS, built into root `styles.css` |
| `tests/` | Unit and integration tests mirroring `src/` |

## Commands

```bash
npm ci
npm run dev
npm run build
npm run build:release
npm run typecheck
npm run lint
npm run lint:fix
npm run test
npm run test -- --selectProjects unit
npm run test -- --selectProjects integration
```

Use this full local gate before publishing or pushing meaningful UI/provider changes:

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` refreshes generated `main.js`, root `styles.css`, and `dist/grimoire`. Generated release artifacts must match source output after the build. The release prebuild also runs Obsidian community-review gates: `review:source`, `review:css`, and `review:deps`.

When bumping the plugin version, update `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` together. `versions.json` maps each released plugin version to the minimum supported Obsidian app version and must include the new release before tagging or publishing.
Keep `CHANGELOG.md` as the source of truth for user-facing release notes. Every release bump should add a dated version section there before tagging or publishing; in-app "What's New" surfaces should read changelog content bundled into `main.js` rather than maintaining separate copy or publishing `CHANGELOG.md` as an Obsidian release asset.
Obsidian plugin updates require the GitHub release tag to match `manifest.json.version` exactly, without a leading `v` prefix. For example, version `1.0.21` must be tagged and released as `1.0.21`, not `v1.0.21`.

Before a public release, Obsidian community plugin submission, or release meant for external review, also run:

```bash
npm audit --omit=dev
```

Fix production dependency advisories when an upstream-compatible update is available. If a warning remains because it comes from an embedded provider SDK or required runtime behavior, document the reason in `DISCLOSURES.md` rather than leaving it unexplained.

Obsidian community CSS review rates styles against their Electron / older-app compatibility baseline (historically 1.11.4), not only against Grimoire's `minAppVersion`. Treat review CSS warnings as product score issues. Keep `review:css` green: no `!important`, and no features listed in `scripts/reviewCss.js` `OBSIDIAN_PARTIAL_CSS_FEATURES` (for example `display: contents` / `css-display-contents`). When Obsidian flags a new partial feature, rewrite the CSS and extend that denylist plus tests. Path-specific style rules live in `src/style/AGENTS.md`.

Dependency changes use npm as the canonical package manager. Keep `package-lock.json` current with `package.json`; do not add secondary package-manager lockfiles unless the repository intentionally changes its install, CI, and release workflow.

The project requires Obsidian 1.13.0 or newer and uses the declarative settings API for native settings search. Implement settings tabs through `getSettingDefinitions()`; do not restore the deprecated `PluginSettingTab.display()` fallback.

## Testing Rules

- Tests mirror `src/` under `tests/unit/` and `tests/integration/`.
- For behavior changes and bug fixes, add the focused failing test first when practical, make it pass, then broaden only when the touched contract is shared.
- In restricted sandboxes, full Jest can fail with local server bind errors or read-only home errors. Treat those as environment restrictions and rerun in an unrestricted environment before changing tests or production code.

## Storage Boundaries

| Path | Owner |
|------|-------|
| `.grimoire/grimoire-settings.json` | Shared Grimoire app settings plus provider-specific configuration |
| `.grimoire/sessions/*.meta.json` | Provider-neutral session metadata |
| `.grimoire/control/conversations/*.json` | Revisioned provider-neutral conversation records used by the new application runtime |
| `.grimoire/control/transaction-intents/*.json` | Recoverable multi-record mutation intents and completion markers |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Optional sanitized debug logs, written only when Advanced debug logging is enabled |
| `.grimoire/mcp/<provider>.json` | Grimoire-owned MCP servers injected into ACP sessions for OpenCode, Grok Build, MiMoCode, Kimi Code, Qwen Code, and Gemini CLI |
| `.grimoire/claude/statusline-usage.json` | Claude Code status-line usage snapshot used to hydrate plan-limit indicators |
| `.claude/settings.json` | Claude Code-compatible project settings and permissions |
| `.claude/mcp.json` | Claude-compatible MCP servers plus Grimoire metadata under `_grimoire.servers` |
| `.claude/commands/**/*.md` | Claude slash commands |
| `.claude/skills/*/SKILL.md` | Claude skills |
| `.claude/agents/*.md` | Claude vault agents |
| `.codex/skills/*/SKILL.md` | Codex vault skills |
| `.codex/agents/*.toml` | Codex vault subagent definitions |
| `.agents/skills/*/SKILL.md` | Shared cross-provider vault skills |
| `.opencode/skills/*/SKILL.md` | OpenCode vault skills |
| `.mimocode/skills/*/SKILL.md` | MiMoCode vault skills |
| `.kimi-code/skills/*/SKILL.md` | Kimi Code vault skills |
| `.grok/skills/*/SKILL.md` | Grok Build vault skills |
| `.qwen/skills/*/SKILL.md` | Qwen Code vault skills |
| `.gemini/skills/*/SKILL.md` | Gemini CLI vault skills |
| `.opencode/agent/**/*.md` | OpenCode agent definitions |
| `.opencode/agents/**/*.md` | Legacy OpenCode agent definition root |
| `.qwen/commands/**/*.md` | Qwen project custom commands |
| `.qwen/agents/*.md` | Qwen project agent definitions |
| `.gemini/commands/**/*.toml` | Gemini project custom commands |
| `.gemini/agents/*.md` | Gemini project agent definitions |

The `_grimoire` MCP metadata key and `grimoire-*` internal OpenCode IDs are implementation details, not product copy.

## Development Notes

- No `console.*` in production code.
- Prefer `rg` for searches.
- Use structured parsers/helpers for structured data instead of ad hoc string edits when the codebase already has a suitable API.
- Comments should explain non-obvious intent, not restate code.
- Do not revert unrelated user or generated changes in a dirty worktree.
- Commit only tracked deliverables unless the user explicitly asks to include temporary `.context/` or `design_handoff_*` files.
- When work is tied to an issue or ticket, include its identifier in the branch name or commit message. Prefer the commit message when committing directly to an existing branch.
- Local test Obsidian vault: set `OBSIDIAN_VAULT` in `.env.local` (gitignored) to your vault path so `npm run build` / `npm run build:release` copy artifacts there automatically. When copying a local build for manual testing, install Grimoire into `<vault>/.obsidian/plugins/grimoire`.
- For provider integrations, inspect real runtime output before normalizing event shapes. Real transcripts and wire traces beat guessed schemas.
- For future provider work and implementation sequencing, use `docs/provider-roadmap.md` before adding new provider directories.
