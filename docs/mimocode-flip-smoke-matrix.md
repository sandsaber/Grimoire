# MiMoCode flip — manual smoke matrix

The MiMoCode flip moved chat execution onto the execution kernel and deleted `MimocodeChatRuntime`.
Automated gates prove the wiring, the contracts, and whole turns over a fake ACP agent; **this is the
layer they cannot reach** — a real `mimo acp` process in a real vault.

Run it against a release build installed in a vault (`npm run build:release`, then the plugin folder
copy). Record the date, the MiMoCode CLI version, and one line per row. A row that fails is a stop
condition for the flip, not a bug report for later: the flip reverts as a single commit.

## Read this before you read the rows

**This matrix has a blocker the other four did not.** The account this branch has access to cannot
generate: every turn returns `end_turn` with zero tokens, and the surface shows *"The provider ended
the turn without producing a result."* That was true of `mimo acp` **before** Grimoire was involved —
the wire recording in `tests/fixtures/provider-traces/wire/mimocode-wire.json` was taken from the CLI
directly and shows the same empty turn, which is why it is labelled `coverage: partial`.

So every row below that needs an *answer* is unverified against MiMoCode itself. What is verified is
everything up to the answer: the process, the handshake, the session, the resume, the model catalog,
the command list, the failure text, and the cancel. The evidence that the harness itself is sound is
in the Record table — the same code path, run against OpenCode on the same machine, produces
thinking, text and usage.

**An account that generates is the one thing this matrix needs.** With it, rows 1, 2, 5, 7, 8, 12,
13, 15 and 6 become answerable in one headless run.

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
| 2026-08-22 | mimo 0.1.13 | live: 6, 9, 17, 18, 19 | live: 1, 2, 5, 7, 8, 12, 13, 15 | the account cannot generate: every turn ends `end_turn` with zero tokens and the surface shows "The provider ended the turn without producing a result." Not the flip — `mimo acp` answers the same way when driven directly, which is why its wire recording is `partial`. Control run: OpenCode row 1 through the same harness code on the same machine returned thinking, text and usage. What passed proves the process, the session, the resume (row 8 returned the same session id it was told), the failure text, the 16-model catalog, the 103 announced commands and the cancel |
