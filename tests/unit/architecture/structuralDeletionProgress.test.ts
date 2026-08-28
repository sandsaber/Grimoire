import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listAllSourceModules } from '@test/helpers/moduleReachability';

/**
 * The plan's own exit gate, counted instead of read.
 *
 * M5 ends when eleven structural deletion searches are zero in production
 * source. They were written as shell commands in
 * `docs/provider-execution-migration-plan.md` and never run, so "what is left"
 * lived in prose — and prose cannot tell a checkpoint that moved a number from
 * one that did not, which is precisely what the v1 attempt could not see about
 * itself.
 *
 * **The numbers are the record.** A count that goes *up* is a surface joining
 * something the migration is removing; a count that goes *down* is progress
 * that has to be written here in the same commit that earned it. Both are red,
 * for the reason the live-matrix summary is: a record updated later is a record
 * nobody trusts.
 *
 * Counted in **files**, not hits, because a file is the unit of the work: what
 * is left is a list of modules to rework, and a refactor inside one of them
 * that changes a hit count says nothing about the gate.
 */

const SOURCE_ROOT = resolve(process.cwd(), 'src');

interface DeletionSearch {
  readonly what: string;
  readonly pattern: RegExp;
  /** Where the plan scopes it; the whole source tree unless narrowed. */
  readonly within?: string;
  readonly files: number;
  /** Why it is not zero yet, and what closes it. */
  readonly closedBy: string;
}

