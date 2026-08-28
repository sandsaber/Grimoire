import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readInterfaceMembers } from '@test/helpers/interfaceMembers';

/**
 * Makes `docs/provider-row-slot-fit.md` executable.
 *
 * The inventory proves a slot *exists* for every row. Three consecutive
 * checkpoints found that existing is not fitting: `tabWarmupPolicy`, the three
 * auxiliary rows, and `taskResultInterpreter` each reached their move with a
 * slot that could not hold them, and each was discovered while moving rather
 * than before.
 *
 * The verdicts in that document come from reading the implementations, which no
 * test can do. What a test can do is stop the numbers those verdicts rest on
 * from drifting: a slot that grows to fit its row, or a row that shrinks to fit
 * its slot, changes the answer — and a document that quietly keeps saying
 * `reshape` about a slot somebody fixed is worse than no document.
 */

const FIT_PATH = 'docs/provider-row-slot-fit.md';

interface RowFit {
  readonly row: string;
  /** The contract the row is declared as today. */
  readonly real: { readonly name: string; readonly path: string };
  /** The contribution waiting for it, when the count is the slot's own. */
  readonly slot?: { readonly name: string; readonly path: string };
  /** The row is a class, so its member count cannot be read as an interface. */
  readonly unverifiable?: boolean;
}

const TYPES = 'src/core/providers/types.ts';
const MODULE = 'src/core/providers/ProviderModule.ts';

const ROWS: readonly RowFit[] = [
  {
    row: 'taskResultInterpreter?',
    real: { name: 'ProviderTaskResultInterpreter', path: TYPES },
    slot: { name: 'ProviderTaskResultPort', path: MODULE },
  },
  {
    row: 'subagentLifecycleAdapter?',
    real: { name: 'ProviderSubagentLifecycleAdapter', path: TYPES },
    slot: { name: 'ProviderNativeAgentPort', path: MODULE },
  },
  {
    row: 'runtimeCommandLoader',
    real: { name: 'ProviderRuntimeCommandLoader', path: TYPES },
    slot: { name: 'ProviderRuntimeCommandsPort', path: MODULE },
  },
  {
    // Typed as a concrete class, so there is no interface to count and no
    // contract a provider could satisfy without constructing Grimoire's own
    // manager. The table says `class` where the others carry a number.
    row: 'mcpServerManager',
    real: { name: 'McpServerManager', path: 'src/core/mcp/McpServerManager.ts' },
    unverifiable: true,
  },
  {
    row: 'settingsTabRenderer',
    real: { name: 'ProviderSettingsTabRenderer', path: TYPES },
    slot: { name: 'ProviderSettingsPresentationPort', path: MODULE },
  },
];

/**
 * The verdict, out of a cell written for a reader.
 *
 * The cell carries emphasis and sometimes a qualifier — `**moved**`,
 * `reshape, **but not yet**`, `reshaped` — and the past tense means the work is
 * done rather than that the verdict changed. Listed rather than derived: a
 * regex that stripped a trailing letter would also silently accept a word
 * nobody meant to write.
 */
const VERDICTS: Readonly<Record<string, string>> = {
  fits: 'fits',
  moved: 'moved',
  reshape: 'reshape',
  reshaped: 'reshape',
};

function readVerdict(cell: string): string {
  const word = cell.trim().replace(/\*/g, '').split(/[,\s]/)[0];
  return VERDICTS[word] ?? word;
}

function fitTable(): Map<string, { real: number; slot: string; verdict: string }> {
  const document = readFileSync(resolve(process.cwd(), FIT_PATH), 'utf8');
  const rows = new Map<string, { real: number; slot: string; verdict: string }>();
  for (const line of document.split('\n')) {
    // The verdict may carry a qualifier — `reshape, **but not yet**` — so it is
    // read up to the next column and the leading word taken from it, rather
    // than assuming one word and silently skipping the row that has two.
    const match = line.match(/^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/);
    if (!match) {
      continue;
    }
    rows.set(match[1], {
      real: Number.parseInt(match[2].trim(), 10),
      slot: match[3].trim(),
      verdict: readVerdict(match[4]),
    });
  }
  return rows;
}

describe('provider row slot fit', () => {
  const table = fitTable();

  it('records every row that has not moved', () => {
    // `modelCatalog` and `usageProvider` have left: their consumers read
    // `ApplicationRuntime.workspaceFor(providerId)` and the registry accessor
    // is deleted. It stays in the document with a `moved` verdict, which is
    // what keeps this list and that table from disagreeing about it.
    // A row missing from the table is a row nobody read before planning its
    // move, which is the whole failure this file exists to stop repeating.
    expect([...table.keys()].filter(row => table.get(row)?.verdict !== 'moved').sort())
      .toEqual(ROWS.map(row => row.row).sort());
  });

  it.each(ROWS.filter(row => !row.unverifiable))(
    '$row still has the member count the table claims',
    ({ row, real }) => {
      expect(readInterfaceMembers(real.path, real.name)).toHaveLength(table.get(row)?.real ?? -1);
    },
  );

  it.each(ROWS.filter(row => row.unverifiable))(
    '$row is recorded as a class, which is why it carries no count',
    ({ row, real }) => {
      // Stated rather than skipped: if it ever becomes an interface, the row
      // stops needing this exemption and the table stops being right about why.
      expect(table.get(row)?.real).toBeNaN();
      expect(readFileSync(resolve(process.cwd(), real.path), 'utf8'))
        .toContain(`export class ${real.name}`);
    },
  );

  it.each(ROWS.filter(row => row.slot))(
    '$row still faces the slot the table claims',
    ({ row, slot }) => {
      expect(readInterfaceMembers(slot!.path, slot!.name))
        .toHaveLength(Number.parseInt(table.get(row)?.slot ?? '-1', 10));
    },
  );

  it('claims a verdict for every row it lists', () => {
    for (const [row, entry] of table) {
      expect(['fits', 'reshape', 'moved']).toContain(entry.verdict);
      expect(row).not.toBe('');
    }
  });
});
