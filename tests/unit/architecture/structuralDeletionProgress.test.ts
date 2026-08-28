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
    what: 'worker tab ownership',
    pattern: /createWorkerTab|orchestratorTabId|workerTabIds/,
    files: 3,
    closedBy: 'durable agents — worker tabs become optional focused views',
  },
  {
    what: 'core importing the plugin type',
    pattern: /GrimoirePlugin/,
    within: 'src/core',
    // **One.** Both registries have left it. The chat one took a plugin for
    // exactly three members — the title, refine and inline-edit factories — and
    // handing them a plugin was the whole reason a provider's auxiliary services
    // could not be reached without one; they are the application's now, and the
    // class is deleted. The workspace one took a plugin for exactly one method,
    // to assemble the plugin-shaped context a contribution's `initialize` wants,
    // which its one caller was already holding a plugin to supply.
    //
    // What is left is `providers/types.ts`, where the contracts themselves are
    // written: `ProviderWorkspaceInitContext` names a plugin because that is
    // what a workspace contribution is handed. It goes when the contracts do.
    files: 1,
    closedBy: 'the provider rows — the legacy contracts are the last thing naming it',
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
    what: 'SubagentManager lifecycle',
    pattern: /hasRunningSubagents|orphanAllActive/,
    files: 2,
    closedBy: 'durable agents — whether an in-turn subagent should hold a turn open',
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
    // **2.** The adapter that builds the patch and the one caller that applies
    // it, which is the conversation save path in `ConversationController`.
    files: 2,
    closedBy: 'the coordinator taking the persistence barrier',
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
    // with it. `error` and `done` are still emitted and still filtered, so the
    // union stays and so do the files naming it. What closes this now is the
    // terminal pair, which the projection already states and the surface still
    // reads off the content channel.
    files: 5,
    closedBy: 'the seam deletion — the lifecycle meaning goes, the content type keeps its own name',
  },
  {
    what: 'the registries — one left',
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
    // `maybeGetClaudeWorkspaceServices()` instead of the registry — the same
    // move the compositions took — introduces a **circular import**: the
    // workspace services reach the history service, so at module init the class
    // is `undefined` and every suite importing Claude fails to load. The
    // registry's indirection is breaking that cycle, which is a reason to keep
    // it that no reading of the call site would have shown.
    // **13, and the registry is a map with three methods on it.**
    // `refreshAgentMentions`, `getRuntimeCommandLoader` and
    // `getSettingsTabRenderer` have all moved to module slots; `TabManager` left
    // the count with the second.
    //
    // `getMcpServerManager` went last. Three chat surfaces held the manager by
    // identity and called it later, so neither the manager nor a snapshot would
    // do: the mention dropdown and the file context want the context-saving
    // servers, the composer's selector wants the enabled ones, and both ask
    // while drawing. `ProviderMcpPort` grew two **synchronous** members over
    // what the workspace holds now, and `tabSettings` hands the widgets a view
    // that resolves the workspace on each call. The `setMcpManager(null)` signal
    // that used to clear the enabled set needed no replacement after all: the
    // selector prunes every enabled server no longer listed, and for an empty
    // list that is all of them — the same end state, by the path already there.
    //
    // `register` and `contributionFor` went with it: a registration held one
    // member after its duplicated capability map was deleted, so the providers'
    // hub exports the initializers as a table and `main.ts` looks the builder up
    // there. `providers/index.ts` left the count with them.
    //
    // **What is left is the reason the class exists**, and it is not a row.
    // These services are a per-provider singleton built asynchronously — eight
    // of the nine read MCP servers and agent definitions off disk to construct —
    // while a module context is built per tab. Something has to hold the one
    // instance between them, and today that is `setServices`/`getServices`, read
    // by nine `maybeGet<Provider>WorkspaceServices` accessors, `main.ts`, and
    // two rows of the settings hub. Closing it means the composition owning that
    // singleton, which is one pass over two lifecycles rather than nine row
    // moves.
    files: 13,
    closedBy: 'the provider rows, when the last consumer of each has moved',
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
      'worker tab ownership: 3',
      'core importing the plugin type: 1',
      'SubagentManager lifecycle: 2',
      'turn metadata and session updates: 2',
      'StreamChunk and the subagent chunk vocabulary: 5',
      'the registries — one left: 13',
    ]);
    // Six of twelve are zero: two closed in the 2026-08-27 session, the
    // interaction callbacks closed with the first step of the seam deletion,
    // the compositions closed by moving under the providers they compose, the
    // neutral settings imports closed by two contract additions, and the
    // subagent hooks closed once the loaders beside them were read.
    expect(SEARCHES).toHaveLength(remaining.length + 6);
  });
});
