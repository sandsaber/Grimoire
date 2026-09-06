# Grimoire

<p align="center">
  <img src="assets/readme/grimoire-logo.png" alt="Grimoire logo" width="240">
</p>

<p align="center">
  <strong>Local-first AI agents for your Obsidian vault.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="docs/readme/README.zh-CN.md">简体中文</a> · <a href="docs/readme/README.zh-TW.md">繁體中文</a> · <a href="docs/readme/README.ja.md">日本語</a> · <a href="docs/readme/README.ko.md">한국어</a> · <a href="docs/readme/README.de.md">Deutsch</a> · <a href="docs/readme/README.fr.md">Français</a> · <a href="docs/readme/README.es.md">Español</a> · <a href="docs/readme/README.pt-BR.md">Português</a> · <a href="docs/readme/README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="Latest release">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="Desktop only">
</p>

<p align="center">
  <img src="assets/readme/chat-workspace.png" alt="Grimoire side panel running beside an Obsidian vault note" width="100%">
</p>

<p align="center">
  <sub>Chat with local CLI agents from the same Obsidian workspace where your notes live.</sub>
</p>

> **Heads-up: 2.0 is in progress.** The next major release moves Grimoire onto a provider-based execution architecture, where one kernel drives every CLI and records exactly one outcome per turn, and brings a redesign that follows your vault's theme and accent. It is merged into `main` and is not in a published release yet. The current release is still 1.3.2. Conversations, settings, and provider files carry over unchanged.

Grimoire brings agentic CLI assistants into Obsidian. Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, and Qwen Code all live in one side panel, where they read your notes, edit files, run commands, call tools, and keep session history against your real vault. Nothing routes through a Grimoire server. There's no telemetry, no hosted backend, and no proxy sitting in the middle.

It's built for people who already work in Obsidian and want AI help that behaves like part of the vault: local context, local files, a provider you pick on purpose, and usage you can actually see.

## Why Grimoire

- Use the CLI agents you already trust, right inside your notes.
- Switch providers from the composer. Claude Code, Codex, Antigravity CLI, legacy Gemini CLI, OpenCode, MiMoCode, Kimi Code, Grok Build, and Qwen Code share one model picker.
- Ground every turn in your vault. Mention notes, folders, and MCP tools instead of pasting paths by hand.
- See cost and limits next to the model selector, where you're making the decision anyway.
- Stay local-first. Grimoire doesn't collect telemetry, proxy prompts, or run a backend.

## What each provider can do

| Capability | Claude Code | Codex | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local persistent runtime | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Native history hydration | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | No |
| Plan mode | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Image attachments | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Instruction mode | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Reasoning effort controls | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Rewind | Yes | No | No | Yes | No | No | No | No | No |
| Fork | Yes | Yes | No | Yes | No | No | No | No | No |
| Provider slash commands | Yes | No | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Grimoire-managed MCP UI | Yes | No | Yes | Yes | Yes | Yes | No | Yes | Yes |

## Installation

Grimoire is a desktop plugin. It drives your provider CLIs locally, so there's no mobile build.

### From Community plugins (recommended)

Install Grimoire from the Obsidian community plugin directory:

1. Open Settings, go to Community plugins, and turn off Restricted mode if it's on.
2. Click Browse, search for Grimoire, and install it.
3. Enable Grimoire, then open its panel from the ribbon or the command palette.

### From GitHub Releases

Install the current release manually if you can't use Community plugins:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [Grimoire release](https://github.com/sandsaber/Grimoire/releases/latest).
2. Create `/path/to/your/vault/.obsidian/plugins/grimoire`.
3. Put all three files in that folder.
4. Enable Grimoire from Settings, Community plugins.

### With BRAT

BRAT can install Grimoire from GitHub Releases if you want to track tagged builds outside the community directory:

1. Install the "Obsidian42 - BRAT" plugin.
2. In BRAT, add a beta plugin from `sandsaber/Grimoire`.
3. Enable Grimoire.

