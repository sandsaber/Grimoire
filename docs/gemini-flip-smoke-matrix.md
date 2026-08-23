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

Recorded against **gemini 0.55.1** on 2026-08-23, Linux.

| # | Row | Result |
|---|---|---|
| 1 | Answers a plain message, and streams it | ⛔ quota |
| 2 | Shows a tool call and its result | ⛔ quota |
| 5 | Reports the context window and the tokens the prompt cost | ⛔ quota |
| 6 | Cancels a running turn and leaves no agent behind | ⛔ quota |
| 7 | Continues the same session on a second turn | ⛔ quota |
| 8 | Resumes the conversation a fresh load was told about | ⛔ quota |
| 9 | Says what a session the agent no longer has needs the person to do | ✅ the binding is kept and the turn says so |
| 12/13 | Asks before it writes, and writes what was allowed | ⛔ quota — but see finding 3 |
| 15 | Writes nothing when the prompt is refused | ❌ finding 3: the agent never reached the approval |
| 16 | Runs the turn in the mode the tab is set to | ✅ Plan reached the session; nothing was written |
| 17 | Fills the model catalog from an empty vault | ✅ six models and four modes, from one reply |
| 19 | Shows the spend when there is spend to show | ⚠️ ran without error and reported no spend |

**⛔ quota** is not a Grimoire result. Partway through the first run the account answered
`session/prompt` with `429 You have exhausted your daily quota on this model`, and every row after it
that needs an answer got nothing. Re-run the matrix on a day with quota before treating any of those
rows as evidence — and read finding 3 first, because what the user sees for a `429` is the third
defect.

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

This is **shared** across the five flipped managed-ACP providers, not Gemini's. It is recorded rather
than fixed here because the fix is a change to how the shared backend classifies a rejection — a
protocol-level error the agent answered with, against a transport-level failure it did not — and
because the account it was found on has no quota left to prove the fix with today.

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
| 2026-08-23 | gemini 0.55.1 | live: 9, 16, 17, 19 | live: 1, 2, 5, 6, 7, 8, 12/13, 15 | the account's daily quota ran out partway through the first run — `session/prompt` answers `429 You have exhausted your daily quota on this model` — so every row needing an answer is unverified. Not the flip. What the run *did* find is three defects, two of them shipped and both fixed here: `session/set_mode` refuses the privileged modes in an untrusted folder and was killing every Auto-approve turn, and the shared model extractor read `id` where the wire sends `modelId`, which broke discovery for Gemini, MiMoCode and Grok. The third is recorded open above: a vendor error on the prompt becomes "could not establish whether this run completed", after a silent second attempt |

