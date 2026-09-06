# Changelog

## 2.0.0 - 2026-09-06

The provider runtime is rebuilt on an execution kernel. Every provider runs through it, and what a chat surface draws is read from the kernel's record of a turn rather than from whether the provider stopped talking. Existing conversations, settings, and provider-owned files are read as they are; nothing needs migrating.

### Changed

- Every turn now ends in exactly one recorded outcome - succeeded, failed, cancelled, interrupted, rejected before dispatch, or unknown. A connection that drops mid-answer no longer renders as a finished reply, and a turn whose fate the provider never confirmed is shown as a warning instead of being drawn as success.
- A turn that never reached the provider - a permission check that refuses on the default mode, a session the CLI would not open - now says so in the conversation, where before it left an empty assistant message.
- Cancelling a turn dispatches the cancel and waits for the provider to confirm it stopped. The interruption is drawn at once, as before; what changed is that the record of the turn is no longer written until the provider has actually answered.
- The plugin follows the vault's theme and accent colour on every surface. The accent had been a fixed violet on thirty-two of them, because Obsidian defines no accent triple and the fallback was silently used. Scrollbars, hovers, menus, and backdrops no longer carry dark-only colours into light themes, and the settings sheet is drawn with Obsidian's own controls.
- Nineteen clickable elements that only a mouse could reach - including a modal that offered a choice the keyboard could only decline - now have a role, a name, a tab stop, and Enter/Space handling.
- Session metadata in `.grimoire/sessions/` is written as a versioned record. A file written before the envelope existed is read as revision 1 and rewritten in place at its next write, never renamed. A writer applies only the fields it changed, so two views of one conversation no longer overwrite each other's edits.

### Added

- `.grimoire/control/` holds the kernel's lifecycle records: which run owns which process, generations, state, terminals, and the evidence needed to recover after a crash or a quit mid-turn. They carry no prompts, no transcripts, no secrets, and no provider payloads, and deleting a conversation deletes its records with it. An older plugin build ignores the directory, so a downgrade is safe.
- A run left `dispatching` or `running` by a quit is classified honestly at the next load instead of being shown as still running.
- Agent work started from a conversation is durable: a restart shows what became of it rather than forgetting it.

### Fixed

- Grok Build's context meter, Kimi Code's, and Qwen Code's read usage from the turn that produced it, so the meter no longer lags a turn behind or stays empty on a provider that reports usage only after the prompt returns.
- Resuming an OpenCode session no longer opens a fresh session on every reload. OpenCode answers `session/load` with its config options and no session id, and requiring the echo turned every resume into "the agent returned another session".
- Stopping the title generation for one tab no longer stops it for every other open tab.

## 1.3.2 - 2026-09-06

### Added

