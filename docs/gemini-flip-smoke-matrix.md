# Gemini flip — smoke matrix

The Gemini flip moved chat execution onto the execution kernel and deleted `GeminiChatRuntime`.
Automated gates prove the wiring, the contracts, and whole turns over a fake ACP agent; **this is the
layer they cannot reach** — a real `gemini --acp` process.

The automated half runs headlessly:

```bash
GRIMOIRE_GEMINI_LIVE=1 npm run test -- --selectProjects integration --testPathPatterns GeminiLiveSmoke
```

It starts the CLI and spends the account's quota, so it is off unless that variable is set.
`GRIMOIRE_GEMINI_CLI` overrides the executable and `GRIMOIRE_GEMINI_TRACE=1` prints the debug log.

## Read this before you read the rows

**This is the first wave-7 harness that could run at all**, and the first live run since wave 5.
MiMoCode's account cannot generate and Kimi Code's machine is not authenticated, so wave 6 shipped
two flips no live run could confirm. Gemini answered its wire recording in full, which is why it was
built before Qwen despite the plan's order — and the run paid for itself immediately.

**Three defects were found by running it, and two of them were shipped.** They are described below
the table, because they matter more than the rows.

Recorded against **gemini 0.57.0** on 2026-08-31, Linux, with row 16 taken on 2026-09-03 once the
quota that had blocked it came back. The 2026-08-23 run against 0.55.1, where everything after row 1
was quota-blocked, is in the Record at the bottom.

| # | Row | Result |
|---|---|---|
| 1 | Answers a plain message, and streams it | ✅ answered `OK`, with the refusal notice beside it |
| 2 | Shows a tool call and its result | ✅ **first time ever** — read the note, then its content |
| 5 | Reports the context window and the tokens the prompt cost | ⛔ **no usage on the wire at all** — the CLI's shape, not a defect here |
| 6 | Cancels a running turn and leaves no agent behind | ✅ cancelled, no agent left |
| 7 | Continues the same session on a second turn | ✅ remembered `violet` in the same session |
| 8 | Resumes the conversation a fresh load was told about | ✅ resumed in a second process, and the drop marker is written back empty |
| 9 | Says what a session the agent no longer has needs the person to do | ✅ **replaced, and it can say so** — `isSessionDropped()` answers `true` |
| 12/13 | Asks before it writes, and writes what was allowed | ✅ asked once, wrote the file |
| 15 | Writes nothing when the prompt is refused | ⛔ **nothing was ever asked** — the agent's write tool stops before the permission, see below |
| 16 | Runs the turn in the mode the tab is set to | ✅ **2026-09-03** — planned instead of writing: it drafted `plans/planned-live.md` and left `planned-live.txt` absent |
| 17 | Fills the model catalog from an empty vault | ✅ six models and four modes, from one reply |
| 19 | Shows the spend when there is spend to show | ⛔ `You have exhausted your daily quota on this model.` |

**Nine of twelve.** Row 16 was taken on 2026-09-03 and is green: Grimoire's `plan` is not one of this
agent's four mode ids, and what proves the translation landed is the agent behaving like a read-only
session — it drafted a plan into `plans/planned-live.md` and never created the file it was asked for.
Row 19 remains the day's quota running out, carrying the vendor's own sentence for why. The other two
are findings, one in this CLI and one in it too:

### Row 5 — this CLI sends no usage, at any point in a turn

The row asked for the pair the badge needs: the context window from an update while the turn runs,
the prompt's tokens from the answer. It got **neither** — no `usage` chunk was produced at all. That
is not the path dropping one: `tests/fixtures/provider-traces/wire/gemini-wire.json` records the
whole vocabulary this CLI speaks, and it is three kinds — `agent_message_chunk`,
`agent_thought_chunk`, `available_commands_update`. There is no usage update in it and no `usage`
on the prompt result. Qwen's and Kimi Code's row 5 are the same class of answer: what the CLI
reports is what the badge can show. Nothing to fix here; the row records the shape.

### Row 15 — the agent's write tool stops at the existence check

The row asks for a file, denies the permission, and expects the file not to exist. Nothing was ever
asked: the agent chose its `write_file` tool, which reads the file it is about to replace, and
abandoned the turn when that read failed — before Grimoire's approval was reached. Row 12/13 passed
on the same day because the model happened to pick the shell instead.

Half of that was ours, and is fixed in the same commit as this run:

- a client request handler that raised an error answered `Internal error` unless the error was an
  `instanceof Error` — false for anything raised in another realm, which is what `node:fs` produces
  under Jest — so the agent was told nothing about a file that simply was not there;
- a read of a missing file answered like every other failure. It answers `-32002 Resource not
  found: <path>` now, which is the protocol's own code and the sentence the agent's own client
  looks for. A containment refusal keeps the internal error and the sentence a person reads, so the
  two are finally distinguishable — that was recorded as an open item since 2026-08-23.

