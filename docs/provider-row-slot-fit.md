# Provider row slot fit

Every row of [`provider-contribution-inventory.md`](provider-contribution-inventory.md) has a typed
slot waiting for it in `ProviderModule`. That table answers *does a slot exist*. This one answers
the question three consecutive checkpoints found it does not:

> **Can the slot hold what the nine providers actually do?**

Three times in a row the answer was no, and each time it was discovered while moving the row rather
than before:

- **`tabWarmupPolicy`** — the slot was `shouldKeepWarm(): boolean`, which cannot express three
  modes, and every provider filled it with a stub answering `false`. The row itself turned out not
  to be a policy at all: eight `resolveMode(context)` implementations returned a constant and read
  none of the context they were given.
- **the three auxiliary rows** — the slot was three `ExecutionBackendFactory`s, and auxiliary work
  is not three backends. It runs through the backend the provider already has, on a conversation
  retained under a purpose key, and the runner that reaches it is built by the host — so there was
  nothing a static module could hold.
- **`taskResultInterpreter`** — one provider has a real one and eight registered the same empty
  answers. The slot's single `interpret(toolName, payload)` describes none of the five questions the
  real one is asked.

The pattern is consistent enough to state: **a slot designed from a row's name rather than from all
nine implementations of it is a slot that will not fit.** So this file reads them first.

## How to read the table

`Real` is the member count of the contract the row is declared as today, or `class` where the row
is typed as a concrete class rather than an interface — which is itself a finding, since a class is
a contract only its own implementation can satisfy. `Slot` is the member count
of the contribution waiting for it. Counts alone prove nothing — a deliberate rename or a genuinely
better decomposition changes them — so the verdict comes from reading both, and the counts are
asserted only so the table cannot drift away from the code.

| Verdict | Meaning |
|---|---|
| `fits` | the slot can express what the implementations do, allowing for deliberate renames |
| `reshape` | something the implementations do has nowhere to go; named in the notes |
| `moved` | the row has already reached its home |

| Row | Real | Slot | Verdict | What has nowhere to go |
|---|---|---|---|---|
| `chatUIConfig` | 20 | 3 | reshape | Reasoning (4 members), the service-tier toggle, the mode selector and its apply hook, bang-bash enablement, model options, custom model ids, model defaults, variant normalization, and metadata preparation. `permissionToggles` is a static `{id,label}[]` against a row that has a descriptor plus two settings-dependent behaviors. This is the largest row and the worst fit. |
| `settingsReconciler` | 3 | 1 of 10 | reshape | `ProviderSettingsCodec.reconcile(TSettings, reason)` sees only the provider's own settings, and every reconciler computes its environment hash from `getRuntimeEnvironmentText`, which joins the **shared** environment scope with the provider's. A user who sets `XAI_API_KEY` in the shared scope would stop invalidating Grok's model cache. |
| `createRuntime` | — | — | moved | `ExecutionBackendFactory`, flipped for all nine. |
| `historyService` | 6 | 5 | reshape | Four members map cleanly under deliberate renames. The other two do not: `buildForkProviderState(sourceSessionId, resumeAt, sourceProviderState)` builds the state a **fork** starts from, and `buildPersistedProviderState(conversation)` is what `SessionStorage` writes on **save**. `buildSessionPatch` is neither — it is a third operation, already live in `ExecutionChatRuntimeAdapter`, producing the session binding a **finished turn** leaves behind. Three moments, three shapes, one slot. |
| `taskResultInterpreter?` | 5 | 1 | reshape, **but not yet** | All five questions: async launch marker, agent id, structured result, terminal status, tag value. Only Claude has a real implementation. Deliberately not designed yet: its consumer is `SubagentManager`, which the durable-agents work is taking lifecycle authority from, and a slot shaped for a consumer that is being replaced is shaped twice. |
| `subagentLifecycleAdapter?` | 8 | 2 | reshape, **but not yet** | Four tool-name predicates the live consumer asks separately, spawn-id resolution, subagent-info building, and both result extractors. `parseDisplay(payload)` receives one payload while a Grok subagent's label comes from the spawn tool's **input** and its id from the **result**. Same reason to wait as the row above: `SubagentManager` and `MessageRenderer` are its consumers, and both are mid-replacement. |
| `commandCatalog` | 8 | 1 | reshape | The catalog also **writes**: vault entries are saved and deleted through it, it owns the dropdown config and the default vault storage path, and it takes runtime commands from the session loader. `list()` is one of eight. |
| `agentMentionProvider` | 1 | 2 | reshape | `searchAgents(query)` becomes `list()`, so the matching moves from the provider to the host — the mention dropdown passes a real query today and the provider decides what matches it. And `ProviderAgentMention` has no `source`, which the row returns on every result and the settings UI reads. `refresh` arriving in the same port is right; the other half is not. |
| `cliResolver` | 2 | 1 | reshape | **The slot is async and the row is not.** `resolveFromSettings(settings): string \| null` answers synchronously, `getResolvedProviderCliPath` has 33 call sites and none of them awaits, and several are inside paths the module contract requires to be synchronous — `createRuntime()` among them. `resolve(): Promise<ProviderCliResolution>` cannot serve any of them without the host owning a cache, and a host-owned cache needs the invalidation `reset()` is: the resolver re-reads settings on every call today, so a user who fixes a CLI path is served immediately. (`reset()` itself needs no slot — the five settings tabs that call it are provider-owned and reach their own resolver directly, never the registry.) |
| `modelCatalog` | 2 | 2 | fits | `isAvailable` is absent by design — a provider that cannot discover models contributes no `models` port, which is the contract's own "absent means unsupported", and both call sites guard on it exactly that way. `refreshModels` returns a `Promise<boolean>` that **neither call site reads**, so the slot returning descriptors instead loses nothing. The slot adds `list`, which the row lacked. |
| `usageProvider` | 3 | 1 | reshape | `getCachedUsage` and `refreshUsage` are one `read()`. The plan indicator shows the cached snapshot immediately and refreshes behind it; one method makes every read either a network call or permanently stale. |
| `runtimeCommandLoader` | 2 | 1 | reshape | `listForSession(sessionId)` presumes a session exists, and the row's context carries `allowSessionCreation` — command discovery may *start* a short-lived session, and the tab manager decides when that is allowed. The context also carries the conversation, the runtime and the external context paths. |
| `mcpStorage` | 3 | 3 (shared) | fits | Reshaped in place. The port had `start(serverId)` and `stop(serverId)` — **operations the product does not have**: an MCP server is a record with an `enabled` flag that the provider's own CLI launches, and those two members existed only in this contract and the nine contexts that stubbed them. `tryParseClipboardConfig`, which the product does have and which had no slot, is on the port now. |
| `mcpServerManager` | class | 4 (shared) | reshape | Mention extraction and transformation, disallowed-tool computation (two forms), context-saving servers, and the enabled count — ten public members against a port describing storage and start/stop. **And the row is typed as a concrete class, not an interface**, so nothing else can satisfy it: a provider cannot contribute an MCP port without constructing Grimoire's own manager. That is the reshape, before any member is counted. |
| `settingsTabRenderer` | 1 + a 7-member context | 1 | reshape | The contract is the context, not the method: the host supplies section builders, model-selector refresh, custom context limits, the advanced section, the hidden-command setting and a discovery suppression flag. `render(host)` types the host as `unknown`, which is honest about the DOM and silent about all seven. |

