# Chat projection flip — manual smoke matrix

The chat projection flip moves a tab from consuming the presentation adapter's chunk generator to
consuming a projection: turns are submitted to the chat execution coordinator, the kernel runs them,
and the surface draws what the projection says. Automated gates prove the wiring, the contracts, and
whole turns end to end over a fake provider; **this is the layer they cannot reach** — a live CLI, a
real vault, and a person watching the column.

The switch is `src/app/chat/projectionChatProviders.ts`. It holds **all nine providers**. It is still
a list rather than a boolean, because removing one entry is how a provider's flip is reverted for
everyone without touching code, and that is the stop condition this matrix exists to trigger:
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
| 1 | The plan approval | Run a plan-mode turn on a provider that has one | The approval appears after the turn ends, and implement / revise / cancel each do what they do on the legacy path. **The half this row called untested was broken**: `planCompleted` was derived only from a resolved interaction whose response id names a plan, and no provider produces such an id — Claude's are `approved` / `feedback` / `declined`, the ACP providers answer permissions, and Codex reads its own plan mode and its own plan deltas. A live Codex plan turn on 2026-08-30 ended with the provider holding `planCompleted: true` and the completion holding `undefined`, so the approval never appeared. The tab merges the provider's own reading in now, driven as row I; what is left for a person is the approval **appearing**, and implement / revise / cancel |
| 2 | Double finalization | Finish an ordinary turn | The answer renders once, no duplicated footer, no empty trailing block. The turn is finalized by the target's `done` and again by the `finally` block, whose guards should make the second a no-op |
| 3 | The save after the barrier | Finish a turn, reload the vault | The conversation holds exactly what was on screen. The barrier writes the answer as **text**, and `ConversationController.save` then writes `state.messages` — which carries the tool calls and content blocks the barrier cannot. While a tab is open the second write is what survives; **a turn whose tab closed, or one adopted after a reload, keeps only the text.** That is the shape of what a `ResultRef` cannot resolve back to, not a defect of the save |
| 4 | Title generation | Send the first message in a blank tab | A title is generated. It fires on `state.messages.length === 1`, and on this path the first message reaches `state.messages` from the projection rather than before the send |

## Rows for the surface itself

| # | Row | What must happen |
|---|---|---|
| 5 | Streaming | Text appears as it arrives, in the order the model produced it, with tool calls in place |
| 6 | The question | Appears once, and reads as what was sent rather than what was typed where the provider composes a prompt |
| 7 | Interruption | Stop mid-answer: the partial answer is kept, the interrupted marker renders, the input unlocks |
| 8 | Queued input | Type while a turn runs, send: the second turn starts only after the first is durable. For a provider that **steers** — Codex alone — the input joins the running turn instead, which the driven half covers as row D |
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
GRIMOIRE_GROK_LIVE=1 npm run test -- --selectProjects integration \
  --testPathPatterns 'GrokChatProjectionLiveSmoke'
# And the same shape for the rest, each with its own env gate:
#   GeminiChatProjectionLiveSmoke     GRIMOIRE_GEMINI_LIVE=1
#   KimicodeChatProjectionLiveSmoke   GRIMOIRE_KIMICODE_LIVE=1
#   MimocodeChatProjectionLiveSmoke   GRIMOIRE_MIMOCODE_LIVE=1
#   QwenChatProjectionLiveSmoke       GRIMOIRE_QWEN_LIVE=1
GRIMOIRE_OPENCODE_LIVE=1 npm run test -- --selectProjects integration \
  --testPathPatterns 'OpencodeChatProjectionLiveSmoke'
# Claude loads the real SDK by path, past the mock every other suite gets.
GRIMOIRE_CLAUDE_LIVE=1 NODE_OPTIONS=--experimental-vm-modules \
  node scripts/run-jest.js --selectProjects=integration \
  --runTestsByPath tests/integration/app/chat/ClaudeChatProjectionLiveSmoke.integration.test.ts
