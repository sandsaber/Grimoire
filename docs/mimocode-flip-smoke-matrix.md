# MiMoCode flip — manual smoke matrix

The MiMoCode flip moved chat execution onto the execution kernel and deleted `MimocodeChatRuntime`.
Automated gates prove the wiring, the contracts, and whole turns over a fake ACP agent; **this is the
layer they cannot reach** — a real `mimo acp` process in a real vault.

Run it against a release build installed in a vault (`npm run build:release`, then the plugin folder
copy). Record the date, the MiMoCode CLI version, and one line per row. A row that fails is a stop
condition for the flip, not a bug report for later: the flip reverts as a single commit.

## Read this before you read the rows

**The blocker this matrix carried for twelve days was never the account.** It said: *"the account
this branch has access to cannot generate: every turn returns `end_turn` with zero tokens"*, checked
on 2026-08-22, 2026-08-30 and 2026-08-31, and each check was a real observation. The conclusion drawn
from them was wrong.

On **2026-09-03** the CLI was asked outside ACP, one model at a time:

| `mimo run -m …` | Answer |
|---|---|
| `xiaomi/mimo-v2.5-pro-ultraspeed` — **what an ACP session opens on** | `Error: Not supported model mimo-v2.5-pro-ultraspeed` |
| `mimo/mimo-auto` — what the 2026-08-30 checks used | `Error: MiMo free API service has ended. Sign in or configure a third-party API.` |
| `xiaomi/mimo-v2.5-pro` | `ok` |

Both models the blocker was established on are dead — one the vendor does not serve, one whose free
tier ended — and the third had never been tried. The account generates.

**What made it look like an account is the ACP path swallowing the error.** With `--print-logs
--log-level DEBUG` the server says
`ERROR service=llm providerID=xiaomi modelID=mimo-v2.5-pro-ultraspeed error={"name":"AI_APICallError","url":"https://token-plan-ams.xiaomimimo.com/v1/chat/completions"…}`,
and what reaches the client is `session/prompt` answering `end_turn` with zero tokens and no error at
all. Grimoire draws *"The provider ended the turn without producing a result."* because that is
literally what happened; there is nothing on the wire to say why. Not ours to fix, and worth knowing
before reading a silent turn as an account.

Set the model and the same session answers: `agent_message_chunk`, `agent_thought_chunk`,
`usage_update` and `available_commands_update`, with `totalTokens: 38318` on the prompt result. Over
`session/set_model` and over `session/set_config_option` alike — the method the product uses works.
**Wait for the set to be answered before prompting**: a first probe sent both together, the turn ran
on the session's default and failed exactly as before.

Run the harnesses with the model, and note the prefix — `decodeMimocodeModelId` returns `null`
without it and the setting is silently dropped:

```bash
GRIMOIRE_MIMOCODE_LIVE=1 GRIMOIRE_MIMOCODE_MODEL=mimocode:xiaomi/mimo-v2.5-pro \
  npm run test -- --selectProjects integration --testPathPatterns MimocodeLiveSmoke
```

## What this one shares, and what it does not

MiMoCode is the third **managed ACP subprocess**, after OpenCode and Grok, and the flip added nothing
to the shared stack: same backend, same client adapter, same launcher, same permission bridge. Two
things are its own.

| Capability | Declared | Why it needs the real CLI |
|---|---|---|
| persistent runtime | yes | one `mimo acp` process outlives a turn; the kernel owns its lifetime |
| native history | yes | a session is resumed by id **and by database** (`MIMOCODE_DB`), both written by the new path |
| plan mode | yes | the mode is a `setConfigOption` on an open session, not a launch flag |
| provider commands | yes | announced by the session as an update; nothing answers a request for them |
| images | yes | **never exercised by any flip**: prompt blocks carry them |
| instruction mode | yes | orchestrator instructions are added to the prompt the reference carries |
| effort | yes | **not a third `setConfigOption` here**: mimo 0.1.13 offers `model` and `mode` only, and carries the thinking level inside the model id (`.../low`, `.../medium`, `.../high`) |
| rewind / fork | no | not declared; nothing to check |
| turn steering | no | not declared; nothing to check |
| per-run MCP selection | no | Grimoire owns the list and injects it; the per-run selector is off |

## The matrix

Rows 1–6 are the turn. Rows 7–11 are the session. Rows 12–16 are what the protocol asks of the
client. Rows 17–19 are what four surfaces ask when nobody is in a conversation.

