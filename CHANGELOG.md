# Changelog

## 1.1.7 - 2026-08-15

### Improved

- Refresh Grok Build models from the live `grok models` list when chat opens or you open the model picker, so new models appear without disabling and re-enabling the provider.

### Fixed

- Stopped OpenCode, MiMoCode, and Kimi Code from flipping Auto-approve to Safe when the first message creates a session.
- Stopped Grok Build from aborting later turns with a raw `Invalid params` error, leaking MCP stderr into the chat, and dropping the question when you reopen the conversation.
- Surfaced Grok 4.6 from the live CLI catalog (with the on-disk cache as fallback) instead of staying stuck on a previously seeded Grok 4.5 default.
- Hid Grok Build's injected workspace `<rules>` dump (AGENTS.md / user rules) when reopening a conversation, so it no longer appears as the first chat message.

## 1.1.6 - 2026-08-14

### Fixed

- Kept non-Latin CLI output intact when a multibyte character is split across process output chunks, so Chinese and other non-ASCII text no longer shows replacement characters in Antigravity responses and model names or in ACP provider error details.
- Recovered Grok Build answers from Grok's own session log when a finished turn never delivered its final message, instead of failing the turn with a misleading "no response" error.

## 1.1.5 - 2026-08-10

### Improved

- Kept recently used provider runtimes warm in a bounded cache so switching tabs avoids unnecessary restarts while older inactive runtimes are reclaimed predictably.
- Made model catalog refreshes responsive with stale-while-revalidate caching keyed to provider configuration, so menus stay usable while updated models load.
- Moved OpenCode, MiMoCode, and Kimi Code history, usage, and session-error reads to shared asynchronous SQLite access to avoid blocking the Obsidian UI.
- Respected custom Claude Code configuration directories across agents, plugins, history, and sidecar data, and safely discovered relocated SDK sessions without scanning outside the configured roots.

### Fixed

- Restored Grok Build responses that arrived through alternate session notifications and deduplicated mirrored events, fixing turns that could appear to return no answer.
- Recovered Codex turns when the app server reports completion before the expected terminal stream event, while preserving genuine empty-response failures.
- Treated missing saved sessions consistently for OpenCode, MiMoCode, and Kimi Code so stale session IDs fall back to a fresh session without surfacing misleading errors.
- Kept provider usage details in the compact accessible tooltip and removed the oversized duplicate message that could overflow narrow chat panes.

## 1.1.4 - 2026-08-09

### Improved

- Improved Obsidian community-review compatibility by allowing scanner dependency installation across npm versions, replacing the flagged YAML parser, and avoiding partially supported CSS features.
- Kept recoverable ACP session-resume failures in debug logs instead of showing alarming notices when Grimoire can safely start a fresh provider session.

### Fixed

- Restored Antigravity model selection by parsing the tab-separated `agy models` output correctly and repairing affected saved model entries automatically.
- Prevented the compact composer toolbar from overflowing when the input is resized to its minimum height, including when themes change the wrapped toolbar size.
- Hid Grok Build's internal `user_info` and `user_query` wrappers when importing or hydrating conversation history.
- Prevented ACP session loading from crashing when a provider reports a tool call without an optional location path.

## 1.1.3 - 2026-08-08

### Added

- Redesigned Settings into four stable top-level tabs (General, Providers, Advanced, About) with a compact provider card grid, inline enable toggles, and a full-width provider details panel instead of one top-level tab per provider.
- Added Advanced hub management for provider skills, subagents/agents, MCP servers, environment variables, and commands, including vault skill catalog entries and Gemini/Qwen agent and command editors.
- Added Grimoire-owned ACP MCP storage under `.grimoire/mcp/<provider>.json` and inject those servers into ACP provider sessions.

### Improved

