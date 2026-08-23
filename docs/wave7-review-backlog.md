# Wave 7 review backlog

## Fourth review — `providers-migration` @ `c76f659`

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

### Not a finding

The reviewer noted that a bare `jest` run shows 548 failures in this environment: Node 25 exposes a
`globalThis.localStorage` with no methods, `getDeviceSettingsStorage()` returns it, and
`storage.getItem` is undefined. That is why `scripts/run-jest.js` exists and why it is what the
project's own commands use. Environmental, not from the diff, and already documented.

## Fifth review — the Gemini dark modules @ `f8b4920`

A read of the three commits the fourth review did not cover — `e34cf7e`, `e9cefd1`, `f1554d3`: nine
provider-owned execution modules, one trace fixture, and the two extractions that changed live code
inside `GeminiChatRuntime`. Each row was checked against the tree, and each of the two behavioural
fixes carries a test proved by breaking it.

The two modules are cross-diffed against Grok's with names normalized — the shape this provider is
derived from — which is what surfaced G1 and G2.

| # | Severity | Where | Finding | Status |
|---|---|---|---|---|
| G1 | Major | `GeminiSessionConfigState.ts` `syncSessionDiscovery` | Writes `selectedMode` from the mode the *session* reports at `session/new`. That is the field `resolvePermissionMode` answers from, so it decides what the **next turn asks for**, not only what the toolbar shows: a vault on Plan, opening a session that reports `default`, sent no `set_mode` at all and ran the turn in the agent's default | ✅ recorded raw for the skip comparison and nowhere else; only a `current_mode_update` moves the toolbar |
| G2 | Major | `GeminiChatRuntime.ts` `permissionMode` / `fullAccess` | The extraction copied rather than moved: the runtime kept its own pair, and they are what gate workspace containment and write approvals. The comment above them records that this exact question was already got wrong once, when another provider's Auto-approve switched off this one's containment | ✅ one implementation, on the state; the runtime delegates |
| G3 | Minor | `GeminiSessionConfigState.ts` `GeminiSessionConfigPorts` | `saveSettings` is documented "only called when something actually changed" and is never called; every sibling's is. The caller saves on the returned boolean | ✅ port removed |
| G4 | Minor | `GeminiChatRuntime.ts` | Two comments left pointing at fields the extraction deleted — one of them now sitting above `permissionModeSyncCallback` and describing something else — plus a malformed `import type` beside a second import from the same module | ✅ comments gone, `syncSessionDiscovery` typed from the state's own signature |
| G5 | Minor | `gemini-execution.json` | `"nativeSessionId": "grok-session"`, carried in from the fixture it was derived from, in the record the composition test will be written against | ✅ `native-session`, as every non-Grok fixture uses |
| G6 | Minor | `GeminiExecutionRequests.test.ts` | Half the values are another provider's: a Claude model id, `arguments: ['acp']` — the subcommand form this provider explicitly does not use — and `databasePath`, a field `GeminiInvocationEnvironment` does not have | ✅ Gemini's own |

### Observations, not findings

- **The approval input changed shape and the commit did not say so.** Swapping the inline `rawInput`
  guard for the shared `normalizeApprovalInput` turns a scalar `rawInput` into `{ value: … }` where
  the runtime produced `{}`. It is what every other ACP provider already does, so this converges;
  recorded because a live behaviour change should be stated rather than found.
- **`recoveryAfterOutput` in the execution fixture asserts `result:provider-native`** for a sink that
  has no recovery port and always commits `projection`. Inherited from the family — OpenCode's,
  MiMoCode's and Kimi's fixtures say the same and their sinks have no recovery port either — and
  nothing reads that event case yet. Owner: the first composition test that does.
- **The applier sets the mode on every turn where the legacy runtime skipped an unchanged one.** That
  is Grok's shape and deliberate: the session a turn lands on is decided at dispatch and may be one
  this tab never configured. The cost is one round trip per turn.

### Checked and clean

The interaction bridge and the execution backend are structural matches to Grok's. The permission
presentation is behaviour-identical to the runtime's, except that it now trims a path from
`rawInput`. The requests store's three reference spaces, eviction bound and `--acp` argument match
both the sibling and the legacy launch spec. The content presenter is a clean subset of Grok's, with
the vendor-update branch and the tool stream adapter absent for reasons the module states.
