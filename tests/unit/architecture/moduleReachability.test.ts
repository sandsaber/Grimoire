import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  findReachableModules,
  findUnreachableModules,
  listAllSourceModules,
} from '@test/helpers/moduleReachability';

/**
 * The walker is the instrument the parity gate is built on, so its resolution
 * rules are pinned directly. Fixtures live in a temp tree because checked-in
 * fixture modules would be compiled by `tsc` and linted with the real sources.
 */
describe('moduleReachability', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grimoire-reachability-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeModule(relativePath: string, contents: string): void {
    const absolute = join(root, 'src', relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }

  function reachable(): Set<string> {
    return findReachableModules({ baseDir: root });
  }

  function unreachable(): string[] {
    return findUnreachableModules({ baseDir: root });
  }

  it('includes the entry point itself', () => {
    writeModule('main.ts', 'export const plugin = 1;\n');

    expect([...reachable()]).toEqual(['src/main.ts']);
    expect(unreachable()).toEqual([]);
  });

  it('follows relative, aliased, and side-effect imports', () => {
    writeModule(
      'main.ts',
      [
        "import { near } from './near';",
        "import { aliased } from '@/deep/aliased';",
        "import './sideEffect';",
        'export const used = [near, aliased];',
      ].join('\n'),
    );
    writeModule('near.ts', 'export const near = 1;\n');
    writeModule('deep/aliased.ts', 'export const aliased = 2;\n');
    writeModule('sideEffect.ts', 'globalThis.marker = true;\n');

    expect(unreachable()).toEqual([]);
    expect(reachable()).toEqual(
      new Set(['src/main.ts', 'src/near.ts', 'src/deep/aliased.ts', 'src/sideEffect.ts']),
    );
  });

  it('follows re-exports, dynamic import, and require', () => {
    writeModule(
      'main.ts',
      [
        "export * from './reexported';",
        "export async function lazy() { return import('./dynamic'); }",
        "export function legacy() { return require('./required'); }",
      ].join('\n'),
    );
    writeModule('reexported.ts', 'export const reexported = 1;\n');
    writeModule('dynamic.ts', 'export const dynamic = 2;\n');
    writeModule('required.ts', 'export const required = 3;\n');

    expect(unreachable()).toEqual([]);
  });

  it('resolves a directory specifier through its index module', () => {
    writeModule('main.ts', "import { barrel } from './feature';\nexport const used = barrel;\n");
    writeModule('feature/index.ts', "export { barrel } from './barrel';\n");
    writeModule('feature/barrel.ts', 'export const barrel = 1;\n');

    expect(unreachable()).toEqual([]);
  });

  it('reports modules nothing imports', () => {
    writeModule('main.ts', "import './wired';\n");
    writeModule('wired.ts', 'export const wired = 1;\n');
    writeModule('orphan.ts', 'export const orphan = 2;\n');
    writeModule('nested/alsoOrphan.ts', 'export const alsoOrphan = 3;\n');

    expect(unreachable()).toEqual(['src/nested/alsoOrphan.ts', 'src/orphan.ts']);
  });

  it('ignores ambient declarations and bare package specifiers', () => {
    writeModule('main.ts', "import { Plugin } from 'obsidian';\nexport const used = Plugin;\n");
    writeModule('globals.d.ts', 'declare const marker: string;\n');

    expect(listAllSourceModules({ baseDir: root })).toEqual(['src/main.ts']);
    expect(unreachable()).toEqual([]);
  });

  it('does not follow a computed require, the walker blind spot', () => {
    writeModule(
      'main.ts',
      ["const name = './computed';", 'export const loaded = require(name);'].join('\n'),
    );
    writeModule('computed.ts', 'export const computed = 1;\n');

    // Documented limitation: an orphan reported here still needs a human
    // verdict, because the reference may exist behind a computed specifier.
    expect(unreachable()).toEqual(['src/computed.ts']);
  });

  it('walks the real production entry point', () => {
    const production = findReachableModules();

    expect(production.has('src/main.ts')).toBe(true);
    expect(production.has('src/features/chat/GrimoireView.ts')).toBe(true);
    expect(production.has('src/providers/index.ts')).toBe(true);
    expect(production.size).toBeGreaterThan(400);
  });
});