- Report provider card status as CLI detected or not detected only, without starting model-catalog discovery just to fill the settings overview.
- Resolve Gemini, Qwen, Grok Build, OpenCode, MiMoCode, and Kimi Code CLIs from configured paths, provider `PATH`, the enhanced GUI process `PATH`, and provider-specific fallbacks so PATH-installed binaries are detected reliably.
- Rebuild the live Settings UI immediately when the language changes so tab labels and lazy content switch without reopening the settings window.
- Harden ACP session resume for OpenCode-family providers and Grok Build: failed `session/load` keeps native store paths for history hydrate, notifies the user, and starts a fresh session instead of wiping recoverable state.
- Split the large chat tab implementation into focused settings, DOM, scroll, context, and provider UI modules for clearer ownership and safer maintenance.
- Derive `TranslationKey` types from the English locale catalog so every UI string stays type-checked as translations grow.
- Refresh README settings screenshots to match the current settings hub.

### Fixed

- Close symlink-based workspace path escapes in ACP containment checks by resolving symlink ancestors and path segments with realpath-aware checks.
- Route Gemini ACP permission requests through the shared approval UI and keep write approvals consistent across ACP providers.
- Prefer built-in/default model ownership when several providers claim the same model id, and set Codex as the product default chat provider.
- Invalidate in-flight tab and stream work on teardown so abandoned turns cannot write into the wrong surface.
- Scope bang-bash to the active tab provider and tighten related safety and accessibility edge cases.
- Prevent `path` unit tests from leaking a `realpathSync` mock into later suites.

## 1.1.2 - 2026-08-04

### Added

- Added Grok Build subagent lifecycle rendering from native spawn, wait, completion, failure, and asynchronous activity.

### Improved

- Migrated the primary compiler and typecheck path to native TypeScript 7.0.2 while retaining the TypeScript 6 compatibility API required by current ESLint and Jest tooling.
- Synced the English and localized README documentation with the 1.1.0 tab, history, navigation, completion-time, Parallel workers, settings, and composer experience; added Korean and Portuguese variants.
- Clarified all provider account, network, storage, and dependency-review boundaries, including the current MCP SDK and patched dependency targets used by the release gate.
- Updated direct and transitive dependencies to their latest compatible releases, refreshed tracked advisory floors, and kept the Obsidian-pinned CodeMirror packages on their required peer-compatible versions.
- Refined chat history, navigation, tool-call, tab, composer, context-usage, and subagent surfaces for more consistent responsive behavior and accessibility; kept the plugin version in Settings instead of the chat header.
- Redesigned permission requests with a clear full action or target, readable long-command previews, separate project and user persistence choices, compact vertical actions, keyboard shortcuts, and accessible labeling while preserving provider-native decision values.
- Showed the Stop control while a parent turn has detected subagent activity and kept Escape available as the general active-turn interrupt without presenting the control as individual background-agent cancellation.

### Fixed

- Completed localization for plugin commands, the ribbon, resume and instruction surfaces, What's New, inline editing, storage, and common file/context notices across all ten UI languages; registered command and ribbon labels now refresh immediately when the language changes.
- Kept every permission decision reachable in short panes, preserved full requested-action labels, and prevented long permission content from clipping the dialog.
- Kept TODO and progress summaries from appearing complete while work remains, and normalized Grok subagent labels and lifecycle states from native tool activity.
- Prevented Qwen child-agent streams from leaking into the parent response and restored parent-session context-window reporting for turns that use subagents.

## 1.1.1 - 2026-08-03

### Improved

- Shortened Qwen Token Plan model names in the compact composer toolbar while preserving the full account-plan label in the model menu, search, accessibility name, and tooltip.
- Updated GitHub release automation and shared MCP dependencies to their current compatible releases.

### Fixed

- Loaded every model reported by the signed-in Qwen Code account, including Token Plan and DeepSeek models, instead of keeping an older GLM-only visibility cache.
- Applied the same authoritative live-catalog reconciliation to Gemini CLI (Legacy) and Antigravity so newly reported models cannot remain hidden behind stale saved model lists.

## 1.1.0 - 2026-08-03

### Added

