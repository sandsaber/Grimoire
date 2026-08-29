# Syncing `main` into `providers-migration`

The migration branch's standing rule is that milestones are **not** merged to `main`, and that the
mandatory mitigation is to sync `main` *into* the branch at every milestone gate. The last sync was
1.1.7 (`0f84b41`), at the M0a gate. M1 through M6 did not sync, and `main` has moved a long way.

This file turns "137 commits behind" into a decision with a size. It is generated from the tree
rather than maintained by hand: each commit in `HEAD..origin/main` is classified by what its `src/`
files are **relative to the merge base** — still here, deleted by this migration, or new on `main`.

That distinction is the whole point of the file, and getting it wrong is easy: a first pass asked
only whether a file exists on this branch, which files this migration deleted and files `main` added
both answer "no". It counted a new message-queue feature as a fix to deleted code.

## The size of it

| | Commits |
|---|---|
| Ahead on `main`, not on the branch | **137** |
| Files a plain `git merge origin/main` conflicts in | **148** |
| Files this migration deleted that existed at the merge base | **109** |
| Touch no `src/` at all (docs, tests, styles, workflows, release metadata) | 76 |
| Touch only files that still exist here | 34 |
| Add only files that are new on `main` | 2 |
| Touch only files this migration deleted | 2 |
| Touch both | 23 |

**The decision surface is 25 commits, not 137**, plus 2 features this branch simply
does not have. The 76 that touch no source and the 34 that touch only live files
are ordinary merges.

What needs a person is every commit that touched a file this migration deleted: a fix to
`AntigravityChatRuntime` is a fix to code that is gone, and the question is not whether to take the
diff but **whether the migrated path has the same bug**. `AGENTS.md` already states the rule this
serves — bug fixes on the frozen path are allowed and must be absorbed by later harvested slices —
and this is the list that rule applies to.

## What a plain merge would do

Resurrect 109 deleted files as conflicts, in the same commit that carries `main`'s real product
work: a diff nobody can review. Two shapes worth considering instead, neither of which this file
chooses:

1. **Merge, deleting on sight.** Take the merge, resolve every conflict in a file this branch
   deleted as a deletion, then work the 25 commits below as a checklist of "does the migrated
   path have this bug?". The history stays honest about when the sync happened.
2. **Replay `main` onto the migrated shape.** Cherry-pick the 112
   that do not touch deleted code, then port the rest by hand. Cleaner diffs, and it loses the merge
   base, which the next sync then has to re-establish.

## Touch only files this migration deleted (2)

