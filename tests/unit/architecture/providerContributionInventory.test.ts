import '@/providers';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readInterfaceMembers } from '@test/helpers/interfaceMembers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
import { antigravityWorkspaceRegistration } from '@/providers/antigravity/app/AntigravityWorkspaceServices';
import { antigravityProviderRegistration } from '@/providers/antigravity/registration';
import { claudeWorkspaceRegistration } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { claudeProviderRegistration } from '@/providers/claude/registration';
import { codexWorkspaceRegistration } from '@/providers/codex/app/CodexWorkspaceServices';
import { codexProviderRegistration } from '@/providers/codex/registration';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';
import { geminiWorkspaceRegistration } from '@/providers/gemini/app/GeminiWorkspaceServices';
import { geminiProviderRegistration } from '@/providers/gemini/registration';
import { grokWorkspaceRegistration } from '@/providers/grok/app/GrokWorkspaceServices';
import { grokProviderRegistration } from '@/providers/grok/registration';
import { kimicodeWorkspaceRegistration } from '@/providers/kimicode/app/KimicodeWorkspaceServices';
import { kimicodeProviderRegistration } from '@/providers/kimicode/registration';
import { mimocodeWorkspaceRegistration } from '@/providers/mimocode/app/MimocodeWorkspaceServices';
import { mimocodeProviderRegistration } from '@/providers/mimocode/registration';
import { opencodeWorkspaceRegistration } from '@/providers/opencode/app/OpencodeWorkspaceServices';
import { opencodeProviderRegistration } from '@/providers/opencode/registration';
import { qwenWorkspaceRegistration } from '@/providers/qwen/app/QwenWorkspaceServices';
import { qwenProviderRegistration } from '@/providers/qwen/registration';

import { PARITY_SURFACES } from './presentationParityManifest';

/**
 * Makes `docs/provider-contribution-inventory.md` executable.
 *
 * The inventory is the design input for the M1 ProviderModule contract and the
 * seed of the parity manifest. On the first attempt the equivalent knowledge
 * lived in prose — "thirteen contributions" — and the replacement contract
 * silently shipped with slots for five of them. A table nothing checks is a
 * table that drifts, so every row here is asserted against the real
 * declarations and the real registration objects.
 */

const INVENTORY_PATH = 'docs/provider-contribution-inventory.md';

/** The moved table's rows as `{ contribution, from }`, so each total still adds up. */
function readMovedRows(): Array<{ contribution: string; from: string }> {
  const document = readFileSync(resolve(process.cwd(), INVENTORY_PATH), 'utf8');
  const lines = document.split('\n');
  const start = lines.findIndex(line => line.startsWith('## Moved to their target homes'));

  if (start === -1) {
    throw new Error(`Moved table was not found in ${INVENTORY_PATH}`);
  }

  const rows: Array<{ contribution: string; from: string }> = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) {
      break;
    }
    if (!line.startsWith('|')) {
      continue;
    }
    const cells = line.split('|').map(cell => cell.trim());
    const contribution = cells[2]?.replace(/`/g, '').replace(/\?$/, '');
    if (!contribution || contribution === 'Contribution' || contribution.startsWith('---')) {
      continue;
    }
    rows.push({ contribution, from: cells[3] ?? '' });
  }

  return rows;
}
const TYPES_PATH = 'src/core/providers/types.ts';

const WORKSPACE_REGISTRATIONS = {
  antigravity: antigravityWorkspaceRegistration,
  claude: claudeWorkspaceRegistration,
  codex: codexWorkspaceRegistration,
  gemini: geminiWorkspaceRegistration,
  grok: grokWorkspaceRegistration,
  kimicode: kimicodeWorkspaceRegistration,
  mimocode: mimocodeWorkspaceRegistration,
  opencode: opencodeWorkspaceRegistration,
  qwen: qwenWorkspaceRegistration,
};

const REGISTRATIONS = {
  antigravity: antigravityProviderRegistration,
  claude: claudeProviderRegistration,
  codex: codexProviderRegistration,
  gemini: geminiProviderRegistration,
  grok: grokProviderRegistration,
  kimicode: kimicodeProviderRegistration,
  mimocode: mimocodeProviderRegistration,
  opencode: opencodeProviderRegistration,
  qwen: qwenProviderRegistration,
};

/** Second column of every row of the table under `headingPrefix`, unwrapped from backticks. */
function readInventoryRows(headingPrefix: string): string[] {
  const document = readFileSync(resolve(process.cwd(), INVENTORY_PATH), 'utf8');
  const lines = document.split('\n');
  const start = lines.findIndex(line => line.startsWith(headingPrefix));

  if (start === -1) {
    throw new Error(`Heading "${headingPrefix}" was not found in ${INVENTORY_PATH}`);
  }

  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) {
      break;
    }
    if (!line.startsWith('|')) {
      continue;
    }
    const cells = line.split('|').map(cell => cell.trim());
    // cells[0] is the empty string before the leading pipe; cells[1] is the row number.
    const identifier = cells[2];
    if (!identifier || identifier === 'Field' || identifier === 'Member') {
      continue;
    }
    if (identifier.startsWith('---') || identifier === 'Contribution') {
      continue;
    }
    rows.push(identifier.replace(/`/g, '').replace(/\?$/, ''));
  }

  return rows;
}

