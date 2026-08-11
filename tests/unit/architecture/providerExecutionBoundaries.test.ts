import { readdirSync,readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

interface SourceFile {
  path: string;
  source: string;
}

interface ImportReference {
  sourcePath: string;
  specifier: string;
}

const sourceRoot = resolve(process.cwd(), 'src');
const legacyContextPath = join(sourceRoot, 'core/providers/LegacyProviderContext.ts');
const legacyCoreAllowlist = new Set([
  join(sourceRoot, 'core/providers/ProviderRegistry.ts'),
  join(sourceRoot, 'core/providers/ProviderWorkspaceRegistry.ts'),
  join(sourceRoot, 'core/providers/types.ts'),
]);

function readTypeScriptSources(directory: string): SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return readTypeScriptSources(path);
    }
    return extname(entry.name) === '.ts'
      ? [{ path, source: readFileSync(path, 'utf8') }]
      : [];
  });
}

function collectImports(file: SourceFile): ImportReference[] {
  const parsed = ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const references: ImportReference[] = [];

  function addSpecifier(node: ts.Expression | undefined): void {
    if (node && ts.isStringLiteralLike(node)) {
      references.push({ sourcePath: file.path, specifier: node.text });
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addSpecifier(node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        addSpecifier(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return references;
}

function resolveImport(reference: ImportReference): string | null {
  if (reference.specifier.startsWith('@/')) {
    return resolve(sourceRoot, reference.specifier.slice(2));
  }
  if (reference.specifier.startsWith('.')) {
    return resolve(reference.sourcePath, '..', reference.specifier);
  }
  return null;
}

function isTargetCoreFile(path: string): boolean {
  return path.startsWith(join(sourceRoot, 'core/execution/'))
    || path.startsWith(join(sourceRoot, 'core/persistence/'))
    || path === join(sourceRoot, 'core/providers/ProviderModule.ts')
    || path === join(sourceRoot, 'core/providers/ProviderCatalog.ts');
}

function isProviderBackendFile(path: string): boolean {
  const sourcePath = relative(sourceRoot, path);
  return /^providers\/[^/]+\/execution\//.test(sourcePath)
    || /^providers\/[^/]+\/.*Backend\.ts$/.test(sourcePath);
}

function isAtOrBelow(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function withoutTypeScriptExtension(path: string): string {
  return path.replace(/\.(?:[cm]?ts|tsx)$/, '');
}

function findCoreBoundaryViolations(files: SourceFile[]): string[] {
  return files.flatMap(file => collectImports(file).flatMap(reference => {
    const target = resolveImport(reference);
    const normalizedTarget = target === null ? null : withoutTypeScriptExtension(target);
    const normalizedLegacyContext = withoutTypeScriptExtension(legacyContextPath);
    const isCoreFile = isAtOrBelow(file.path, join(sourceRoot, 'core'));
    const isProviderBackend = isProviderBackendFile(file.path);
    const forbiddenInternalTarget = isCoreFile && normalizedTarget !== null && (
      normalizedTarget === join(sourceRoot, 'main')
      || isAtOrBelow(normalizedTarget, join(sourceRoot, 'features'))
      || isAtOrBelow(normalizedTarget, join(sourceRoot, 'shared'))
      || isAtOrBelow(normalizedTarget, join(sourceRoot, 'providers'))
    );
    const forbiddenTargetDependency = isTargetCoreFile(file.path) && (
      reference.specifier === 'obsidian'
      || normalizedTarget === normalizedLegacyContext
    );
    const forbiddenLegacyDependency = normalizedTarget === normalizedLegacyContext
      && (
        (isCoreFile && !legacyCoreAllowlist.has(file.path))
        || isProviderBackendFile(file.path)
      );
    const forbiddenProviderShellDependency = isProviderBackend && (
      reference.specifier === 'obsidian'
      || normalizedTarget === join(sourceRoot, 'main')
      || (normalizedTarget !== null && (
        isAtOrBelow(normalizedTarget, join(sourceRoot, 'features'))
        || isAtOrBelow(normalizedTarget, join(sourceRoot, 'shared'))
      ))
    );

    return forbiddenInternalTarget
      || forbiddenTargetDependency
      || forbiddenLegacyDependency
      || forbiddenProviderShellDependency
      ? [`${relative(sourceRoot, file.path)} -> ${reference.specifier}`]
      : [];
  }));
}

function findFeatureProcessImports(files: SourceFile[]): string[] {
  return files.flatMap(file => collectImports(file)
    .filter(reference => (
      reference.specifier === 'child_process'
      || reference.specifier === 'node:child_process'
    ))
    .map(() => relative(sourceRoot, file.path)));
}

function findCoreExecutionDomGlobals(files: SourceFile[]): string[] {
  const forbidden = new Set([
    'window',
    'document',
    'HTMLElement',
    'HTMLInputElement',
    'Element',
    'MutationObserver',
  ]);
  return files.flatMap(file => {
    const parsed = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const matches = new Set<string>();
    function visit(node: ts.Node): void {
      if (ts.isIdentifier(node) && forbidden.has(node.text)) {
        matches.add(node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    return [...matches].map(identifier => (
      `${relative(sourceRoot, file.path)} -> ${identifier}`
    ));
  });
}

describe('provider execution architecture boundaries', () => {
  it('keeps core independent from the plugin shell, features, and providers', () => {
    const coreSources = readTypeScriptSources(join(sourceRoot, 'core'));
    const providerBackends = readTypeScriptSources(join(sourceRoot, 'providers'))
      .filter(file => isProviderBackendFile(file.path));

    expect(findCoreBoundaryViolations([...coreSources, ...providerBackends])).toEqual([]);
  });

  it('detects forbidden relative, alias, dynamic, require, and legacy imports', () => {
    const fixtures: SourceFile[] = [
      {
        path: join(sourceRoot, 'core/example.ts'),
        source: "import value from '../providers/codex/value';",
      },
      {
        path: join(sourceRoot, 'core/example.ts'),
        source: "const plugin = require('@/main');",
      },
      {
        path: join(sourceRoot, 'core/example.ts'),
        source: "void import('@/features/chat/GrimoireView');",
      },
      {
        path: join(sourceRoot, 'core/execution/example.ts'),
        source: "import type { LegacyProviderContext } from '../providers/LegacyProviderContext';",
      },
      {
        path: join(sourceRoot, 'core/execution/example.ts'),
        source: "import type { App } from 'obsidian';",
      },
      {
        path: join(sourceRoot, 'providers/fake/execution/FakeBackend.ts'),
        source: "import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';",
      },
      {
        path: join(sourceRoot, 'providers/fake/execution/FakeBackend.ts'),
        source: "import { Notice } from 'obsidian';",
      },
      {
        path: join(sourceRoot, 'core/example.ts'),
        source: "export * from '@/providers';",
      },
    ];

    expect(findCoreBoundaryViolations(fixtures)).toHaveLength(fixtures.length);
  });

  it('prevents feature process launch from spreading beyond the legacy shell service', () => {
    const processImports = findFeatureProcessImports(
      readTypeScriptSources(join(sourceRoot, 'features')),
    );

    expect(processImports).toEqual([
      'features/chat/services/BangBashService.ts',
    ]);
  });

  it('keeps the execution kernel independent from DOM ownership', () => {
    const executionSources = readTypeScriptSources(join(sourceRoot, 'core/execution'));

    expect(findCoreExecutionDomGlobals(executionSources)).toEqual([]);
  });

  it('detects direct DOM ownership in the execution kernel', () => {
    const fixtures: SourceFile[] = [
      {
        path: join(sourceRoot, 'core/execution/window-owner.ts'),
        source: 'window.addEventListener("unload", () => undefined);',
      },
      {
        path: join(sourceRoot, 'core/execution/view-owner.ts'),
        source: 'const root: HTMLElement = document.body;',
      },
    ];

    expect(findCoreExecutionDomGlobals(fixtures)).toEqual([
      'core/execution/window-owner.ts -> window',
      'core/execution/view-owner.ts -> HTMLElement',
      'core/execution/view-owner.ts -> document',
    ]);
  });
});