### From source (developers)

Build the release bundle and drop it into your vault:

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

Then enable Grimoire from Settings, Community plugins.

Whichever path you pick, install at least one CLI provider before you start. Grimoire wraps the provider CLIs. It doesn't replace their account setup, model access, quotas, or terms.

## Set up a provider

Enable the providers you want under Settings, Grimoire, Providers, and they'll appear in the model selector. Codex is enabled on first launch; the rest are opt-in.

### Recommended providers

For the best Grimoire experience, start with Claude Code, Codex, OpenCode, MiMoCode, Kimi Code, Grok Build, or Qwen Code. These providers currently expose the strongest runtime surfaces for vault-native work: persistent sessions, plan-oriented workflows, tool activity, and rich model controls.

Antigravity CLI and Gemini CLI (Legacy) remain available for Google accounts and compatibility cases, but they are not recommended as primary Grimoire providers today. Grimoire supports them on a best-effort basis, and we have implemented the fallbacks their current CLIs make possible, but their ACP and runtime surfaces are technically limited: sessions, approvals, streaming, tool/edit metadata, model discovery, and usage reporting are incomplete or unreliable compared with the recommended providers.

### Claude Code

Pick Claude Code when you want its native project memory, slash commands, MCP configuration, plans, and rewind/fork, backed by your Claude subscription or API key.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Authenticate through Claude Code, then enable it in Grimoire. The old npm package is deprecated; use the native installer above, Homebrew (`brew install --cask claude-code`), WinGet, or the other options in the official quickstart.

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

Inside Grimoire, Claude Code reads and preserves your `.claude/` files, runs on the Claude Code SDK, and supports slash commands, MCP settings, agents, skills, plans, rewind, and fork. When Claude reports both, you'll see quota windows and API spend side by side.

**Respect Claude Code settings** is enabled by default. Grimoire reads Claude Code user settings (`~/.claude/settings.json`) and vault settings (`.claude/settings.json`) for `model` and `env`, then uses those values in the Claude model selector and runtime environment. This lets Claude Code custom models work in Grimoire too, including Anthropic-compatible gateways such as MiniMax, Z.ai, and others. Project settings override user settings, and explicit Grimoire environment settings override both.

