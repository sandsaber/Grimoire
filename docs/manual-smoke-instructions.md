# The manual half of the smoke matrices — how to run it

Four providers execute through the kernel: Codex, Claude, OpenCode and Grok. Each has a matrix, and
each matrix has two halves. **The half that runs itself is already run** — a real CLI, real turns,
the flipped path end to end, recorded in each matrix's own Record table. This document is the other
half: the rows that need a person, because they are about what the screen shows or about actions
only a hand can take.

Nothing here needs a developer. It needs Obsidian, a vault you do not mind writing into, and about
an hour for all four providers.

## Before you start

```bash
npm run build:release
```

That refreshes `main.js`, `styles.css` and `dist/grimoire`. Then install the build into the test
vault:

```bash
cp -r dist/grimoire "<your-vault>/.obsidian/plugins/grimoire"
```

If `OBSIDIAN_VAULT` is set in `.env.local`, the build already copied itself there and you can skip
that. Restart Obsidian, open Grimoire, and check the provider you are about to test is enabled in
settings with a CLI path that resolves.

**Use a scratch vault.** Several rows ask the assistant to write files, and one asks it to try
writing outside the vault.

## How to record what you find

Add one row per provider to the Record table at the bottom of that provider's matrix
(`docs/<provider>-flip-smoke-matrix.md`): the date, the CLI version, which rows passed, which
failed, and a note. Then update the summary in
`tests/unit/architecture/liveMatrixRecords.test.ts` — it asserts the last date per matrix, so it
goes red until you do, which is the point.

**A row that fails is a stop condition, not a bug report for later.** Each flip is one revertible
commit. Write down what you saw, in the words the screen used.

## What "passed" means

A row passes when the thing described happens *and nothing else visibly breaks around it*. If the
answer is right but a card renders as raw JSON, that is a failure of that row.

---

## Claude — 18 rows

Covered already, do not repeat: 1, 2, 3, 10, 12, 19, 22, 25, 27, 28.

| # | What to do | What must happen |
|---|---|---|
| 4 | Watch the reasoning while a turn runs | Thinking renders in its own block, separate from the answer, and each sentence appears **once** |
| 5 | Send a message with an image attached | The model describes the image |
| 6 | Ask something that makes the model ask you back | The question dialog opens, the choices render **including Other**, and your answer reaches the model |
| 7 | Turn on plan mode, send a message | The turn plans; the toolbar shows plan mode **without you switching it** |
| 8 | Approve the plan | The session leaves planning in the mode it was given, and the work proceeds |
| 9 | Refuse a plan, with feedback typed in | The model revises; the turn does **not** end |
| 11 | Trigger an approval, then press **Stop** while the prompt is on screen | The prompt disappears, the composer unlocks, the turn ends as interrupted |
| 13 | Fork the conversation from an earlier message, continue it | The fork takes; the new turn answers in that context |
| 14 | Rewind — conversation only | The conversation returns to that point; **no file changes** |
| 15 | Rewind — code and conversation | The files listed are restored, and the surface says how many changed |
| 16 | Rewind that fails: make one listed file read-only first (`chmod 444`) | The turn reports the failure **and the files are back as they were** |
| 17 | Ask for a subagent (`Task`) | The subagent card appears, runs, and reports its own result |
| 18 | Stop a running subagent | It stops, and the parent turn survives it |
| 20 | Use an MCP tool from a Grimoire-owned server | It appears in the tool list and runs |
| 21 | Use a trusted read-only MCP tool in normal mode | It runs with **no prompt at all** |
| 23 | Open two Claude tabs, run a turn in each | Answers and approvals land in the tab that asked |
| 24 | Close a tab mid-turn | The turn is cancelled and nothing is left running |
| 26 | Quit Obsidian while a turn is running, start it again | The turn shows as finished or interrupted, **never as still running** |

Row 16 in full, since it is the fiddly one: start a turn that edits two files, let it finish, then
`chmod 444` one of them, then rewind with `code-and-conversation`. The point is not that it fails —
it is that a failed restore leaves the files exactly as they were before the rewind began.

---

## Codex — 14 rows

Covered already, do not repeat: 1, 2, 6, 8, 12, 14, 16, 21.

Open `docs/codex-flip-smoke-matrix.md` and run every row not in that list. The ones that most need
eyes: the tool card and its output, the diff for an edit, thinking rendering separately, the context
badge landing on the turn that earned it, two tabs at once, switching the model from the toolbar,
approvals and their refusal, and the fork affordance.

---

## OpenCode — 8 rows

Covered already, do not repeat: 1, 2, 5, 6, 7, 8, 9, 12, 13, 15, 17, 18, 19.

Left for you: whether the tool card, the diff, the thinking block and the badges render; two tabs
side by side; switching the model from the toolbar; a write outside the vault being refused in safe
mode and allowed in auto-approve; and the permission dialog naming a shell command as a command
rather than as a tool called `Shell`.

---

## Grok — 7 rows

Covered already, do not repeat: 1, 1b, 2, 5, 6, 7, 8, 9, 13, 14, 16, 18, 19, 20.

Left for you: rows 3, 4, 10, 11, 12, 15, 17 and 21 from `docs/grok-flip-smoke-matrix.md` — the diff,
the thinking block, two tabs, switching the model mid-conversation, changing the reasoning effort
(which restarts the process, so the next turn must run under the new one), a write outside the vault,
the question dialog, and **the rewind button being gone**.

Row 21 is worth care: the flip removed a button that never worked. What must be true is that Grok
assistant messages have no rewind affordance **and no other message action was lost with it**.

---

## If something is ambiguous

Two rules settle most of it:

- **The row describes what a user would see.** If you cannot tell whether it passed, it failed — an
  outcome a person cannot recognise is not one the product delivers.
- **Provider-native behaviour wins.** If Grimoire renders something differently from the CLI's own
  interface and the matrix does not say it should, that is worth writing down even if no row names it.