The other half is upstream, and the row cannot pass until it moves. In `gemini 0.57.0`:

- `ClientSideConnection.#handleResponse` rejects with `response.error` — the JSON-RPC object, not an
  `Error`;
- `AcpFileSystemService.normalizeFileSystemError` maps a failed read to `ENOENT` by testing
  `err instanceof Error ? err.message : String(err)` against four markers, one of which is the
  `Resource not found` we now send. For a plain object that expression is `"[object Object]"`, so
  **no client answer can ever be classified**;
- `getCorrectedFileContent` then asks `isNodeError(err) && err.code === 'ENOENT'`, and `isNodeError`
  requires an `Error` instance too. So the tool reports `Error checking existing file: …` and stops.

What our fix buys today is that the sentence it stops with names the actual condition instead of
saying `Internal error`. Re-run the row when the CLI updates; nothing in Grimoire is waiting on it.

**Row 1 is the one to read.** It is the first Gemini turn this branch has ever completed end to end,
and it carries both of the fixes the previous run's failures produced: the agent refused
`session/set_mode` for `yolo` exactly as before, the turn **survived it**, and the notice explaining
that appeared in the transcript beside the answer.

> Gemini did not switch to Auto-approve: Cannot enable privileged approval modes in an untrusted
> folder. This turn ran in the mode the session was already in.
>
> OK

**⛔ quota** is not a Grimoire result, and it is now measured rather than guessed: this account
replenishes roughly **one turn at a time**. The second run began with quota, answered row 1 in full,
and was exhausted again by row 2. Every row needing an answer after the first is therefore still
unverified — and the rows that do not need one (the missing session, the mode reaching the session,
the model catalogue, the cancel) pass consistently across both runs.

**What the second run did certify is finding 3's fix.** Where the tab used to say "Grimoire could not
establish whether this run completed", it now says:

> You have exhausted your daily quota on this model.

That is the vendor's own sentence, reaching the surface through the classification added after the
first run. Confirmed against the real CLI rather than against a fake.

Row 19 is weak by construction: it asserts the turn ran and records what the indicator showed. A plan
that charges nothing per turn makes an empty indicator honest, so a green here means "nothing
contradicted it", not "spend works".

## What the run found

### 1. Every turn died with Auto-approve on — shipped, fixed in this wave

`gemini 0.55.1` advertises four modes in its reply to `session/new` — `default`, `autoEdit`, `yolo`,
`plan` — and then **refuses two of them**:

```
session/set_mode { modeId: "yolo" }
→ -32603 Internal error
  { details: "Cannot enable privileged approval modes in an untrusted folder." }
```

`autoEdit` answers the same way; `default` and `plan` are accepted. The set is awaited before the
prompt, so a thrown rejection ended the turn before it was sent — and the message the user got was
about a session that may no longer exist, which is not what happened at all.

The blast radius in the shipped product: a Gemini user who turns Auto-approve on in a folder Gemini
has not been told to trust loses **every turn**. This is the same shape as the fourth review's
Critical (`full_access` sent as a `modeId`), reached from the other side: the id was right this time
and the agent still would not take it.

Fixed in `GeminiAcpDynamicConfigApplier`: a refused mode leaves the turn running under the mode the
session already has, and the refusal is recorded through a port the composition logs. The refusals
observed are all toward asking rather than away from it — the privileged modes are the ones an
untrusted folder withholds — so the session is stricter than the toolbar promises rather than looser.
That is the safe way to be wrong about a permission, and it is still wrong — so the turn it happened
to now carries a notice saying so, in the toolbar's own word for the mode and with the agent's reason
behind it: *"Gemini did not switch to Auto-approve: Cannot enable privileged approval modes in an
untrusted folder. This turn ran in the mode the session was already in."* Once per session rather than
once per turn, because the folder is what the refusal is about and it does not change between turns.

### 2. The model list was read under the wrong name — shipped, fixed in this wave, three providers

`extractAcpSessionModelState` passed `availableModels` through untouched, and `AcpModelInfo` declared
`id`. The wire sends **`modelId`**, and three recordings say so: `gemini 0.55.1`, `grok` and `mimo`
all answer `session/new` that way. So every consumer read `undefined`:

- **Gemini** called `.trim()` on it and threw, inside the handler that opens a session. The metadata
  session swallowed it and answered "no models"; the legacy runtime's `createSession` swallowed it
  the same way and reported that the session could not be created;
- **MiMoCode** and **Grok** pass theirs through a normalizer that drops an entry with no id, so they
  discovered no models over ACP and said nothing. Grok has a file catalog behind it; MiMoCode does
  not.

Fixed in the shared extractor, which now resolves `modelId` or `id` into one and drops an entry that
has neither. Row 17 went from zero models to six.

**Why no test caught it:** every fake wrote `id`, including the one written for this composition two
commits ago — from a reading of the recording that got the modes right and the models wrong. The
fakes now use the recorded shape, and the extractor has its own case.

