import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';

const sourceRoot = resolve(process.cwd(), 'src');

describe('chat execution projection boundaries', () => {
  it('keeps the attachment adapter free of execution resource authority', () => {
    const path = join(
      sourceRoot,
      'features/chat/application/ChatProjectionAttachment.ts',
    );
    const parsed = parse(path);
    const forbiddenCalls = new Set([
      'acquireLease',
      'cancelRun',
      'createSession',
      'disposeSession',
      'resolveInteraction',
      'startRun',
    ]);
    const calls: string[] = [];
    visit(parsed, node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && forbiddenCalls.has(node.expression.name.text)) {
        calls.push(node.expression.name.text);
      }
    });

    expect(calls).toEqual([]);
    expect(imports(parsed)).toEqual(['../projections/ChatProjection']);
  });

  it('keeps projections independent from providers, Obsidian, and DOM rendering', () => {
    const paths = [
      'features/chat/projections/AgentProjection.ts',
      'features/chat/projections/ChatProjection.ts',
      'features/chat/rendering/AgentWorkCard.ts',
      'features/chat/rendering/ChatProjectionRenderer.ts',
    ];
    const forbiddenIdentifiers = new Set([
      'document',
      'HTMLElement',
      'MutationObserver',
      'window',
    ]);
    const identifiers = new Set<string>();
    const specifiers: string[] = [];
    for (const relativePath of paths) {
      const parsed = parse(join(sourceRoot, relativePath));
      visit(parsed, node => {
        if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text)) {
          identifiers.add(node.text);
        }
      });
      specifiers.push(...imports(parsed));
    }

    expect([...identifiers]).toEqual([]);
    expect(specifiers.filter(specifier => (
      specifier === 'obsidian'
      || specifier.includes('/providers/')
      || specifier.includes('LegacyProviderContext')
    ))).toEqual([]);
  });

  it('keeps the parallel application path provider-neutral and process-free', () => {
    const paths = [
      'features/chat/application/AgentProjectionCoordinator.ts',
      'features/chat/application/AgentWorkCommandAdapter.ts',
      'features/chat/application/ChatExecutionCoordinator.ts',
      'features/chat/application/ChatInputCommandAdapter.ts',
      'features/chat/application/ChatProjectionAttachment.ts',
    ];
    const violations = paths.flatMap(relativePath => {
      const parsed = parse(join(sourceRoot, relativePath));
      return imports(parsed)
        .filter(specifier => (
          specifier === 'obsidian'
          || specifier === 'child_process'
          || specifier === 'node:child_process'
          || specifier.includes('/providers/')
          || specifier.includes('LegacyProviderContext')
        ))
        .map(specifier => `${relativePath} -> ${specifier}`);
    });

    expect(violations).toEqual([]);
  });
});

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function imports(source: ts.SourceFile): string[] {
  return source.statements.flatMap(statement => (
    ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : []
  ));
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}
