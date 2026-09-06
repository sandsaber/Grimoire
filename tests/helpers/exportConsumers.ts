import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { listAllSourceModules } from '@test/helpers/moduleReachability';
import ts from 'typescript';

/**
 * Which exported symbols production code actually uses.
 *
 * The reachability walker beside this one answers about whole modules, and the
 * defect it cannot see is the one the `main` sync produced three times: a module
 * every gate calls reachable, exporting a symbol nothing calls. `isAcpSessionGone`
 * lived in a module imported for a different function; `readGrokAcpModelThinkingOptions`
 * and `claudeTaskPlanState` had full unit suites and no caller. Module tests pass
 * either way, which is what made all three invisible.
 *
 * A consumer in `tests/` does not count. That is the whole point: a symbol whose
 * only callers are its own tests is a symbol nothing ships.
 *
 * Known blind spots, both of which cause false *negatives* rather than failures:
 * consumption is matched by name within a resolved module, so two modules
 * exporting the same name hide each other; and a namespace import marks every
 * export of its target used, because nothing here can say which member was
 * reached through it.
 */

export interface ExportConsumerOptions {
  /** Directory scanned for modules. Defaults to `<cwd>/src`. */
  sourceRoot?: string;
  /** Directory reported paths are relative to. Defaults to the process cwd. */
  baseDir?: string;
}

export interface UnconsumedExport {
  /** Module path, relative to `baseDir`, POSIX-separated. */
  readonly module: string;
  /** The exported name. `default` for a default export. */
  readonly name: string;
}

interface ModuleFacts {
  /** Names this module declares as exported. */
  readonly exports: Set<string>;
  /** Modules this one re-exports wholesale, as resolved paths. */
  readonly starReExports: Set<string>;
  /** Whether anything imports this module as a namespace, or star-exports it. */
  wholeModuleUsed: boolean;
  /** Names some other module imports from this one. */
  readonly consumed: Set<string>;
}

function parse(absolutePath: string): ts.SourceFile {
  return ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
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
    return null;
  }
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function declaredExportNames(node: ts.Node): string[] {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
  const exported = modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) {
    return [];
  }
  if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
    return ['default'];
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.flatMap(declaration => (
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
    ));
  }
  if (
    (ts.isFunctionDeclaration(node)
      || ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isEnumDeclaration(node)
      || ts.isModuleDeclaration(node))
    && node.name
    && ts.isIdentifier(node.name)
  ) {
    return [node.name.text];
  }
  return [];
}

/** Every module's exports and the names other production modules take from it. */
function collectFacts(sourceRoot: string, baseDir: string): Map<string, ModuleFacts> {
  const modules = listAllSourceModules({ sourceRoot, baseDir })
    .map(relativePath => resolve(baseDir, relativePath));
  const facts = new Map<string, ModuleFacts>();
  const factsFor = (absolutePath: string): ModuleFacts => {
    let entry = facts.get(absolutePath);
    if (!entry) {
      entry = {
        exports: new Set(),
        starReExports: new Set(),
        wholeModuleUsed: false,
        consumed: new Set(),
      };
      facts.set(absolutePath, entry);
    }
    return entry;
  };

  for (const absolutePath of modules) {
    const source = parse(absolutePath);
    const self = factsFor(absolutePath);

    const visit = (node: ts.Node): void => {
      for (const name of declaredExportNames(node)) {
        self.exports.add(name);
      }

      if (ts.isExportAssignment(node)) {
        self.exports.add('default');
      }

      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const target = resolveSpecifier(sourceRoot, absolutePath, node.moduleSpecifier.text);
        const clause = node.importClause;
        if (target && clause) {
          const targetFacts = factsFor(target);
          if (clause.name) targetFacts.consumed.add('default');
          const bindings = clause.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings)) {
            targetFacts.wholeModuleUsed = true;
          } else if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              targetFacts.consumed.add((element.propertyName ?? element.name).text);
            }
          }
        }
      }

      if (ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        const target = specifier && ts.isStringLiteralLike(specifier)
          ? resolveSpecifier(sourceRoot, absolutePath, specifier.text)
          : null;
        const clause = node.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            // `export { a as b } from './x'` takes `a` from x and offers `b`.
            self.exports.add(element.name.text);
            if (target) factsFor(target).consumed.add((element.propertyName ?? element.name).text);
          }
        } else if (target) {
          // `export * from './x'`: what x offers, this module offers, so
          // consumption has to be decided at this module's own consumers.
          self.starReExports.add(target);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
    for (const name of localReferences(source)) {
      if (self.exports.has(name)) self.consumed.add(name);
    }
  }

  return facts;
}

