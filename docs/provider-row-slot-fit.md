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
| `taskResultInterpreter?` | 5 | 1 | reshape | All five questions: async launch marker, agent id, structured result, terminal status, tag value. Only Claude has a real implementation, so the reshape is small — but `interpret(toolName, payload)` answers none of them. |
| `subagentLifecycleAdapter?` | 8 | 2 | reshape | Four tool-name predicates the live consumer asks separately, spawn-id resolution, subagent-info building, and both result extractors. `parseDisplay(payload)` receives one payload while a Grok subagent's label comes from the spawn tool's **input** and its id from the **result**. |
| `commandCatalog` | 8 | 1 | reshape | The catalog also **writes**: vault entries are saved and deleted through it, it owns the dropdown config and the default vault storage path, and it takes runtime commands from the session loader. `list()` is one of eight. |
| `agentMentionProvider` | 1 | 2 | reshape | `searchAgents(query)` becomes `list()`, so the matching moves from the provider to the host — the mention dropdown passes a real query today and the provider decides what matches it. And `ProviderAgentMention` has no `source`, which the row returns on every result and the settings UI reads. `refresh` arriving in the same port is right; the other half is not. |
| `cliResolver` | 2 | 1 | reshape | `reset()` has no slot. It is what a settings change calls to drop a cached resolution, and without it a user who fixes a CLI path keeps the old failure until reload. |
| `modelCatalog` | 2 | 2 | fits | `isAvailable` is absent by design — a provider that cannot discover models contributes no `models` port, which is the contract's own "absent means unsupported", and both call sites guard on it exactly that way. `refreshModels` returns a `Promise<boolean>` that **neither call site reads**, so the slot returning descriptors instead loses nothing. The slot adds `list`, which the row lacked. |
| `usageProvider` | 3 | 1 | reshape | `getCachedUsage` and `refreshUsage` are one `read()`. The plan indicator shows the cached snapshot immediately and refreshes behind it; one method makes every read either a network call or permanently stale. |
| `runtimeCommandLoader` | 2 | 1 | reshape | `listForSession(sessionId)` presumes a session exists, and the row's context carries `allowSessionCreation` — command discovery may *start* a short-lived session, and the tab manager decides when that is allowed. The context also carries the conversation, the runtime and the external context paths. |
| `mcpStorage` | 3 | 4 (shared) | reshape | `tryParseClipboardConfig` has nowhere to go. It is how a user pastes a server config, and it is the only member that parses rather than stores. |
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
| Claude | 10 |
| Gemini | 11 |
| Qwen | 11 |
| Grok | 12 |
| Kimi Code | 12 |
| MiMoCode | 12 |
| OpenCode | 12 |
| Antigravity | no module context at all; its two slots are built inline |

This is invisible to every other gate: the parity manifest sees a module in the bundle, the
inventory sees a row with a slot, and the table above sees two contracts of compatible shape. The
counts are gated in `moduleContextWiring.test.ts` and may only fall.

**Codex is the proof that all of them are writable.** A member stubbed in eight contexts and real in
one is eight providers' work, not a contract problem — and that distinction is what decides whether
a row moves or a slot changes.

## What this means for sequencing

**No row can move today.** `modelCatalog` is the one whose slot fits — and it is blocked anyway, because eight of nine providers'
`listModels` and `refreshModels` throw. Every other remaining row needs its slot reshaped first, and
the reshape has to be designed from the implementations — which is what the notes above are for.

So the work splits in two, and only one half is design:

1. **Write the eight module contexts.** Mechanical, provider by provider, with Codex as the worked
   example. It blocks every workspace row.
2. **Reshape eleven slots.** Design, from the implementations, with the notes above as input.

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