- Completed the Grimoire interface translation catalog across all ten supported languages, covering chat controls, tool activity, plans, permissions, background tasks, history, settings, provider configuration, notices, and accessibility labels.
- Added browser-style tab management with right-click actions to close, close others, close tabs to the right, rename, or duplicate a tab; middle-click closing; and a timed Undo action that restores closed tabs with their drafts and position.
- Added direct open-in-new-tab actions to chat history, including modifier-click and middle-click workflows, while keeping renamed conversations synchronized across open Grimoire views.
- Added a five-way floating navigator for long conversations with top, previous prompt, conversation directory, next prompt, and bottom controls.
- Added localized completion timestamps beside message copy actions, with compact same-day formatting and full date/time tooltips.
- Added a redesigned **Parallel workers** approval card that shows the inherited model, lets users choose which proposed tasks to run, and launches only the selected worker tabs.

### Improved

- Rebuilt Settings on Obsidian's declarative Setting API with native settings search, theme-aware sections, consistent control sizing, accessible provider-tab overflow, and a permanent What's new entry.
- Unified provider settings across Claude Code, Codex, OpenCode, Grok Build, MiMoCode, Kimi Code, Antigravity, Gemini CLI (Legacy), and Qwen Code, including provider-local enable controls, model search and aliases, and consistent agent, command, environment, and CLI-path editors where supported.
- Reworked the composer into a compact responsive toolbar with consistent model, reasoning, permission, service-tier, MCP, external-context, workspace, usage, and Parallel workers controls.
- Kept model menus usable while live catalogs refresh or fail by preserving fallback choices, grouped provider search, account usage readouts, and provider branding.
- Unified spacing, typography, copy feedback, status treatment, and accessibility across messages, thinking, tool calls, diffs, questions, permissions, plans, progress, and subagent blocks.
- Used each provider's registered display name and color for model groups, tab activity, runtime-context activity, and diagnostics instead of falling back to Claude styling for newer providers.

### Fixed

- Kept long What's New cards compact with an independently scrollable release-notes body while leaving the title and actions visible.
- Reported missing or unlaunchable Codex and ACP provider CLIs immediately with the real command or working-directory error instead of hanging until the 30-second initialization timeout.
- Preserved terminal process failures for late transport subscribers, rejected requests against already-closed transports, and made Windows command-shim startup and shutdown handling more reliable.
- Prevented the same stored conversation from opening in multiple tabs or Grimoire views, avoiding competing saves and stale message overwrites.
- Localized common startup, runtime-readiness, session-creation, and request failures for Gemini CLI (Legacy), Qwen Code, OpenCode, MiMoCode, Kimi Code, and Grok Build; localized empty-response failures for OpenCode, MiMoCode, and Kimi Code; and localized provider-specific Claude and Antigravity failures across every supported language.
- Standardized the user-facing **MiMoCode** name in settings, commands, permissions, and diagnostics.
- Rejected unknown provider identifiers when loading stored sessions while preserving legacy sessions that predate provider metadata.

### Compatibility

- Grimoire now requires Obsidian 1.13.0 or newer.

## 1.0.40 - 2026-07-31

### Added

- Added the opt-in Qwen Code ACP provider with native persistent sessions and resume, live model and mode discovery, streaming activity, image input, commands, file approvals, and usage metadata when Qwen reports it.
- Added Qwen reasoning effort controls and structured Qwen questions in the shared inline question UI.

### Improved

- Made long provider waits visible after 10 seconds without output by showing the active provider and elapsed time; the indicator pauses for questions and permissions.
- Made horizontally scrolling provider settings tabs easier to use.

### Fixed

- Applied Qwen's selected effort with its native `/effort` command before the next normal turn and retained it for the active session.
- Rendered Qwen's actual structured questions and answer controls instead of showing a generic permission request.

## 1.0.39 - 2026-07-27

### Improved

- Loaded Claude models, context metadata, and supported effort levels from the authenticated Claude Code runtime, with saved, API, and built-in fallbacks when live discovery is unavailable.
- Recognized Claude Sonnet 5 as a native 1M-context model and removed the obsolete manual Opus and Sonnet 1M toggles.

### Fixed

- Preserved each conversation's selected model across tab switches, reloads, forks, and sends for every provider, including explicit conversation-model selection in Gemini and Antigravity.

