# Antigravity flip — smoke matrix

Antigravity was the first provider to move onto the execution kernel, in wave 1. It is a print-mode
CLI rather than an ACP one: `agy --print "<prompt>"`, one request per turn, no session and no
protocol to resume. That shapes this matrix — there is no session to lose, no permission channel to
answer, and no config to apply mid-turn, so most rows the ACP matrices carry do not exist here.

The automated half runs headlessly:

```bash
GRIMOIRE_ANTIGRAVITY_LIVE=1 npm run test -- --selectProjects integration --testPathPatterns AntigravityLiveSmoke
```

It starts the CLI and spends the account's tokens, so it is off unless that variable is set.
`GRIMOIRE_ANTIGRAVITY_CLI` overrides the executable and `GRIMOIRE_ANTIGRAVITY_MODEL` sends a
`--model`; with neither, the CLI uses what the account is configured for.

**This matrix was written last of the nine, long after the flip it records.** The harness existed
from wave 1 and its result lived in the migration journal, where nothing could see it — which is the
gap the records gate was built to close and which this file had been sitting in the whole time. A
provider with a harness and no matrix looks exactly like a provider with nothing to record.

Recorded against **agy 1.1.15** on 2026-08-23, Linux. This is the only provider whose automated half
is fully green on this machine.

| # | Row | Result |
|---|---|---|
| 1 | Answers a plain message, and leaves nothing running | ✅ answered, no `agy` left behind |
| 2 | Cancels a running turn and leaves no `agy` process tree behind | ✅ root and its `sleep 120` child both gone |

Row 2 is the row wave 1 turned on, and it is worth knowing why it looks the way it does. **Its first
version went green with process termination disabled.** Written the obvious way — ask for a long
answer, cancel mid-stream, assert the tree is gone — it passed against a `terminate` that had been
patched to signal nothing: `agy` had simply finished on its own inside the window the assertion
allowed, so the row was measuring the model's speed rather than the kernel's cancel. It asks for a
`sleep 120` tool call now, so the tree that must disappear contains a descendant that will still be
running two minutes later, and the tree is a tree rather than one process. The answer is read from
`ps`, not from the runner that is supposed to have done the killing.

## The half a person still has to look at

With an account configured, install a release build in a vault and check:

- the answer appears in the tab, and the model that produced it is the one the selector shows;
- **the permission mode comes from Antigravity's own toggle.** This provider reads its projection
  rather than the shared `permissionMode` key, because that key holds whichever provider the settings
  tab is showing — observed as Antigravity refusing every turn while its own toggle read Auto-approve.
  Set another provider's mode to Safe, leave Antigravity's on Auto-approve, and send a turn;
- `agy --print` exposes no approval hook, so `normal` mode is deliberately fail-closed here: a turn in
  Safe mode must refuse rather than write unattended;
- the model list fills from `agy models`, and a custom model label added in settings appears beside the
  discovered ones;
- **on Windows**, that a turn still answers when `agy` returns exit code 0 with empty stdout — the
  recovery path reads the print output from Antigravity's own transcript, and the models from
  Antigravity settings plus the seeded list. That row cannot be checked on Linux at all.

## Record

One row per run. `never` in the Date column is a real answer, and it is what
`liveMatrixRecords.test.ts` reads — so a matrix that has never been run says so
here rather than by the absence of a table.

| Date | CLI version | Rows passed | Rows failed | Notes |
|---|---|---|---|---|
| 2026-08-31 | agy 1.1.22 | 1, 2 | none | eight days on and seven patch versions later, and re-run for a reason of its own: the day's work changed what every ACP client answers a failed filesystem request with, and this is the one provider on this machine whose account never refuses — so a green here separates a shared-layer regression from an account. Both rows unchanged, in fourteen seconds: the turn answers `ok`, and the cancelled turn's tree — `agy` plus the `sleep 120` it was asked to run — has no survivors. Print mode reaches none of the changed code, which is what the run says out loud |
| 2026-08-23 | agy 1.1.15 | 1, 2 | none | run when this matrix was written, four days after the flip it records. Both rows green: a turn answers and leaves nothing running, and a cancelled turn's process tree — `agy` plus the `sleep 120` it was asked to run — is gone by the operating system's account rather than the runner's |
| 2026-08-19 | agy 1.1.x | 1, 2 | none | wave 1, recorded in the migration journal rather than here. The CLI version was not written down at the time, which is one of the reasons this table exists |
