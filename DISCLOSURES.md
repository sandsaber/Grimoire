# Grimoire disclosures

This document summarizes Grimoire's privacy, network, account, payment, and file-access behavior for Obsidian community plugin review.

## Short version

Grimoire is a local-first Obsidian desktop plugin. It has no hosted backend, no client-side telemetry, no ads, and no self-update mechanism. It wraps user-installed CLIs for Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, and Qwen Code. An enabled provider may send selected prompts, context, files, images, tool output, and commands to its own services according to its own terms and privacy policies.

## Payments and accounts

Grimoire itself does not require payment and does not sell access to any hosted Grimoire service.

Full functionality requires at least one external CLI provider. Those providers may require an account, subscription, API key, or paid usage:

- Claude Code may require a Claude account, subscription, or API key.
- Codex may require an OpenAI or ChatGPT account, plan access, or API key.
- Antigravity CLI may require an eligible Google account and the model access available to that account.
- Gemini CLI (Legacy) may require a Google account, Gemini API key, or Vertex AI configuration.
- OpenCode may require provider credentials for the model vendors configured by the user.
- MiMoCode may require Xiaomi credentials and any model-provider credentials configured by the user.
- Kimi Code may require a Moonshot AI account or the credentials for a configured supported provider.
- Grok Build may require a Grok/xAI account, subscription, OAuth access, or API key.
- Qwen Code may require an Alibaba ModelStudio, third-party provider, or custom-provider account and configuration.

Provider billing, quotas, rate limits, retention, and account requirements are controlled by the provider, not by Grimoire.

## Network use

Grimoire does not send data to a Grimoire server and does not proxy provider traffic.

Network use can happen when the user enables or configures external tools:

- Provider CLIs may contact Anthropic, OpenAI, Google, Alibaba ModelStudio, xAI, Moonshot AI, Xiaomi, OpenCode-configured vendors, or other services required by that provider.
- User-configured MCP servers may contact remote services depending on the MCP server configuration.
- User-approved shell commands or provider tools may access the network if the command or tool does so.
- Installation and updates happen through Obsidian, BRAT, npm, or GitHub Releases, depending on the user's installation path.

### MCP server connectivity testing

When a user clicks "Test" on a configured HTTP or SSE MCP server, Grimoire verifies the connection using Node's `http`/`https` modules rather than Obsidian's `requestUrl`. This is required, not a stylistic choice: the Model Context Protocol SDK's streamable-HTTP and SSE transports need a streaming `fetch` implementation, and `requestUrl` buffers the entire response and cannot stream. Node's HTTP stack also avoids the renderer's CORS restrictions, which would otherwise block requests to remote MCP servers that do not send Obsidian-origin CORS headers. The request targets only the server URL the user entered, runs solely for the explicit test action, and is unrelated to normal turn traffic (which the provider CLIs handle themselves).

## System, shell, and filesystem access

Grimoire is desktop-only because it launches local CLI agents. To do that, it uses Node.js filesystem and process APIs.

Grimoire may inspect environment variables such as `PATH`, `HOME`, `APPDATA`, and provider-specific configuration variables to locate installed CLIs, Node.js, provider data directories, and user-configured runtime settings. Grimoire does not read `os.hostname()`, `os.userInfo()`, or `os.networkInterfaces()`.

Grimoire uses direct filesystem access for provider-owned files and runtime data that are outside the Obsidian vault API, including external context paths, provider history stores, CLI discovery, provider configuration, and Grimoire-owned `.grimoire/` data.

Grimoire launches subprocesses for provider CLIs, MCP transports, and user-approved shell commands. Shell execution is core to the plugin: provider CLIs and commands run locally with the permissions granted by the user's operating system and the selected provider permission mode.

## Data sent to providers

When a provider is enabled and the user sends a turn, the provider CLI may receive:

- the user's prompt;
- selected vault note content and mentioned files or folders;
- images or attachments included in the turn;
- tool call results and command output;
- provider settings needed to run the request.

Grimoire's role is to make that provider boundary visible inside Obsidian. The provider decides what is transmitted to its own services.

## File access

Grimoire reads and writes files in the user's vault to support chat sessions, settings, provider configuration, and user-requested edits.

Grimoire stores its own data under:

- `.grimoire/grimoire-settings.json`
- `.grimoire/sessions/*.meta.json`
- `.grimoire/logs/YYYY-MM-DD.jsonl` when debug logging is enabled
- `.grimoire/claude/statusline-usage.json` when Claude usage snapshots are configured

Grimoire also reads and preserves provider-native vault files such as `.claude/`, `.codex/`, `.opencode/`, and provider-owned `.grimoire/<provider>/` launch artifacts when the corresponding integration uses them. Provider credentials and account configuration remain provider-owned. For example, Qwen Code reads `~/.qwen/settings.json`; Grimoire does not parse, write, or reconcile that file or Qwen MCP configuration.

Users can add external context paths outside the vault. When they do, Grimoire may read those paths to surface files as selectable context for provider turns. Provider CLIs and user-approved shell commands may also access files outside the vault according to the provider's runtime and permission settings.

## Vault enumeration and clipboard access