## 1.0.37 - 2026-07-25

### Fixed

- Resolved the `@hono/node-server` dependency advisory reported by Obsidian community-plugin review by pinning its patched 2.0.11 release. The server adapter remains excluded from Grimoire's bundled plugin runtime.

## 1.0.36 - 2026-07-25

### Added

- Added a global **Excluded folders** setting next to excluded tags. Notes inside these folders are kept out of automatic context, search, linked-note loading, editor selection, Canvas context, and project workspaces unless the user explicitly includes a path with `@`.

### Improved

- Streamlined Grimoire's shared agent prompt to reduce context overhead, preserve provider-native project instructions, and clarify vault paths, turn context, excluded-folder boundaries, Obsidian conventions, and image handling.
- Updated compatible production and development dependencies, including Claude Agent SDK 0.3.220 and patched transitive releases for Hono, Fast URI, and Express body parsing.
- This update changes foundational agent guidance. If tasks start working worse or you notice a provider-specific regression, please [open an issue on GitHub](https://github.com/sandsaber/Grimoire/issues).

## 1.0.35 - 2026-07-20

### Improved

- Made Grimoire settings discoverable through Obsidian 1.13 settings search while preserving the existing settings UI on Obsidian 1.12.7.
- Refreshed compatible project dependencies and aligned the minimum supported Obsidian version with the tested 1.12.7 stable release.
- Updated localized Grok Build documentation for Grok 4.5 model discovery and unified weekly usage reporting.

### Fixed

- Aligned HTML and SVG creation with Obsidian's DOM helpers and removed the partially supported completed-task decoration color flagged by community-plugin review.

## 1.0.34 - 2026-07-19

### Added

- Added repository contribution guidelines and a pull request template covering architecture, security, testing, attribution, and release expectations.

### Improved

- Aligned Grok permission modes with native Grok Build launch behavior while keeping the user's saved Safe, Auto-approve, or Plan choice authoritative.

### Fixed

- Launched Grok Build with its native `--always-approve` flag in Auto-approve mode so approved write operations do not prompt again. (#10)
- Reconciled saved Grok models with the account's current ACP catalog and stopped sending retired model IDs through `session/set_model`.
- Restored Grok's unified weekly usage indicator, reset date, and extra-credit balance through the native billing contract with authenticated compatibility fallbacks.
- Kept Grok's synthetic skills reminders out of visible chat history, including reminders already imported into failed conversations.
- Loaded older Grok sessions whose ACP model records omit display names or the current model instead of failing during normalization.

## 1.0.33 - 2026-07-12

### Added

- Added task-level progress updates for Codex reasoning summaries and ACP plans from OpenCode, MiMoCode, and Kimi Code.
- Added shared provider-error classification for authentication, quota, rate-limit, unavailable-model, and transport failures.

### Improved

- Asked every main agent to communicate meaningful phase changes, recovery attempts, and completion outcomes without exposing private reasoning.
- Reworked permission requests with semantic command summaries, full-command tooltips, clearer shell copy, responsive actions, and readable multi-line commands.
- Reduced Codex tool noise by keeping typed tool activity while suppressing duplicate raw execution wrappers.

### Fixed

- Reconnected OpenCode, MiMoCode, and Kimi Code after early JSON-RPC transport closures without reviving stale turns during runtime cleanup.
- Recovered hidden MiMoCode API errors from native session metadata, preserved them in restored history, and switched unsupported Ultraspeed selections to an available base model.
- Replaced empty ACP turns with actionable errors and recorded successful prompt enqueue metadata consistently.
- Normalized Grok execute approvals as shell commands and prevented long permission titles from breaking the dialog layout.

## 1.0.32 - 2026-07-12

### Improved

- Documented Grimoire's composer keyboard shortcuts across every localized README.

### Fixed

- Made `Shift+Tab` cycle the complete Safe, Auto-approve, and Plan permission sequence instead of skipping Auto-approve. (#6)

## 1.0.31 - 2026-07-12

### Added

- Added a translated **Delete all** action to History, with a confirmation dialog before clearing every saved conversation.

### Improved

- Made the Codex plan-usage indicator explicitly show used quota and the time of its last successful refresh.

### Fixed

- Restored complete Grimoire chat history when a Codex replacement session persists only a replayed suffix.
- Kept Codex replay prompts, selected-file context, and injected plugin instructions out of visible user message bubbles.
- Correctly marked context files as loaded when a shell command reads the file successfully before a later command segment fails.

## 1.0.30 - 2026-07-11

### Fixed

- Preserved the visible Grimoire conversation when Codex or Gemini must create a replacement native session, while avoiding duplicate history during normal session continuation.
- Restored prior conversation context when OpenCode, MiMoCode, Kimi Code, or Grok retries a turn in a newly created ACP session after a transport failure.

## 1.0.29 - 2026-07-10

### Fixed

- Loaded Codex model options from the signed-in CLI account and kept the last successful catalog, so account-specific GPT-5.6 variants remain available in the picker after restarting Obsidian.
- Added diagnostic logging for Codex model catalog refreshes instead of silently falling back to the static model list when discovery fails.

## 1.0.28 - 2026-07-09

### Fixed

- Restored visible chat history after restarting Obsidian by keeping a Grimoire display fallback when provider-native transcripts are unavailable.
- Passed pinned vault `@` files into provider prompts so instructions selected with `@instructions.md` are available to Codex, OpenCode, Grok, MiMoCode, Kimi Code, Antigravity, and Gemini turns.
- Marked the current note chip as the default edit target when users ask to apply instructions without naming another target file.
- Aligned Codex turn context with Grimoire's shared XML context format and kept appended context out of restored user-message display text.

## 1.0.27 - 2026-07-07

### Fixed

- Fixed model picker search so multi-word queries such as `claude sonnet` match across provider names and model labels.
- Kept Claude Code's `Sonnet 5` alias discoverable when Antigravity also exposes older Claude Sonnet models.

## 1.0.26 - 2026-07-02

### Improved

- Redesigned the Plan complete approval surface with a collapsible card, rendered plan preview, permission summary, and keyboard-friendly approval rows.
- Kept plan approval in the current provider session so Claude Code exits Plan mode cleanly without starting a separate Grimoire session.
- Documented the new Plan complete approval behavior across the README set.

### Fixed

- Removed the unsupported Approve (new session) path from ExitPlanMode and the related pending new-session state.

## 1.0.25 - 2026-06-26

### Improved

- Added Plan mode to the shared permission control so supported providers can cycle through Safe, Auto-approve, and Plan from the composer.
- Documented both ways to enter or leave Plan mode: the permission control and the `Shift+Tab` shortcut.
- Documented how Claude Code `AskUserQuestion` and Codex `request_user_input` appear in Grimoire's shared inline question UI.

### Fixed

- Normalized the Plan permission label across Claude and Codex.
- Removed the Plan-only composer border so Plan mode uses the same inactive composer styling as Safe and Auto-approve.

## 1.0.24 - 2026-06-21

### Fixed

- Bundled What's New release notes into the plugin so Obsidian auto-updates can show them without downloading extra files.
- Removed the unsupported `CHANGELOG.md` release asset from the Obsidian release package.

### Improved

- Added a direct Full changelog link from What's New surfaces to the repository changelog.

## 1.0.23 - 2026-06-21

### Added

- Added a bundled changelog as the source of truth for Grimoire release notes.
- Added a one-time What's New card inside the Grimoire chat window after updates.
- Added a persistent What's new action in Settings for manually opening the current release notes.

### Improved

- Kept automatic release notes inside Grimoire's own window instead of showing a global Obsidian modal.

## 1.0.22 - 2026-06-20

### Added

- Added Antigravity CLI support with provider settings, launch handling, and model discovery.
- Added Gemini CLI (Legacy) as a provider option for users who still rely on the classic Gemini CLI.

### Improved

- Documented provider limitations and release tag expectations for safer Obsidian releases.

### Fixed

- Fixed Antigravity launch assertions and localized provider limitation copy.