| # | Row | What proves it |
|---|---|---|
| 1 | A turn answers, and the answer streams | text appears while it runs, not only at the end |
| 2 | A tool call renders as a card, with its output | the card shows the normalized tool name, not `tool` |
| 3 | A diff renders for an edit | the edit card shows the change, not raw text |
| 4 | A plan renders and updates | the progress item follows the agent's plan entries |
| 5 | The context badge fills in | percentage and window, then the prompt's own tokens after the answer |
| 6 | Cancelling a turn stops the agent | the process stops working; the tab is usable immediately |
| 7 | A second turn continues the same session | no history is re-sent, and the agent remembers turn 1 |
| 8 | Reloading Obsidian resumes the conversation | the transcript hydrates and turn 3 continues it |
| 9 | Deleting the session outside Grimoire is legible | the binding is kept and the turn says what to do |
| 10 | Two tabs run at once | neither tab's answer, model or mode appears in the other |
| 11 | Switching the model mid-conversation applies | the next turn runs on it — and because the level is inside the model id, switching the level *is* switching the model |
| 12 | An edit asks before it writes | the prompt names the file, and Deny stops the write |
| 13 | A command asks before it runs | the prompt names the command; Allow runs it, Deny does not |
| 14 | "Always allow" is not asked again in that session | the second edit runs without a prompt |
| 15 | Dismissing the prompt cancels the turn | nothing is written and the turn ends |
| 16 | A write outside the vault is refused in safe mode | containment holds; full access allows it |
| 17 | The model catalog fills from an empty vault | the settings model browser lists models on first open |
| 18 | Slash commands list in a blank tab | the session's own commands appear in the composer |
| 19 | The spend indicator moves | after a turn, with a vendor that reports cost and one that does not |

## The half that runs itself

Twelve rows are driven headlessly by
`tests/integration/providers/mimocode/execution/MimocodeLiveSmoke.integration.test.ts`, against a real
`mimo acp`. It is skipped unless asked for, because it starts a CLI and spends the account's tokens:

```bash
GRIMOIRE_MIMOCODE_LIVE=1 node scripts/run-jest.js --selectProjects=integration \
  --runTestsByPath tests/integration/providers/mimocode/execution/MimocodeLiveSmoke.integration.test.ts
```

Through `scripts/run-jest.js` rather than bare `npx jest`: the runner passes `--localstorage-file`,
and without it every suite that writes provider settings fails with `storage.getItem is not a
function`.

`GRIMOIRE_MIMOCODE_TRACE=1` prints the debug records the composition writes, `GRIMOIRE_MIMOCODE_CLI`
points at a binary other than `mimo` on `PATH`, and `GRIMOIRE_MIMOCODE_MODEL` overrides the model.

It covers rows 1, 2, 5 (the numbers, not the badge), 6, 7, 8, 9, 12, 13, 15, 17, 18 and 19. **The
rows it does not cover are the ones a person has to look at**: whether the tool card, the diff, the
plan and the badges actually render, two tabs side by side, switching the model from the toolbar,
"always allow" not asking twice, and a write outside the vault.

Nine of those twelve currently fail for the reason at the top of this document, not for a defect in
the flip. They will pass or fail honestly the first time this is run on an account that generates,
and that run is what certifies the flip.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-09-03 | `mimo 0.1.13` (`xiaomi/mimo-v2.5-pro`) | 1, 2, 5, 6, 8, **9**, **12/13**, 15, 17, 18, 19 | 7 | **Eleven of twelve, and the two rows closed were both measuring something other than what they are named for.** Rows 12/13 asked for a file "in the working directory": the permission *was* asked and allowed, the agent wrote the file and replied `done` — into the user's home, because this CLI resolves that phrase there. Proven outside Grimoire entirely: `mimo run` in a fresh temp cwd asks for `external_directory (/home/m5/*)` for the same sentence, and writes exactly where told when the path is absolute. The row names the path absolutely now; OpenCode's twin keeps the relative phrasing because that CLI resolves it correctly. Row 9 had drifted from OpenCode's twin, which was rewritten when a load that fails learnt to ask `session/list`: an unknown session is replaced rather than kept, the turn succeeds on a fresh one, and `isSessionDropped()` answers `true` — all three now assert that live. **Row 7 is the one left**, and the CLI is not the reason: driven straight at `mimo acp`, two turns on one session both answer, with and without the model re-applied between them the way the product re-applies it. The empty second turn appears only through the product path, so what it sends on a second turn is where to look next |
| 2026-09-03 | `mimo 0.1.13` (`xiaomi/mimo-v2.5-pro`) | 1, 2, 5, 6, 8, 15, 17, 18, 19 | 7, 9, 12/13 | **The account was never the blocker.** Nine of twelve on the first run that used a model the vendor still serves — the two the blocker was established on are dead, and the one the ACP session opens on, `xiaomi/mimo-v2.5-pro-ultraspeed`, is refused by the vendor as "Not supported model". Row 5 reports `contextTokens: 34559` of `1048576`; row 19 reads a real spend, `$0.02 this month`. The three reds are this provider's own and are the first ones worth reporting: row 7's *second* turn ends without a result where its first answered, row 9 draws nothing at all, and rows 12/13 do not complete the permitted write. None had ever been reachable before |
| 2026-08-22 | mimo 0.1.13 | live: 6, 9, 17, 18, 19 | live: 1, 2, 5, 7, 8, 12, 13, 15 | the account cannot generate: every turn ends `end_turn` with zero tokens and the surface shows "The provider ended the turn without producing a result." Not the flip — `mimo acp` answers the same way when driven directly, which is why its wire recording is `partial`. Control run: OpenCode row 1 through the same harness code on the same machine returned thinking, text and usage. What passed proves the process, the session, the resume (row 8 returned the same session id it was told), the failure text, the 16-model catalog, the 103 announced commands and the cancel |
