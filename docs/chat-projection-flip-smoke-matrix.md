# Chat projection flip — manual smoke matrix

The chat projection flip moves a tab from consuming the presentation adapter's chunk generator to
consuming a projection: turns are submitted to the chat execution coordinator, the kernel runs them,
and the surface draws what the projection says. Automated gates prove the wiring, the contracts, and
whole turns end to end over a fake provider; **this is the layer they cannot reach** — a live CLI, a
real vault, and a person watching the column.

The switch is `src/app/chat/projectionChatProviders.ts`. It holds **Antigravity**, and nothing else:
adding one provider to that list is that provider's flip, and this matrix is what certifies it. Run
it against a release build installed in a vault (`npm run build:release`, then the plugin folder
copy). Record the date, the CLI version, and one line per row. A row that fails is a stop condition:
remove the provider from the list, which reverts the flip for everyone without touching code.

## Rows the automated gates already cover over a fake provider

Listed so the matrix is honest about what it is *adding*, not to be re-run: one turn drawn block by
block, a turn cancelled mid-answer, a turn adopted after a reload, a run finishing with nobody
drawing it, two surfaces on one conversation, the persistence barrier, and a turn whose answer and
stored message are one message. Those hold over `DeterministicFakeBackend`; what they cannot hold is
a real provider's content, timing, and failure wording.

## What this matrix exists to find

The four couplings the flip carried across from `InputController` that no gate here can check, in
the order they are most likely to break:

| # | Row | What to do | What must happen |
|---|---|---|---|
| 1 | The plan approval | Run a plan-mode turn on a provider that has one | The approval appears after the turn ends, and implement / revise / cancel each do what they do on the legacy path. `planCompleted` is derived from the turn's own resolved interactions now, by the same reading the adapter does — a response id that names a plan — so what is untested is the providers' ids, not the wiring |
| 2 | Double finalization | Finish an ordinary turn | The answer renders once, no duplicated footer, no empty trailing block. The turn is finalized by the target's `done` and again by the `finally` block, whose guards should make the second a no-op |
| 3 | The save after the barrier | Finish a turn, reload the vault | The conversation holds exactly what was on screen. The barrier writes the answer as **text**, and `ConversationController.save` then writes `state.messages` — which carries the tool calls and content blocks the barrier cannot. While a tab is open the second write is what survives; **a turn whose tab closed, or one adopted after a reload, keeps only the text.** That is the shape of what a `ResultRef` cannot resolve back to, not a defect of the save |
| 4 | Title generation | Send the first message in a blank tab | A title is generated. It fires on `state.messages.length === 1`, and on this path the first message reaches `state.messages` from the projection rather than before the send |

## Rows for the surface itself

| # | Row | What must happen |
|---|---|---|
| 5 | Streaming | Text appears as it arrives, in the order the model produced it, with tool calls in place |
| 6 | The question | Appears once, and reads as what was sent rather than what was typed where the provider composes a prompt |
| 7 | Interruption | Stop mid-answer: the partial answer is kept, the interrupted marker renders, the input unlocks |
| 8 | Queued input | Type while a turn runs, send: the second turn starts only after the first is durable |
| 9 | A permission prompt | The provider's own dialog appears once — not twice — and answering it continues the turn |
| 10 | Reload mid-turn | Close and reopen the vault while a turn runs: the tab shows the turn still going and finishes drawing it |
| 11 | Tab close mid-turn | Close the tab: the turn finishes in the kernel and its answer is in the conversation when reopened |
| 12 | Two tabs, one conversation | Open the same chat twice: one turn, drawn in both |
| 13 | The context meter | Moves after a turn, and the conversation still has its usage after a reload |
| 14 | A failing turn | The provider's own failure wording renders, not the neutral sentence, where the provider has one |

## The half that runs itself

`tests/integration/app/chat/AntigravityChatProjectionLiveSmoke.integration.test.ts`, off by default:

```bash
GRIMOIRE_ANTIGRAVITY_LIVE=1 npm run test -- --selectProjects integration \
  --testPathPatterns 'AntigravityChatProjectionLiveSmoke'
```

Nothing below the composition is a fake. The backend is the one production registers, over the OS
process runner and a real `agy`; the conversation store is `SessionStorage` over a vault adapter, so
the barrier's write goes through the same envelope a vault in the field holds. What is doubled is
the column — the DOM — and it records what it was asked to draw rather than answering, so an
assertion is about what the surface was told to do.

It covers **rows 2, 3, 5, 7 and the negative half of 14**: one `done` and one assistant bubble per
turn, the stored answer carrying the id the surface drew it into, text arriving on the column, a
cancelled turn ending as cancelled with its partial answer kept and no `agy` left behind, and no
failure wording on a turn that did not fail. It also asserts the switch itself holds the provider,
because a harness that builds the tab's end directly would otherwise keep passing after the flip was
reverted.

What it cannot reach stays a person's: what the drawn text *looks like*, and every row that needs a
plugin around it.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-08-27 | `agy` 1.1.19 | 2, 3, 5, 7, 14 (driven half) | — | Antigravity's flip. The driven half only; rows 1, 6, 9 do not apply to print mode — it has no plan approval, no interaction channel, and refuses anything short of full access before a process exists — and rows 4, 8, 10, 11, 12, 13 are outstanding, in a vault, by the owner's standing override |
