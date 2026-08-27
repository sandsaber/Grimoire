# Chat projection flip — manual smoke matrix

The chat projection flip moves a tab from consuming the presentation adapter's chunk generator to
consuming a projection: turns are submitted to the chat execution coordinator, the kernel runs them,
and the surface draws what the projection says. Automated gates prove the wiring, the contracts, and
whole turns end to end over a fake provider; **this is the layer they cannot reach** — a live CLI, a
real vault, and a person watching the column.

The switch is `src/app/chat/projectionChatProviders.ts`. It holds **Antigravity**, **Claude** and
**Codex**:
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

One file per flipped provider under `tests/integration/app/chat/`, over the shared assembly in
`chatProjectionLiveHarness.ts`, each off by default:

```bash
GRIMOIRE_ANTIGRAVITY_LIVE=1 npm run test -- --selectProjects integration \
  --testPathPatterns 'AntigravityChatProjectionLiveSmoke'
GRIMOIRE_CODEX_LIVE=1 npm run test -- --selectProjects integration \
  --testPathPatterns 'CodexChatProjectionLiveSmoke'
GRIMOIRE_OPENCODE_LIVE=1 npm run test -- --selectProjects integration \
  --testPathPatterns 'OpencodeChatProjectionLiveSmoke'
# Claude loads the real SDK by path, past the mock every other suite gets.
GRIMOIRE_CLAUDE_LIVE=1 NODE_OPTIONS=--experimental-vm-modules \
  node scripts/run-jest.js --selectProjects=integration \
  --runTestsByPath tests/integration/app/chat/ClaudeChatProjectionLiveSmoke.integration.test.ts
```

Nothing below the composition is a fake. The backend is the one production registers, over the OS
process runner and a real `agy`; the conversation store is `SessionStorage` over a vault adapter, so
the barrier's write goes through the same envelope a vault in the field holds. What is doubled is
the column — the DOM — and it records what it was asked to draw rather than answering, so an
assertion is about what the surface was told to do.

It covers **rows 2, 3, 5, 7, 9, 10 and the negative half of 14**, per provider and only where that
provider has the thing: one `done` and one assistant bubble per turn, the stored answer carrying the
id the surface drew it into, text arriving on the column, a provider's own content items reaching it
through the presenter, a cancelled turn ending as cancelled with its partial answer kept and no
process left behind, a permission prompt asked **once** and answered so the turn continues, a
reloaded tab resuming the thread the vault kept, and no failure wording on a turn that did not fail. Each file also asserts the switch holds its provider, because a harness that
builds the tab's end directly would otherwise keep passing after the flip was reverted.

**Two things a row here must not do**, both learned by doing them:

- **read the model's answer as proof of a mechanism.** Codex's `thread/resume` with no id resumes
  the most recent thread in its own store, and the conversation's transcript is replayed into every
  request — so "it remembered the word" stayed true through three separate breaks. Assert the wire;
- **stand in for the tab binding without copying it.** The first version of this harness left out
  `tabProjectionExecution`'s content filter, drew `user_message_start` into the column and reported
  it as a finding. That filter is one exported function now, used by both. The same gap swallowed
  the interaction fix: the harness had no presenter either, so a fixed path still hung.

- **read a live green as certification when the vendor is up and down.** OpenCode passed every row
  at least three times over five runs and never all three in one, always failing on its own
  `Endpoint is unavailable`. That is a stop condition, not a flip.

**And a row that can hang must have its own bound.** Claude's permission row stopped dead for five
minutes and was killed by the suite timeout, which reports "the test took too long" rather than
"nobody answered the question". It races a 120s timer now and fails saying what was asked.

What it cannot reach stays a person's: what the drawn text *looks like*, and every row that needs a
plugin around it.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-08-27 | `opencode` acp | — | A, B, C across five runs | **Not flipped.** OpenCode stays off the switch: five runs could not produce one clean pass. Every failure carried the vendor's own `Upstream request failed: Endpoint is unavailable` / `OpenCode service failure`, or a model that answered without touching the filesystem — and the path rendered those sentences correctly each time, which is row 14 passing. Two harness defects were found and fixed on the way: an OpenCode session belongs to its project directory, so the reload row has to hand the directory over and not only the record store; and a row about a *permission* must name a shell command rather than an outcome, because a model that declines to use a tool proves nothing. The rows now refuse a vendor outage by name rather than reporting it as an assertion about this path. Flip it when the endpoint is up |
| 2026-08-27 | Claude Agent SDK (`haiku`) | 2, 3, 5, 9, 10, 14 (driven half) | — | Claude's flip, and **the row that found the defect this path shipped with**: a provider that stops to ask hung forever, because the bridge that presents an interaction and resolves it was built only when the *adapter* opened a session and here the coordinator opens one. The coordinator attaches it now, one per conversation. Rows 1, 4, 6, 8, 11, 12, 13 outstanding under the standing override |
| 2026-08-27 | `codex` app-server | 2, 3, 5, 10, 14 (driven half) | — | Codex's flip, and the first provider content this path has drawn. Its answer renders **once** here, where `CodexLiveSmoke` row 1 records the legacy adapter path seeing it three times. Codex sends one tool call's result twice — at item completion and again from `flushPendingRawToolOutputs` — which `StreamController` merges by id on both paths, so it is an observation rather than a row. Rows 1, 4, 6, 8, 9, 11, 12, 13 outstanding under the standing override |
| 2026-08-27 | `agy` 1.1.19 | 2, 3, 5, 7, 14 (driven half) | — | Antigravity's flip. The driven half only; rows 1, 6, 9 do not apply to print mode — it has no plan approval, no interaction channel, and refuses anything short of full access before a process exists — and rows 4, 8, 10, 11, 12, 13 are outstanding, in a vault, by the owner's standing override |
