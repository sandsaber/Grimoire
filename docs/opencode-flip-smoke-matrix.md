# OpenCode flip — manual smoke matrix

The OpenCode flip moved chat execution onto the execution kernel and deleted `OpencodeChatRuntime`.
Automated gates prove the wiring, the contracts, and whole turns over a fake ACP agent; **this is the
layer they cannot reach** — a real `opencode acp` process in a real vault.

Run it against a release build installed in a vault (`npm run build:release`, then the plugin folder
copy). Record the date, the OpenCode CLI version, and one line per row. A row that fails is a stop
condition for the flip, not a bug report for later: the flip reverts as a single commit.

## What makes this one different from the first three

Antigravity is a process per run, Codex a daemon, Claude an SDK stream. OpenCode is the first
**managed ACP subprocess**, and the first flip where the protocol — not the provider — decides what
the client must answer. Five of the rows below exist only because of that.

| Capability | Declared | Why it needs the real CLI |
|---|---|---|
| persistent runtime | yes | one `opencode acp` process outlives a turn; the kernel owns its lifetime |
| native history | yes | a session is resumed by id **and by database**, and both are written by the new path |
| plan mode | yes | the mode is a `setConfigOption` on an open session, not a launch flag |
| provider commands | yes | announced by the session as an update; nothing answers a request for them |
| images | yes | **never exercised by any flip**: prompt blocks carry them |
| instruction mode | yes | orchestrator instructions are added to the prompt the reference carries |
| effort | yes | a third `setConfigOption`, under an id the session itself names |
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
| 9 | Deleting the session outside Grimoire is legible | OpenCode says only "service failure", so the binding is kept and the turn says what to do |
| 10 | Two tabs run at once | neither tab's answer, model or mode appears in the other |
| 11 | Switching the model mid-conversation applies | the next turn runs on it, and the effort list changes with it |
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
`tests/integration/app/execution/opencode/OpencodeLiveSmoke.integration.test.ts`, against a real
`opencode acp`. It is skipped unless asked for, because it starts a CLI and spends the account's
tokens:

```bash
GRIMOIRE_OPENCODE_LIVE=1 node scripts/run-jest.js --selectProjects=integration \
  --runTestsByPath tests/integration/app/execution/opencode/OpencodeLiveSmoke.integration.test.ts
```

Through `scripts/run-jest.js` rather than bare `npx jest`: the runner passes `--localstorage-file`,
and without it every suite that writes provider settings fails with `storage.getItem is not a
function`.

`GRIMOIRE_OPENCODE_TRACE=1` prints the debug records the composition writes, `GRIMOIRE_OPENCODE_CLI`
points at a binary other than `opencode` on `PATH`, and `GRIMOIRE_OPENCODE_MODEL` overrides the
model.

It covers rows 1, 2, 5 (the numbers, not the badge), 6, 7, 8, 9, 12, 13, 15, 17, 18 and 19. **The
rows it does not cover are the ones a person has to look at**: whether the tool card, the diff, the
plan and the badges actually render, two tabs side by side, switching the model from the toolbar,
"always allow" not asking twice, and a write outside the vault.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-08-20 | 1.18.18 | live: 1, 2, 5, 6, 7, 8, 9, 12, 13, 15, 17, 18, 19 | — | first live run found five defects, all fixed and pinned; see the journal entry for that run |
