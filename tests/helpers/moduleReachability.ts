import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

/**
 * Import-graph walker used by the presentation parity gate.
 *
 * A module that the production entry point cannot reach is not in the shipped
 * bundle, regardless of whether it compiles, lints, or has passing unit tests.
 * The Phase 9 cutover left 324 such modules behind while every automated gate
 * stayed green, so reachability is asserted directly.
 */

const sourceRoot = resolve(process.cwd(), 'src');

export const PRODUCTION_ENTRY_POINT = join(sourceRoot, 'main.ts');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(path);
    }
    // Ambient declaration files are consumed by the compiler, never imported,
    // so they can never be "reachable" and are not orphans either.
    if (entry.name.endsWith('.d.ts')) {
      return [];
    }
    return extname(entry.name) === '.ts' ? [path] : [];
  });
}

/** Every non-ambient `.ts` file under `src/`, as repository-relative POSIX paths. */
export function listAllSourceModules(): string[] {
  return listSourceFiles(sourceRoot).map(toRepoRelative).sort();
}

function toRepoRelative(absolutePath: string): string {
  return relative(process.cwd(), absolutePath).split('\\').join('/');
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
      // form `import 'y'` that the deleted provider registration hub relied on.
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

function resolveSpecifier(fromAbsolutePath: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = resolve(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(fromAbsolutePath, '..', specifier);
  } else {
    return null;
  }

  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

/**
 * Modules reachable from `entryPoint`, as repository-relative paths.
 * The entry point itself is included.
 */
export function findReachableModules(entryPoint: string = PRODUCTION_ENTRY_POINT): Set<string> {
  const visited = new Set<string>([entryPoint]);
  const pending = [entryPoint];

  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const specifier of collectSpecifiers(current)) {
      const target = resolveSpecifier(current, specifier);
      if (target !== null && !visited.has(target)) {
        visited.add(target);
        pending.push(target);
      }
    }
  }

  return new Set([...visited].map(toRepoRelative));
}

/** Modules under `src/` that the production entry point cannot reach. */
export function findUnreachableModules(): string[] {
  const reachable = findReachableModules();
  return listAllSourceModules().filter(module => !reachable.has(module));
}
