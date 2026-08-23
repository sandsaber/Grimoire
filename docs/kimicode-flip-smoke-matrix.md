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

**This provider cannot be certified on the machine it was built on.** `kimi 0.38.0` refuses both
`session/new` and `session/load` with `-32000 "Authentication required"` — its own log says *no
provider configured; complete onboarding via /login* — so no session has ever opened here and no row
that needs an answer has ever run.

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
| 5 | Reports the context window and the tokens the prompt cost | ⛔ not authenticated |
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
| 2026-08-23 | kimi 0.38.0 | 9, 19 | live: all others | the CLI refuses `session/new` and `session/load` with `-32000 "Authentication required"`, so no session has ever opened and no row that needs an answer has run. Not the flip. The run found a shipped defect anyway: a resumed conversation was told its saved session may be gone and to start a new chat, when the agent had said the CLI was not logged in. Fixed for all six ACP providers and confirmed against this same CLI |