## The workspace rows are further away than their slots suggest

A slot that fits is not a slot that can receive its row. Eight of the nine providers fill their
workspace slots from a module context whose **workspace half throws**: `listModels`,
`refreshModels`, `resolveCliPath`, `readPlanUsage`, `listCommands`, the agent-mention pair and all
four MCP members are `notWired(...)`. The slot exists, the module declares it, the initializer fills
it, and calling it raises.

| Provider | Unwired context members |
|---|---|
| Codex | 0 — the only real one, and the only provider whose workspace is initialized today |
| Claude | 1 |
| Gemini | 1 |
| Qwen | 1 |
| Grok | 2 |
| Kimi Code | 2 |
| MiMoCode | 2 |
| OpenCode | 2 |
| Antigravity | no module context at all; its two slots are built inline |

This is invisible to every other gate: the parity manifest sees a module in the bundle, the
inventory sees a row with a slot, and the table above sees two contracts of compatible shape. The
counts are gated in `moduleContextWiring.test.ts` and may only fall.

**They have fallen.** The table above is the state after the eight contexts were wired: ten to
twelve stubs each became at most two, and neither of the two is wiring. `renderSettingsTab` faces a
slot that types the host as `unknown` against a seven-member context; `listSessionCommands` faces a
slot taking a session id while the real loader takes a runtime. Both close with their row's reshape.

The implementation is `src/providers/shared/workspaceContextSlots.ts` — one, not eight. What a
provider supplies is its services accessor, its chat-UI config, and whether its command dropdown
offers the CLI's built-ins beside the vault's.

**Codex is the proof that all of them are writable.** A member stubbed in eight contexts and real in
one is eight providers' work, not a contract problem — and that distinction is what decides whether
a row moves or a slot changes.

## What this means for sequencing

**No row can move today.** `modelCatalog` is the one whose slot fits — and it is blocked anyway, because eight of nine providers'
`listModels` and `refreshModels` throw. Every other remaining row needs its slot reshaped first, and
the reshape has to be designed from the implementations — which is what the notes above are for.

So the work splits in two, and only one half is design:

1. **Write the eight module contexts.** Done — see the table above. It blocked every workspace row.
2. **Reshape eleven slots.** Design, from the implementations, with the notes above as input.

**Two of the eleven wait on their consumers rather than on design.** `taskResultInterpreter` and
`subagentLifecycleAdapter` are read by `SubagentManager` and `MessageRenderer`, both of which the
durable-agents work is replacing. A slot shaped for a consumer that is being replaced is a slot
shaped twice, so they are last, not first — even though they are the smallest.

It also means the M1 slot count was never a measure of readiness. Twenty-odd rows had a typed slot
from the beginning and one of them could have received its row.

### The first version of this table said three, and it was written from the counts

`historyService`, `agentMentionProvider` and `modelCatalog` were all graded `fits` on a first pass
that compared member counts and assumed the differences were renames. Reading them properly changed
two of the three — and the errors were not small ones. `historyService` looked like a six-into-five
rename and is three unrelated operations sharing a name. `agentMentionProvider` looked like a
one-into-two widening and quietly relocates the matching out of the provider while dropping a field
the settings UI reads.

That is the same shortcut this file exists to stop, taken while writing the file that says not to
take it. The counts are load-bearing only as drift detection; the verdict has to come from opening
every implementation and every consumer, and there is no version of this that a count can do.
