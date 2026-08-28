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
    // **Three until the auxiliary row.** `ProviderRegistry` took a plugin for
    // exactly three members — the title, refine and inline-edit factories — and
    // handing them a plugin was the whole reason a provider's auxiliary
    // services could not be reached without one. They are the application's
    // now, and the registry names no plugin type at all.
    files: 2,
    closedBy: 'the provider rows — one of the two is the workspace registry itself',
  },
  {
    what: 'subagent hooks and loaders',
    pattern: /setSubagentHookProvider|loadSubagent(ToolCalls|FinalResult)/,
    // **3, and all three are Claude's own history.** `setSubagentHookProvider`
    // left with the other five interaction setters, and the two loaders left
    // the contract with the retry ladder that was their only caller. What the
    // pattern still finds is the live recovery path — `ClaudeHistoryStore` and
    // its sidecar reader — which is provider-internal rather than a seam.
    files: 3,
    closedBy: 'durable agents — what is left is Claude reading its own sidecar',
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
    // What it measures now is the class losing lifecycle authority, not the
    // type it renders with — the same correction `StreamChunk` already got,
    // where the content half was named `ChatContentItem` so the gate could
    // search for the half that goes.
    what: 'SubagentManager lifecycle',
    pattern: /\bSubagentManager\b|orphanAllActive/,
    // **7, of which one is the replacement** — `SubagentAgentRecorder` names
    // the class while describing what it takes over from it. The rest are the
    // three chat controllers, the tab and its types, and the class itself.
    files: 7,
    closedBy: 'durable agents — it loses lifecycle authority and keeps its rendering',
  },
  {
    what: 'the application importing a concrete provider module',
    pattern: /providers\/(claude|codex|antigravity|opencode|mimocode|kimicode|grok|qwen|gemini)\//,
    within: 'src/app',
    files: 20,
    closedBy: 'the provider rows',
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
    // **5.** The lifecycle union, its re-export, and the three modules that
    // still name a subagent chunk kind. What is left to delete is the union and
    // the framing two provider normalizers emit into a channel the projection
    // drops it from — normalizer surgery against tests written from real
    // transcripts, which belongs with the smoke matrix.
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
    files: 17,
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
      'core importing the plugin type: 2',
      'subagent hooks and loaders: 3',
      'SubagentManager lifecycle: 7',
      'the application importing a concrete provider module: 20',
      'turn metadata and session updates: 2',
      'StreamChunk and the subagent chunk vocabulary: 5',
      'the registries — one left: 17',
    ]);
    // Three of eleven are zero: two closed in the 2026-08-27 session, and the
    // interaction callbacks closed with the first step of the seam deletion.
    expect(SEARCHES).toHaveLength(remaining.length + 3);
  });
});
