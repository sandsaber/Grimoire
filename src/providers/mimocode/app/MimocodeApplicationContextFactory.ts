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
  type MimocodeAcpDynamicConfig,
  MimocodeAcpDynamicConfigApplier,
  type MimocodeAcpDynamicConfigResolver,
} from '../execution/MimocodeAcpDynamicConfig';
import type {
  MimocodeAuxiliaryPort,
  MimocodeEmptyResultPolicy,
  MimocodeExecutionBackendContext,
  MimocodeExecutionDynamicApplier,
  MimocodeExecutionInvocation,
  MimocodeExecutionRequestResolver,
  MimocodeInteractionBridge,
} from '../execution/MimocodeExecutionBackend';
import type { MimocodeModuleWorkspace } from '../MimocodeProviderModule';

export const MIMOCODE_EXECUTION_REQUEST_KIND = 'mimocode-turn';
export const MIMOCODE_AUXILIARY_REQUEST_KIND = 'mimocode-auxiliary';
export const MIMOCODE_DYNAMIC_CONFIG_KIND = 'mimocode-dynamic-config';

export interface MimocodeWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<MimocodeModuleWorkspace>;
}

export interface MimocodeApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<
    ApplicationIdentityFactory,
    'nextSessionInstanceId' | 'nextInteractionId'
  >;
  readonly presentations: ExecutionInteractionPresentationPort;
  readonly workspace: MimocodeWorkspaceInitializer;
  readonly processLauncher: AcpManagedProcessLauncher;
  readonly reconciler: ExecutionRecoveryPort;
  readonly clientInfo: AcpImplementation;
  readonly emptyResultPolicy: MimocodeEmptyResultPolicy;
  readonly resultCommitTimeoutMs: number;
  readonly recoveryTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly maxResultBytes: number;
  readonly auxiliaryTimeoutMs?: number;
  readonly scheduler?: ResultCommitScheduler;
}

/** Provider-owned composition from narrow application mechanisms to the managed ACP backend. */
export class MimocodeApplicationContextFactory implements ProviderApplicationContextFactory {
  readonly providerId = 'mimocode';

  constructor(private readonly options: MimocodeApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<MimocodeExecutionBackendContext> {
    const scheduler = this.options.scheduler ?? defaultScheduler();
    const clientFactory: ManagedAcpClientFactory = new AcpManagedClientAdapterFactory({
      clientInfo: this.options.clientInfo,
      processLauncher: this.options.processLauncher,
    });
    const interactionBridge: MimocodeInteractionBridge = new AcpPermissionInteractionBridge(
      this.options.presentations,
    );
    const requestResolver = this.createRequestResolver();
    const dynamicApplier = this.createDynamicApplier();
    const resultSink = createNativeScopedResultSink('mimocode', this.options.results);
    const auxiliaryQueries = this.createAuxiliaryQueries(clientFactory, scheduler);
    return {
      clientFactory,
      requestResolver,
      dynamicApplier,
      interactionBridge,
      resultSink,
      emptyResultPolicy: this.options.emptyResultPolicy,
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
  }): Promise<{ initialize(signal: AbortSignal): Promise<MimocodeModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }

  protected createRequestResolver(): MimocodeExecutionRequestResolver {
    return {
      resolve: async requestRef => this.options.requests.take<MimocodeExecutionInvocation>(
        requestRef,
        MIMOCODE_EXECUTION_REQUEST_KIND,
      ),
    };
  }

  protected createDynamicApplier(): MimocodeExecutionDynamicApplier {
    const resolver: MimocodeAcpDynamicConfigResolver = {
      resolve: async (dynamicRef: string) => this.options.requests.take<MimocodeAcpDynamicConfig>(
        dynamicRef,
        MIMOCODE_DYNAMIC_CONFIG_KIND,
      ),
    };
    return new MimocodeAcpDynamicConfigApplier(resolver);
  }

  protected createAuxiliaryQueries(
    clientFactory: ManagedAcpClientFactory,
    scheduler: ResultCommitScheduler,
  ): MimocodeAuxiliaryPort {
    const resolver = {
      resolve: async (requestRef: string) => this.options.requests.take<ManagedAcpAuxiliaryInvocation>(
        requestRef,
        MIMOCODE_AUXILIARY_REQUEST_KIND,
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

function defaultScheduler(): ResultCommitScheduler {
  return {
    setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
  };
}
