import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

/**
 * Import-graph walker behind the presentation parity gate.
 *
 * A module the production entry point cannot reach is not in the shipped
 * bundle, regardless of whether it compiles, lints, or has passing unit tests.
 * The first migration attempt left 324 such modules behind while every
 * automated gate stayed green, so reachability is asserted directly instead of
 * being inferred from the other gates.
 *
 * Known blind spot: only string-literal specifiers are followed. A `require()`
 * with a computed specifier is invisible here, which is why an orphan reported
 * by this walker still needs a human verdict before it is deleted.
 */

export interface ModuleGraphOptions {
  /** Directory scanned for modules. Defaults to `<cwd>/src`. */
  sourceRoot?: string;
  /** Directory reported paths are relative to. Defaults to the process cwd. */
  baseDir?: string;
  /** Absolute path of the entry point. Defaults to `<sourceRoot>/main.ts`. */
  entryPoint?: string;
}

interface ResolvedOptions {
  sourceRoot: string;
  baseDir: string;
  entryPoint: string;
}

function resolveOptions(options: ModuleGraphOptions = {}): ResolvedOptions {
  const baseDir = options.baseDir ?? process.cwd();
  const sourceRoot = options.sourceRoot ?? resolve(baseDir, 'src');
  return {
    baseDir,
    sourceRoot,
    entryPoint: options.entryPoint ?? join(sourceRoot, 'main.ts'),
  };
}

export const PRODUCTION_ENTRY_POINT = join(resolve(process.cwd(), 'src'), 'main.ts');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(path);
    }
    // Ambient declarations are consumed by the compiler, never imported, so
    // they can neither be reachable nor be orphans.
    if (entry.name.endsWith('.d.ts')) {
      return [];
    }
    return extname(entry.name) === '.ts' ? [path] : [];
  });
}

function toRelative(baseDir: string, absolutePath: string): string {
  return relative(baseDir, absolutePath).split('\\').join('/');
}

/** Every non-ambient `.ts` file under the source root, as relative POSIX paths. */
export function listAllSourceModules(options: ModuleGraphOptions = {}): string[] {
  const { sourceRoot, baseDir } = resolveOptions(options);
  return listSourceFiles(sourceRoot)
    .map(path => toRelative(baseDir, path))
    .sort();
}

function collectSpecifiers(absolutePath: string): string[] {
  const parsed = ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function add(node: ts.Expression | undefined): void {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      // Covers `import x from 'y'`, `export * from 'y'`, and the side-effect
      // form `import 'y'` that the provider registration hub relies on.
      add(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        add(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return specifiers;
}

function resolveSpecifier(
  sourceRoot: string,
  fromAbsolutePath: string,
  specifier: string,
): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = resolve(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(fromAbsolutePath, '..', specifier);
  } else {
    // Bare specifiers are packages, not first-party modules.
    return null;
  }

  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

/**
 * Modules reachable from the entry point, as relative paths.
 * The entry point itself is included.
 */
export function findReachableModules(options: ModuleGraphOptions = {}): Set<string> {
  const { sourceRoot, baseDir, entryPoint } = resolveOptions(options);
  const visited = new Set<string>([entryPoint]);
  const pending = [entryPoint];

  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const specifier of collectSpecifiers(current)) {
      const target = resolveSpecifier(sourceRoot, current, specifier);
      if (target !== null && !visited.has(target)) {
        visited.add(target);
        pending.push(target);
      }
    }
  }

  return new Set([...visited].map(path => toRelative(baseDir, path)));
}

/** Modules under the source root the entry point cannot reach. */
export function findUnreachableModules(options: ModuleGraphOptions = {}): string[] {
  const reachable = findReachableModules(options);
  return listAllSourceModules(options).filter(module => !reachable.has(module));
}
