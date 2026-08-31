# Grok flip — manual smoke matrix

The Grok flip moved chat execution onto the execution kernel and deleted `GrokChatRuntime`.
Automated gates prove the wiring, the contracts, and whole turns over a fake ACP agent; **this is the
layer they cannot reach** — a real `grok agent … stdio` process in a real vault.

Run it against a release build installed in a vault (`npm run build:release`, then the plugin folder
copy). Record the date, the Grok CLI version, and one line per row. A row that fails is a stop
condition for the flip, not a bug report for later: the flip reverts as a single commit.

## What makes this one different from OpenCode's

Both are managed ACP subprocesses, and the transport, the launcher, the client adapter, the backend,
the permission bridge and the filesystem are literally the same code. What is Grok's alone is what
these rows are for.

| Difference | Why it needs the real CLI |
|---|---|
| the launch carries the policy | permission mode and reasoning effort are **process arguments**, so changing either must restart the process rather than reconfigure the session |
| its own update envelope | usage, cost and the stop reason arrive on `_x.ai/session_notification`; without them a turn's badge and its ending never appear |
| a mirrored update | some releases send the same update on both channels, and delivering both prints every sentence twice |
| no context window on the wire | the recording observes seven update types and none is a context reading; it comes from Grok's own session log |
| the answer it never sent | Grok finishes turns whose final message never reaches ACP, with the answer written to that log |
| billing over the live transport | the plan indicator is `x.ai/billing`, asked of the running process — no ACP method answers it |
| questions of its own | `ask_user_question` is a server request with its own answer shape, outside the kernel's interactions |
| subagents that end without being asked | `subagent_finished` arrives on the vendor channel; a subagent nobody polls has no other way to complete its block |
| rewind is gone | the live record advertised it and the runtime always refused; the flip removes the dead button |

## The matrix

Rows 1–6 are the turn. Rows 7–12 are the session. Rows 13–17 are what the protocol asks of the
client. Rows 18–21 are what five surfaces ask when nobody is in a conversation.

| # | Row | What proves it |
|---|---|---|
| 1 | A turn answers, and the answer streams | text appears while it runs, not only at the end |
| 2 | A tool call renders as a card, with its output | the card shows the normalized tool name, not `tool` |
| 3 | A diff renders for an edit | the edit card shows the change, not raw text |
| 4 | Thinking renders separately from the answer | `agent_thought_chunk` is not printed as the answer |
| 5 | The context badge fills in | the reading comes from the session log, and lands on the turn that earned it |
| 6 | Cancelling a turn stops the agent | the process stops working; the tab is usable immediately |
| 7 | A second turn continues the same session | no history is re-sent, and the agent remembers turn 1 |
| 8 | Reloading Obsidian resumes the conversation | the transcript hydrates from the session directory and turn 3 continues it |
| 9 | Deleting the session outside Grimoire is legible | the turn says what to do rather than repeating a generic failure |
| 10 | Two tabs run at once | neither tab's answer, model or mode appears in the other |
| 11 | Switching the model mid-conversation applies | the next turn runs on it, through `session/set_model` |
| 12 | Changing the effort restarts the process | it is a launch flag: the next turn runs under the new one |
| 13 | An edit asks before it writes | the prompt names the file, and Deny stops the write |
| 14 | A command asks before it runs | the prompt names the command as a shell command, not as a tool called `Shell` |
| 15 | A question Grok asks reaches the tab | the question dialog opens, and the answer reaches the agent |
| 16 | Dismissing the prompt cancels the turn | nothing is written and the turn ends |
| 17 | A write outside the vault is refused in safe mode | containment holds; auto-approve allows it |
| 18 | The model catalog fills from an empty vault | the settings model browser lists models on first open |
| 19 | Slash commands list in a blank tab | the session's own commands appear in the composer |
| 20 | The spend indicator moves | after a turn, from the ticks Grok reports and from the log when it reports none |
| 21 | No rewind button appears | the affordance the flip removed is gone, and nothing else lost a button |
| 22 | A subagent that finishes on its own completes its block | spawn one, do not poll `get_command_or_subagent_output`, and let it end: the block stops rendering as running and shows its result. **Never run.** This is the row for `subagent_finished`, which the legacy runtime read and the flip lost; the field spellings restored with it are the shipped runtime's, not the recording's — no subagent ran in the recording |

## The half that runs itself

Thirteen rows are driven headlessly by
`tests/integration/providers/grok/execution/GrokLiveSmoke.integration.test.ts`,
against a real `grok agent … stdio`. It is skipped unless asked for, because it starts a CLI and
spends the account's tokens:

```bash
GRIMOIRE_GROK_LIVE=1 node scripts/run-jest.js --selectProjects=integration \
  --runTestsByPath tests/integration/providers/grok/execution/GrokLiveSmoke.integration.test.ts
```

Through `scripts/run-jest.js` rather than bare `npx jest`: the runner passes `--localstorage-file`,
and without it every suite that writes provider settings fails with `storage.getItem is not a
function`.

`GRIMOIRE_GROK_TRACE=1` prints the debug records the composition writes, `GRIMOIRE_GROK_CLI` points
at a binary other than `grok` on `PATH`, and `GRIMOIRE_GROK_MODEL` overrides the model.

It covers rows 1, 1b (the mirrored update, which has no number in the table because it is invisible
when it works), 2, 5, 6, 7, 8, 9, 13, 14, 16, 18, 19 and 20. **The rows it does not cover are the
ones a person has to look at**: whether the tool card, the diff, the thinking block and the badges
actually render, two tabs side by side, switching the model from the toolbar, changing the effort,
a write outside the vault, a question dialog, and the rewind button being gone.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-08-31 | grok 1.0.5 | live: 1, 1b, 2, 5, 6, 7, 8, 9, 13/14, 16, 18, 19, 20 | — | thirteen of thirteen, run as the check on a change one layer under this provider: a failed ACP filesystem request now carries the handler's own message, and a read of a missing file answers `-32002 Resource not found`. Row 16 still raises the permission for a file that does not exist and still stops on the refusal — the row that fails on Gemini for the vendor reason its own matrix records |
| 2026-08-30 | `grok` acp (`grok-4.6`) | all 13 | — | Run to certify the session-restart notice, which this provider could not draw: `GrokProviderState` has carried a `sessionDropped` field since the legacy runtime and nothing on the execution path wrote or read it, so a session the agent had lost was replaced in silence. Found on Kimi Code, whose live row 9 caught it; the same four pieces are wired here, and row 9 asserts `isSessionDropped()` rather than only the replacement. Thirteen of thirteen |
| 2026-08-20 | 1.0.5 | live: 1, 1b, 2, 5, 6, 7, 8, 9, 13, 14, 16, 18, 19, 20 | — | first live run found the resume shape this provider actually has; see the journal entry for that run |
| 2026-08-21 | 1.0.5 | live: 1, 1b, 2, 5, 6, 7, 8, 9, 13, 14, 16, 18, 19, 20 | — | re-run after the two review passes; row 6 is the one that mattered, since a Stop now waits for the prompt ACP answers it on |
