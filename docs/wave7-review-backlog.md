# Fourth review — `providers-migration` @ `c76f659`

One multi-agent review at effort `high`, run over the 50 commits this branch is ahead by. Thirteen
findings: 1 Critical, 7 Major, 5 Minor. Every row is verified against the tree before it is touched,
and every fix carries a test proved by breaking it.

The reviewer also cross-diffed the two new provider trees with names normalized and found no
copy-paste defects, and confirmed the ten items listed under "checked and clean" in its report.

| # | Severity | Where | Finding | Status |
|---|---|---|---|---|
| G1 | Critical | `GeminiChatRuntime.ts` `applySelectedMode` | Sends Grimoire's `full_access`/`normal` as an ACP `modeId`; the CLI's modes are `default`/`autoEdit`/`yolo`/`plan`, so the call is rejected inside the turn's try and the turn dies before the prompt is sent | ✅ `modes.ts` with both mappings, from the recorded session |
| C1 | Major | `CCSettingsStorage.ts` `saveUnlocked` | Read degraded to defaults on a parse failure and the write merged onto `{}`, rewriting the user's (and Claude Code's) `settings.json` down to two keys on one "Always allow" | ✅ read still degrades; the write refuses |
| A1 | Major | `ExecutionChatRuntimeAdapter.ts` `establish` | Observer attached before `this.active` is set, so the tab's own run is not owned during the window and renders twice | ✅ `claimRunId` closes the window between minting and `active` |
| A2 | Major | `ExecutionChatRuntimeAdapter.ts` `syncConversationState` | `resetSession()` on a conversation switch neither cancels nor clears `active`; `disposeSession` throws on the live run and the kernel session leaks | ✅ cancels, settles, then disposes — beside the caller, not in front of it |
| G2 | Major | `GeminiChatRuntime.ts` `current_mode` | Stored the agent's raw id into `selectedMode`, which the toolbar reads back and cannot render | ✅ mapped where it reaches the vault |
| G3 | Major | `GeminiChatRuntime.ts` `currentSessionModeId` | Never reset, unlike its sibling, so a new session short-circuits and runs in the agent's default while the toolbar says Plan | ✅ reset at all three sites |
| S1 | Major | `SessionStorage.ts` `listMetadata` | Lists via `adapter.listFiles` while writes are durable, so a conversation interrupted mid-rename is never listed and never recoverable | ✅ lists through `durable.list`, which completes the rename first |
| K1 | Major | `ExecutionLifecycleRegistry.ts` `startRun` | No acceptance guard, so a run admitted during shutdown leaves a durable `queued` record the next startup loads as live | ✅ the acceptance guard `createSessionUnlocked` already had |
| K2 | Minor | `ExecutionLifecycleRegistry.ts` `createSessionUnlocked` | The guard throws after the durable record is created, leaving an `active` session the next start reopens | ✅ guarded before the write, and the catch removes the record |
| K3 | Minor | `ExecutionLifecycleRegistry.ts` `sweepTabScopedRecords` | Runs before `loadPersistedControls` detects `migrationRequired`, so a reverted build deletes records D5 says it must only read | ✅ raises on an unreadable record instead of stepping over it |
| T1 | Minor | `AcpJsonRpcTransport.ts` | The backpressure fix is a no-op: `awaitingDrain` is written and never read, and `sendRaw` is synchronous | ✅ writes are queued and flushed on `drain`, in order |
| P1 | Minor | `ClaudePermissionUpdates.ts` | `removeRules` and `addDirectories` are still forwarded verbatim, so a suggestion riding one click can delete a `deny` rule | ✅ `removeRules` and `addDirectories` dropped like `replaceRules` |
| P2 | Minor | `ClaudePermissionUpdates.ts` | `addRules` with an empty list passes `every` vacuously and suppresses the explicit grant, so "Always allow" grants nothing | ✅ an empty rule list no longer counts as the rule update |

## Not a finding

The reviewer noted that a bare `jest` run shows 548 failures in this environment: Node 25 exposes a
`globalThis.localStorage` with no methods, `getDeviceSettingsStorage()` returns it, and
`storage.getItem` is undefined. That is why `scripts/run-jest.js` exists and why it is what the
project's own commands use. Environmental, not from the diff, and already documented.
