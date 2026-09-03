# Kimi Code flip — smoke matrix

The Kimi Code flip moved chat execution onto the execution kernel and deleted `KimicodeChatRuntime`.
Automated gates prove the wiring, the contracts, and whole turns over a fake ACP agent; **this is the
layer they cannot reach** — a real `kimi acp` process.

The automated half runs headlessly:

```bash
GRIMOIRE_KIMICODE_LIVE=1 npm run test -- --selectProjects integration --testPathPatterns KimicodeLiveSmoke
```

It starts the CLI and spends the account's tokens, so it is off unless that variable is set.
`GRIMOIRE_KIMICODE_CLI` overrides the executable and `GRIMOIRE_KIMICODE_TRACE=1` prints the debug log.

## Read this before you read the rows

**That blocker lifted on 2026-08-30, and the rows below have not been re-run.** `kimi 0.39.1` answers
now, on a `zai-coding-plan` GLM model, and two things already stand on real traffic: its wire
recording was retaken and carries a whole turn (`coverage: complete`, six session-update kinds), and
the chat projection matrix certified **6 of 7** driven rows on it — the seventh red because Kimi
reports usage after the prompt returns, which is recorded there. **The rows in this table still say
what they said when nothing could run**, and each one is worth a run now.

The paragraph they were written under follows. `kimi 0.38.0` refused both
`session/new` and `session/load` with `-32000 "Authentication required"` — its own log said *no
provider configured; complete onboarding via /login* — so no session had ever opened here and no row
that needs an answer had ever run.

The flip shipped anyway, deliberately, and this matrix was written last of the eight. That order is
the reason it was worth writing: **the harness found a shipped defect on its first run**, in a path no
authenticated account would have taken. See below.

The harness is deliberately MiMoCode's file with the names changed, down to the row numbers. These two
providers mirror each other by instruction and their compositions differ only in identifiers, so the
two harnesses are meant to stay diffable after normalizing the provider name — that is how drift
between them gets found. A row that is true of one and not the other belongs in this table as a
difference, not in the harness as a divergence.

Recorded against **kimi 0.38.0** on 2026-08-23, Linux.

| # | Row | Result |
|---|---|---|
| 1 | Answers a plain message, and streams it | ⛔ not authenticated |
| 2 | Shows a tool call and its result | ⛔ not authenticated |
| 5 | Reports the context window and the tokens the prompt cost | ✅ **2026-09-03** — the window arrives now; the prompt's own tokens are not on this wire at all, and the row pins that |
| 6 | Cancels a running turn and leaves no agent behind | ⛔ not authenticated |
| 7 | Continues the same session on a second turn | ⛔ not authenticated |
| 8 | Resumes the conversation a fresh load was told about | ⛔ not authenticated |
| 9 | Says what a session the agent no longer has needs the person to do | ✅ passes — and it is the row that found the defect |
| 12/13 | Asks before it writes, and writes what was allowed | ⛔ not authenticated |
| 15 | Writes nothing when the prompt is refused | ⛔ not authenticated |
| 17 | Fills the model catalog from an empty vault | ⛔ not authenticated |
| 18 | Lists the commands a session announces | ⛔ not authenticated |
| 19 | Shows the spend when there is spend to show | ✅ nothing owed, nothing shown |

Row 8 is worth reading even though it is red: the resume binding it builds — `sessionId` **and**
`databasePath` — was produced correctly (`~/.local/share/kimicode/kimicode.db`) before the turn was
refused. What is unproven is only the half that needs an answer.

## What the run found

**A user resuming a conversation was told to start a new chat, forever.** Row 9 reported:

> Kimi Code could not start this turn. If this conversation was resumed from a saved session, that
> session may no longer exist — starting a new chat will create one.

The session was not the problem. The agent had answered `session/load` with *"Authentication
required"*, and a new chat would have failed identically — the same defect Qwen's harness found on
`session/new` two days' work earlier, surviving on the path that fix deliberately did not cover.

That carve-out had a reason: what an agent says about a session it cannot *find* is often unactionable
— OpenCode answers `Internal error: OpenCode service failure` — while "starting a new chat will create
one" is the sentence that helps. It was read as *the agent has nothing to say here*, and this run is
the counterexample. Both halves are needed and neither can be dropped, so both now travel:

> Kimi Code could not open the session this conversation was resumed from. Kimi Code said:
> Authentication required. Starting a new chat helps only if the session itself is gone.