const SEARCHES: readonly DeletionSearch[] = [
  {
    what: 'generator consumption in the feature layer',
    pattern: /for await .*\.query|\.query\(preparedTurn/,
    within: 'src/features',
    files: 0,
    closedBy: 'closed — the legacy branch left InputController with the chat projection flip',
  },
  {
    what: 'child_process in the feature layer',
    pattern: /from ['"](node:)?child_process['"]|require\(['"](node:)?child_process['"]\)/,
    within: 'src/features',
    files: 0,
    closedBy: 'closed — bang-bash runs on the local-shell backend',
  },
  {
    what: 'runtime interaction callbacks',
    pattern: /setApprovalCallback|setAskUserQuestionCallback|setExitPlanModeCallback/,
    files: 0,
    closedBy: 'closed — the six setters came off `ChatRuntime` and became one '
      + '`installInteractions` on the adapter, which is not a contract member',
  },
  {
    // **Zero.** An approved orchestrator plan dispatches a durable agent per
    // task instead of spawning a chat tab per task. What made that possible was
    // the first implementation of `AgentDispatchPort`, which is short because
    // nothing new was needed: a provider adapter is built without a tab
    // already, a tab was only ever one holder of one, and the persistence
    // barrier runs whether or not a surface is attached. A dispatched turn is
    // an ordinary turn with nobody drawing it.
    //
    // **Two conversations, which is what the design question turned out to
    // be** (D10 in the persistence decisions). Each worker writes into its own,
    // because a conversation runs one turn at a time and two workers cannot
    // share one; the orchestrator's is the `rootOwner`, so the background work
    // card on the tab a person is looking at lists what that tab started. The
    // task text lives in the worker's conversation and nowhere else — a control
    // record holds references, and a prompt is free text somebody wrote — which
    // is also what lets a redispatch after a reload find the same task instead
    // of inventing one.
    //
    // Three fields went with it: the parent link, the child list, and the tab
    // bar's two badges. The tab cap counts every tab now, because the exception
    // was the fleet a single plan owned and there is no fleet of tabs.
    what: 'worker tab ownership',
    pattern: /createWorkerTab|orchestratorTabId|workerTabIds/,
    files: 0,
    closedBy: 'closed — an approved plan dispatches durable agents, and a worker '
      + 'is not a tab',
  },
  {
    what: 'core importing the plugin type',
    pattern: /GrimoirePlugin/,
    within: 'src/core',
    // **Zero.** The last one was `providers/types.ts`, where eleven contracts
    // named a plugin because that is what the host hands a provider: the
    // workspace init context, the settings-tab renderer, the model catalog and
    // its refresh, the plan-usage provider and its context, the chat UI config,
    // the CLI resolver, the workspace services themselves, and the registration
    // that produces them. None had a consumer inside `src/core`.
    //
    // They moved whole to `providers/shared/providerHostContracts.ts`, which is
    // the documented home for a provider-neutral helper that needs the plugin
    // type. `ProviderSpendUsageStore` went with them — it lived in core, read
    // nothing from core, and had thirteen consumers, every one a provider.
    //
    // The direction is a gate, not a habit: `executionCompositionBoundaries`
    // fails on a new provider import under `src/core`, by relative path or
    // alias, so the edge cannot come back the other way.
    files: 0,
    closedBy: 'closed — the eleven host-shaped contracts moved to '
      + '`providers/shared/providerHostContracts.ts`, which is where a helper '
      + 'that needs the plugin type belongs',
  },
  {
    what: 'subagent hooks and loaders',
    // **Narrowed to the member that was on the seam, and it is zero.**
    // `setSubagentHookProvider` left with the other five interaction setters,
    // when six became one `installInteractions` on the adapter.
    //
    // The two loaders came out of the pattern, and it is a settlement rather
    // than a deletion. They left the *contract* with the retry ladder that was
    // their only caller; what the old pattern still found was
    // `ClaudeHistoryStore` and its sidecar reader filling in a stored
    // conversation's subagent tool calls, from Claude's own JSONL, so a past
    // turn renders with what it did. **Durable agents cannot take that over**,
    // which is what the previous `closedBy` claimed: an `AgentResultRecord`
    // carries `finalText`, artifacts, changed files and citations, and
    // deliberately no tool calls — the records say that work exists and how it
    // ended, not what it did. Provider-internal history parsing, in the
    // directory the architecture rules put it in.
    pattern: /setSubagentHookProvider/,
    files: 0,
    closedBy: 'closed — the setter went with the interaction callbacks, and the '
      + "loaders are Claude's own history parsing rather than a seam",
  },
  {
    // **The pattern is narrowed, and the evidence is why.** It was
    // `SubagentManager|SubagentInfo|orphanAllActive`, and of the twenty files
    // that matched, **thirteen named only `SubagentInfo`** — the rendering type
    // the plan explicitly retains ("`SubagentManager` loses lifecycle authority
    // while its rendering is retained"). `orphanAllActive` matched **nothing**:
    // the method it was named for is already deleted. The headline number was
    // dominated by a type the milestone keeps, and a reader chasing it to zero
    // would delete the rendering the plan says to keep.
    //
    // **Narrowed to the lifecycle half, on the same argument the `StreamChunk`
    // search was narrowed on: the old pattern could never reach zero.** The
    // plan's own words are that the class *"loses lifecycle authority while its
    // rendering is retained"* — so it survives, and a search counting files
    // that name it counts the rendering it is supposed to keep. Six of the
    // seven named nothing else.
    //
    // What goes is the one lifecycle question anything asks it:
    // `hasRunningSubagents`, which the tab installs as the `subagentState`
    // interaction and Claude's `Stop` hook reads to decide whether a turn may
    // end. **2**, and the tab's call site is already half moved — it unions the
    // manager's answer with `runningOwnedAgents`, so an agent from a closed tab
    // keeps a turn open. What is left is the manager's in-turn tracking, which
    // the records deliberately do not carry: a subagent that runs inside a turn
    // is drawn and finished before the turn is, and there is nothing for it to
    // survive. Closing this is deciding whether the `Stop` hook should count
    // those at all — a question about Claude's turn-ending, not about storage.
    //
    // `orphanAllActive` matched nothing when this search was written and still
    // does; it is kept because the plan names it.
    // **Zero, and the blocker written here twice was a type rather than a
    // fact.** The entry used to say the live map could not go because a record
    // write is asynchronous and Claude's `Stop` hook asks synchronously. The
    // first half was true. The second was not: the hook's body was already
    // `async` — only the parameter's type said the answer had to be immediate,
    // and every layer between copied that shape from it.
    //
    // Once the question could be awaited, the records became the single source.
    // `durableAgentsRunning` waits for the recordings this tab has in flight —
    // which is the window the live map existed to cover — then reads, listing
    // the conversation's agents when nothing has listed them yet, because an
    // unknown can no longer be softened by a second opinion. Every uncertainty
    // answers "running": ending a turn early loses an agent's work, and a turn
    // blocked in error is unblocked by the agent finishing.
    //
    // `SubagentManager` keeps its rendering, which is what M5 said it would.
    // The sweep of terminal entries that this method did on the way past went
    // with it: both terminal transitions delete their own entry, and `clear()`
    // empties both maps on a conversation switch.
    what: 'SubagentManager lifecycle',
    pattern: /hasRunningSubagents|orphanAllActive/,
    files: 0,
    closedBy: 'closed — the durable records are the single source, now that the '
      + 'hook that reads them can be asked with a promise',
  },
  {
    // **Split from one search of 20, with the total preserved.** The single
    // count could not fall, because eighteen of the twenty were a provider's
    // own composition — a directory under the application choosing where it
    // lived, not neutral code reaching into a provider. Reporting those beside
    // the two real violations meant neither number could be acted on: fixing
    // both violations would have moved 20 to 18 and looked like nothing
    // happened. Both halves are closed now, by different work.
    what: 'provider-neutral application code importing a concrete provider',
    pattern: /providers\/(claude|codex|antigravity|opencode|mimocode|kimicode|grok|qwen|gemini)\//,
    within: 'src/app/settings',
    files: 0,
    // **Closed, and both halves went the way the reading said they would.**
    //
    // `defaultSettings` took Codex's primary model constant for the app-level
    // `model` field, which `defaultConfigs()` cannot supply — that map is
    // `encode(defaults())` per provider and holds no `model` key. The default
    // provider nominates it now, through `chatUI.models.primaryModel`, which is
    // **optional and absent for the other eight** because it answers a question
    // only `DEFAULT_CHAT_PROVIDER_ID` is ever asked.
    //
    // `GrimoireSettingsStorage` took three providers' settings accessors for
    // the legacy top-level migration. Which three is a provider's own answer
    // now, through `adoptLegacyTopLevelFields` on the settings reconciliation —
    // the half of the codec that already takes the app record. The list still
    // cannot grow: only those three were ever written that way.
    //
    // Two of its uses were neither: `setLastModel` and `setLastEnvHash` wrote
    // *Claude's* settings for operations that read as global, and **had no
    // caller in `src/` at all**. Deleted.
    closedBy: 'closed — the default provider nominates its model, and each codec adopts its own legacy fields',
  },
  {
    // **Closed.** The eighteen were each provider's execution composition and
    // its transport, living under `src/app/execution/<provider>/` and naming
    // only their own provider. The owner's answer was that provider-specific
    // code belongs under the provider, so they are `src/providers/<id>/execution/`
    // now, beside the presenters and backends they were already importing.
    // What stays in `src/app/execution` is what is provider-neutral: the kernel
    // host, the workspace holder, the aux runner, the host timers.
    what: 'a provider composition living under src/app',
    pattern: /providers\/(claude|codex|antigravity|opencode|mimocode|kimicode|grok|qwen|gemini)\//,
    within: 'src/app/execution',
    files: 0,
    closedBy: 'closed — the compositions moved under the providers they compose',
  },
  {
    // **Narrowed again, to the one member whose home is still open.**
    // `syncConversationState` left this search settled rather than moved. It
    // was counted because the seam had it, and the seam is deleted; what it
    // does now is tell a tab's adapter which conversation the tab is on, which
    // is how the adapter notices a tab moving between conversations and drops
    // the session rather than filing one chat's runs under another's name
    // (D4). Nine call sites across the tab layer and `main.ts`, and no version
    // of this architecture has an adapter that is never told. The earlier
    // narrowing, which still holds: `consumeTurnMetadata` is off the deleted
    // contract — the coordinator carries its three facts on `CompletedChatTurn`
    // — and what that pattern still found was that name on nine provider
    // content presenters, which is a provider's own API for its own normalizer.
    what: 'turn metadata and session updates',
    pattern: /buildSessionUpdates/,
    // **Zero, and the `closedBy` was right about what would do it.** The two
    // were the adapter that built the patch and the conversation save path that
    // applied it. The write moved into the persistence barrier: the tab hands
    // the turn a closure over its own adapter, and the coordinator calls it
    // inside the same `apply` as the assistant message.
    //
    // **The tab still builds it, which is the part that could not move.**
    // `ProviderModule` carries a long note on why a conversation-scoped caller
    // cannot: four providers resolve a path through a context that reads the
    // tab's last launch first. A closure keeps the tab as the answerer and
    // moves only the write, which is what that note had folded into one
    // question.
    //
    // The rename to `sessionBinding` follows the move rather than causing it —
    // the method no longer returns a `Partial<Conversation>` for somebody
    // else's write, so `buildSessionUpdates` had stopped describing it. What
    // the move fixed: a turn whose surface save was skipped — a plan turn whose
    // approval was invalidated, or a failed turn — left the conversation bound
    // to a session the provider had already refused.
    files: 0,
    closedBy: 'closed — the barrier writes the binding in the same write as the answer',
  },
  {
    // **Narrowed to the half that goes**, which is what the split was for.
    // `StreamChunk` is `ChatContentItem | ChatTurnLifecycleChunk`, and the
    // content half was given its own name precisely so this search could stop
    // finding it — the type's own comment says so, and this entry's `closedBy`
    // has always said "the content type keeps its own name". Searching for the
    // union alias counted every content consumer, and could never reach zero.
    what: 'StreamChunk and the subagent chunk vocabulary',
    pattern: /\bChatTurnLifecycleChunk\b|async_subagent_result|subagent_tool_(use|result)/,
    // **Still 5, and the count is right — three of the union's five variants
    // are gone and no file stopped naming it.** `user_message_start` and
    // `assistant_message_start` were deleted with their last two emitters, the
    // ACP normalizer and the Codex router; `status` had no emitter at all, only
    // a `StreamController` case and two `TurnFeedbackMetrics` arms, which went
    // with it.
    //
    // **`done` is the fourth, and the count still says 5 — which is the honest
    // answer, because no file stopped naming the union.** It had been reaching
    // nobody: the only emitter was Codex's notification router and the only
    // reader was Codex's own presenter, filtering it back out before anything
    // saw it, with Claude's presenter filtering a chunk its transform never
    // emitted. The projection path says a turn ended by calling the column's
    // `finishTurn`.
    //
    // **What that dead variant was hiding.** Nine live-smoke suites asserted
    // one such chunk on the column as a matrix row, which that path cannot
    // deliver, and their fake column implemented neither `finishTurn` nor
    // `renderTurnFailure` — so the render target's call would have thrown.
    // Both are fixed; the rows count what the column was actually told.
    //
    // **This search cannot reach zero as written, and that is a finding about
    // the search.** Three of its four patterns name the subagent chunk
    // vocabulary, which is `ChatContentItem` — Claude's transform emits those
    // three and `StreamController` draws them. Durable agents cannot take them
    // over for the reason the `subagent hooks and loaders` row already
    // recorded: an `AgentResultRecord` carries no tool calls. The fifth
    // variant, `error`, is live on the auto-turn path, which renders a turn the
    // backend started rather than one a surface asked for and so has no
    // projection to read a terminal off.
    files: 5,
    closedBy: 'the auto-turn path — the last lifecycle variant is its failure '
      + 'channel; the three subagent variants are content and are not going',
  },
  {
    what: 'the registries',
    pattern: /\bProviderRegistry\b|\bProviderWorkspaceRegistry\b/,
    // **17, and `ProviderRegistry` is deleted.** Its last two rows —
    // `taskResultInterpreter` and `subagentLifecycleAdapter` — are
    // `ProviderDeclarations.asyncTaskResults` and
    // `ProviderDeclarations.subagentLifecycle`, filled by the three providers
    // that had them, so the class, the `ProviderRegistration` interface and all
    // nine `registration.ts` files went with them. The pattern still names both
    // because what it counts is the shape, not the class: what is left is
    // `ProviderWorkspaceRegistry`, across the feature layer, `main.ts`, and the
    // nine provider files that publish its accessors.
    // **16.** `modelRouting` left it by having a comment corrected: it named the
    // chat registry as the class its two statics came off, and that class is
    // deleted.
    //
    // `ClaudeConversationHistoryService` was tried and put back. Reaching
    // `maybeGetClaudeWorkspaceServices(plugin)` instead of the registry — the same
    // move the compositions took — introduces a **circular import**: the
    // workspace services reach the history service, so at module init the class
    // is `undefined` and every suite importing Claude fails to load. The
    // registry's indirection is breaking that cycle, which is a reason to keep
    // it that no reading of the call site would have shown.
    // **Closed. Both registries are deleted.**
    //
    // The chat one went when its last two rows became declarations. The
    // workspace one took longer because it was doing something real: a
    // provider's services are a per-provider singleton built asynchronously —
    // eight of the nine read MCP servers and agent definitions off disk to
    // construct — while a module context is built **per tab**, so something had
    // to hold the one instance between them. A static in `src/core/providers`
    // did, which meant provider-neutral core held a map of provider services
    // and every reader reached it without saying who it was.
    //
    // Every reader has a plugin. So `ApplicationRuntime` — the composition root,
    // which already holds the compositions and the agent coordinator — holds
    // them, `main.ts` publishes what `ProviderWorkspaceManager` builds, and the
    // nine `maybeGet<Provider>WorkspaceServices` accessors take the plugin they
    // were always called beside.
    files: 0,
    closedBy: 'closed — the composition root holds what the registries held',
  },
];

function read(module: string): string {
  return readFileSync(resolve(process.cwd(), module), 'utf8');
}

function matchingFiles(search: DeletionSearch): string[] {
  const prefix = search.within ? `${search.within.replace(/^src\/?/, '')}/` : '';
  return listAllSourceModules({ sourceRoot: SOURCE_ROOT, baseDir: SOURCE_ROOT })
    .filter(module => module.startsWith(prefix))
    .filter(module => search.pattern.test(read(`src/${module}`)));
}

describe('structural deletion progress', () => {
  it('reads the source tree it is meant to be counting', () => {
    // Guards every count below: a reader that found nothing would report every
    // search as zero, which is the answer the exit gate is waiting for.
    expect(listAllSourceModules({ sourceRoot: SOURCE_ROOT, baseDir: SOURCE_ROOT }).length)
      .toBeGreaterThan(400);
  });

  it.each(SEARCHES.map(search => [search.what, search] as const))(
    '%s',
    (_what, search) => {
      expect(matchingFiles(search)).toHaveLength(search.files);
    },
  );

  it('says in one place how far the exit gate has to go', () => {
    const remaining = SEARCHES.filter(search => search.files > 0);

    // Printed by being asserted, like the live-matrix summary: a reader who
    // wants "what is left" reads this line rather than eleven assertions.
    expect(remaining.map(search => `${search.what}: ${search.files}`)).toEqual([
      'StreamChunk and the subagent chunk vocabulary: 5',
    ]);
    // **Eleven of twelve are zero.** The one that is not is not blocked, and
    // its entry says why: three of its four patterns name the subagent chunk
    // vocabulary, which is `ChatContentItem` — Claude's transform emits those
    // and `StreamController` draws them — and durable agents cannot take them
    // over, because an `AgentResultRecord` carries no tool calls.
    //
    // The row above it closed by re-reading its own recorded blocker and
    // finding a type where it had written a fact, which is worth remembering
    // the next time this list looks finished.
    expect(SEARCHES).toHaveLength(remaining.length + 11);
  });
});
