import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readInterfaceMembers } from '@test/helpers/interfaceMembers';

import { antigravityProviderRegistration } from '@/providers/antigravity/registration';
import { claudeProviderRegistration } from '@/providers/claude/registration';
import { codexProviderRegistration } from '@/providers/codex/registration';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';
import { geminiProviderRegistration } from '@/providers/gemini/registration';
import { grokProviderRegistration } from '@/providers/grok/registration';
import { kimicodeProviderRegistration } from '@/providers/kimicode/registration';
import { mimocodeProviderRegistration } from '@/providers/mimocode/registration';
import { opencodeProviderRegistration } from '@/providers/opencode/registration';
import { qwenProviderRegistration } from '@/providers/qwen/registration';

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
const TYPES_PATH = 'src/core/providers/types.ts';

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

    it('documents exactly the declared fields', () => {
      expect([...documented].sort()).toEqual([...declared].sort());
    });

    it('claims the count the heading advertises', () => {
      expect(documented).toHaveLength(16);
    });

    it.each(Object.entries(REGISTRATIONS))(
      '%s supplies only documented contributions',
      (_providerId, registration) => {
        const undocumented = Object.keys(registration).filter(key => !documented.includes(key));

        expect(undocumented).toEqual([]);
      },
    );

    it.each(Object.entries(REGISTRATIONS))('%s supplies every required field', (_providerId, registration) => {
      const optional = ['getPreloadedContextFiles', 'environmentKeyPatterns', 'subagentLifecycleAdapter'];
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
      expect(documented).toHaveLength(11);
    });
  });

  describe('registration- and app-level contributions', () => {
    const documented = readInventoryRows('## Registration- and app-level contributions');

    it('records the three contributions that live outside both service objects', () => {
      expect(documented).toHaveLength(3);
    });

    it('anchors workspaceCapabilities on the workspace registration', () => {
      expect(readInterfaceMembers(TYPES_PATH, 'ProviderWorkspaceRegistration')).toContain(
        'workspaceCapabilities',
      );
    });

    it('anchors the third source of provider defaults', () => {
      expect(Object.keys(getBuiltInProviderDefaultConfigs())).toEqual(
        expect.arrayContaining(Object.keys(REGISTRATIONS)),
      );
    });

    it('still has no workspace dispose contract, as the inventory row states', () => {
      // The row says init exists and dispose does not, and that shipping one
      // without the other is the v1 defect repeating. When dispose lands, this
      // fails and the row must move with it.
      const registry = readFileSync(
        resolve(process.cwd(), 'src/core/providers/ProviderWorkspaceRegistry.ts'),
        'utf8',
      );

      expect(registry).toContain('static async initializeAll');
      expect(registry).not.toContain('disposeAll');
    });
  });
});
