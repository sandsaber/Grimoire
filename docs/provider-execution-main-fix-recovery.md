# Recovering the fixes the flips dropped

The `main` sync merged 137 commits and left this branch green. Green is not the
same as complete: a fix that lived inside a file this migration deleted was
resolved away with the file, and a fix that arrived as a new module can sit in
the tree with nothing calling it. This is the audit of which of `main`'s fixes
are actually live here, and the plan for the ones that are not.

## How it was checked

Three passes, because one is not enough:

1. **Deleted-file pass.** Every commit in the merged range that touched a file
   this migration had deleted — 25 of 137 — because a conflict resolved as "keep
   the deletion" silently drops whatever that commit changed.
2. **Dead-export pass.** Every `export` those 137 commits introduced, checked for
   a production consumer outside its own file. This is what catches a fix that
   merged cleanly and is wired to nothing.
3. **Marker pass**, for behaviours that added no export — a `--print-timeout`
   flag, a five-minute kill, an `ERROR` frame — grepped against the migrated
   provider path.

Reachability alone was tried and is too coarse: `claudeTaskPlanState.ts` is
reachable because a live module imports it, and its feature is still dead
because nothing supplies the state.

## What is live, verified

- **ACP launch by config content**, OpenCode / MiMoCode / Kimi Code — the
  `*_CONFIG_CONTENT` env var and the deliberate deletion of the file-based one
  (`OpencodeExecutionComposition.ts`, and the two siblings);
- **the model-catalog refresh cache and its fingerprints**, every provider,
  ported during the sync with the `force` flag plumbed through
  `ProviderModelsPort`;
- **Claude's runtime command cache store**, constructed in
  `ClaudeWorkspaceServices`;
- the message queue, the Windows `cmd.exe` quoting, both CI jobs, and
  Antigravity's vault-skill **catalog**.

## What is not, and what it costs a user

### A. Antigravity — 14 of its 16 commits touched deleted files

The whole print-mode hardening series is gone. Nothing in
`src/providers/antigravity/execution` or `runtime` matches its markers.

