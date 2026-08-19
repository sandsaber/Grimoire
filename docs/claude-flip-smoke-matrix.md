# Claude flip — manual smoke matrix

The Claude flip moved chat execution onto the execution kernel and deleted `ClaudeChatRuntime`.
Automated gates prove the wiring, the contracts, and one whole turn over a fake SDK; **this is the
layer they cannot reach** — the real `@anthropic-ai/claude-agent-sdk` in a real vault.

Run it against a release build installed in a vault (`npm run build:release`, then the plugin folder
copy). Record the date, the Claude CLI version, and one line per row. A row that fails is a stop
condition for the flip, not a bug report for later: the flip reverts as a single commit.

## Why this matrix is the longest of the three

Antigravity declares no resume, plan mode, fork, images or steering, so its matrix was five rows.
Codex declares nearly everything and its matrix was twenty-two. Claude declares everything Codex does
except turn steering, **plus** three nobody has flipped before:

| Capability | Declared | Why it needs the real SDK |
|---|---|---|
| persistent runtime | yes | the SDK query outlives a turn; the kernel owns its lifetime now |
| native history | yes | the session is resumed by id, and the id is written by the new path |
| plan mode | yes | `EnterPlanMode` is auto-approved and never reaches a permission callback |
| **rewind** | yes | **first flip with one**: preview, backup, apply, restore-on-failure |
| fork | yes | the fork resumes at an assistant message id the turn metadata supplies |
| image attachments | yes | images ride in the user message rather than in files |
| instruction mode | yes | orchestrator instructions ride the turn |
| provider commands | yes | slash commands are resolved by the SDK, not by Grimoire |
| MCP tools | yes | Grimoire-owned servers are injected into the SDK's options |
| **native agents** | yes | **first flip with them**: subagents run inside a turn and report separately |
| interactions | yes | approvals, questions **and plan decisions** — three kinds, not two |

## Which model to run it on

Whatever the vault is configured for. The rows are about the path, not about the answer; a cheaper
model makes the long rows cheaper and changes nothing they assert.

## The matrix

| # | What to do | What must happen |
|---|---|---|
| 1 | Send a plain message | The answer streams; the turn ends; no error notice |
| 2 | Ask for something that runs a command, approve it | The prompt appears with the command, **Allow once** runs it, and the card shows its output |
| 3 | Ask for a file edit | The diff renders as a tool result, and the file changes on disk |
| 4 | Watch the reasoning while a turn runs | Thinking streams, and each sentence appears **once** — not twice |
| 5 | Send a message with an image attached | The model describes the image |
| 6 | Answer a question the model asks (`AskUserQuestion`) | The choices render, including **Other**; the answer reaches the model |
| 7 | Turn on plan mode and send a message | The turn plans; the toolbar shows plan mode without being switched by hand |
| 8 | Approve a plan (`ExitPlanMode` → approve) | The session leaves planning in the mode it was given, and the work proceeds |
| 9 | Refuse a plan with feedback | The model revises; the turn does **not** end |
| 10 | Trigger an approval and press **Escape** | The turn is cancelled rather than the tool merely refused |
| 11 | Trigger an approval and press **Stop** while it is showing | The prompt disappears, the composer unlocks, and the turn ends as interrupted |
| 12 | Reload Obsidian, reopen the conversation, send a message | The session resumes: the model remembers without the history being replayed |
| 13 | Fork a conversation from an earlier message and continue | The fork takes, and the new turn answers in that context |
| 14 | **Rewind** a conversation (conversation only) | The conversation returns to that point; no file changes |
| 15 | **Rewind** with code (`code-and-conversation`) | The files listed are restored, and the surface reports how many changed |
| 16 | **Rewind that fails** — make a listed file read-only first | The turn reports the failure **and the files are back as they were** |
| 17 | Ask for a subagent (`Task`) | The subagent card appears, runs, and reports its own result |
| 18 | Stop a running subagent | It stops, and the parent turn survives it |
| 19 | Run a slash command the SDK owns | It resolves and runs; Grimoire does not answer it locally |
| 20 | Use an MCP tool from a Grimoire-owned server | It appears in the tool list and runs |
| 21 | Use a trusted read-only MCP tool in normal mode | It runs with **no prompt at all** |
| 22 | Press **Stop** mid-answer | The turn ends promptly and no `claude` process is left behind |
| 23 | Open two Claude tabs and run turns in both | Answers and approvals land in the tab that asked |
| 24 | Close a tab mid-turn | The turn is cancelled and nothing is left running |
| 25 | Fail a turn deliberately (bad model, or revoke auth) | One error is shown, in the SDK's own words |
| 26 | Restart Obsidian while a turn is running | The next start reconciles: the turn shows as finished or interrupted, never as still running |
| 27 | Watch the context-window indicator across a few turns | It updates, and the fraction is against a real window |
| 28 | Watch the plan-limit badge | It shows the plan and updates |

## Known gaps, expected to fail nothing above

- **auxiliary work** — titles, instruction refinement, inline edits — still runs on its own
  cold-start SDK queries, not through the kernel. That is M5's, and a session or process conflict
  between the two paths is a stop condition rather than an expected difference;
- **the workspace half** — commands, agents, MCP settings, models, the settings tab — is still
  registered the legacy way. The module context's workspace slots throw by name, and nothing in the
  flipped path calls them;
- **turn steering** is declared unsupported for Claude and always has been. There is no row for it.

## Recording the result

Append the outcome to `docs/provider-execution-migration-progress.md` as a checkpoint entry: date,
CLI version, one line per row, and — if any row failed — what was reverted or what the next action
is. Until that entry exists, wave 3 is wired and not certified.
