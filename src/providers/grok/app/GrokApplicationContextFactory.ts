import {
  clearTimeout as clearNodeTimeout,
  setTimeout as setNodeTimeout,
} from 'node:timers';

import type { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import type { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import type { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import type { ExecutionInteractionPresentationPort } from '@/app/runtime/ExecutionInteractionPresentationStore';
import type { ProviderApplicationContextFactory } from '@/app/runtime/ProviderApplicationContextRegistry';
import { createNativeScopedResultSink } from '@/app/runtime/ProviderExecutionResultAdapters';
import type { ExecutionRecoveryPort } from '@/core/execution/ExecutionContracts';
import type { ResultCommitScheduler } from '@/core/execution/ResultCommit';
import {
  AcpManagedClientAdapterFactory,
  type AcpManagedProcessLauncher,
} from '@/providers/acp/execution/AcpManagedClientAdapter';
import { type ManagedAcpAuxiliaryInvocation,ManagedAcpAuxiliaryQuery } from '@/providers/acp/execution/ManagedAcpAuxiliaryQuery';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpImplementation } from '@/providers/acp/types';

import {
  type GrokAcpDynamicConfig,
  GrokAcpDynamicConfigApplier,
  type GrokAcpDynamicConfigResolver,
} from '../execution/GrokAcpDynamicConfig';
import type {
  GrokAuxiliaryPort,
  GrokExecutionBackendContext,
  GrokExecutionDynamicApplier,
  GrokExecutionInvocation,
  GrokExecutionRequestResolver,
  GrokExecutionUsagePort,
  GrokInteractionBridge,
} from '../execution/GrokExecutionBackend';
import { GrokInteractionPresentationBridge } from '../execution/GrokInteractionPresentationBridge';
import type { GrokModuleWorkspace } from '../GrokProviderModule';

export const GROK_EXECUTION_REQUEST_KIND = 'grok-turn';
export const GROK_AUXILIARY_REQUEST_KIND = 'grok-auxiliary';
export const GROK_DYNAMIC_CONFIG_KIND = 'grok-dynamic-config';

export interface GrokWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<GrokModuleWorkspace>;
}

export interface GrokApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<
    ApplicationIdentityFactory,
    'nextSessionInstanceId' | 'nextInteractionId'
  >;
  readonly presentations: ExecutionInteractionPresentationPort;
  readonly workspace: GrokWorkspaceInitializer;
  readonly processLauncher: AcpManagedProcessLauncher;
  readonly reconciler: ExecutionRecoveryPort;
  readonly usage: GrokExecutionUsagePort;
  readonly clientInfo: AcpImplementation;
  readonly resultCommitTimeoutMs: number;
  readonly recoveryTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly maxResultBytes: number;
  readonly auxiliaryTimeoutMs?: number;
  readonly scheduler?: ResultCommitScheduler;
}

/** Provider-owned composition from narrow application mechanisms to the managed ACP backend. */
export class GrokApplicationContextFactory implements ProviderApplicationContextFactory {
  readonly providerId = 'grok';

  constructor(private readonly options: GrokApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<GrokExecutionBackendContext> {
    const scheduler: ResultCommitScheduler = this.options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
    };
    const clientFactory: ManagedAcpClientFactory = new AcpManagedClientAdapterFactory({
      clientInfo: this.options.clientInfo,
      processLauncher: this.options.processLauncher,
    });
    const interactionBridge: GrokInteractionBridge = new GrokInteractionPresentationBridge(
      this.options.presentations,
    );
    const requestResolver = this.createRequestResolver();
    const dynamicApplier = this.createDynamicApplier();
    const resultSink = createNativeScopedResultSink('grok', this.options.results);
    const auxiliaryQueries = this.createAuxiliaryQueries(clientFactory, scheduler);
    return {
      clientFactory,
      requestResolver,
      dynamicApplier,
      interactionBridge,
      resultSink,
      usage: this.options.usage,
      reconciler: this.options.reconciler,
      auxiliaryQueries,
      scheduler,
      sessionInstanceIdFactory: () => this.options.identities.nextSessionInstanceId(),
      interactionIdFactory: () => this.options.identities.nextInteractionId(),
      resultCommitTimeoutMs: this.options.resultCommitTimeoutMs,
      recoveryTimeoutMs: this.options.recoveryTimeoutMs,
      runTimeoutMs: this.options.runTimeoutMs,
      maxResultBytes: this.options.maxResultBytes,
    };
  }

  async createWorkspaceContext(input: {
    readonly generation: number;
  }): Promise<{ initialize(signal: AbortSignal): Promise<GrokModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }

  protected createRequestResolver(): GrokExecutionRequestResolver {
    return {
      resolve: async requestRef => this.options.requests.take<GrokExecutionInvocation>(
        requestRef,
        GROK_EXECUTION_REQUEST_KIND,
      ),
    };
  }

  protected createDynamicApplier(): GrokExecutionDynamicApplier {
    const resolver: GrokAcpDynamicConfigResolver = {
      resolve: async (dynamicRef: string) => this.options.requests.take<GrokAcpDynamicConfig>(
        dynamicRef,
        GROK_DYNAMIC_CONFIG_KIND,
      ),
    };
    return new GrokAcpDynamicConfigApplier(resolver);
  }

  protected createAuxiliaryQueries(
    clientFactory: ManagedAcpClientFactory,
    scheduler: ResultCommitScheduler,
  ): GrokAuxiliaryPort {
    const resolver = {
      resolve: async (requestRef: string) => this.options.requests.take<ManagedAcpAuxiliaryInvocation>(
        requestRef,
        GROK_AUXILIARY_REQUEST_KIND,
      ),
    };
    return new ManagedAcpAuxiliaryQuery(
      resolver,
      clientFactory,
      scheduler,
      this.options.maxResultBytes,
      this.options.auxiliaryTimeoutMs ?? this.options.runTimeoutMs,
    );
  }
}
