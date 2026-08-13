import {
  AntigravityApplicationContextFactory,
  type AntigravityApplicationContextFactoryOptions,
  type AntigravityWorkspaceInitializer,
} from '@/providers/antigravity/app/AntigravityApplicationContextFactory';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';
import type { ClaudeApplicationContextFactoryOptions } from '@/providers/claude/app/ClaudeApplicationContextFactory';
import { ClaudeApplicationContextFactory } from '@/providers/claude/app/ClaudeApplicationContextFactory';
import type { CodexApplicationContextFactoryOptions } from '@/providers/codex/app/CodexApplicationContextFactory';
import { CodexApplicationContextFactory } from '@/providers/codex/app/CodexApplicationContextFactory';
import type { GeminiApplicationContextFactoryOptions } from '@/providers/gemini/app/GeminiApplicationContextFactory';
import { GeminiApplicationContextFactory } from '@/providers/gemini/app/GeminiApplicationContextFactory';
import type { GrokApplicationContextFactoryOptions } from '@/providers/grok/app/GrokApplicationContextFactory';
import { GrokApplicationContextFactory } from '@/providers/grok/app/GrokApplicationContextFactory';
import type { KimicodeApplicationContextFactoryOptions } from '@/providers/kimicode/app/KimicodeApplicationContextFactory';
import { KimicodeApplicationContextFactory } from '@/providers/kimicode/app/KimicodeApplicationContextFactory';
import type { MimocodeApplicationContextFactoryOptions } from '@/providers/mimocode/app/MimocodeApplicationContextFactory';
import { MimocodeApplicationContextFactory } from '@/providers/mimocode/app/MimocodeApplicationContextFactory';
import type { OpencodeApplicationContextFactoryOptions } from '@/providers/opencode/app/OpencodeApplicationContextFactory';
import { OpencodeApplicationContextFactory } from '@/providers/opencode/app/OpencodeApplicationContextFactory';
import type { QwenApplicationContextFactoryOptions } from '@/providers/qwen/app/QwenApplicationContextFactory';
import { QwenApplicationContextFactory } from '@/providers/qwen/app/QwenApplicationContextFactory';

import type { DurableStorage } from '../../core/persistence/DurableStorage';
import type { Sha256DigestPort } from '../../core/providers/ProviderSettingsFingerprint';
import { ApplicationExecutionRequestBroker } from './ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from './ApplicationIdentityFactory';
import { DurableExecutionResultStore } from './DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from './EphemeralExecutionRequestStore';
import {
  type ExecutionInteractionPresentationPort,
  ExecutionInteractionPresentationStore,
} from './ExecutionInteractionPresentationStore';
import {
  type ProviderApplicationContextFactory,
  ProviderApplicationContextRegistry,
} from './ProviderApplicationContextRegistry';

export interface ProviderApplicationContextPrimitives {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: ApplicationIdentityFactory;
  readonly presentations: ExecutionInteractionPresentationPort;
}

export interface ProviderApplicationContextOverrides {
  readonly antigravity?: Partial<AntigravityApplicationContextFactoryOptions>;
  readonly codex?: Partial<Omit<CodexApplicationContextFactoryOptions, keyof ProviderApplicationContextPrimitives>>;
  readonly claude?: Partial<Omit<ClaudeApplicationContextFactoryOptions, keyof ProviderApplicationContextPrimitives>>;
  readonly opencode?: Partial<Omit<OpencodeApplicationContextFactoryOptions, keyof ProviderApplicationContextPrimitives>>;
  readonly mimocode?: Partial<Omit<MimocodeApplicationContextFactoryOptions, keyof ProviderApplicationContextPrimitives>>;
  readonly kimicode?: Partial<Omit<KimicodeApplicationContextFactoryOptions, keyof ProviderApplicationContextPrimitives>>;
  readonly grok?: Partial<Omit<GrokApplicationContextFactoryOptions, keyof ProviderApplicationContextPrimitives>>;
  readonly qwen?: Partial<Omit<QwenApplicationContextFactoryOptions, keyof ProviderApplicationContextPrimitives>>;
  readonly gemini?: Partial<Omit<GeminiApplicationContextFactoryOptions, keyof ProviderApplicationContextPrimitives>>;
}

export interface ProviderApplicationContextCompositionOptions {
  readonly storage: DurableStorage;
  readonly digest: Sha256DigestPort;
  readonly overrides?: ProviderApplicationContextOverrides;
}

/**
 * The sole production composition of the nine provider application context
 * factories. Application startup constructs this once; `main.ts` never
 * branches on provider identity.
 */
export class ProviderApplicationContextComposition {
  readonly primitives: ProviderApplicationContextPrimitives;
  readonly registry: ProviderApplicationContextRegistry;
  readonly presentationStore: ExecutionInteractionPresentationStore;

