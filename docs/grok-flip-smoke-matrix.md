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

## The half that runs itself

Rows driven headlessly by `tests/integration/app/execution/grok/GrokLiveSmoke.integration.test.ts`,
against a real `grok agent … stdio`. It is skipped unless asked for, because it starts a CLI and
spends the account's tokens:

```bash
GRIMOIRE_GROK_LIVE=1 node scripts/run-jest.js --selectProjects=integration \
  --runTestsByPath tests/integration/app/execution/grok/GrokLiveSmoke.integration.test.ts
```

Through `scripts/run-jest.js` rather than bare `npx jest`: the runner passes `--localstorage-file`,
and without it every suite that writes provider settings fails with `storage.getItem is not a
function`.

`GRIMOIRE_GROK_TRACE=1` prints the debug records the composition writes, `GRIMOIRE_GROK_CLI` points
at a binary other than `grok` on `PATH`, and `GRIMOIRE_GROK_MODEL` overrides the model.

**The rows it does not cover are the ones a person has to look at**: whether the tool card, the diff,
the thinking block and the badges actually render, two tabs side by side, switching the model from
the toolbar, a write outside the vault, and the rewind button being gone.

## Record

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| — | — | — | — | not yet run |
