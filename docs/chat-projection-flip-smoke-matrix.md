# Chat projection flip — manual smoke matrix

The chat projection flip moves a tab from consuming the presentation adapter's chunk generator to
consuming a projection: turns are submitted to the chat execution coordinator, the kernel runs them,
and the surface draws what the projection says. Automated gates prove the wiring, the contracts, and
whole turns end to end over a fake provider; **this is the layer they cannot reach** — a live CLI, a
real vault, and a person watching the column.

The switch is `src/app/chat/projectionChatProviders.ts`. It is **empty**, so nothing below is live
yet: adding one provider to that list is that provider's flip, and this matrix is what certifies it.
Run it against a release build installed in a vault (`npm run build:release`, then the plugin folder
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
| 1 | **The plan approval never appears** | Run a plan-mode turn on a provider that has one | **Known gap, expected to fail.** `planCompleted` came from the runtime's turn metadata and has no projection equivalent, so the approval is not raised. Record it; do not certify a plan-capable provider until it is closed |
| 2 | Double finalization | Finish an ordinary turn | The answer renders once, no duplicated footer, no empty trailing block. The turn is finalized by the target's `done` and again by the `finally` block, whose guards should make the second a no-op |
| 3 | The save after the barrier | Finish a turn, reload the vault | The conversation holds exactly what was on screen. The barrier writes the answer and `ConversationController.save` then writes `state.messages` over it; those must be the same thing |
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

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| never | — | — | — | the switch is empty, so no provider is on this path yet |