  constructor(options: ProviderApplicationContextCompositionOptions) {
    const identities = new ApplicationIdentityFactory();
    const requestStore = new EphemeralExecutionRequestStore();
    const requests = new ApplicationExecutionRequestBroker(requestStore, identities);
    const results = new DurableExecutionResultStore(options.storage, options.digest);
    const presentations = new ExecutionInteractionPresentationStore(options.storage, options.digest);
    this.presentationStore = presentations;
    this.primitives = Object.freeze({ requests, results, identities, presentations });

    const overrides = options.overrides ?? {};
    const factories = createFactories(this.primitives, overrides);
    this.registry = new ProviderApplicationContextRegistry(
      builtInProviderCatalog,
      factories,
    );
  }
}

function createFactories(
  primitives: ProviderApplicationContextPrimitives,
  overrides: ProviderApplicationContextOverrides,
): readonly ProviderApplicationContextFactory[] {
  return Object.freeze([
    new AntigravityApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      workspace: overrides.antigravity?.workspace ?? noWorkspace,
      ...(overrides.antigravity?.processTransport ? { processTransport: overrides.antigravity.processTransport } : {}),
      ...(overrides.antigravity?.scheduler ? { scheduler: overrides.antigravity.scheduler } : {}),
    }),
    new CodexApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      presentations: primitives.presentations,
      workspace: overrides.codex?.workspace ?? noWorkspace,
      processFactory: overrides.codex?.processFactory ?? unreachableFactory('codex process'),
      defaultResumeParams: overrides.codex?.defaultResumeParams ?? {},
      ...(overrides.codex?.transcript ? { transcript: overrides.codex.transcript } : {}),
      ...(overrides.codex?.scheduler ? { scheduler: overrides.codex.scheduler } : {}),
      ...(overrides.codex?.resultCommitTimeoutMs !== undefined
        ? { resultCommitTimeoutMs: overrides.codex.resultCommitTimeoutMs }
        : {}),
    }),
    new ClaudeApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      presentations: primitives.presentations,
      workspace: overrides.claude?.workspace ?? noWorkspace,
      queryFactory: overrides.claude?.queryFactory ?? unreachableFactory('claude query'),
      taskResultLoader: overrides.claude?.taskResultLoader ?? { load: async () => null },
      reconciler: overrides.claude?.reconciler ?? { reconcile: async () => ({ kind: 'unknown', effectsPossible: true }) },
      auxiliaryQueries: overrides.claude?.auxiliaryQueries ?? { execute: async () => '' },
      ...(overrides.claude?.scheduler ? { scheduler: overrides.claude.scheduler } : {}),
    }),
    new OpencodeApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      presentations: primitives.presentations,
      workspace: overrides.opencode?.workspace ?? noWorkspace,
      processLauncher: overrides.opencode?.processLauncher ?? unreachableLauncher(),
      reconciler: overrides.opencode?.reconciler ?? unreachableRecovery(),
      clientInfo: overrides.opencode?.clientInfo ?? { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: overrides.opencode?.resultCommitTimeoutMs ?? 2_000,
      recoveryTimeoutMs: overrides.opencode?.recoveryTimeoutMs ?? 2_000,
      runTimeoutMs: overrides.opencode?.runTimeoutMs ?? 60_000,
      maxResultBytes: overrides.opencode?.maxResultBytes ?? 1_048_576,
      ...(overrides.opencode?.auxiliaryTimeoutMs !== undefined
        ? { auxiliaryTimeoutMs: overrides.opencode.auxiliaryTimeoutMs }
        : {}),
      ...(overrides.opencode?.scheduler ? { scheduler: overrides.opencode.scheduler } : {}),
    }),
    new MimocodeApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      presentations: primitives.presentations,
      workspace: overrides.mimocode?.workspace ?? noWorkspace,
      processLauncher: overrides.mimocode?.processLauncher ?? unreachableLauncher(),
      reconciler: overrides.mimocode?.reconciler ?? unreachableRecovery(),
      clientInfo: overrides.mimocode?.clientInfo ?? { name: 'grimoire', version: '0.0.0' },
      emptyResultPolicy: overrides.mimocode?.emptyResultPolicy ?? { resolve: async () => ({ kind: 'no-provider-error' }) },
      resultCommitTimeoutMs: overrides.mimocode?.resultCommitTimeoutMs ?? 2_000,
      recoveryTimeoutMs: overrides.mimocode?.recoveryTimeoutMs ?? 2_000,
      runTimeoutMs: overrides.mimocode?.runTimeoutMs ?? 60_000,
      maxResultBytes: overrides.mimocode?.maxResultBytes ?? 1_048_576,
      ...(overrides.mimocode?.auxiliaryTimeoutMs !== undefined
        ? { auxiliaryTimeoutMs: overrides.mimocode.auxiliaryTimeoutMs }
        : {}),
      ...(overrides.mimocode?.scheduler ? { scheduler: overrides.mimocode.scheduler } : {}),
    }),
    new KimicodeApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      presentations: primitives.presentations,
      workspace: overrides.kimicode?.workspace ?? noWorkspace,
      processLauncher: overrides.kimicode?.processLauncher ?? unreachableLauncher(),
      reconciler: overrides.kimicode?.reconciler ?? unreachableRecovery(),
      clientInfo: overrides.kimicode?.clientInfo ?? { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: overrides.kimicode?.resultCommitTimeoutMs ?? 2_000,
      recoveryTimeoutMs: overrides.kimicode?.recoveryTimeoutMs ?? 2_000,
      runTimeoutMs: overrides.kimicode?.runTimeoutMs ?? 60_000,
      maxResultBytes: overrides.kimicode?.maxResultBytes ?? 1_048_576,
      ...(overrides.kimicode?.auxiliaryTimeoutMs !== undefined
        ? { auxiliaryTimeoutMs: overrides.kimicode.auxiliaryTimeoutMs }
        : {}),
      ...(overrides.kimicode?.scheduler ? { scheduler: overrides.kimicode.scheduler } : {}),
    }),
    new GrokApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      presentations: primitives.presentations,
      workspace: overrides.grok?.workspace ?? noWorkspace,
      processLauncher: overrides.grok?.processLauncher ?? unreachableLauncher(),
      reconciler: overrides.grok?.reconciler ?? unreachableRecovery(),
      usage: overrides.grok?.usage ?? unreachableUsage(),
      clientInfo: overrides.grok?.clientInfo ?? { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: overrides.grok?.resultCommitTimeoutMs ?? 2_000,
      recoveryTimeoutMs: overrides.grok?.recoveryTimeoutMs ?? 2_000,
      runTimeoutMs: overrides.grok?.runTimeoutMs ?? 60_000,
      maxResultBytes: overrides.grok?.maxResultBytes ?? 1_048_576,
      ...(overrides.grok?.auxiliaryTimeoutMs !== undefined
        ? { auxiliaryTimeoutMs: overrides.grok.auxiliaryTimeoutMs }
        : {}),
      ...(overrides.grok?.scheduler ? { scheduler: overrides.grok.scheduler } : {}),
    }),
    new QwenApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      presentations: primitives.presentations,
      workspace: overrides.qwen?.workspace ?? noWorkspace,
      processLauncher: overrides.qwen?.processLauncher ?? unreachableLauncher(),
      reconciler: overrides.qwen?.reconciler ?? unreachableRecovery(),
      commands: overrides.qwen?.commands ?? { replace: () => undefined, clear: () => undefined },
      usage: overrides.qwen?.usage ?? unreachableUsage(),
      clientInfo: overrides.qwen?.clientInfo ?? { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: overrides.qwen?.resultCommitTimeoutMs ?? 2_000,
      recoveryTimeoutMs: overrides.qwen?.recoveryTimeoutMs ?? 2_000,
      runTimeoutMs: overrides.qwen?.runTimeoutMs ?? 60_000,
      maxResultBytes: overrides.qwen?.maxResultBytes ?? 1_048_576,
      ...(overrides.qwen?.scheduler ? { scheduler: overrides.qwen.scheduler } : {}),
    }),
    new GeminiApplicationContextFactory({
      requests: primitives.requests,
      results: primitives.results,
      identities: primitives.identities,
      presentations: primitives.presentations,
      workspace: overrides.gemini?.workspace ?? noWorkspace,
      processLauncher: overrides.gemini?.processLauncher ?? unreachableLauncher(),
      reconciler: overrides.gemini?.reconciler ?? unreachableRecovery(),
      historyReplay: overrides.gemini?.historyReplay ?? {
        begin: async () => undefined,
        observe: () => false,
        settle: async () => undefined,
        clear: () => undefined,
      },
      usage: overrides.gemini?.usage ?? unreachableUsage(),
      clientInfo: overrides.gemini?.clientInfo ?? { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: overrides.gemini?.resultCommitTimeoutMs ?? 2_000,
      recoveryTimeoutMs: overrides.gemini?.recoveryTimeoutMs ?? 2_000,
      runTimeoutMs: overrides.gemini?.runTimeoutMs ?? 60_000,
      maxResultBytes: overrides.gemini?.maxResultBytes ?? 1_048_576,
      ...(overrides.gemini?.scheduler ? { scheduler: overrides.gemini.scheduler } : {}),
    }),
  ]);
}

const noWorkspace: AntigravityWorkspaceInitializer = {
  async initialize() {
    return { dispose: async () => undefined };
  },
};

function unreachableFactory(label: string): { create(): never } {
  return {
    create() {
      throw new Error(`Provider application context composition is missing the ${label} factory.`);
    },
  };
}

function unreachableLauncher() {
  return { async launch(): Promise<never> { throw new Error('Process launcher is not configured.'); } };
}

function unreachableRecovery() {
  return { async reconcile(): Promise<never> { throw new Error('Recovery port is not configured.'); } };
}

function unreachableUsage() {
  return {
    attach() { throw new Error('Usage port is not configured.'); },
    detach() { throw new Error('Usage port is not configured.'); },
    recordNotification() { throw new Error('Usage port is not configured.'); },
    async recordTurn() { throw new Error('Usage port is not configured.'); },
  };
}
