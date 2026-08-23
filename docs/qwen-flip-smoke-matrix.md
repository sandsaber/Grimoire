# Qwen Code flip — smoke matrix

The Qwen flip moved chat execution onto the execution kernel and deleted `QwenChatRuntime`. Automated
gates prove the wiring, the contracts, and whole turns over a fake ACP agent; **this is the layer they
cannot reach** — a real `qwen --acp` process.

The automated half runs headlessly:

```bash
GRIMOIRE_QWEN_LIVE=1 npm run test -- --selectProjects integration --testPathPatterns QwenLiveSmoke
```

It starts the CLI and spends the account's tokens, so it is off unless that variable is set.
`GRIMOIRE_QWEN_CLI` overrides the executable and `GRIMOIRE_QWEN_TRACE=1` prints the debug log.

## Read this before you read the rows

**This provider cannot be certified on the machine it was built on.** `qwen 0.21.15` refuses
`session/new` with *"Authentication required: Use Qwen Code CLI to authenticate first."*, so no session
has ever opened and no row that needs an answer has ever run. Qwen flips from Kimi Code's position:
wired, green against a fake agent, and never having met the real CLI past its handshake.

The harness exists anyway, and it earned its keep before it could pass a single row — see below.

Four rows are this provider's own and no sibling harness has them:

- **row 20** — the reasoning level it applies by *talking to the session*, `/effort <level>` as a
  `session/prompt` the vendor charges for. Two turns must produce one prompt;
- **row 21** — the question it asks over the permission channel, the first `kind: 'question'`
  interaction the kernel carries. An empty result there is a row that **did not run** rather than one
  that failed, because whether a given turn reaches for `ask_user_question` is the agent's choice;
- **row 22** — the context window from `qwen/status/session/context_usage`, a method ACP does not
  define and the only source this provider has for the parent window;
- **row 23** — the subagent stream it sends down the *parent* session, which must not be drawn.

Recorded against **qwen 0.21.15** on 2026-08-23, Linux.

| # | Row | Result |
|---|---|---|
| 1 | Answers a plain message, and streams it | ⛔ not authenticated |
| 2 | Shows a tool call and its result | ⛔ not authenticated |
| 5 | Reports the context window and the tokens the prompt cost | ⛔ not authenticated |
| 6 | Cancels a running turn and leaves no agent behind | ⛔ not authenticated |
| 7 | Continues the same session on a second turn | ⛔ not authenticated |
| 8 | Resumes the conversation a fresh load was told about | ⛔ not authenticated |
| 9 | Says what a session the agent no longer has needs the person to do | ⛔ not authenticated |
| 12/13 | Asks before it writes, and writes what was allowed | ⛔ not authenticated |
| 15 | Writes nothing when the prompt is refused | ⛔ not authenticated |
| 16 | Runs the turn in the mode the tab is set to | ⛔ not authenticated |
| 17 | Fills the model catalog from an empty vault | ⛔ not authenticated |
| 19 | Shows the spend when there is spend to show | ⛔ not authenticated |
| 20 | Talks the session into an effort, and only once | ⛔ not authenticated |
| 21 | Asks the person a question, and sends the answers back | ⛔ not authenticated |
| 22 | Reports the context window from the method ACP does not define | ⛔ not authenticated |
| 23 | Keeps a nested agent activity out of the conversation | ⛔ not authenticated |

## What the run found anyway

**A user with no credentials was told to start a new chat, forever.** Every row above reported:

> Qwen could not start this turn. If this conversation was resumed from a saved session, that session
> may no longer exist — starting a new chat will create one.

Nothing had been resumed. The turn was the first of a fresh conversation, and the real cause was the
agent refusing `session/new` for want of authentication — advice that would fail identically every
time it was followed.

The channel to fix it already existed: the turn-refusal payload added after Gemini's live smoke, which
carried a refused *prompt* in the agent's own words. A refused **session** refuses the turn just as
completely, and its reason is the one a first-run user needs most. Both now travel the same way, for
all six ACP providers, and the same harness confirms it against the real CLI:

> Authentication required: Use Qwen Code CLI to authenticate first.

A failed `session/load` deliberately keeps the composition's own sentence instead: what an agent says
about a session it cannot load is rarely actionable — OpenCode answers `Internal error: OpenCode
service failure` — while "starting a new chat will create one" names the thing that helps. The agent
wins where it knows more; the composition wins where it does.

## The half a person still has to look at

With an authenticated account, install a release build in a vault and check:

- the answer streams into the tab rather than arriving at the end;
- a tool call renders as a card with the agent's own name on it — this provider has no tool stream
  adapter, so the name is whatever the agent called it;
- **a subagent's activity does not appear in the transcript** while the parent Agent card does. This is
  the one to look at hardest: it is the only row whose failure looks like a working conversation with
  extra text in it;
- **a question renders as a question**, with its options, and answering it releases the turn — not as
  an approval asking whether to allow or deny it;
- the effort selector changes the level and does not send `/effort` on every turn afterwards;
- the context badge shows a window, which for this provider comes from a method ACP does not define.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-08-23 | qwen 0.21.15 | none | live: all | the CLI refuses `session/new` with "Authentication required", so no session has ever opened and no row that needs an answer has run. Not the flip. The run was worth making anyway: it found that a user without credentials was told a saved session may have gone and to start a new chat — advice that fails identically every time — and the fix, carrying the agent's own refusal to the tab for all six ACP providers, was then confirmed against this same CLI |