If the effective Claude environment includes `ANTHROPIC_API_KEY`, Grimoire can refresh Anthropic's model catalog and merge discovered models into the picker. Without an API key, or if the refresh fails, the picker keeps working from Claude Code aliases such as `Best`, `Fable 5`, `Opus Plan`, and 1M variants, plus your `.claude` and custom Grimoire models.

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "ANTHROPIC_MODEL": "glm-5.2[1m]",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.7-flash"
  }
}
```

### Codex

Codex is the default provider on first launch. Pick it for OpenAI Codex in a local CLI, signed in with your ChatGPT plan or an API key.

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Run it once, sign in, then enable it in Grimoire. The standalone installer is the primary install path now; use the official Codex CLI docs for Windows, Homebrew, and fallback package-manager options.

- [Codex CLI setup](https://developers.openai.com/codex/cli)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)

Inside Grimoire, Codex runs on its app-server protocol with native history, fork, plan mode, image input, and reasoning effort controls. Plan usage shows up when Codex reports rate-limit metadata.

### Antigravity CLI

Antigravity CLI is Google's replacement for consumer Gemini CLI use, and it can access Gemini, Claude, GPT-OSS, and other model families available to your Antigravity account. Inside Grimoire, treat it as a compatibility provider rather than the recommended default.

```bash
agy
```

Install the official Antigravity CLI from Google, authenticate it locally, then enable Antigravity in Grimoire. Grimoire auto-detects `agy` from PATH, or you can set a custom CLI path in provider settings.

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

Inside Grimoire, Antigravity runs through `agy --print` with optional model selection from `agy models`, and Grimoire folds the active note plus editor, browser, canvas, vault-search, and project-workspace context into that print prompt. This is a best-effort integration because `agy` does not currently expose a strong ACP-compatible runtime to Grimoire. Persistent sessions, native history, images, plan mode, streaming, approval-safe file edits, reliable usage reporting, and auxiliary workflows stay disabled or limited until Antigravity exposes stable runtime surfaces for them.

Known Windows limitation: current Windows `agy` builds can finish successfully while returning empty stdout for `agy models` and `agy --print`. Grimoire uses best-effort recovery from Antigravity logs, transcripts, settings, and a seeded Pro AI model list, but Windows Antigravity support may be less reliable than macOS or Linux until the upstream CLI exposes stable output. If your account shows additional models in Antigravity, add their exact labels under Antigravity settings > Custom models.

`agy --print` does not expose Grimoire file-edit approval hooks. For safety, Antigravity's shared Safe/normal mode is blocked in Grimoire; switch the Antigravity toolbar toggle to Auto-approve only when you are comfortable with AGY editing files without Grimoire prompts.

### Gemini CLI (Legacy)

Gemini CLI remains available as a legacy compatibility provider for Gemini Code Assist Standard, Enterprise, Google Cloud, and paid API-key users where Google continues serving Gemini CLI requests. It is not recommended for new Grimoire setups because its ACP support is weak and several Grimoire workflows cannot be implemented reliably on top of it. Consumer Google AI Pro, Ultra, and free-tier accounts should use Antigravity instead after Google's June 18, 2026 transition, with the Antigravity limitations above in mind.

```bash
gemini
```

Enable Gemini CLI only if your account tier is still supported and you specifically need that legacy Google path. Grimoire runs it through `gemini --acp`, folds the active note plus editor, browser, canvas, vault-search, and project-workspace context into the ACP prompt, keeps its model and mode discovery provider-owned, and labels it as legacy so it does not look like a recommended provider. Prefer Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build, or Qwen Code when possible.

### Qwen Code

Qwen Code is an opt-in ACP provider. It keeps provider-native persistent sessions, resume, and model context; discovers models and modes from the live ACP session; streams messages, tool activity, and plans; and supports image input, provider commands, and file approvals. Grimoire does not hydrate provider-native message history.

```bash
# Linux and macOS (recommended standalone install)
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows PowerShell
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# Alternative installs
brew install qwen-code
npm install -g @qwen-code/qwen-code@latest # Node.js 22+

