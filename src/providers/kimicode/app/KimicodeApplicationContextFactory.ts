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
import { AcpPermissionInteractionBridge } from '@/providers/acp/execution/AcpPermissionInteractionBridge';
import {
  type ManagedAcpAuxiliaryInvocation,
  ManagedAcpAuxiliaryQuery,
} from '@/providers/acp/execution/ManagedAcpAuxiliaryQuery';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpImplementation } from '@/providers/acp/types';

import {
  type KimicodeAcpDynamicConfig,
  KimicodeAcpDynamicConfigApplier,
  type KimicodeAcpDynamicConfigResolver,
} from '../execution/KimicodeAcpDynamicConfig';
import type {
  KimicodeAuxiliaryPort,
  KimicodeExecutionBackendContext,
  KimicodeExecutionDynamicApplier,
  KimicodeExecutionInvocation,
  KimicodeExecutionRequestResolver,
  KimicodeInteractionBridge,
} from '../execution/KimicodeExecutionBackend';
import type { KimicodeModuleWorkspace } from '../KimicodeProviderModule';

export const KIMICODE_EXECUTION_REQUEST_KIND = 'kimicode-turn';
export const KIMICODE_AUXILIARY_REQUEST_KIND = 'kimicode-auxiliary';
export const KIMICODE_DYNAMIC_CONFIG_KIND = 'kimicode-dynamic-config';

export interface KimicodeWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<KimicodeModuleWorkspace>;
}

export interface KimicodeApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<
    ApplicationIdentityFactory,
    'nextSessionInstanceId' | 'nextInteractionId'
  >;
  readonly presentations: ExecutionInteractionPresentationPort;
  readonly workspace: KimicodeWorkspaceInitializer;
  readonly processLauncher: AcpManagedProcessLauncher;
  readonly reconciler: ExecutionRecoveryPort;
  readonly clientInfo: AcpImplementation;
  readonly resultCommitTimeoutMs: number;
  readonly recoveryTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly maxResultBytes: number;
  readonly auxiliaryTimeoutMs?: number;
  readonly scheduler?: ResultCommitScheduler;
}

/** Provider-owned composition from narrow application mechanisms to the managed ACP backend. */
export class KimicodeApplicationContextFactory implements ProviderApplicationContextFactory {
  readonly providerId = 'kimicode';

  constructor(private readonly options: KimicodeApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<KimicodeExecutionBackendContext> {
    const scheduler: ResultCommitScheduler = this.options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
    };
    const clientFactory: ManagedAcpClientFactory = new AcpManagedClientAdapterFactory({
      clientInfo: this.options.clientInfo,
      processLauncher: this.options.processLauncher,
    });
    const interactionBridge: KimicodeInteractionBridge = new AcpPermissionInteractionBridge(
      this.options.presentations,
    );
    const requestResolver = this.createRequestResolver();
    const dynamicApplier = this.createDynamicApplier();
    const resultSink = createNativeScopedResultSink('kimicode', this.options.results);
    const auxiliaryQueries = this.createAuxiliaryQueries(clientFactory, scheduler);
    return {
      clientFactory,
      requestResolver,
      dynamicApplier,
      interactionBridge,
      resultSink,
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
  }): Promise<{ initialize(signal: AbortSignal): Promise<KimicodeModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }

  protected createRequestResolver(): KimicodeExecutionRequestResolver {
    return {
      resolve: async requestRef => this.options.requests.take<KimicodeExecutionInvocation>(
        requestRef,
        KIMICODE_EXECUTION_REQUEST_KIND,
      ),
    };
  }

  protected createDynamicApplier(): KimicodeExecutionDynamicApplier {
    const resolver: KimicodeAcpDynamicConfigResolver = {
      resolve: async (dynamicRef: string) => this.options.requests.take<KimicodeAcpDynamicConfig>(
        dynamicRef,
        KIMICODE_DYNAMIC_CONFIG_KIND,
      ),
    };
    return new KimicodeAcpDynamicConfigApplier(resolver);
  }

  protected createAuxiliaryQueries(
    clientFactory: ManagedAcpClientFactory,
    scheduler: ResultCommitScheduler,
  ): KimicodeAuxiliaryPort {
    const resolver = {
      resolve: async (requestRef: string) => this.options.requests.take<ManagedAcpAuxiliaryInvocation>(
        requestRef,
        KIMICODE_AUXILIARY_REQUEST_KIND,
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
