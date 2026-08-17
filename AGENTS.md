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

- Keep `src/core/` provider-neutral. Shared chat/runtime/settings contracts belong there only when at least two providers need the behavior.
- Keep provider-specific protocol, storage, CLI resolution, history parsing, model discovery, settings UI, and launch artifacts inside `src/providers/<provider>/`.
- Register provider runtime and auxiliary services through `ProviderRegistry`.
- Register provider workspace services through `ProviderWorkspaceRegistry`.
- Feature code must consume provider-neutral contracts. Do not read provider-specific `Conversation.providerState` fields directly from `src/features/`.
- Preserve provider-native behavior first. Prefer adapting official CLI/runtime semantics over reimplementing provider features inside Grimoire.
- Use `.grimoire/` for Grimoire-owned vault data. Do not add legacy storage migration behavior unless a migration milestone explicitly asks for it.

## Key Paths

| Path | Purpose |
|------|---------|
| `src/main.ts` | Obsidian plugin entry point, view registration, commands, lifecycle |
| `src/app/` | Settings defaults and plugin-level storage helpers |
| `src/core/` | Provider-neutral runtime, providers, MCP, security, storage, tools, shared types |
| `src/providers/` | Provider adapters and provider-owned services |
| `src/features/chat/` | Main sidebar chat interface and tab lifecycle |
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
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Optional sanitized debug logs, written only when Advanced debug logging is enabled |
| `.grimoire/control/**` | Grimoire-owned execution lifecycle control records: ownership, generations, state-machine positions, terminals, dispatch intents, and recovery evidence. Never a second provider transcript, and never prompts, secrets, or raw payloads. Written from the Antigravity flip onward, by the kernel the plugin constructs at load and shuts down at unload; retention, deletion, versioning, and redaction are decided in [`docs/provider-execution-persistence-decisions.md`](docs/provider-execution-persistence-decisions.md). These files are inert to the legacy runtime path, which is what makes reverting a shipped flip safe |
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
- For future provider work and implementation sequencing, read `docs/provider-execution-migration-plan.md` first — it is the canonical execution architecture and defines when the old runtime path is frozen — then `docs/provider-roadmap.md` for the current integration path. Check `docs/provider-execution-migration-progress.md` for the active milestone before adding new provider directories or extending `ChatRuntime`.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

RTK is an optional local developer tool ([rtk-ai/rtk](https://github.com/rtk-ai/rtk)). It is not a project dependency: nothing in `npm run build`, the tests, or CI requires it. Without it installed, run the plain commands documented above.

## Installation

```bash
brew install rtk
```

Alternatives:

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
```

```bash
cargo install --git https://github.com/rtk-ai/rtk
```

The install script drops the binary in `~/.local/bin`, which must be on `PATH`. Pre-built binaries are also published on the [releases page](https://github.com/rtk-ai/rtk/releases).

Verify the install, and that it is the right `rtk` — an unrelated `rtk` (Rust Type Kit) exists and has no `gain` subcommand:

```bash
rtk --version && rtk gain
```

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
rtk uv run <cmd>        # Compact uv project command output
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