describe('provider contribution inventory', () => {
  describe('ProviderRegistration table', () => {
    const documented = readInventoryRows('## `ProviderRegistration` fields');
    const declared = readInterfaceMembers(TYPES_PATH, 'ProviderRegistration');
    const moved = readMovedRows()
      .filter(row => row.from === 'registration')
      .map(row => row.contribution);

    it('documents exactly the declared fields', () => {
      expect([...documented].sort()).toEqual([...declared].sort());
    });

    it('claims the count the heading advertises', () => {
      // Two, and both optional: what is left of the registration is
      // `taskResultInterpreter?` and `subagentLifecycleAdapter?`, which three
      // providers fill and durable agents takes. Everything else is recorded in
      // the moved table below — including `createRuntime`, whose flip was M2's
      // and whose registration *hop* went at M5, when a tab started asking the
      // application for a runtime instead of a registry for a factory.
      expect(documented).toHaveLength(2);
    });

    it('accounts for every field the registration ever declared', () => {
      // A row that moves leaves the table above and appears in the moved one.
      // Without this the inventory shrinks silently, which is the same failure
      // as a contribution disappearing — the thing this file exists to catch.
      expect(documented.length + moved.length).toBe(16);
    });

    it('does not leave a moved row in both tables', () => {
      expect(moved.filter(field => documented.includes(field))).toEqual([]);
    });

    it('records where each moved row went', () => {
      expect(moved).toEqual([
        'displayName',
        'blankTabOrder',
        'isEnabled',
        'setEnabled',
        'getPreloadedContextFiles',
        'capabilities',
        'environmentKeyPatterns',
        'createTitleGenerationService',
        'createInstructionRefineService',
        'createInlineEditService',
        'chatUIConfig',
        'settingsReconciler',
        'createRuntime',
        'historyService',
      ]);
    });

    it.each(Object.entries(REGISTRATIONS))(
      '%s supplies only documented contributions',
      (_providerId, registration) => {
        const undocumented = Object.keys(registration).filter(key => !documented.includes(key));

        expect(undocumented).toEqual([]);
      },
    );

    it.each(Object.entries(REGISTRATIONS))('%s supplies every required field', (_providerId, registration) => {
      // `taskResultInterpreter` joined this list when eight of nine providers
      // turned out to be filling it with an interpreter that answered nothing.
      const optional = ['subagentLifecycleAdapter', 'taskResultInterpreter'];
      const missing = documented.filter(
        field => !optional.includes(field) && !(field in registration),
      );

      expect(missing).toEqual([]);
    });
  });

  describe('ProviderWorkspaceServices table', () => {
    const documented = readInventoryRows('## `ProviderWorkspaceServices` members');
    const declared = readInterfaceMembers(TYPES_PATH, 'ProviderWorkspaceServices');

    it('documents exactly the declared members', () => {
      expect([...documented].sort()).toEqual([...declared].sort());
    });

    it('claims the count the heading advertises', () => {
      // Ten, not eleven: row 7 left this table when `tabWarmupPolicy` became
      // `ProviderDeclarations.warmup`. A row whose member no longer exists on
      // the interface cannot stay here — the rule above is that the two agree
      // exactly — so a moved row is recorded in the migration log instead.
      expect(documented).toHaveLength(10);
    });

    it.each(Object.entries(WORKSPACE_REGISTRATIONS))(
      '%s registers a workspace contribution with both halves of the lifecycle',
      (_providerId, registration) => {
        // The services object itself is produced by `initialize(context)` and
        // needs a live plugin, so what is checkable statically is that the
        // registration exists and carries capabilities plus an initializer.
        // Row 3 of the app-level table owns the missing dispose half.
        expect(typeof registration.initialize).toBe('function');
        expect(registration.workspaceCapabilities).toBeDefined();
      },
    );
  });


  describe('a registered row has a filled slot to move into', () => {
    /**
     * Rows whose module slot is a *declaration* — filled at module definition,
     * not by the host — paired with the registration field they replace.
     *
     * A provider that registers the row and leaves the slot empty is a
     * contribution that disappears at that row's flip with nothing failing,
     * which is how the first attempt lost most of the product. The slot being
     * dark is exactly why nothing else notices.
     */
    const DECLARED_ROW_SLOTS = [
      { registration: 'taskResultInterpreter', slot: 'taskResults' },
      { registration: 'subagentLifecycleAdapter', slot: 'nativeAgents' },
    ] as const;

    /**
     * Providers that register a row today and declare nothing for it.
     *
     * May shrink, never grow. Each entry is a contribution that would be lost
     * if its row flipped right now.
     */
    const KNOWN_GAPS: ReadonlySet<string> = new Set([
      // This gate found eight more the moment it was written, all on
      // `taskResultInterpreter`: only Claude had a real one, and the other
      // eight registered the same twenty-nine-line no-op. They are deleted —
      // the row is optional now, and an absence is read as
      // `NO_TASK_RESULT_INTERPRETATION`. One gap is left.
      //
      // Grok's eight-member lifecycle adapter against a two-member slot that
      // cannot express it: `recognizesToolName` collapses four distinct
      // questions the live consumer asks separately, and `parseDisplay` gets
      // one payload while a Grok subagent's label comes from the spawn tool's
      // *input* and its id from the *result*. Filling it would mean inventing a
      // mapping no consumer matches. It closes when the row moves and the slot
      // is reshaped to what the four providers actually do.
      'grok:subagentLifecycleAdapter',
    ]);

    it.each(
      Object.entries(REGISTRATIONS).flatMap(([providerId, registration]) => (
        DECLARED_ROW_SLOTS
          .filter(row => row.registration in registration)
          .map(row => [`${providerId}.${row.registration}`, providerId, registration, row] as const)
      )),
    )('%s has somewhere to land', (_label, providerId, _registration, row) => {
      const declared = providerCatalog().declarations(providerId) as unknown as Record<string, unknown>;
      const isKnownGap = KNOWN_GAPS.has(`${providerId}:${row.registration}`);

      // A recorded gap is asserted to still *be* one, so an entry that has
      // quietly been filled is caught the same way an unrecorded gap is.
      expect(declared[row.slot] === undefined).toBe(isKnownGap);
    });

    it('records every gap that exists, and no gap that does not', () => {
      const actual = Object.entries(REGISTRATIONS).flatMap(([providerId, registration]) => {
        const declared = providerCatalog().declarations(providerId) as unknown as Record<string, unknown>;
        return DECLARED_ROW_SLOTS
          .filter(row => row.registration in registration && declared[row.slot] === undefined)
          .map(row => `${providerId}:${row.registration}`);
      });

      expect(actual.sort()).toEqual([...KNOWN_GAPS].sort());
    });
  });

  describe('agreement with the presentation parity manifest', () => {
    // The inventory says which contributions exist and where they are going;
    // the manifest says whether each is still in the bundle. Those two claims
    // have to agree, or a contribution can be recorded as live here while its
    // surface is quietly marked pending there.
    const CONTRIBUTION_SURFACES: Array<{ contribution: string; surfaceId: string }> = [
      { contribution: 'capabilities', surfaceId: 'provider-capability-gating' },
      { contribution: 'createRuntime', surfaceId: 'provider-chat-execution' },
      { contribution: 'createTitleGenerationService', surfaceId: 'provider-auxiliary-services' },
      { contribution: 'historyService', surfaceId: 'provider-history-services' },
      { contribution: 'commandCatalog', surfaceId: 'provider-command-catalogs' },
      { contribution: 'agentMentionProvider', surfaceId: 'provider-agent-mentions' },
      { contribution: 'cliResolver', surfaceId: 'provider-cli-resolution' },
      { contribution: 'modelCatalog', surfaceId: 'provider-model-selection' },
      { contribution: 'settingsTabRenderer', surfaceId: 'settings-provider-tabs' },
      { contribution: 'mcpServerManager', surfaceId: 'settings-mcp-management' },
    ];

    // The moved table counts: a contribution that reached its target home is
    // still a contribution with a surface, and its manifest entry has to keep
    // saying so.
    const documented = [
      ...readInventoryRows('## `ProviderRegistration` fields'),
      ...readInventoryRows('## `ProviderWorkspaceServices` members'),
      ...readMovedRows().map(row => row.contribution),
    ];

    it.each(CONTRIBUTION_SURFACES)(
      '$contribution is inventoried and its surface $surfaceId is wired',
      ({ contribution, surfaceId }) => {
        expect(documented).toContain(contribution);

        const surface = PARITY_SURFACES.find(entry => entry.id === surfaceId);
        expect(surface).toBeDefined();
        // A contribution the inventory still lists as live cannot have a
        // surface that left the bundle. When one moves at its milestone, both
        // records move in the same commit.
        expect(surface?.state).toBe('wired');
      },
    );
  });

  describe('registration- and app-level contributions', () => {
    const documented = readInventoryRows('## Registration- and app-level contributions');

    it('accounts for the three contributions that live outside both service objects', () => {
      const moved = readMovedRows().filter(row => row.from === 'app-level');

      expect(documented).toHaveLength(1);
      expect(documented.length + moved.length).toBe(3);
    });

    it('anchors workspaceCapabilities on the workspace registration', () => {
      expect(readInterfaceMembers(TYPES_PATH, 'ProviderWorkspaceRegistration')).toContain(
        'workspaceCapabilities',
      );
    });

    it('has no third source of provider defaults left to anchor', () => {
      // The row said a hand-maintained map stood beside the two registries.
      // It derives from the catalog now, so what is checkable is that it still
      // covers every provider and no longer names a per-provider constant.
      const source = readFileSync(
        resolve(process.cwd(), 'src/providers/defaultProviderConfigs.ts'),
        'utf8',
      );

      expect(Object.keys(getBuiltInProviderDefaultConfigs())).toEqual(
        expect.arrayContaining(Object.keys(REGISTRATIONS)),
      );
      expect(source).not.toMatch(/DEFAULT_\w+_PROVIDER_SETTINGS/);
    });

    it('has both halves of the workspace lifecycle, where the moved row says', () => {
      // The row used to say init existed and dispose did not, and that shipping
      // one without the other is the v1 defect repeating. Both halves are on
      // the manager now, and the registry owns no lifecycle at all.
      const manager = readFileSync(
        resolve(process.cwd(), 'src/core/providers/ProviderWorkspaceManager.ts'),
        'utf8',
      );
      const registry = readFileSync(
        resolve(process.cwd(), 'src/core/providers/ProviderWorkspaceRegistry.ts'),
        'utf8',
      );

      expect(manager).toContain('async initializeAll');
      expect(manager).toContain('async disposeAll');
      expect(registry).not.toContain('initializeAll');
    });
  });
});