/**
 * Names the module refers to in its own body.
 *
 * An export used where it is declared is not the defect this looks for: it is
 * live code that also happens to be exported, usually so a test can reach it.
 * The defect is a symbol nothing outside its own tests ever names — which is
 * what the three the `main` sync produced had in common.
 *
 * Declaration names, and the specifier lists of imports and exports, are not
 * references: counting them would make every export look used by itself.
 */
function localReferences(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isDeclarationName(node) && !isModuleBindingName(node)) {
      names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return names;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node & { name?: ts.Node };
  return parent?.name === node;
}

function isModuleBindingName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return ts.isImportSpecifier(parent)
    || ts.isExportSpecifier(parent)
    || ts.isImportClause(parent)
    || ts.isNamespaceImport(parent)
    || ts.isPropertyAccessExpression(parent) && parent.name === node
    || ts.isPropertyAssignment(parent) && parent.name === node;
}

/**
 * Pushes each barrel's consumption down onto what it re-exports.
 *
 * A name taken from a barrel is a name taken from whichever module behind it
 * declares it, and a barrel imported as a namespace uses all of them.
 */
function propagateThroughBarrels(facts: Map<string, ModuleFacts>): void {
  // Bounded by the number of modules: each pass can only add, and a chain of
  // barrels is at most that deep.
  for (let pass = 0; pass < facts.size; pass += 1) {
    let changed = false;
    for (const entry of facts.values()) {
      for (const target of entry.starReExports) {
        const targetFacts = facts.get(target);
        if (!targetFacts) continue;
        if (entry.wholeModuleUsed && !targetFacts.wholeModuleUsed) {
          targetFacts.wholeModuleUsed = true;
          changed = true;
        }
        for (const name of entry.consumed) {
          if (!targetFacts.consumed.has(name)) {
            targetFacts.consumed.add(name);
            changed = true;
          }
        }
      }
    }
    if (!changed) return;
  }
}

/**
 * Exports no other production module takes, sorted by module then name.
 *
 * The production entry point is excluded: nothing in `src/` imports it, and its
 * default export is what Obsidian loads.
 */
export function listUnconsumedExports(options: ExportConsumerOptions = {}): UnconsumedExport[] {
  const baseDir = options.baseDir ?? process.cwd();
  const sourceRoot = options.sourceRoot ?? resolve(baseDir, 'src');
  const entryPoint = join(sourceRoot, 'main.ts');
  const facts = collectFacts(sourceRoot, baseDir);
  propagateThroughBarrels(facts);

  const unconsumed: UnconsumedExport[] = [];
  for (const [absolutePath, entry] of facts) {
    if (absolutePath === entryPoint || entry.wholeModuleUsed) continue;
    for (const name of entry.exports) {
      if (!entry.consumed.has(name)) {
        unconsumed.push({
          module: absolutePath.slice(baseDir.length + 1).split('\\').join('/'),
          name,
        });
      }
    }
  }

  return unconsumed.sort((left, right) => (
    left.module === right.module
      ? left.name.localeCompare(right.name)
      : left.module.localeCompare(right.module)
  ));
}
