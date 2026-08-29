import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import baseline from '@test/fixtures/architecture/unconsumedExports.json';
import { listUnconsumedExports } from '@test/helpers/exportConsumers';

/**
 * The gate the `main` sync needed and did not have.
 *
 * Three fixes arrived in that merge and were wired to nothing:
 * `createClaudeTaskPlanState`, `readGrokAcpModelThinkingOptions` and
 * `isAcpSessionGone`. Each had a module, a full unit suite, and no production
 * caller — and every existing gate stayed green, because a module test passes
 * whether or not anything calls the module. Run against the tree as it stood
 * before the recovery, this names all three without being told which to look
 * for.
 *
 * A consumer in `tests/` does not count, and neither does an export the module
 * only offers so a test can reach code it also uses itself. What is left is the
 * symbol nothing ships.
 */
describe('unconsumed exports', () => {
  it('adds no export that nothing in src takes', () => {
    const current = listUnconsumedExports();
    const allowed = new Set(
      Object.entries(baseline.modules).flatMap(([module, names]) => (
        names.map(name => `${module}#${name}`)
      )),
    );

    const added = current
      .map(entry => `${entry.module}#${entry.name}`)
      .filter(entry => !allowed.has(entry));

    // The baseline is a backlog, so shrinking it needs no edit here and growing
    // it needs a deliberate one. An export that arrives with tests and no caller
    // is the case this exists for.
    expect(added).toEqual([]);
  });

  it('holds a baseline that still describes this tree', () => {
    // A stale entry is how a gate quietly stops holding anything: the module it
    // names is gone, the line stays, and the allowance outlives what it excused.
    const live = new Set(listUnconsumedExports().map(entry => entry.module));
    const stale = Object.keys(baseline.modules).filter(module => !live.has(module));

    expect(stale).toEqual([]);
  });
});

/**
 * The walker's own rules, pinned on a temp tree because checked-in fixture
 * modules would be compiled by `tsc` and linted with the real sources.
 */
describe('listUnconsumedExports', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grimoire-exports-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeModule(relativePath: string, contents: string): void {
    const absolute = join(root, 'src', relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }

  function found(): string[] {
    return listUnconsumedExports({ baseDir: root })
      .map(entry => `${entry.module}#${entry.name}`);
  }

  it('names a symbol that has a module and no caller', () => {
    // The shape all three sync casualties had: exported, tested, never called.
    writeModule('main.ts', "import { used } from './helpers';\nexport default used;\n");
    writeModule('helpers.ts', [
      'export function used(): string { return unused() ? "y" : "n"; }',
      'function unused(): boolean { return true; }',
      'export function orphan(): string { return "nobody calls this"; }',
    ].join('\n'));

    expect(found()).toEqual(['src/helpers.ts#orphan']);
  });

  it('does not name an export the module itself uses', () => {
    // Exported so a test can reach it, and live code all the same. Reporting
    // these would bury the one finding that matters under hundreds that do not.
    writeModule('main.ts', "import { entry } from './helpers';\nexport default entry;\n");
    writeModule('helpers.ts', [
      'export function shared(): string { return "s"; }',
      'export function entry(): string { return shared(); }',
    ].join('\n'));

    expect(found()).toEqual([]);
  });

  it('follows a name taken through a barrel to the module that declares it', () => {
    // `src/providers/acp/index.ts` is exactly this, and a gate that stopped at
    // the barrel would call every module behind it dead.
    writeModule('main.ts', "import { deep } from './barrel';\nexport default deep;\n");
    writeModule('barrel.ts', "export * from './deep';\n");
    writeModule('deep.ts', 'export const deep = 1;\nexport const alsoDeep = 2;\n');

    expect(found()).toEqual(['src/deep.ts#alsoDeep']);
  });

  it('counts a namespace import as using everything behind it', () => {
    // Nothing here can say which member a namespace import reached, so the
    // honest answer is all of them — a false negative rather than a false alarm.
    writeModule('main.ts', "import * as all from './helpers';\nexport default all;\n");
    writeModule('helpers.ts', 'export const a = 1;\nexport const b = 2;\n');

    expect(found()).toEqual([]);
  });

  it('counts a type taken only as a type', () => {
    // `import type` is erased from the bundle and is still a consumer: a
    // contract module exports nothing else, and calling it dead would be wrong.
    writeModule('main.ts', [
      "import type { Contract } from './contract';",
      'export default (value: Contract) => value;',
    ].join('\n'));
    writeModule('contract.ts', 'export interface Contract { id: string }\n');

    expect(found()).toEqual([]);
  });
});