### 3. A vendor error becomes "could not establish whether this run completed" — shipped, open

`ManagedAcpExecutionBackend.recover` takes the prompt's rejection as `_error` and never reads it. A
`session/prompt` that fails is treated as a connection that died: the process is closed, a new one is
launched, the same prompt is sent again, and when that fails too the run is reconciled to `unknown`
and the tab shows *"Grimoire could not establish whether this run completed."*

For a transport failure that is right. For an agent that answered — `429 You have exhausted your
daily quota on this model` — it is three wrongs at once: the message the vendor sent is discarded,
the turn is charged a second time against a quota that is already gone, and the user is told
something that means nothing.

This is **shared** across the flipped managed-ACP providers, not Gemini's. **Fixed and confirmed
live**: a `JsonRpcErrorResponse` means the agent answered, so the turn ends with the vendor's own
words and is not retried. The second run is the evidence — the tab shows *"You have exhausted your
daily quota on this model."*

Related and smaller: an ACP `fs/read_text_file` for a file that does not exist surfaces as a bare
internal error, which is also what a containment refusal surfaces as. Row 15 is what that costs —
Gemini reads a file to check whether it exists before writing it, got `Error checking existing file:
Internal error`, and abandoned its write tool without ever raising the permission request the row is
about. In row 12/13 it fell back to a shell command and wrote the file that way, which is why the
approval it did raise was for `echo` rather than for a write.

## The half a person still has to look at

The headless rows above drive the runtime and the kernel. They do not draw anything. Install a
release build in a vault and check, with quota:

- the answer streams into the tab rather than arriving at the end;
- a tool call renders as a card with the agent's own name on it — this provider has no tool stream
  adapter, so `read` stays `read` rather than becoming the canonical `Read` its siblings show;
- the approval prompt names the tool and the path, and answering it releases the turn;
- the model selector lists what row 17 discovered, and picking one changes the badge;
- the permission toggle shows Safe/Plan/Auto-approve, and picking Auto-approve in an untrusted folder
  leaves the turn running with a warning notice in it. **This is the one to look at hardest**: the
  notice is what stands between the toolbar saying Auto-approve and the session being in Default, so
  read it as a user would and check it is legible where it lands.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-09-03 | gemini 0.57.0 | live: 16 | — | **row 16 alone, and it closes the row the quota took on 2026-08-31.** Run after the day's projection matrix had already exhausted twenty free-tier requests on `gemini-3.5-flash`, so it also says the exhaustion is per model rather than per account. The turn ran read-only: `update_topic`, then a plan written to `plans/planned-live.md`, and no `planned-live.txt` — which is the half `session/set_mode` would have broken by forwarding an id this agent does not have. Rows 5 and 15 unchanged and not re-run: one is this CLI sending no usage at all, the other waits on the CLI's own `write_file` |
| 2026-08-31 | gemini 0.57.0 | live: 1, 2, 6, 7, 8, 9, 12/13, 17 | live: 5, 15, 16, 19 | **the first run this account could pay for**: eight of twelve, and seven of the eight had never passed before. Row 9 is the one it was run for — the session-restart notice was wired for this provider the same day, the last of the six on this transport, and the row watched a session be replaced and `isSessionDropped()` answer `true`. Rows 16 and 19 are the quota running out at the end of the run, not the flip; row 5 is this CLI sending no usage at all, which its own wire recording already showed; row 15 is the agent's `write_file` tool abandoning the turn at its existence check, half ours and fixed here — a missing file answers `-32002 Resource not found` now, and a handler's message survives a cross-realm error — and half upstream, where no client answer can be classified at all. The file's timeout went to ten minutes on the evidence of a turn that took five |
| 2026-08-23 | gemini 0.55.1 | live: 1, 6, 9, 16, 17 | live: 2, 5, 7, 8, 12/13, 15, 19 | second run, after quota replenished. **Row 1 completed end to end for the first time**, carrying both fixes the first run produced: the mode refusal no longer kills the turn, and the notice explaining it renders beside the answer. Finding 3's fix confirmed too — the tab now shows the vendor's own "You have exhausted your daily quota on this model." where it used to show a meaningless notice. The account replenishes about one turn at a time, so everything after row 1 is still quota-blocked |
| 2026-08-23 | gemini 0.55.1 | live: 9, 16, 17, 19 | live: 1, 2, 5, 6, 7, 8, 12/13, 15 | the account's daily quota ran out partway through the first run — `session/prompt` answers `429 You have exhausted your daily quota on this model` — so every row needing an answer is unverified. Not the flip. What the run *did* find is three defects, two of them shipped and both fixed here: `session/set_mode` refuses the privileged modes in an untrusted folder and was killing every Auto-approve turn, and the shared model extractor read `id` where the wire sends `modelId`, which broke discovery for Gemini, MiMoCode and Grok. The third is recorded open above: a vendor error on the prompt becomes "could not establish whether this run completed", after a silent second attempt |