qwen --version
qwen
```

In the interactive CLI, use `/auth` and choose Alibaba ModelStudio, Third-party Providers, or Custom Provider. Qwen OAuth has been discontinued. Then enable Qwen Code in Grimoire; it launches `qwen --acp`. Safe, Auto-approve, and Plan map to Qwen's `default`, `yolo`, and `plan` modes. Other Qwen automatic modes are shown conservatively as Safe in the shared toolbar.

- [Qwen Code documentation](https://qwenlm.github.io/qwen-code-docs/en/)
- [Qwen Code authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

If Qwen does not start or no models appear, run `/doctor` inside Qwen Code, complete `/auth`, verify `qwen --version`, and check the Qwen CLI path in Grimoire settings.

Choose Low, Medium, High, XHigh, or Max reasoning effort (High by default). Before a normal turn, Grimoire applies Qwen's real `/effort <tier>` command and caches it for that session; the effective tier still depends on the selected model and provider. Qwen's structured `AskUserQuestion` requests arrive through ACP permission metadata and use Grimoire's shared inline question UI, including single-select, multi-select, and freeform answers.

Qwen owns its credentials and native configuration in `~/.qwen/settings.json`; prefer the CLI or Qwen-owned `.env` and environment variables for those settings. Grimoire manages an isolated project MCP list in `.grimoire/mcp/qwen.json` and injects it into ACP sessions without rewriting Qwen's native configuration. Usage appears only when Qwen emits ACP token or cost metadata. Qwen does not currently support Grimoire fork or rewind controls.

### OpenCode

Pick OpenCode for a model-agnostic agent that brings its own provider configuration.

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew, npm, bun, and package-manager installs work too. Configure your provider credentials in OpenCode, then enable it in Grimoire.

- [OpenCode download](https://opencode.ai/download)
- [OpenCode provider docs](https://opencode.ai/docs/providers)
- [OpenCode config docs](https://opencode.ai/docs/config)

Inside Grimoire, OpenCode runs over ACP with Grimoire-managed launch artifacts, plus persistent runtime, native history, plan mode, image input, provider commands, and reasoning effort. It reports monthly spend when cost metadata is available.

### MiMoCode

MiMoCode (Xiaomi) is a fork of OpenCode with persistent memory, intelligent context management, and subagent orchestration.

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

### Kimi Code

Kimi Code CLI (MoonshotAI) is a multi-provider terminal agent supporting Kimi, OpenAI, Anthropic, Gemini, and Vertex AI models.

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

### Grok Build

Pick Grok Build for xAI's agentic CLI in Obsidian. Sign in with Grok OAuth or use an xAI API key.

```bash
grok
```

Install the Grok CLI from xAI, authenticate with grok.com OAuth or configure API keys, then enable Grok Build in Grimoire.

- [Grok Build documentation](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [Usage and limits](https://docs.x.ai/grok/faq)

Grok 4.5 is currently the default model powering Grok Build. Grimoire discovers the available model catalog from the authenticated Grok CLI account instead of maintaining a static list, so availability can vary by account and CLI version and update automatically.

Inside Grimoire, Grok Build runs over ACP via `grok agent stdio` with Grimoire-managed launch artifacts under `.grimoire/grok/`, persistent runtime, native JSONL history hydration, plan mode, image input, provider commands, reasoning effort on native models, rewind, and fork. With OAuth, Grimoire shows the shared weekly Grok usage allowance, reset time, and Extra Usage Credits when available; API spend aggregates from session cost metadata when reported.

## Your first chat

1. Pick a provider and model in the composer.
2. Set reasoning effort and choose Safe, Auto-approve, or Plan in the permission control.
3. Mention any notes, folders, or context you want in scope.
4. Send the turn.
5. Watch tool calls, usage, and output land in the panel.

## Features

### Chat workspace

A focused side panel with multiple tabs. Each tab keeps its own draft, provider, model, context, and runtime. Close and reopen Obsidian and your sessions come back, with the provider, model, and reasoning effort preserved on every response. Rewind and fork appear when the active provider supports them. Auto-scroll backs off the moment you scroll away to read something. After 10 seconds without visible output, a shared wait indicator shows the active provider and elapsed time; it pauses while a question or permission is waiting.

### Tab, history, and navigation controls

Right-click a tab to rename, duplicate, close it, close other tabs, or close tabs to its right. Middle-click closes a tab, and the timed Undo action restores a closed tab with its draft and position. Open a saved conversation in a new tab from chat history with its action, a modifier-click, or a middle-click. Long conversations have a five-way navigator for the top, previous prompt, conversation directory, next prompt, and bottom. Completed messages show a localized completion timestamp next to their copy action.

<p align="center">
  <img src="assets/readme/conversation-history.png" alt="Grimoire conversation history and tab navigation" width="100%">
</p>

### Parallel workers, settings, and composer

The **Parallel workers** approval card shows the inherited model and lets you select only the proposed tasks to launch. Settings use Obsidian's native search and retain a permanent What's New entry. Provider settings and the composer use one consistent surface across providers, while keeping provider-owned controls and configuration where they belong.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Enter` | Send the current turn. Disabled when **Send only with button** is enabled. |
| `Shift+Enter` | Insert a new line in the composer. |
| `Shift+Tab` | Cycle permission modes: `Safe -> Auto-approve -> Plan -> Safe`. Providers without Plan mode cycle between Safe and Auto-approve. |
| `Escape` | Stop the active response, or close the open chat history sheet. |

### Model selector