```

Nothing below the composition is a fake. The backend is the one production registers, over the OS
process runner and a real `agy`; the conversation store is `SessionStorage` over a vault adapter, so
the barrier's write goes through the same envelope a vault in the field holds.

**The column is real too, since 2026-08-30.** It used to be a double that recorded the operations it
was asked for and performed none of them, and that made every row here a statement about what the
surface was *told* to do — one layer above where an answer is assembled. `StreamController` is what
turns those calls into the content blocks a conversation is stored and redrawn from, so with it
stubbed a turn could cut an answer into one block per delta on every provider and no row would
notice; one did, for the whole migration. The controller, the `ChatState` and the `SubagentManager`
are the production ones now, wired as `Tab.ts` wires them
(`tests/helpers/chat/realChatColumn.ts`), and what stays doubled is Obsidian: the elements, the
markdown renderer and the vault.

It covers **rows 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13 and the negative half of 14**, per provider and
only where that provider has the thing: one `done` and one assistant bubble per turn, the stored answer
carrying the id the surface drew it into, text arriving on the column **as one block rather than one
per delta**, a provider's own content items reaching it
through the presenter, a cancelled turn ending as cancelled with its partial answer kept and no
process left behind, a permission prompt asked **once** and answered so the turn continues, a
reloaded tab resuming the thread the vault kept, and no failure wording on a turn that did not fail. Each file also asserts the switch holds its provider, because a harness that
builds the tab's end directly would otherwise keep passing after the flip was reverted.

**Rows 6, 8, 11, 12 and 13 joined that list on 2026-08-30, and none of them ever needed a person.**
They were left to one because the first harness had a single surface, released it at the end of a
row, and read nothing back but the messages. With a second surface and a tab that can be closed
mid-turn: row 11 asks whether the kernel finishes a turn nobody is drawing and the barrier stores it,
row 12 whether one run reaches both surfaces, row 13 whether the count the context meter reads
survives the save, row 8 whether queued input waits for the running turn to be **durable** rather
than merely over, and row 6's driven half — the question drawn once per column, as the provider
composed it — costs nothing beside row 12. Their bodies are shared by every provider's file —
`chatProjectionSurfaceRows.ts` — while each `it` stays in the provider's own file, so a file still
lists the rows it runs.

What is left for a person is **row 4** — title generation, which lives in the tab rather than on this
path — the *appearance* of row 1's approval, and what everything above looks like on screen. Row 1's
other half is driven: whatever the provider said about a plan, the surface hears.

**Two things a row here must not do**, both learned by doing them:

- **read the model's answer as proof of a mechanism.** Codex's `thread/resume` with no id resumes
  the most recent thread in its own store, and the conversation's transcript is replayed into every
  request — so "it remembered the word" stayed true through three separate breaks. Assert the wire;
- **stand in for the tab binding without copying it.** The first version of this harness left out
  `tabProjectionExecution`'s content filter, drew `user_message_start` into the column and reported
  it as a finding. That filter is one exported function now, used by both. The same gap swallowed
  the interaction fix: the harness had no presenter either, so a fixed path still hung.

- **read a live green as certification when the vendor is up and down.** OpenCode passed every row
  at least three times over six runs and never all three in one, always failing on its own
  `Endpoint is unavailable`. Say "intermittent" in the record rather than "green".

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
| 2026-09-03 | `mimo` acp (`xiaomi/mimo-v2.5-pro`) | 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 (driven half) | — | **Seven of seven, from zero of seven.** Every red this file recorded for MiMoCode was "the account cannot generate", and the account generates: the two models the blocker was established on are dead — the vendor refuses `xiaomi/mimo-v2.5-pro-ultraspeed`, which is what an ACP session opens on, and `mimo/mimo-auto`'s free tier has ended — while `xiaomi/mimo-v2.5-pro` answers. The ACP path reports the vendor's `AI_APICallError` as `end_turn` with zero tokens and no error, which is why a dead model read as a dead account |
| 2026-09-03 | `kimi` acp (`zai-coding-plan/glm-5.3-flash`) | 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, **13**, 14 (driven half) | — | **Seven of seven — row 13 was the one red this provider had, and it is green.** The context meter was a turn behind because `usage_update` is the frame *after* the answer to `session/prompt`, so the run that earned it had ended and the kernel had no live run to give it to. Fixed at `noteTurnEnded`, the seam Grok and Qwen already use, which this provider's sink never implemented. Live: `contextTokens: 25344` of `contextWindow: 1000000`, on the column **and** in the stored conversation after the save. Every other row re-run under the change and unchanged |
| 2026-09-03 | `gemini` 0.57.0 acp | 2, 3, 5, 9, 14 (driven half) | 8, 10, 11, 12 — the account | **Rows E, F and H ran for the first time, and what they certified was a hole in this harness rather than the path.** The free tier is 20 requests a day on `gemini-3.5-flash`; row C spends a turn of tool calls and each call is a request, so the quota went mid-run. Rows E, F and H then drew nothing at all and reported `expected "succeeded", received "failed"` — an assertion about the projection, for an account that had run out. **`refuseVendorOutage` could not fire in any of them**: the four shared rows never called it, and the fix of 2026-08-31 — a refusal arrives through `renderTurnFailure`, not as an error chunk — had been applied to Gemini's own guard alone while five siblings still read the chunks only. The guard is a shared-row option now, every provider hands its own in, and `failures` is a required parameter at all seventeen call sites so a new one cannot forget it. Proven by re-running against the exhausted account: rows B, C, F and H name the quota by sentence. **Row E is silent and always will be** — it detaches the tab before the turn ends, so nothing draws the failure, which is what the row itself asserts. Rows A and B are green on a real turn each; C, E, F and H need a day's quota that has not been spent on getting to them. Rows 1, 4, 6, 13 outstanding under the standing override |
| 2026-08-30 | `qwen-code` 0.22.3 acp (`GLM-5.2` via an OpenAI-compatible key) | 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 (driven half) | — | **Qwen is authenticated now too, and took every row on its first real run** — 7/7, where 2026-08-27 recorded `Authentication required` on all three rows it had. The permission row is one of the seven the `installInteractions` repair brought back, and it passes: the prompt was asked once, answered, and the file was written. Row 13 passes here and not on Kimi Code for a reason the wire shows plainly — Qwen sends `usage_update` **before** the prompt result, inside the run it belongs to, and Kimi sends it after. Like Gemini, Qwen persists no session directory, so its `providerState` is empty where Grok's carries one |
| 2026-08-31 | `agy` 1.1.22 | 2, 3, 5, 7, 9, 10, 11, 12, 14 (driven half) | — | five of five, unchanged on a CLI seven patch versions newer, and re-run as the control for the day's shared ACP change: this is the one account on this machine that never refuses, and print mode reaches none of the changed code. A green here says a red elsewhere is that provider's, not the layer's |
| 2026-08-31 | `gemini` acp | 2, 3, 5, 9, 10, 14 (driven half) | — | **Row 5 is certified for Gemini at last**, on one turn: the answer arrives as one text block, split only where a stretch of reasoning displaced it — `["text","thinking","text"]` — and the stored conversation is `["user","assistant"]`. It had been red since 2026-08-30 for the assertion's own fault, corrected the same day and unrunnable until the quota came back. **The full file was re-run immediately after and got nothing**: `You have exhausted your daily quota on this model.` on every row, which is the account and not this path. That re-run is worth as much as the pass — it is what showed that a refused turn reaches this harness through `renderTurnFailure` rather than as an error chunk, so a row reading only the chunks reported a turn that failed with nothing said. Gemini's rows print the drawn failure now and refuse a quota row by name. Rows 1, 4, 6, 8, 11, 12, 13 outstanding under the standing override |
| 2026-08-30 | `kimi` acp (`zai-coding-plan/glm-5.3-flash`) | 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 14 (driven half) | 13 | **Kimi Code is authenticated now** — it was not on 2026-08-23, when every turn answered `Authentication required` — so this is its first real certification: 6 of 7 rows green on the first run, including the permission prompt, the reload, the closed tab and the queue. Row 13 is red for a reason worth keeping: Kimi sends `usage_update` **after** `session/prompt` returns. Driven directly over two turns, the wire reads answer, prompt-result, *then* usage — so the first turn's usage arrives during the second turn's run, the last turn's is dropped, and the context meter is permanently one turn behind. The path attributes a session update to the active run, which is the kernel's model; where usage should live for a provider that reports it out of band is an owner's question, not a patch |
| 2026-08-30 | `mimo` acp (`xiaomi/mimo-v2.5-pro-ultraspeed`) | — | A, B, C, E, F, G, H | **Still the account, and now checked twice.** Every turn ends `missing-required-result` with zero tokens, and `mimo acp` answers the same way driven directly — on its default model *and* on the free `mimo/mimo-auto`, set over the wire the product sets it with. So the blocker recorded on 2026-08-22 has not moved. What the run does certify is the failure surface: the turn ends as failed, the provider's own wording is what the column drew, usage arrives and is zero, and the queue still released the second turn only after the first was durable |
| 2026-08-30 | `codex` app-server (`gpt-5.4-mini`) | **1 (the driven half)**, and the eight rows above re-run on all five providers | — | **Row 1 found a regression the flip carried.** Driving it took one plan-mode turn: the provider held `planCompleted: true`, the completion held `undefined`, and Grimoire's plan approval therefore never appeared for the one provider that has it. The coordinator's rule — a resolved interaction whose response id names a plan — is satisfied by no provider in the repository, and the coordinator's own test asserted it with an invented id (`plan-approve`). The tab reads the provider's own reading of the finished turn now and merges the plan flag alone; the same read is what OpenCode's per-turn session-cost backfill hangs off, and it had stopped running too. Row I asserts the **mechanism** rather than the outcome — whatever the provider said, the surface heard — because Codex reports a plan only when the model actually produces plan items, and the first version of the row passed alone and failed in a full run on the same code |
| 2026-08-30 | `agy`, Claude Agent SDK, `codex` app-server, `opencode` acp, `grok` acp | 2, 3, 5, **6**, 7, **8**, 9, 10, **11, 12, 13**, 14 (driven half) | — | **Five rows left the person's half.** Row 8 is driven too: a second message sent while a turn runs is admitted as `queued`, and at the moment it starts the vault already holds the first answer — `["user","assistant","user"]` on all five providers, which is durability rather than mere completion. Row 6's driven half rides on row 12: the question is drawn once per column, as the provider composed it, which is where a provider that echoes it back would show up. Rows 11, 12 and 13 are driven now — a tab closed mid-turn whose answer the barrier still stores and a reopened tab still shows, one run drawn into two surfaces on one conversation, and the turn's usage on the column and in the saved conversation. Antigravity 5/5, Claude 7/7, Codex 8/8, OpenCode 7/7, Grok 7/7. Row 11 asserts that **nothing drew the ending** — the detached column was never told the turn finished — so it cannot pass for the ordinary reason. Antigravity has no row 13: print mode reports no usage at all. The rows are wired into all nine files; on Gemini, Kimi Code, MiMoCode and Qwen they have **never run**, for the account reasons already recorded, and each costs a turn. One Claude run stalled past ten minutes and was killed; every row passed on the re-run, so read it as intermittent rather than green |
| 2026-08-30 | `gemini` acp | 3, 9, 10, 14 (driven half) | 5, as this harness asserts it | Gemini's one turn of the day, spent on the row the `installInteractions` fix repaired — and **row B passed**: the permission prompt was asked once, answered, and the turn continued, which it could not do while the row called a method that no longer exists. Row C green. Row A answered `ok` and failed the new blocks assertion, which was **the assertion's fault**: Gemini drew a notice above its answer — it could not switch to auto-approve in an untrusted folder — and `StreamController` writes a notice into the open text block on purpose without adding it to the message's own `content`. The row allows for that now and the exception is pinned deterministically; it could not be re-run the same day, so **row 5 for Gemini is uncertified until the quota returns**. Rows 1, 4, 6, 8, 11, 12, 13 outstanding under the standing override |
| 2026-08-30 | `agy`, Claude Agent SDK, `codex` app-server, `opencode` acp, `grok` acp | 2, 3, 5, 7, 9, 10, 14 (driven half) on all five | — | **The first run with a real column**, and the run the column was widened for: the block-splitting fix of 2026-08-29 was held by unit tests only, because this harness stubbed `appendText` and nothing in it read `contentBlocks`. Row 5 now asserts the answer is one text block and that every split is explained by something that displaced it. Antigravity 2/2, Claude 3/3, Codex 4/4, OpenCode 3/3, Grok 3/3. **It found three defects.** The permission row was dead on seven of the nine files — it called `setApprovalCallback`, which the seam deletion replaced with `installInteractions`, through a cast that kept compiling; it is installed by name now. And a provider whose *reasoning* arrives as `provider-content` rather than as `reasoning-text` was drawn one thinking block per delta: OpenCode eight, Grok twenty-nine. The render target closed both open blocks ahead of any payload that drew; `handleStreamChunk` already closes what each chunk displaces, and does it per chunk, so the target closes nothing now. Re-run live after the fix: one thinking block on both. And steered input was reordered on a copy — `ChatState.messages` answers with one, so the move that puts a steered question in front of the turn it joined was performed on a temporary in every real tab, and the save wrote a question that follows its own answer; Codex's row D asserts the order now, live. Gemini, Kimi Code, MiMoCode and Qwen not run — quota and accounts, unchanged since 2026-08-27 |
| 2026-08-27 | `gemini` acp | 2, 3, 5, 9, 14 (driven half) | 10 | Gemini CLI's flip. Rows A and B green on a real turn each — the account replenishes about one at a time. Row C is red for the reason Gemini's *own* matrix already records its row 8 as `⛔ quota`: `session/load` answered `Internal error`, and the path rendered the composition's own sentence for exactly that — "Gemini could not open the session this conversation was resumed from … Starting a new chat helps only if the session itself is gone." Not a regression of this path; the same blocker one milestone earlier. Gemini persists no session directory, so its `providerState` is empty where Grok's carries one |
| 2026-08-27 | `kimi` acp | 14 (driven half) | A, B, C | Kimi Code's flip, under the standing override. Not authenticated on this machine: every turn answers `Authentication required`, and **the projection path renders those words** rather than the neutral sentence, which is the one row this run can certify. Rows A, B and C need an account |
| 2026-08-27 | `mimo` acp | 14 (driven half) | A, B, C | MiMoCode's flip, under the standing override. This account cannot generate — every turn ends `missing-required-result`, "The provider ended the turn without producing a result", which is the wording the path drew. Rows A, B and C need an account that answers |
| 2026-08-27 | `qwen` acp | 14 (driven half) | A, B, C | Qwen Code's flip, under the standing override. Not authenticated: `Authentication required: Use Qwen Code CLI to authenticate first.` — actionable, provider-written, and drawn by this path, which is what row 14 asks for. Rows A, B and C need an account |
| 2026-08-27 | `grok` acp (`grok-4.6`) | 2, 3, 5, 9, 10, 14 (driven half) | — | Grok Build's flip, and **the first ACP provider certified on this path**. Row C failed twice before it was worth anything, both times in the harness rather than the product: a harness deletes the directory it made when it is released, and the reload row released the first one before the second existed — so Grok's session directory, which lives *in the vault*, went with it and the agent correctly reported the session as missing. The reload row owns that directory now. Proven by breaking `nativeSessionRef`, which takes the reload onto a different session. Rows 1, 4, 6, 8, 11, 12, 13 outstanding under the standing override |
| 2026-08-27 | `opencode` acp | 2, 3, 5, 9, 10, 14 — never together | A, B or C on every one of six runs | **Flipped, certified intermittently.** Six runs, every row green at least three times and never all three together. Every failure carried the vendor's own `Upstream request failed: Endpoint is unavailable` / `OpenCode service failure`, or a model that answered without touching the filesystem — and the path rendered those sentences correctly each time, which is row 14 passing. Two harness defects were found and fixed on the way: an OpenCode session belongs to its project directory, so the reload row has to hand the directory over and not only the record store; and a row about a *permission* must name a shell command rather than an outcome, because a model that declines to use a tool proves nothing. The rows now refuse a vendor outage by name rather than reporting it as an assertion about this path. Held off the switch at first and then flipped, because excluding it while three providers that have never passed a row are on the list is not a rule, it is an inconsistency: its evidence is the strongest of the four account-bound ones |
| 2026-08-27 | Claude Agent SDK (`haiku`) | 2, 3, 5, 9, 10, 14 (driven half) | — | Claude's flip, and **the row that found the defect this path shipped with**: a provider that stops to ask hung forever, because the bridge that presents an interaction and resolves it was built only when the *adapter* opened a session and here the coordinator opens one. The coordinator attaches it now, one per conversation. Rows 1, 4, 6, 8, 11, 12, 13 outstanding under the standing override |
| 2026-08-27 | `codex` app-server | 2, 3, 5, 8, 10, 14 (driven half) | — | Codex's flip, and the only provider that declares steering — row D covers it, and it is the row that found the flip had silently taken steering away.  and the first provider content this path has drawn. Its answer renders **once** here, where `CodexLiveSmoke` row 1 records the legacy adapter path seeing it three times. Codex sends one tool call's result twice — at item completion and again from `flushPendingRawToolOutputs` — which `StreamController` merges by id on both paths, so it is an observation rather than a row. Rows 1, 4, 6, 8, 9, 11, 12, 13 outstanding under the standing override |
| 2026-08-27 | `agy` 1.1.19 | 2, 3, 5, 7, 14 (driven half) | — | Antigravity's flip. The driven half only; rows 1, 6, 9 do not apply to print mode — it has no plan approval, no interaction channel, and refuses anything short of full access before a process exists — and rows 4, 8, 10, 11, 12, 13 are outstanding, in a vault, by the owner's standing override |
