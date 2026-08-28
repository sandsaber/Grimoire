import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { auxiliaryPurposeKey } from '@/app/execution/auxiliaryPurpose';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { AuxiliaryPurpose } from '@/core/auxiliary/ProviderAuxiliarySource';
import { CodexExecution } from '@/providers/codex/execution/CodexExecutionComposition';
import { GrokExecution } from '@/providers/grok/execution/GrokExecutionComposition';
import { KimicodeExecution } from '@/providers/kimicode/execution/KimicodeExecutionComposition';
import { MimocodeExecution } from '@/providers/mimocode/execution/MimocodeExecutionComposition';
import { OpencodeExecution } from '@/providers/opencode/execution/OpencodeExecutionComposition';

/**
 * What each composition contributes to auxiliary work.
 *
 * This replaces five near-identical files that each asserted the same three
 * things about the same shared services — one runner per service, a new one per
 * title, nothing built until something is asked — through a different
 * provider's constructor. Those properties belong to the owner and the
 * `QueryBacked*` services, and are asserted once where they live.
 *
 * **What is genuinely per provider is the pair below**: which of the provider's
 * own auxiliary conversations a purpose maps to, and whether the configured
 * title model is one this provider owns. Both were invisible to a reader of the
 * old three-line constructors, and both decide which process a turn runs on.
 */

interface CompositionUnderTest {
  readonly build: (plugin: never, registry: never) => {
    auxiliarySource(): { createRunner(purpose: AuxiliaryPurpose): unknown };
    createAuxRunner(purpose: never): unknown;
  };
  readonly ownedTitleModel: string;
  readonly providerId: string;
}

const COMPOSITIONS: readonly CompositionUnderTest[] = [
  { build: (p, r) => new CodexExecution(p, r), ownedTitleModel: 'gpt-5-codex', providerId: 'codex' },
  { build: (p, r) => new GrokExecution(p, r), ownedTitleModel: '', providerId: 'grok' },
  { build: (p, r) => new KimicodeExecution(p, r), ownedTitleModel: '', providerId: 'kimicode' },
  { build: (p, r) => new MimocodeExecution(p, r), ownedTitleModel: '', providerId: 'mimocode' },
  { build: (p, r) => new OpencodeExecution(p, r), ownedTitleModel: '', providerId: 'opencode' },
];

function createPlugin(settings: Record<string, unknown> = {}): never {
  return {
    app: { vault: { adapter: { basePath: '/test/vault' } } },
    getActiveEnvironmentVariables: () => '',
    getResolvedProviderCliPath: () => '/fake/cli',
    recordDebugLog: () => undefined,
    settings: { titleGenerationModel: '', ...settings },
  } as never;
}

describe('provider auxiliary sources', () => {
  it.each(COMPOSITIONS.map(c => [c.providerId, c] as const))(
    '%s maps every purpose onto its own auxiliary conversation',
    (_providerId, composition) => {
      const host = new ExecutionKernelHost({ storage: new TestDurableStorage() });
      const execution = composition.build(createPlugin(), host.registry as never);
      const asked: string[] = [];
      jest.spyOn(execution, 'createAuxRunner').mockImplementation(((purpose: string) => {
        asked.push(purpose);
        return { query: async () => '', reset: () => undefined };
      }));

      const source = execution.auxiliarySource();
      source.createRunner('inline-edit');
      source.createRunner('instruction-refine');
      source.createRunner('title');

      // A purpose is the retention key the provider holds its auxiliary
      // conversation under. Getting it wrong sends a refinement to the thread an
      // inline edit is holding, which no assertion about the answer would catch.
      expect(asked).toEqual(['inline', 'instructions', 'title-gen']);
    },
  );

  it('offers no title model when the configured one belongs to another provider', () => {
    const host = new ExecutionKernelHost({ storage: new TestDurableStorage() });
    const execution = new CodexExecution(
      createPlugin({ titleGenerationModel: 'claude-sonnet-4-5' }),
      host.registry,
    );

    // The provider is chosen from the model, so this is the fallback path: a
    // provider asked for a title it does not own must let the provider pick its
    // own model rather than be handed a foreign id.
    expect(execution.auxiliarySource().resolveTitleModel?.()).toBeUndefined();
  });

  it('offers the configured title model when this provider owns it', () => {
    const host = new ExecutionKernelHost({ storage: new TestDurableStorage() });
    const execution = new CodexExecution(
      createPlugin({ titleGenerationModel: 'gpt-5-codex' }),
      host.registry,
    );

    expect(execution.auxiliarySource().resolveTitleModel?.()).toBe('gpt-5-codex');
  });
});

describe('auxiliaryPurposeKey', () => {
  it('answers for every purpose, so a new one cannot be silently dropped', () => {
    expect(auxiliaryPurposeKey('inline-edit')).toBe('inline');
    expect(auxiliaryPurposeKey('instruction-refine')).toBe('instructions');
    expect(auxiliaryPurposeKey('title')).toBe('title-gen');
  });
});