| Commit | Subject |
|---|---|
| `70ebb682` | fix(grok): serialize concurrent ensureReady restarts |
| `3a702bab` | feat(grok): key the effort picker on what the session reports, per model (#95) |

## The two, answered

Both are Grok's, and answering them is what the other 23 need too.

**`70ebb682` — serialize concurrent `ensureReady` restarts.** The bug on `main` is that the send
path and the slash-menu catalog call `ensureReady` milliseconds apart, each evaluates restart
reasons against shared state, and a caller that evaluates mid-restart shuts the fresh process down
and races its own start — surfacing "Failed to start Grok Build. Check the CLI path and login state"
when both were fine. `main` serializes through a promise chain so exactly one cycle runs.

The migrated path does **not** have that bug, and does not have `main`'s fix either.
`ManagedAcpExecutionBackend.ensureClient` fences with a generation counter: two concurrent callers
each bump it, and the loser finds `generation !== this.clientGeneration`, closes the client it
opened, and throws a *side-effect-free* dispatch error. So no process is shut down under a healthy
start and no misleading message is shown — but the losing caller **fails** where `main`'s fix would
have queued it and let both succeed. In this composition that failure is classified `invalidated` /
`pre-dispatch-rejected`, which is honest and retryable, and it is still a turn the user asked for
that did not run. Queueing would be the better answer here too, and it is a change to the shared ACP
backend rather than a port of Grok's diff.

**`3a702bab` — key the effort picker on what the session reports, per model.** Partly present. Its
sibling commits in the table below touch `GrokChatUIConfig`, which is live, and the branch's
`GrokExecutionComposition` already takes `onModelChanged` with a `reasoningEffort` from the session
and syncs session model state from it. What has to be checked is the half that lived in the deleted
runtime: whether the reported levels reach `getReasoningOptions` per model, so a catalog model stops
offering `xhigh` once Grok Build says otherwise.

## Touch both (23)

Part of each applies directly; part landed on code that is gone.

| Commit | Subject | Deleted files | Live or new files |
|---|---|---|---|
| `4812edd5` | fix(antigravity): show vault skills in slash menu | 1 | 3 |
| `faae24e0` | fix(antigravity): resolve vault skills through the command catalog (#58) | 1 | 3 |
| `fffe0fab` | fix(antigravity): pass vault to agy --print via probed --add-dir (#67) | 1 | 2 |
| `55ff6d0c` | fix(antigravity): address review findings on the add-dir probe (#67) | 1 | 1 |
| `1891fcd7` | fix(antigravity): stream prompt over stdin to survive Windows argv limit (#69) | 1 | 4 |
| `568fa764` | fix(antigravity): stop killing healthy long turns at five minutes (#70) | 1 | 1 |
| `31e0b60e` | fix(antigravity): settle print runs after stdio drains and stop caching aborted probes | 1 | 2 |
| `ec6f649f` | fix(antigravity): harden cancellation across platforms and orphaned pipe holders | 1 | 1 |
| `53dde367` | fix(antigravity): refine probe abort detection and per-process cancel tracking (#69, #70) | 1 | 1 |
| `d4e594b3` | fix(antigravity): keep a fully streamed answer when agy flags ERROR after answering (#69) | 1 | 2 |
| `d9370d7e` | fix(opencode): launch acp with config content only | 4 | 2 |
| `260ab0e9` | fix(antigravity): count log-file growth as liveness for silent tool calls | 1 | 1 |
| `20f894b9` | fix(kimicode): launch acp with config content only; pin aux env contract | 2 | 1 |
| `4034864d` | fix(claude): rebuild the plan panel from the sdk's task tools | 1 | 4 |
| `3bedd86e` | feat(antigravity): stream answer text and tool steps while the run is open | 1 | 11 |
| `e37d5377` | fix(antigravity): close tool cards with the output agy reports | 1 | 1 |
| `3f981731` | fix(grok): keep the reported levels through a model switch (#95) | 1 | 1 |
| `c5e3975f` | fix(grok): close the remaining review findings on the effort picker (#95) | 1 | 3 |
| `7488b1a0` | fix(antigravity): close the review findings on live progress (#96) | 1 | 4 |
| `ae1e9413` | fix(providers): seed a model catalog only under the key it came from (#98) | 3 | 18 |
| `71a96fa7` | fix(acp): ask the agent whether a session is gone instead of guessing | 3 | 7 |
| `3e6ead48` | fix(providers): finish the session-resume fix for Gemini, Qwen and Grok | 5 | 4 |
| `4bb549e8` | fix(chat): tell the user when a session could not be resumed (#99) | 7 | 16 |

## Features `main` has that this branch does not (2)

New files, so they merge cleanly — but nothing here consumes them, and the migrated chat path is not
the one they were written against.

| Commit | Subject |
|---|---|
| `33baeed2` | feat(claude): add a runtime command cache store keyed by configuration |
| `74addd6f` | feat(chat): add a message queue that keeps each follow-up whole |

## Touch only files that still exist (34)

Ordinary merges, subject to the usual conflicts.

| Commit | Subject |
|---|---|
| `c119141d` | fix(antigravity): quote Windows cmd.exe launch arguments (#59) |
| `c90b01a5` | fix(gemini,qwen): cache model discovery so the picker stops booting the CLI |
| `60dc12f5` | fix(claude): stop re-probing an SDK catalog on every plugin load |
| `74203c51` | fix(claude): name the todo tools so the plan panel keeps working |
| `f16d1164` | fix(claude): complete the replayed plan entry instead of leaving it running |
| `ecfdbb3a` | fix(claude): seed the catalog probe suppressor when the CLI path resolves late |
| `17a8b6ef` | fix(claude): keep the deferred seed from absorbing a config change |
| `511bfcc9` | fix(providers): seed gemini, qwen, and codex catalogs when the CLI path resolves late |
| `57f5b478` | fix(chat): render LaTeX-delimited math instead of leaking its markup (#81) |
| `8deb17c8` | fix(providers): rediscover settled model catalogs only on a key change or by request |
| `8d10059c` | feat(claude): add a Refresh models button to the Claude settings tab |
| `848705e3` | feat(claude): persist the model catalog discovery fingerprint |
| `abb6b743` | feat(claude): seed only a catalog that records the key it came from |
| `1784b4c1` | fix(grok): expose xhigh effort for grok-4.6 |
| `39ec48ca` | feat(chat): summarise tool cards for agy PascalCase parameters |
| `2793f36a` | feat(claude): persist the discovered command list and the key it came from |
| `c63372d1` | fix(claude): reuse a persisted command list instead of probing on every load |
| `9462eedf` | fix(claude): top up a cached command list with the vault as it is now |
| `678a878e` | fix(claude): refresh the command cache from a live session for free |
| `568af4db` | fix(claude): pace retries after a command probe that found nothing |
| `37f18d3e` | feat(claude): make the command refresh button rediscover the list |
| `c1471149` | chore(claude): record why a command probe gave up and correct its cost note |
| `10022471` | feat(claude): wire the command cache and probe logging into the workspace |
| `30a53e83` | feat(grok): read the reasoning levels Grok Build reports per model (#95) |
| `9c480efa` | Merge remote-tracking branch 'origin/main' into fix/claude-command-catalog-probe-cache |
| `d1ef9640` | fix(claude): stop the cache writing on every dropdown open (#97) |
| `7a420010` | fix(claude): close the review findings on the command cache (#97) |
| `48480c41` | feat(chat): queue follow-ups as separate turns instead of merging them |
| `13169404` | feat(chat): show the queue as a list the user can edit row by row |
| `2f256ee7` | fix(chat): preserve queue position on edit and add visual separator between queue and input |
| `74051480` | fix(style): add fallback color for queue separator border-top |
| `86ce9683` | fix(style): match queue separator to the composer border on focus |
| `f8bce17e` | fix(chat): release the edited queue slot when that message leaves as its own turn |
| `7c2cd6c5` | fix(chat): make the queue hold hold, and keep it inside its conversation |