| # | Fix | What its absence means |
|---|---|---|
| A1 | `--add-dir <vault>` behind a capability probe (#67) | the agent's workspace does not include the vault root |
| A2 | capability probe + prompt over stdin as NDJSON (#69) | a long conversation hits `spawn ENAMETOOLONG` on Windows |
| A3 | `--print-timeout` instead of a fixed kill (#70) | healthy long turns are killed at five minutes |
| A4 | log-file growth counted as liveness | a silent tool call reads as a hung process |
| A5 | keep a fully streamed answer when `agy` flags `ERROR` after answering | the answer the user already saw is thrown away |
| A6 | stream answer text and tool steps while the run is open | the turn renders only when it finishes |
| A7 | tool-card name and input normalization (#96) | cards show raw tool ids |
| A8 | vault-skill invocation expansion (#58) | a skill picked from the menu is sent unexpanded |

Three of the modules those depend on — `AntigravityCliCapabilities.ts`,
`AntigravityStreamJson.ts`, `antigravityToolNormalization.ts` — came back with
the merge and **were deleted again during the sync**, on the parity gate's
report that they were unreachable. That reading was wrong, and it is the same
mistake this session had already caught once: the flip lost the behaviour and
left the module behind, exactly as Grok's `subagent_finished` did. Unreachable
means "nothing calls it", and the question that has to follow is *why*.

`src/providers/antigravity/AGENTS.md` still documents A1, A2 and A3 as current
behaviour, and cites one of the deleted modules by name.

Not yet decided: cancellation hardening across platforms (`ec6f649f`). The
migrated backend has process-tree machinery of its own from the M2 proof, so
this needs a behaviour comparison rather than a restore.

### B. Claude — the plan panel

`claudeTaskPlanState.ts` merged in, `transformSDKMessage` takes an optional
`taskPlanState`, and `ClaudeContentPresenter.transformOptions()` supplies
`streamState` and `usageState` and not that. The plan panel is never rebuilt
from the SDK's task tools.

### C. Grok — reasoning levels per model

`readGrokAcpModelThinkingOptions` (#95) has no caller. The picker cannot learn
what the session reported, so it falls back — and, with the widened
`isGrokNativeModelId` that also arrived, offers `xhigh` for a model that
refuses it.

Separately, `70ebb682` serialized concurrent `ensureReady` restarts. This branch
answers the same race with a generation fence that **fails** the losing caller
instead of queueing it. That is a decision, not a gap, and it is written down as
one in the sync inventory.

### D. Session resume — the ACP family, Gemini, Qwen, Grok

Three commits, all dead here:

- `isAcpSessionGone` has no caller; `ManagedAcpExecutionBackend` still classifies
  a failed `session/load` by matching the error text, and the seam it would plug
  into is synchronous while the helper is `async`;
- the `sessionDropped` persistence and read-back is unreferenced;
- the session-restart notice ships its UI, its CSS and ten locale strings, and
  `ExecutionChatRuntimeAdapter.isSessionDropped()` is a constant `false` because
  no composition implements the port.

A `session/load` that answers a bare `Internal error` still fails the turn
instead of soft-failing into a fresh session — the bug those commits fixed.

### E. Codex

Nothing lost. Its one commit in the range is the catalog seeding, which is live.
`CodexSessionFileTail` was deleted by the migration itself, with a parity-manifest
row saying it dies with the legacy runtime.

## Plan

Ordered by what a user meets first, and every item ends in a test that fails
without it. Each is its own commit with its own journal entry.

**Phase 1 — Antigravity, restore the print-mode series.** The largest block and
the only one where the product is plainly worse than `main`.

1. Restore `AntigravityCliCapabilities` and `AntigravityStreamJson` from the
   merge, and wire the probe into the migrated launch path. *Acceptance:* a
   capability probe result decides the launch shape, and a cancelled or errored
   probe is not cached.
2. A2 — prompt over stdin as one NDJSON user event when stream-json is
   advertised, argv otherwise. *Acceptance:* a prompt beyond the Windows argv
   limit launches.
3. A1 — `--add-dir <vault>` when advertised.
4. A3, A4 — `--print-timeout`, and log growth as liveness.
5. A5, A6 — keep a streamed answer past a late `ERROR`; emit text and tool steps
   while the run is open.
6. A7, A8 — restore `antigravityToolNormalization` and the vault-skill expansion.
7. Rewrite `src/providers/antigravity/AGENTS.md` to describe what is then true.

**Phase 2 — wire what arrived and is dead.**

8. B — supply `taskPlanState` from `ClaudeContentPresenter`. *Acceptance:* a
   `TaskCreate` / `TaskList` transcript produces a plan chunk.
9. C — call `readGrokAcpModelThinkingOptions` where the session state is
   normalized, and narrow `isGrokNativeModelId` back so `grok-4.5` is not
   offered `xhigh`.
10. D — the largest design item, and the only one that is not a port: give one
    provider's composition a `sessionDropped` port implementation, reading what
    `acpSessionResume` computes, and make `ManagedAcpExecutionBackend` able to
    ask `isAcpSessionGone` — which means widening `isMissingSessionError` to
    allow an async answer.

**Phase 3 — decide rather than port.**

11. ~~Grok `ensureReady`: queue the loser or keep failing it.~~ **Settled: keep
    the fence, and no queueing.** `70ebb682` serialized against two callers —
    the send path and the slash-menu catalog — reaching one runtime's shared
    process state at once. That race is structurally absent here.
    `ensureClient` has exactly two call sites (`ManagedAcpExecutionBackend`
    lines 636 and 746), both on `ManagedAcpExecutionSession`, and both reached
    only from the single active run's own dispatch or its recovery;
    `createRun` refuses a second run while one is active. The slash menu runs
    against a separate metadata session and a separate process. The generation
    fence stays as what it is — a guard for disposal and restart-fingerprint
    changes — rather than a substitute for a queue nothing can enter twice.
12. The eight defects the sync carried in from `main` — they exist on `main` too
    and want a pass upstream.

**Phase 4 — the gate that would have caught all of this.**

13. ~~Turn the dead-export pass into a test.~~ **Done.**
    `tests/helpers/exportConsumers.ts` walks `src/` for exports no other module
    in `src/` takes, counting `import type` and following barrels, and counting
    an export the module itself uses as used — the test-only export is not the
    defect; the symbol nothing outside its own tests names is. Run against
    `d5cb9353`, the tree as it stood before this recovery, it names
    `createClaudeTaskPlanState`, `readGrokAcpModelThinkingOptions` and
    `isAcpSessionGone` without being told which to look for, which is B, C and D.
    The gate holds a checked-in baseline of the 183 it finds today; that list is
    a backlog rather than an endorsement, and several entries — the whole of
    `acpManagedSession.ts`, `markAcpSessionLoadFailed` — look like real dead code
    left by the flip and want a deletion pass of their own.

## What is deliberately not restored

Nothing yet. Every item above is either a restore, a wire-up, or a decision with
its reason written down — and the two that are decisions say so.
