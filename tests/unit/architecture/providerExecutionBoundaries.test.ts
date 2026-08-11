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

function findProviderBoundaryContractFields(files: SourceFile[]): string[] {
  const rootContracts: string[] = [
    'CancellationReason',
    'CausalDeliveryPosition',
    'ExecutionBackend',
    'ExecutionBackendDescriptor',
    'ExecutionBackendFactory',
    'ExecutionEvent',
    'ExecutionEventScope',
    'ExecutionOwner',
    'ExecutionRecoveryPort',
    'ExecutionRequest',
    'ExecutionRun',
    'ExecutionSession',
    'ExecutionSessionConfig',
    'ExecutionSessionSnapshot',
    'InteractionPort',
    'InteractionRequest',
    'InteractionResolution',
    'ProviderExecutionEvent',
    'ResultRef',
    'RunRecoveryEvidence',
    'RunRecoveryQuery',
    'RunTerminal',
  ];
  type ContractDeclaration = ts.InterfaceDeclaration
    | ts.TypeAliasDeclaration
    | ts.ClassDeclaration;
  const declarations = new Map<string, ContractDeclaration>();
  const fields = new Set<string>();
  const boundarySourcePaths = new Set([
    'core/execution/ExecutionBackendDescriptor.ts',
    'core/execution/ExecutionContracts.ts',
    'core/execution/ExecutionEvents.ts',
    'core/execution/ExecutionIds.ts',
  ]);
  for (const file of files) {
    const parsed = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const statement of parsed.statements) {
      if ((ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
        || ts.isClassDeclaration(statement)) && statement.name) {
        const contractName = statement.name.text;
        declarations.set(contractName, statement);
        const exported = statement.modifiers?.some(
          modifier => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) ?? false;
        if (exported && boundarySourcePaths.has(relative(sourceRoot, file.path))) {
          fields.add(`ContractSurface.${contractName}`);
          if (isObjectContract(statement)) rootContracts.push(contractName);
        }
      }
    }
  }

  const visited = new Set<string>();
  const pending = [...rootContracts];
  while (pending.length > 0) {
    const contractName = pending.shift() as string;
    if (visited.has(contractName)) continue;
    const declaration = declarations.get(contractName);
    if (!declaration || !isObjectContract(declaration)) continue;
    visited.add(contractName);

    function visit(node: ts.Node, operationName?: string): void {
      if (ts.isFunctionTypeNode(node)) {
        fields.add(`${contractName}.<call>`);
        ts.forEachChild(node, child => visit(child, '<call>'));
        return;
      }
      if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
        const name = node.name && (
          ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
        ) ? node.name.text : '<computed>';
        fields.add(`${contractName}.${name}`);
      }
      if (ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) {
        const name = node.name && (
          ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
        ) ? node.name.text : '<computed>';
        fields.add(`${contractName}.${name}`);
        ts.forEachChild(node, child => visit(child, name));
        return;
      }
      if (ts.isConstructorDeclaration(node)) {
        fields.add(`${contractName}.constructor`);
        ts.forEachChild(node, child => visit(child, 'constructor'));
        return;
      }
      if (ts.isParameter(node)) {
        const name = ts.isIdentifier(node.name) ? node.name.text : '<pattern>';
        fields.add(`${contractName}.${operationName ?? '<call>'}.${name}`);
      }
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const referenced = declarations.get(node.typeName.text);
        if (referenced && isObjectContract(referenced) && !visited.has(node.typeName.text)) {
          pending.push(node.typeName.text);
        }
      }
      ts.forEachChild(node, child => visit(child, operationName));
    }
    visit(declaration);
  }
  return [...fields];
}