One picker, grouped by provider and sorted by label: Antigravity, Claude Code, Codex, Gemini CLI (Legacy), Grok Build, Kimi Code, MiMoCode, OpenCode, and Qwen Code. Search runs across labels, descriptions, groups, and model IDs without resizing the menu while you filter. Catalogs load lazily and remember which groups you collapsed. Add custom aliases and context-window overrides in settings. Claude's 1M variants are extra options, not replacements for the base models.

### Usage and cost

A badge next to the model selector keeps the active provider's usage in view, with fuller readouts inside the model menu: quota windows where a provider exposes them, spend where only cost is available. Stale numbers stay put while a refresh is in flight or fails, so the meter never blanks out. Turn the whole thing off in settings if you want a quieter UI.

| Provider | Where usage comes from |
| --- | --- |
| Claude Code | SDK rate-limit events, optional `.grimoire/claude/statusline-usage.json`, and SDK result cost metadata |
| Codex | Account rate-limit notifications and `account/rateLimits/read` when available |
| Antigravity CLI | Not reliably available from `agy --print` yet |
| Gemini CLI (Legacy) | ACP cost metadata when Gemini CLI reports it; legacy provider only |
| Qwen Code | ACP token and cost metadata when Qwen Code reports it |
| OpenCode | Monthly spend aggregated from ACP and session cost metadata |
| MiMoCode | Monthly spend aggregated from ACP and session cost metadata |
| Kimi Code | Monthly spend aggregated from ACP and session cost metadata |
| Grok Build | Shared weekly Grok usage, reset time, and Extra Usage Credits through OAuth; monthly API spend from session cost metadata |

### Plan mode

When the active provider supports Plan mode, you can turn it on in either of two ways:

- Click the permission control in the composer until it cycles to Plan: `Safe -> Auto-approve -> Plan`.
- Press `Shift+Tab` to cycle the full sequence: `Safe -> Auto-approve -> Plan -> Safe`.

Plan mode asks the provider to plan before it starts making changes. In the composer it uses the same permission control as Safe and Auto-approve, so the active mode stays visible while you work.

When a provider finishes planning, Grimoire shows a collapsible Plan complete card with the rendered plan, requested permissions, and keyboard-friendly rows. Approving continues in the same session; entering feedback keeps Plan mode active so the provider can revise the plan.

### Context and mentions

Mention vault notes and folders straight from the composer, pull in the current or linked note, and add persistent external context paths in settings. Paste or drop images when the provider takes image input. Mention MCP servers where the provider integration supports it. The Context tab shows the bound note, model, permission mode, pinned files, launch artifacts such as `.grimoire/grok/system.md`, and files the agent loaded during the session.

### Inline editing

Run "Grimoire: Inline edit" on a selection. A prompt opens next to the text, the edit comes back as a diff you accept or reject, and it routes through the provider-backed inline edit service. It handles both replacing a selection and inserting new text.

### Clarifying questions

When a provider asks for structured user input, Grimoire pauses the turn and renders the question over the composer. Claude Code exposes this as `AskUserQuestion`; Codex app-server exposes an experimental `request_user_input` / `requestUserInput` surface; Qwen Code delivers `AskUserQuestion` through ACP permission metadata. Grimoire normalizes those provider-specific mechanisms into the same inline question UI. Single-select, multi-select, and freeform answers resolve back into the provider run, so the agent can continue without a separate chat message.

If the question covers chat text you need to reread, use the chevron in the question header to collapse it into a compact bar. Your selected and freeform answers stay in place until you expand or submit the question.

### Commands

Built-in commands cover Grimoire workflows like image generation and resume. Providers that expose their own commands, such as Claude Code slash commands and OpenCode, Grok Build, or Qwen Code runtime commands, surface them through provider-owned catalogs. Hide the ones you don't use from the dropdown in settings.

### Image generation

Paste or drop images to attach them. The built-in `/image [prompt]` command doesn't call any image API itself. It hands a normal turn to the active provider with instructions to use whatever image generation you've configured: provider-native tooling, MCP tools, or a local command. The agent saves the result in your vault and returns an embed like `![[path/to/image.png]]`. If nothing is set up for image generation, you get a plain answer explaining what's missing.

