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

**That blocker lifted on 2026-08-30, and the rows below have not been re-run.** `qwen-code 0.22.3`
answers now — authenticated against Z.AI GLM-5.2 through an OpenAI-compatible key — and two things
already stand on real traffic: its wire recording was retaken and carries a whole turn
(`coverage: complete`, four session-update kinds and one vendor method), and the chat projection
matrix certified **7 of 7** driven rows on it. **The rows in this table still say what they said when
nothing could run**, and each one is worth a run now.

The paragraph they were written under follows. `qwen 0.21.15` refused
`session/new` with *"Authentication required: Use Qwen Code CLI to authenticate first."*, so no session
had ever opened and no row that needs an answer had ever run. Qwen flipped from Kimi Code's position:
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
| 5 | Reports the context window and the tokens the prompt cost | ✅ **2026-09-03** — the window is real; the prompt's own tokens are not on this wire, and the row pins that |
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
| 21 | Asks the person a question, and sends the answers back | ✅ **certified 2026-08-31**, and never before it — see the note under the Record |
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

A failed `session/load` was deliberately left out at the time: what an agent says about a session it
cannot load is often unactionable — OpenCode answers `Internal error: OpenCode service failure` —
while "starting a new chat will create one" names the thing that helps.

**Kimi Code's harness then found the other half of it, one path over.** An unauthenticated CLI refuses
the *load* the same way it refuses `session/new`, and a user resuming a conversation was told the saved
session may have gone and to start a new chat — the same advice that fails identically every time,
reached by the path the first fix did not cover. Both halves now travel, the agent's words first and
the advice conditioned on them out loud, for all six ACP providers.

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
| 2026-09-03 | `qwen-code 0.22.3` | 1, 2, **5**, 6, 7, 8, 9, 12/13, 15, 16, 17, 19, 20, 21, 22, 23 | — | **Sixteen of sixteen — the first full green this matrix has had.** Row 5 was carried as "the CLI's `{used, size}` shape", and half of that was right for the wrong reason. The window half works and always did: `qwen-wire.json` seq 23 is `{used: 28101, size: 1000000}`, sent while the turn runs, and the sink asks `qwen/status/session/context_usage` at `noteTurnEnded` besides — live it read `contextTokens: 30163` of `1000000`. The red was the *other* half, `inputTokens`, and this CLI does not send it: seq 24 answers `{stopReason: end_turn}` with a `_meta` carrying `qwen.branchPoint`, a checkpoint rather than a count. Pinned with `toBe(0)` so the row speaks up if the vendor changes its mind. **The opposite of Gemini's**, checked the same day: its tokens *were* on the wire under `_meta.quota` and unread. Every other row re-run unchanged, 332 seconds |
| 2026-08-31 | `qwen-code 0.22.3` | 1, 2, 6, 7, 8, 9, 12/13, 15, 16, 17, 19, 20, 21, 22, 23 | 5 | the whole file again, with the three repaired rows in it: **fifteen of sixteen**, and the one red is row 5's `{used, size}` shape, which this CLI has always sent and no code here can change. Rows 7 and 8 recalled their minted words, row 21's answer reached the agent and came back in the tool result, and rows 12/13 and 15 still raise the permission under the day's shared filesystem change. This is the run the three fixes are certified by |
| 2026-08-31 | `qwen-code 0.22.3` | 21 | — | **the round trip is certified for the first time, and the two runs before this one certified nothing.** This row answered under a key the surface never uses — first `{ colour: 'blue' }`, then the question's *header* — and `mapQwenQuestionAnswers` looks the answer up by the question's own id, or its text when it has none, which is what `InlineAskUserQuestion` sends. So the map arrived empty, `ask_user_question` reported *No valid answers were provided.*, the agent replied *"I asked, but no answer came back … just tell me your preferred colour in text (e.g., \"blue\")"* — and the row's assertion found `blue` in **that sentence** and went green. It answers the way the surface answers now, and asserts on the tool result rather than the prose: the agent's own reading of what it received has to name the option and must not say *No valid answers*. The product was right the whole time; only the row was wrong |
| 2026-08-31 | `qwen-code 0.22.3` | 7, 8 | — | the two rows above, re-run after the fix and after the memories were removed. They mint their word now — `grimoire` plus six random characters — so nothing a previous run left can answer for them, which is what they meant to ask all along. Both green on the first attempt: the agent echoed `grimoirenmmgpa` in the same session and `grimoirerfy6jw` across a reload. The three memories of 2026-08-30 were deleted from `~/.qwen/memories/`, backed up first, and neither of these runs wrote a new one |
| 2026-08-31 | `qwen-code 0.22.3` | 1, 2, 6, 8, 9, 12/13, 15, 16, 17, 18, 19, 20, 22, 23 | 5, 7, 21 | thirteen of sixteen, and **two of the three reds are this harness poisoning itself**. Run as the check on a change one layer under this provider — a read of a missing file answers `-32002 Resource not found` now — and rows 12/13 and 15 both still raise the permission and stop on the refusal, which is where that change would have shown. Rows 7 and 21 both answered `cobalt` where the row expected `violet`: this CLI keeps memories across sessions in `~/.qwen/memories/`, and **yesterday's run of this very file wrote three of them** — `tomato`, `violet` and `cobalt`, each described as "User asked to remember the word … on 2026-08-30". A fresh session therefore starts knowing all three, so row 7 recalls the wrong one and row 21's colour question is answered from memory rather than from the option the tab chose. Not the flip, not the day's change, and not the account: the rows have to stop asking a global memory to be empty. Row 5 is the same `{used, size}` shape as always |
| 2026-08-30 | `qwen-code 0.22.3` | 1, 2, 6, 7, 8, **9**, 12/13, 15, 16, 17, 18, 20, 21, 22, 23 | 5 | The same day, after the session-restart notice was wired here as well. Row 9 asserts it now: an unknown session is replaced — correct — **and `isSessionDropped()` says so**, which it could not before, because this provider persisted no state at all. `QwenProviderState` has one field, and a resumed session writes it back empty so a stale marker cannot stand. Row 8 was updated with it: the binding is an id and a marker that is usually `{}` |
| 2026-08-30 | `qwen-code 0.22.3` | 1, 2, 6, 7, 8, 9, 12/13, 15, 16, 17, 18, 20, 21, 22, 23 | 5 | **The first run with an account, and fifteen of sixteen rows green.** Three reds were the rows' own: row 8 read the session binding through a `.updates` wrapper the seam deletion removed; row 16 approved **everything**, including the agent's request to leave plan mode, and then asserted that plan mode had prevented the write — the agent had behaved perfectly, refusing to write and asking to exit, and the row said yes; row 21 answered the question with `{ colour: 'blue' }`, a key the question never carried and a value it never offered, and the agent said so — *"I asked, but no answer came through"*. All three now measure what they claim: the plan exit is refused, and the question is answered by its own header with one of its own options. Row 5 stays red and is the CLI's shape: Qwen's `usage_update` carries `{used, size}` and no per-prompt tokens, so the badge can show the window and not what the prompt cost |
| 2026-08-23 | qwen 0.21.15 | none | live: all | the CLI refuses `session/new` with "Authentication required", so no session has ever opened and no row that needs an answer has run. Not the flip. The run was worth making anyway: it found that a user without credentials was told a saved session may have gone and to start a new chat — advice that fails identically every time — and the fix, carrying the agent's own refusal to the tab for all six ACP providers, was then confirmed against this same CLI |