The agent's words come first and the advice says out loud what it depends on. All six managed-ACP
providers share the sentence — it was six copies of the same two lines and is one now — and the vague
case keeps its advice with the vendor's noise in front of it.

**Row 9 was green before the fix**, which is the other half of the finding. It asserted that the
message mentioned a *session*, and the composition's own sentence does that whatever the agent said.
It asserts the agent's own words now.

## The half a person still has to look at

With an authenticated account, install a release build in a vault and check:

- the answer streams into the tab rather than arriving at the end;
- a tool call renders as a card with the agent's own name on it;
- the model and thinking-level selectors fill from the session the agent opens, and a level chosen in
  one tab does not change another tab's;
- a permission prompt appears before a write and the refusal actually stops it;
- the spend indicator moves when the vendor charges, which for this provider is read from Kimi Code's
  own session database when the wire says nothing.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-09-03 | `kimi 0.39.1` | 1, 2, 5, 6, 7, 8, 9, 12/13, 15, 17, 18, 19 | — | **Twelve of twelve, and row 5 closes the question it had been carrying since 2026-08-30.** It was never an owner's question about where usage should live: the seam for it already existed and this provider had not been given it. `noteTurnEnded` is the backend's last look at a turn *before any terminal* — Grok reads a cost only its session log has there, and Qwen asks for a window ACP never sends it — and `KimicodeProjectionResultSink` implemented no `noteTurnEnded` at all, which is why the one provider whose window is late was the one that lost it. The turn waits there for it now, bounded at 400ms against a frame that arrives on the same stdio stream microseconds later. Every row carries a `usage` chunk in this run, not just row 5. **Half of row 5 is the CLI and stays so**: `session/prompt` answers `{stopReason: end_turn}` and nothing else, so `inputTokens` is 0 — pinned with `toBe(0)` rather than dropped, so the row speaks up if the vendor changes its mind |
| 2026-08-31 | `kimi 0.39.1` | 1, 2, 6, 7, 8, 9, 12/13, 15, 17, 18, 19 | 5 | run a second time the same evening, beside Qwen's, to see whether the memory trap that failed two of Qwen's rows had a twin here. It does not: this CLI keeps sessions under `~/.kimi-code/sessions` and **no memory store at all**, so rows 7 and 8 can keep naming a fixed word. Eleven of twelve again, the same row 5 red for the same owner's question |
| 2026-08-31 | `kimi 0.39.1` | 1, 2, 6, 7, 8, 9, 12/13, 15, 17, 18, 19 | 5 | eleven of twelve again, and the same row red for the same reason — the context meter is one turn behind because `usage_update` arrives after `session/prompt` returns, which is an owner's question and not a patch. Run as the check on a change one layer under this provider: a read of a missing file answers `-32002 Resource not found` now. Rows 12/13 and 15 both still raise the permission and still stop on the refusal, which is where that change would have shown |
| 2026-08-30 | `kimi 0.39.1` | 1, 2, 6, 7, 8, 9, 12/13, 15, 17, 18, 19 | 5 | **The first run with an account.** Eleven of twelve rows green. Four of them were red for reasons that were the rows' own and had gone unseen because nothing could run them: rows 8 and 19 read the session binding through a `.updates` wrapper the seam deletion removed, so they threw before resuming anything; row 6 looked for a process matching `kimi` **and** `acp`, and this CLI renames itself to `kimi-cod` with no arguments, so it never saw the agent it was about to assert was gone. **Row 9 found a product defect Grok and Qwen had too**: `kimi acp` refuses an unknown session explicitly, Grimoire correctly opens a fresh one — and nothing said so, because this fork never wired `sessionDropped`, so the session-restart notice could not be drawn. Fixed by mirroring OpenCode's four pieces; `isSessionDropped()` answers `true` on the same live row now. Row 5 is red and stays red: Kimi sends `usage_update` **after** `session/prompt` returns, so no usage reaches the turn at all |
| 2026-08-23 | kimi 0.38.0 | 9, 19 | live: all others | the CLI refuses `session/new` and `session/load` with `-32000 "Authentication required"`, so no session has ever opened and no row that needs an answer has run. Not the flip. The run found a shipped defect anyway: a resumed conversation was told its saved session may be gone and to start a new chat, when the agent had said the CLI was not logged in. Fixed for all six ACP providers and confirmed against this same CLI |