### Safety and permissions

Permission modes belong to the provider, so Grimoire surfaces them through shared composer controls instead of reinventing them. The permission control and `Shift+Tab` both cycle through Safe, Auto-approve, and Plan when the active provider supports plan mode. Safe mode and permission prompts stay visible while you work. Bang-bash mode only shows up when an enabled provider offers it. Treat configured MCP servers, shell access, and API keys as sensitive, because they are.

### Debug logging

Off by default. Turn it on and Grimoire writes sanitized JSONL to `.grimoire/logs/YYYY-MM-DD.jsonl`, with prompts, answers, note contents, paths, environment values, and secrets redacted. It's for diagnosing provider and runtime issues, not for keeping a transcript.

### Settings

General settings cover Obsidian-following theme behavior, auto-scroll, title generation, usage indicators, debug logging, locale, tabs, and which provider owns the settings view. Per-provider tabs handle CLI paths, model behavior, commands, agents, skills, and provider-owned config where it exists. You can also set project workspace environment variables, scoped per provider when needed.

<p align="center">
  <img src="assets/readme/settings-general.png" alt="Grimoire general settings" width="100%">
</p>

## Where Grimoire keeps your data

| Path | What's there |
| --- | --- |
| `.grimoire/grimoire-settings.json` | App settings plus provider configuration |
| `.grimoire/sessions/*.meta.json` | Session metadata |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Opt-in sanitized debug logs |
| `.grimoire/claude/statusline-usage.json` | Claude usage snapshot for the plan meter |
| `.grimoire/grok/` | Grok Build launch artifacts, managed config, and session pointers |

Provider-native files under `.claude/`, `.codex/`, `.opencode/`, and `.grimoire/grok/` are read and written in place, so your provider setup stays portable outside Grimoire.

## Privacy

Grimoire runs inside Obsidian, on your machine. It has no backend, adds no telemetry, and never uploads your prompts, answers, notes, files, tool output, API keys, or usage logs to any Grimoire service. The only logs it writes are the optional, sanitized debug logs above, and those stay in your vault.

What it can't hide is the provider itself. Whichever CLI you enable receives the prompt, the context you selected, and the files, images, tool output, and commands a request needs. That CLI may then talk to Anthropic, OpenAI, Google, your configured OpenCode vendors, MCP servers, or anything else it's set up to reach. Terms, retention, billing, rate limits, and privacy policies are the provider's, not Grimoire's. Grimoire's job is to make that boundary visible and keep it under your control inside Obsidian.

For an Obsidian policy-oriented summary of network use, account requirements, external file access, logging, and telemetry, see [DISCLOSURES.md](DISCLOSURES.md).

## Development

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a
pull request; it covers provider ownership, security boundaries, testing, generated
artifacts, and the repository's review expectations.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

Before publishing or pushing meaningful UI or provider changes, run the full local gate:

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` refreshes the generated `main.js`, the root `styles.css`, and `dist/grimoire`.

npm is the canonical package manager for development, CI, and releases. Keep `package-lock.json` current when dependencies change; secondary package-manager lockfiles are intentionally not committed.

## Releases

Grimoire releases are published from semver tags such as `1.0.0`. The release workflow runs the local gate, builds the Obsidian bundle, verifies that the tag matches `package.json` and `manifest.json`, then attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub Release.

Obsidian Community plugins are the recommended user install path. GitHub Releases still carry the bundle assets for manual installs and BRAT. Use `main` for releasable development, then publish by tagging the version that matches the manifest.

## Roadmap

Today Grimoire ships with Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, and Qwen Code.

Next on the list: GitHub Copilot CLI, other ACP-compatible providers, and local model CLIs once their runtime is stable enough to embed in Obsidian. Implementation notes live in [docs/provider-roadmap.md](docs/provider-roadmap.md).

## License

MIT. See [LICENSE](LICENSE).
