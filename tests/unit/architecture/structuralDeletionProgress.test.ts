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
    files: 3,
    closedBy: 'the seam deletion',
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
    files: 7,
    closedBy: 'durable agents',
  },
  {
    what: 'SubagentManager lifecycle',
    pattern: /\bSubagentManager\b|\bSubagentInfo\b|orphanAllActive/,
    // **20, and two of them are the replacement rather than the thing being
    // replaced**: `SubagentAgentRecorder` and `tabDurableSubagents`, which name
    // it while describing what they take over from it. A count that rises for
    // that reason is still a count rising, and recording it is cheaper than
    // wording a comment around a grep. The real fall comes when the work card
    // ships and `orphanAllActive` stops being what tab close does.
    files: 20,
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
    what: 'turn metadata and session updates',
    pattern: /consumeTurnMetadata|buildSessionUpdates|syncConversationState/,
    files: 24,
    closedBy: 'the seam deletion',
  },
  {
    what: 'StreamChunk and the subagent chunk vocabulary',
    pattern: /\bStreamChunk\b|async_subagent_result|subagent_tool_(use|result)/,
    files: 25,
    closedBy: 'the seam deletion — the lifecycle meaning goes, the content type keeps its own name',
  },
  {
    what: 'the two registries',
    pattern: /\bProviderRegistry\b|\bProviderWorkspaceRegistry\b/,
    // **34.** The chat-UI row is off the registry entirely: its accessor is
    // deleted, and so are the four model-routing statics that only lived there
    // to reach it — they are `modelRouting.ts` now, over the catalog. Six files
    // lost the name outright with them, and `ProviderRegistry` is down to five
    // members. `GrimoireSettings` still counts, because the pattern is both
    // registries and it holds eight `ProviderWorkspaceRegistry` calls.
    files: 34,
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
      'runtime interaction callbacks: 3',
      'worker tab ownership: 3',
      'core importing the plugin type: 2',
      'subagent hooks and loaders: 7',
      'SubagentManager lifecycle: 20',
      'the application importing a concrete provider module: 20',
      'turn metadata and session updates: 24',
      'StreamChunk and the subagent chunk vocabulary: 25',
      'the two registries: 34',
    ]);
    // Two of eleven are zero, and both closed in the 2026-08-27 session.
    expect(SEARCHES).toHaveLength(remaining.length + 2);
  });
});