- Antigravity turns can now carry images. `agy` has no image flag and its print-mode transport is text-only, so an attachment rides along as a temp file whose path the prompt names: the agent opens it, answers about it, and the file is removed when the turn ends - on success, failure, and cancel alike. The file keeps the name you gave it in any alphabet, since that name is the only label the image carries into the CLI, and an image that could not be handed over is now named in the chat instead of quietly missing from the answer. Print-mode history holds no images, so a follow-up question about the same picture needs it attached again.
- Added an auto-rename control to the tab rename dialog and the tab context menu, so a conversation can be re-titled from its own content without clearing the field first (#123).
- Conversation titles are now generated in the interface language. The title prompt is English, so a Russian vault still got English tab titles; the request now names the plugin locale, for every provider. Titles that arrive wrapped in a model's preamble - `Here is your title:` - are unwrapped rather than becoming the title (#120).
- Added the Refresh models button to the Codex, Gemini CLI, and Qwen Code settings tabs, matching the one Claude already had. A model added on the service side, or a CLI reinstalled somewhere else, can now be picked up without disabling and re-enabling the provider. A refresh that retires the selected model moves the selection off the dead id instead of leaving it there (#129, #131).

### Improved

- Image attachments now live in the vault at `.grimoire/attachments/<sha256>.<ext>` instead of being serialized into session metadata. A message keeps the hash, so a conversation update no longer rewrites megabytes of base64 on every field change, the same screenshot across ten conversations is one file, and deleting a conversation reclaims what nothing else references. Images are scaled to at most 2000 px on the long edge on the way in, which is also why a large screenshot is no longer refused for a size it will not have once stored. Attachments saved before the store keep working exactly as they did (#126).
- The fallback conversation title - what a conversation is called before a generated one arrives, and instead of one when title generation is unavailable - is now built rather than cut at the first punctuation mark. Measured over 135 real conversations: 97 unique titles became 135, four titles that leaked `<git_status>`-style context blocks became none, and sentences no longer break inside a version number such as `1.4.5` (#118).
- Every title source now shares one 100-character budget and one truncation, so a generated title, a fallback title, and a fork title no longer end differently on the same text, and none of them cuts through an emoji. The prompt still asks for about 50 characters; the budget is a safety net against a title being mutilated mid-word, not a target (#124).
- Closing the full-size image viewer with Escape no longer cancels the running turn along with it (#126).

### Fixed

- Stopped reopening a Claude conversation from duplicating every message in it. Hydration merged the conversation's own messages with the transcript's while keying only on ids drawn from two namespaces that can never collide, so each open appended a second copy of the whole exchange and saved it back to session metadata. Conversations already stored with duplicates repair themselves the next time they are opened (#127, #128).
- Fixed every Grok Build turn failing with `Cannot read properties of undefined (reading 'trim')` once a saved session was reopened. ACP's `session/load` speaks about the session the client named, so an agent need not echo the id back - Grok Build 1.0.13 answers with `models` and `_meta` alone - and the runtime bound itself to that missing field. Resuming a Grok conversation had never once succeeded: the load failed, a fresh session was created behind it, and the whole transcript was replayed into it as the next prompt. The runtime now keeps the id it asked to load, the way the Qwen adapter already did; Gemini CLI, OpenCode, MiMoCode, and Kimi Code carried the same binding and are fixed with it.
- Kept an image attached to a message when a conversation is rebuilt from the provider's own log. Grok Build, OpenCode, MiMoCode, and Kimi Code replace the stored turns with their native transcript when a chat is opened, and a turn rebuilt that way carries no attachment - Grok saves the picture into its session's `assets` directory and names the path in the prompt instead of keeping it on the message. The stored attachment now travels onto the matching turn, so reopening a chat no longer empties it of the images it was about.
- Stopped a reopened Codex conversation from showing `<image name=[Image #1] path="/tmp/...">` where the attached picture belongs. Codex records an image input as that wrapper in its own transcript, so the hydrated turn stopped matching the turn Grimoire had stored - and the stored turn, the only one carrying the attachment, was discarded along with the thumbnail. The wrapper is now kept out of the displayed message, which also lets the stored turn survive hydration with its image intact.
- Codex, Gemini CLI, and Qwen Code now notice new models after the CLI is upgraded in place. Each catalog was keyed on the CLI path and environment, none of which an upgrade over the same path touches, so a settled catalog was never probed again: measured against codex-cli 0.153.4, three of the seven models it reports were unreachable and a retired one was still offered as the default. The key now carries the binary's size and modification time, the way Claude's already did (#129, #131).
- Stopped the model picker from cutting a label in half. It split on the last `/`, which in a Qwen ModelStudio name such as `[ModelStudio Token Plan for Global/Intl] qwen3.7-plus` belongs to the bracket rather than to a vendor prefix. A slash inside brackets or parentheses is now ignored, and a leading `[qualifier]` is read the same way a `vendor/model` prefix already was (#132).
- Grok Build now keeps a model declared in `config.toml` as `[model."<id>"]`, which is the supported way to point Grok at a local OpenAI-compatible endpoint. Selecting one silently fell back to the frontier default, because the catalog was rebuilt from the cloud cache alone right before each prompt. A config-declared model also wins over a cached entry of the same id, which is the order Grok itself resolves them in (#121).
- Passed those local model definitions on to Grok's auxiliary processes, so a locally served model can be used for title generation and the slash-command catalog instead of being unknown to them. The auxiliaries keep the permission mode Grimoire assigns them rather than inheriting the vault's (#122).
- Named a Codex image attachment after the file you picked again. A field-name mismatch meant every image reached Codex as `image-1`, `image-2`, and so on, with your own file name thrown away.
- Left a Claude question dialog Grimoire cannot render unanswered instead of reporting a dismissal you never made, and recorded the reason in the debug log. Answering a dialog kind the host never declared closed that dialog under whichever client could display it (#109).
- Updated the Claude Agent SDK to 0.3.241, and cleared the `fast-uri` and `qs` advisories that had left `npm audit` red on production dependencies.

## 1.3.1 - 2026-08-31

### Fixed

- Restored Codex's ability to ask you a question outside Plan mode. Codex keeps its `request_user_input` tool behind an experimental feature flag in its default collaboration mode, so a question the agent tried to ask in Safe or Auto mode was refused with `request_user_input is unavailable in Default mode` and the turn carried on with a guess instead. Grimoire now starts the Codex app-server with that feature enabled, using the configuration override rather than the `--enable` flag so that a Codex build which does not know the feature still starts instead of failing to launch at all (#110).
- Taught Grimoire to render an AskUserQuestion that Claude Code hands over as a user dialog. Newer Claude Code builds can route the question to the host as a `request_user_dialog` control request instead of the permission callback, and Grimoire never advertised that it could display one, so the question degraded to the CLI's no-dialog behavior. It now opens in the same question UI as before: a permission the CLI already denied stays denied, and a dismissed question is reported back as a decline with its reason rather than a silent cancel (#109).

## 1.3.0 - 2026-08-29

### Added

- Follow-ups typed while the agent is working are now queued as separate turns instead of being merged into one message. The queue is a list you can work row by row - edit, remove, or clear it - and the message at the head can be steered into the running turn instead of waiting. A held queue offers Resume.
- Added a notice when a saved session could not be resumed. Grimoire opens a fresh session and the messages above are not in its context, which previously showed up only as the agent quietly having forgotten the conversation; the thread now ends in a marked seam naming the new session, drawn before you type rather than after a turn has been spent.
- Added Refresh buttons for the Claude model catalog and slash-command list, so a newly installed model or command can be picked up without disabling and re-enabling the provider.

### Improved

- Antigravity now streams answer text and tool steps while the run is still open, instead of showing nothing until the CLI finishes. Tool cards close with the output `agy` reports, and their parameter summaries read correctly for `agy`'s PascalCase arguments.
- Grok Build's reasoning-effort picker now offers what the session reports for the selected model, rather than a fixed list, and keeps those levels through a model switch. `xhigh` is available on the models that report it.
- Claude's slash-command list is persisted with the configuration it was discovered under and reused on load, instead of probing a billable session on every start. A probe that finds nothing now backs off instead of retrying immediately.
- Settled model catalogs are no longer rediscovered on a timer. They refresh when the resolved CLI path or provider configuration actually changes, or when you ask.

### Fixed

- Stopped a failed session resume from silently re-sending the entire conversation to the agent. A dropped session was handed the whole transcript as the next prompt, so one failed resume cost what the whole conversation costs - measured at roughly 34k tokens for a short question that needed none of it. The replacement session now starts clean, and the drop is recorded so an editor restart cannot mistake it for a first-ever message (#99).
- Decided a lost session by asking the agent through `session/list` rather than reading the answer out of the error text. Every managed CLI reports a missing session as a generic internal error - Grok Build as `Path not found`, OpenCode and MiMoCode as a bare `Internal error` - so an expired token used to be indistinguishable from a session that was genuinely gone. Authentication and configuration failures now surface instead of silently dropping the conversation's context.
- Fixed the message queue firing at a session that had just failed: a steered follow-up escaped the hold, the hold itself rendered nothing so there was no way to see or resume it, and cancelling a turn while resuming destroyed the queued message.
- Stopped a queue from following you into the next conversation. Switching conversations refilled the composer and re-attached images from the conversation you had just left.
- Kept an edited queue entry in its original position instead of moving it to the end.
- Rendered LaTeX-delimited math (`\(...\)` and `\[...\]`) instead of leaking the delimiters into the message (#81).
- Seeded a model catalog only under the configuration key it was discovered with, so a catalog found for one CLI path is no longer served for another (#98).
- Seeded the Gemini, Qwen, and Codex catalogs when the CLI path resolves after startup, instead of leaving the picker empty until a restart.
- Stopped Claude rewriting its command cache every time the slash-command dropdown opened.
- Translated the Grok subagent Variant, Color, and Steps labels in Russian, Japanese, Korean, and Traditional Chinese. The same three fields were already translated everywhere else in settings, so those languages showed English labels on one screen and their own on another.

## 1.1.10 - 2026-08-25

### Improved

- Stopped the Gemini and Qwen model pickers from launching their CLI every time the dropdown opens. Discovery booted the real CLI over ACP and created a session on each open, which stalled the menu for seconds and flashed a console window on Windows; both providers now reuse the cached catalog like Codex and OpenCode already did, and rediscover immediately when the resolved CLI path or environment changes.

### Fixed

- Stopped Claude from starting a billable Claude Code session on every plugin load just to list models. The ten-minute throttle lived only in memory and nothing seeded it from the catalog already on disk, so each start probed again even with no Claude tab open (#84).
- Restored the plan panel in Claude chats. Claude Code 2.1.233 retired the TodoWrite tool in favour of incremental task tracking, so plans silently stopped appearing - nothing errored, the panel simply never filled. Grimoire now follows the task calls and rebuilds the plan from them.
- Updated the Claude Agent SDK to 0.3.233.

## 1.1.9 - 2026-08-22

### Fixed

- Fixed Antigravity turns failing with `spawn ENAMETOOLONG` on Windows once the conversation grew past roughly 32k characters: when `agy` supports it, the prompt now travels over stdin as stream-json instead of one oversized command-line argument (#69).
- Stopped Antigravity from killing healthy turns at the five-minute mark: the print run now follows a 10-minute inactivity timer refreshed by CLI output and `agy` log-file growth, with a 30-minute absolute ceiling and `--print-timeout 29m` so the CLI self-terminates with a structured result first (#70).
- Kept a fully streamed Antigravity answer even when `agy` flags a run-level error after the agent has already responded — refused tool arguments, stale task kills, scheduler conflicts, and cancellations now surface as a trailing warning note instead of discarding the reply.
- Fixed OpenCode, MiMoCode, and Kimi Code being fully broken on Windows (empty model list, no chat turns): a file-based `OPENCODE_CONFIG`-style env var makes the CLIs' ACP mode hang or crash, so the managed config now travels as config content only and the system prompt is inlined into the config.

## 1.1.8 - 2026-08-20

### Fixed

- Fixed Antigravity on Windows hanging until timeout with no output when the CLI resolves to a `.cmd`/`.bat` wrapper or a bare command name: the multi-line print prompt now reaches `agy` intact through an explicitly quoted `cmd.exe` invocation instead of Node's unquoted `shell: true`.
- Added the vault root to the Antigravity agent workspace: Grimoire probes `agy --help` once for `--add-dir` support and passes `--add-dir <vault>` to `agy --print`, so the agent works directly on your notes and `.cmd` wrapper workarounds are no longer needed.
- Honored Stop while Antigravity is still starting up: a cancelled turn now ends immediately instead of launching the CLI anyway and running to completion.
- Made Antigravity vault skills appear in the slash menu and expand reliably when invoked, instead of silently passing the raw `/skill` text to the model.
- Serialized concurrent Grok Build runtime restarts so rapidly opening chats no longer races the agent startup and interrupts the first turn.

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