function isObjectContract(
  declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration,
): boolean {
  if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) return true;
  const type = declaration.type;
  if (ts.isTypeLiteralNode(type) || ts.isFunctionTypeNode(type)) return true;
  if (ts.isIntersectionTypeNode(type)) {
    return type.types.some(member => ts.isTypeLiteralNode(member));
  }
  return ts.isUnionTypeNode(type) && type.types.some(member => ts.isTypeLiteralNode(member));
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

  it('requires explicit review for every provider-facing execution contract field', () => {
    const executionSources = readTypeScriptSources(join(sourceRoot, 'core/execution'));

    expect(findProviderBoundaryContractFields(executionSources).sort()).toEqual([
      'CancellationReason.code',
      'CausalDeliveryPosition.sequence',
      'CausalDeliveryPosition.streamId',
      'ContractSurface.CancellationReason',
      'ContractSurface.CausalDeliveryPosition',
      'ContractSurface.ExecutionBackend',
      'ContractSurface.ExecutionBackendDescriptor',
      'ContractSurface.ExecutionBackendFactory',
      'ContractSurface.ExecutionBackendId',
      'ContractSurface.ExecutionDispatchError',
      'ContractSurface.ExecutionEvent',
      'ContractSurface.ExecutionEventEnvelope',
      'ContractSurface.ExecutionEventScope',
      'ContractSurface.ExecutionGapDiagnostic',
      'ContractSurface.ExecutionIngressEventListener',
      'ContractSurface.ExecutionOwner',
      'ContractSurface.ExecutionOwnerKind',
      'ContractSurface.ExecutionRecoveryPort',
      'ContractSurface.ExecutionRequest',
      'ContractSurface.ExecutionRun',
      'ContractSurface.ExecutionSession',
      'ContractSurface.ExecutionSessionConfig',
      'ContractSurface.ExecutionSessionId',
      'ContractSurface.ExecutionSessionSnapshot',
      'ContractSurface.InteractionId',
      'ContractSurface.InteractionPort',
      'ContractSurface.InteractionRequest',
      'ContractSurface.InteractionResolution',
      'ContractSurface.InternalExecutionServiceId',
      'ContractSurface.LifecycleLeaseId',
      'ContractSurface.ProviderExecutionEvent',
      'ContractSurface.ResultExpectation',
      'ContractSurface.ResultRef',
      'ContractSurface.RunId',
      'ContractSurface.RunNonTerminalState',
      'ContractSurface.RunRecoveryEvidence',
      'ContractSurface.RunRecoveryQuery',
      'ContractSurface.RunState',
      'ContractSurface.RunTerminal',
      'ContractSurface.RunTerminalKind',
      'ContractSurface.RunTerminalReason',
      'ContractSurface.SessionInstanceId',
      'ContractSurface.Unsubscribe',
      'ExecutionBackend.createSession',
      'ExecutionBackend.createSession.config',
      'ExecutionBackend.descriptor',
      'ExecutionBackend.dispose',
      'ExecutionBackendDescriptor.association',
      'ExecutionBackendDescriptor.backendId',
      'ExecutionBackendDescriptor.kind',
      'ExecutionBackendDescriptor.providerId',
      'ExecutionBackendDescriptor.service',
      'ExecutionBackendFactory.create',
      'ExecutionBackendFactory.create.context',
      'ExecutionBackendFactory.descriptor',
      'ExecutionBackendId.<computed>',
      'ExecutionDispatchError.constructor',
      'ExecutionDispatchError.constructor.message',
      'ExecutionDispatchError.constructor.sideEffectFree',
      'ExecutionEvent.activity',
      'ExecutionEvent.completed',
      'ExecutionEvent.interaction',
      'ExecutionEvent.interactionId',
      'ExecutionEvent.kind',
      'ExecutionEvent.nativeAgentKey',
      'ExecutionEvent.parentNativeAgentKey',
      'ExecutionEvent.progressId',
      'ExecutionEvent.reason',
      'ExecutionEvent.responseId',
      'ExecutionEvent.result',
      'ExecutionEvent.sideEffectFree',
      'ExecutionEvent.state',
      'ExecutionEvent.status',
      'ExecutionEvent.terminal',
      'ExecutionEvent.toolCallId',
      'ExecutionEvent.total',
      'ExecutionEventEnvelope.backendGeneration',
      'ExecutionEventEnvelope.backendId',
      'ExecutionEventEnvelope.event',
      'ExecutionEventEnvelope.eventId',
      'ExecutionEventEnvelope.executionSessionId',
      'ExecutionEventEnvelope.occurredAt',
      'ExecutionEventEnvelope.schemaVersion',
      'ExecutionEventEnvelope.scope',
      'ExecutionEventEnvelope.sequence',
      'ExecutionEventEnvelope.sessionInstanceId',
      'ExecutionEventScope.agentInstanceId',
      'ExecutionEventScope.agentRunId',
      'ExecutionEventScope.kind',
      'ExecutionEventScope.nativeRunRef',
      'ExecutionEventScope.runId',
      'ExecutionGapDiagnostic.affectedRunIds',
      'ExecutionGapDiagnostic.expectedCausalSequence',
      'ExecutionGapDiagnostic.firstObservedCausalSequence',
      'ExecutionGapDiagnostic.streamId',
      'ExecutionIngressEventListener.<call>',
      'ExecutionIngressEventListener.<call>.event',
      'ExecutionOwner.kind',
      'ExecutionOwner.ownerId',
      'ExecutionRecoveryPort.reconcile',
      'ExecutionRecoveryPort.reconcile.query',
      'ExecutionRequest.owner',
      'ExecutionRequest.requestRef',
      'ExecutionRequest.resultExpectation',
      'ExecutionRequest.runId',
      'ExecutionRun.cancel',
      'ExecutionRun.cancel.reason',
      'ExecutionRun.events',
      'ExecutionRun.runId',
      'ExecutionSession.createRun',
      'ExecutionSession.createRun.request',
      'ExecutionSession.dispose',
      'ExecutionSession.executionSessionId',
      'ExecutionSession.getSnapshot',
      'ExecutionSession.sessionInstanceId',
      'ExecutionSession.subscribe',
      'ExecutionSession.subscribe.listener',
      'ExecutionSessionConfig.backendGeneration',
      'ExecutionSessionConfig.executionSessionId',
      'ExecutionSessionConfig.nativeSessionRef',
      'ExecutionSessionConfig.owner',
      'ExecutionSessionId.<computed>',
      'ExecutionSessionSnapshot.executionSessionId',
      'ExecutionSessionSnapshot.nativeSessionRef',
      'ExecutionSessionSnapshot.sessionInstanceId',
      'InteractionId.<computed>',
      'InteractionPort.cancel',
      'InteractionPort.cancel.interactionId',
      'InteractionPort.resolve',
      'InteractionPort.resolve.resolution',
      'InteractionRequest.expiresAt',
      'InteractionRequest.interactionId',
      'InteractionRequest.kind',
      'InteractionRequest.presentationRef',
      'InteractionRequest.responseIds',
      'InteractionRequest.runId',
      'InteractionResolution.interactionId',
      'InteractionResolution.resolvedAt',
      'InteractionResolution.responseId',
      'InternalExecutionServiceId.<computed>',
      'LifecycleLeaseId.<computed>',
      'ProviderExecutionEvent.backendGeneration',
      'ProviderExecutionEvent.backendId',
      'ProviderExecutionEvent.causal',
      'ProviderExecutionEvent.deliveryId',
      'ProviderExecutionEvent.event',
      'ProviderExecutionEvent.executionSessionId',
      'ProviderExecutionEvent.occurredAt',
      'ProviderExecutionEvent.scope',
      'ProviderExecutionEvent.sessionInstanceId',
      'ResultRef.digest',
      'ResultRef.resultId',
      'ResultRef.storage',
      'RunId.<computed>',
      'RunRecoveryEvidence.effectsPossible',
      'RunRecoveryEvidence.interactionId',
      'RunRecoveryEvidence.kind',
      'RunRecoveryEvidence.sessionInstanceId',
      'RunRecoveryEvidence.terminal',
      'RunRecoveryQuery.backendGeneration',
      'RunRecoveryQuery.backendId',
      'RunRecoveryQuery.cancellationRequested',
      'RunRecoveryQuery.executionSessionId',
      'RunRecoveryQuery.nativeRunRef',
      'RunRecoveryQuery.nativeSessionRef',
      'RunRecoveryQuery.resultExpectation',
      'RunRecoveryQuery.runId',
      'RunRecoveryQuery.sessionInstanceId',
      'RunTerminal.kind',
      'RunTerminal.occurredAt',
      'RunTerminal.reason',
      'RunTerminal.resultRef',
      'SessionInstanceId.<computed>',
      'Unsubscribe.<call>',
    ]);
  });

  it('detects an unreviewed field added to a provider-facing execution contract', () => {
    const fixtures: SourceFile[] = [
      {
        path: join(sourceRoot, 'core/execution/codex-scope.ts'),
        source: `export type ExecutionEventScope = {
          readonly kind: 'run';
          readonly runId: string;
          readonly turnId: string;
        };`,
      },
      {
        path: join(sourceRoot, 'core/execution/backend-signature.ts'),
        source: `export interface ExecutionBackend {
          createSession(turnId: string): Promise<void>;
        }`,
      },
      {
        path: join(sourceRoot, 'core/execution/ExecutionContracts.ts'),
        source: `export interface ProviderCursor {
          readonly codexThreadId: string;
        }
        export type ExecutionIngressEventListener = (
          event: string,
          turnId: string,
        ) => void;`,
      },
    ];

    expect(findProviderBoundaryContractFields(fixtures).sort()).toEqual([
      'ContractSurface.ExecutionIngressEventListener',
      'ContractSurface.ProviderCursor',
      'ExecutionBackend.createSession',
      'ExecutionBackend.createSession.turnId',
      'ExecutionEventScope.kind',
      'ExecutionEventScope.runId',
      'ExecutionEventScope.turnId',
      'ExecutionIngressEventListener.<call>',
      'ExecutionIngressEventListener.<call>.event',
      'ExecutionIngressEventListener.<call>.turnId',
      'ProviderCursor.codexThreadId',
    ]);
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