Grimoire enumerates vault files to power note mentions, search, context selection, and vault text indexing. This gives the plugin access to vault file paths and, when selected or indexed, vault file contents.

Grimoire uses clipboard access only for explicit user actions such as copying code or markdown, importing MCP configuration from the clipboard, and accepting pasted images or text in the composer.

## Dynamic code in bundled dependencies

Grimoire's own source code does not call `eval()` or `new Function()`. The bundled release includes official provider and MCP SDK dependencies that contain runtime schema-validation code using generated functions, including AJV-based validators. Grimoire does not use this mechanism to execute user prompts, note contents, or downloaded plugin code.

## Logging

Debug logging is off by default.

When enabled, Grimoire writes sanitized JSONL logs to `.grimoire/logs/YYYY-MM-DD.jsonl`. These logs are intended for diagnosing provider and runtime issues. Grimoire redacts prompts, answers, note contents, paths, environment values, and secrets rather than storing a transcript.

## Telemetry, ads, and updates

Grimoire does not include:

- client-side telemetry;
- dynamic ads loaded over the internet;
- static ads inside or outside the plugin interface;
- a plugin self-update mechanism.

Updates are delivered through the normal Obsidian community plugin flow, BRAT, or GitHub Releases.

## Source, license, and bundled code

Grimoire is published under the MIT license. See [LICENSE](LICENSE).

Grimoire does not include closed-source Grimoire code. External provider CLIs, SDKs, MCP servers, and model vendors are separate projects with their own licenses and policies.

## Dependencies and known advisories

The Obsidian community plugin review may report dependency warnings for packages such as `hono`, `@hono/node-server`, `fast-uri`, `ip-address`, `qs`, `@anthropic-ai/sdk`, `ws`, and `brace-expansion`. They are resolved through the Model Context Protocol SDK (`@modelcontextprotocol/sdk`), provider SDKs, or development tooling. The table records the current lockfile graph; the audit and bundle checks are still rerun for every release.

Grimoire keeps patched versions selected by the current dependency graph. Server packages such as `hono` and `@hono/node-server` are dependency-review inputs and are not imported as a Grimoire HTTP server. Bundle inclusion must be checked from the actual release build rather than inferred from a package name.

The MCP SDK range is `^1.30.0`, whose dependency contract accepts `@hono/node-server` 2.x. Grimoire uses the npm lockfile plus a narrow override for `@hono/node-server` so a clean release graph can be verified without resolver bypasses or stale advisory assumptions. Vault YAML frontmatter uses the `yaml` package (not `js-yaml`).

- Clean installation, the full unit suite, release-bundle verification, and `npm audit --omit=dev` are required release gates before publication.
- A clean audit is a verified release target, not a standing claim in this document.
- `.npmrc` sets `min-release-age=7`, so a freshly published release cannot enter the lockfile for a week. When a security fix lands inside that window, it is admitted through `lockfile-age-exceptions.json` with an `expiresAt` no later than the package's natural eligibility, never by lowering the quarantine itself.

| Package | Source | In `main.js` | Locked version | Advisory range | Status |
|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | Direct dependency | Verify from release bundle | 1.30.0 | Direct SDK; audit gate applies | Locked from the declared `^1.30.0` range |
| `hono` | MCP SDK | Verify from release bundle | 4.13.0 | `<4.12.34` | Above tracked ranges |
| `@hono/node-server` | MCP SDK | Verify from release bundle | 2.1.0 | `<2.0.5` | Narrow override to a patched release |
| `fast-uri` | MCP SDK / AJV | Verify from release bundle | 3.1.6 | `>=3.0.0 <=3.1.5` | Above tracked ranges |
| `ip-address` | MCP SDK / Express rate limit | Verify from release bundle | 10.4.0 | `<=10.1.0` | Above tracked range |
| `qs` | MCP SDK / Express | Verify from release bundle | 6.16.0 | `>=2.2.5 <6.16.0` | Above tracked range; admitted before the 7-day quarantine through a `lockfile-age-exceptions.json` entry that expires at its natural eligibility |
| `@anthropic-ai/sdk` | Claude Agent SDK | Verify from release bundle | 0.115.0 | `>=0.79.0 <0.91.1` | Above tracked range |
| `ws` | jsdom | Development dependency | 8.21.2 | `>=8.0.0 <8.20.1` | Development-only; above tracked range |
| `brace-expansion` 1.x | Nested tooling dependency | Development dependency | 1.1.18 | `<1.1.18` | Development-only; patched |
| `brace-expansion` 2.x | Nested tooling dependency | Development dependency | 2.1.4 | `>=2.0.0 <2.1.4` | Development-only; patched |
| `brace-expansion` 4.x / 5.x | Nested tooling dependency | Development dependency | 5.0.9 (no 4.x copy) | `>=4.0.0 <5.0.9` | Development-only; patched |
| `yaml` | Direct dependency (frontmatter) | Verify from release bundle | current lockfile | npm audit gate | Replaces `js-yaml` for skills/agents/command YAML |

The `npm run review:deps` check (run automatically by `npm run build:release`) enforces the resolved versions for tracked review advisories. The release workflow also runs the unmodified `npm audit --omit=dev` command and requires a clean result.
