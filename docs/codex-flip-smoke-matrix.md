# Codex flip — manual smoke matrix

The Codex flip (`10722cd`) moved chat execution onto the execution kernel and deleted
`CodexChatRuntime`. Automated gates prove the wiring, the contracts, and one whole turn over a fake
connection; **this is the layer they cannot reach** — the live `codex app-server` on a real vault.

Run it against a release build installed in a vault (`npm run build:release`, then the plugin folder
copy). Record the date, the Codex CLI version, and one line per row. A row that fails is a stop
condition for the flip, not a bug report for later: the flip reverts as a single commit.

## Why this matrix is bigger than wave 1's

Antigravity declares no resume, plan mode, fork, images, or steering, so its matrix was five rows.
Codex declares nearly all of them, and each is a path the kernel now serves for the first time:

| Capability | Declared | Why it needs a live daemon |
|---|---|---|
| persistent runtime | yes | the daemon outlives a turn; the kernel owns its lifetime now |
| native history | yes | the thread is resumed by id, and the id is written by the new path |
| plan mode | yes | plan turns are a different `collaborationMode` and a different surface |
| fork | yes | the fork resumes at an id the turn metadata supplies |
| image attachments | yes | files are written host-side and read by the daemon, possibly across WSL |
| instruction mode | yes | orchestrator instructions ride the turn rather than the thread |
| turn steer | yes | input joins a turn that is already running |
| interactions | yes | approvals and questions cross four processes to reach the surface |

## Which model to run it on

`gpt-5.4-mini` — cheap, and what this account's `~/.codex/config.toml` already selects. The rows are
about the path, not about the answer.

`gpt-5.3-codex-spark` is **not** the cheap option: a ChatGPT account refuses it outright ("not
supported when using Codex with a ChatGPT account"), and the refusal is worth knowing for row 21 —
it arrives as a `thread/status/changed: systemError` and an `error` notification.

## The half that runs itself

Eight rows are driven headlessly by
`tests/integration/app/execution/codex/CodexLiveSmoke.integration.test.ts`, against a real
`codex app-server`. It is skipped unless asked for, because it starts a CLI and spends the account's
tokens:

```bash
GRIMOIRE_CODEX_LIVE=1 node scripts/run-jest.js --selectProjects=integration \
  --runTestsByPath tests/integration/app/execution/codex/CodexLiveSmoke.integration.test.ts
```

Through `scripts/run-jest.js` rather than bare `npx jest`: the runner passes `--localstorage-file`,
and without it every suite that writes provider settings fails on Node 25 with
`storage.getItem is not a function` — the hostname-keyed CLI paths read `window.localStorage`, which
that Node defines as a half-built global unless the flag names a file.

`GRIMOIRE_CODEX_TRACE=1` adds the daemon's own notifications and every RPC beside the chunks, which
is how each of the defects it found was read rather than guessed. `GRIMOIRE_CODEX_CLI` points at a
binary other than `codex` on `PATH`, and `GRIMOIRE_CODEX_MODEL` overrides the model.

It covers rows 1, 2, 6, 8, 12, 14, 16 and 21 — all green as of `875a45d`. **The rows below that it
does not cover are the ones a person has to look at**: whether the tool card, the diff, the plan, the
badges and the two-tab behaviour actually render.

## The matrix

| # | What to do | What must happen |
|---|---|---|
| 1 | Send a plain message | The answer streams; the turn ends; no error notice |
| 2 | Ask for something that runs a command | The tool card appears with the command, then its output and exit status |
| 3 | Ask for a file edit | The diff renders as a tool result, and the file changes on disk |
| 4 | Watch the reasoning while a turn runs | Thinking text streams, and the reasoning summary shows as its widget — each once, never twice |
| 5 | Send a message with an image attached | The model describes the image; the temp directory is gone afterwards |
| 6 | Send `/compact`, then `/compact please` | The first compacts the thread; the second is refused with "does not accept arguments" |
| 7 | Type a second message while a turn is running | It is added to the running turn rather than queued, and the answer accounts for it |
| 8 | Trigger a command approval, answer **Allow once** | The command runs, the prompt closes, and the composer unlocks |
| 9 | Trigger an approval and press **Escape** | The turn is cancelled rather than the command merely refused |
| 10 | Trigger an approval and press **Stop** while it is showing | The prompt disappears, the composer unlocks, and the turn ends as interrupted |
| 11 | Answer a question the model asks (`requestUserInput`) | The answers reach the model; the modal closes |
| 12 | Turn on plan mode and send a message | The plan renders as it streams, and the plan-completion state is recorded |
| 13 | Turn on orchestrator mode and send a message | The worker-plan JSON block is produced, once — not stated twice |
| 14 | Reload Obsidian, reopen the conversation, send a message | The thread resumes: the model remembers the conversation without it being replayed into the prompt |
| 15 | Fork a conversation from an earlier message and continue | The fork takes, the rollback lands on the chosen message, and the new turn answers in that context |
| 16 | Press **Stop** mid-answer | The turn ends promptly and the `codex` process tree is gone (`ps`/Task Manager) |
| 17 | Watch the plan-limit badge across a few turns | It shows a plan and a used fraction, and updates |
| 18 | Watch the context-window indicator | It updates as the turn consumes tokens |
| 19 | Open two Codex tabs and run turns in both | Answers, approvals and images land in the tab that asked; neither tab's images vanish |
| 20 | Close a tab mid-turn | The turn is cancelled, nothing is left running, and the vault has no leftover temp directories |
| 21 | Fail a turn deliberately (kill the daemon, or a bad model) | One error is shown, in the daemon's own words |
| 22 | Restart Obsidian while a turn is running | The next start reconciles: the turn shows as finished or interrupted, never as still running |

## Known gaps, expected to fail nothing above

- **hooks, MCP startup status, remote control, whole raw responses, `thread/started`** are recorded in
  `wireVocabularyCoverage` as notifications the connection does not consume. Nothing in the matrix
  depends on them; if a row fails in a way that looks like one of them, that is the finding;
- **rewind** is declared unsupported for Codex and always has been. Row 15 is fork, not rewind.

## Recording the result

Append the outcome to `docs/provider-execution-migration-progress.md` as a checkpoint entry: date,
CLI version, one line per row, and — if any row failed — what was reverted or what the next action
is. Until that entry exists, wave 2 is wired and not certified.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-08-21 | 0.147.0 | live: 1, 2, 6, 8, 12, 14, 16, 21 | — | re-run after the two review passes; the shared kernel changes left every row green |
