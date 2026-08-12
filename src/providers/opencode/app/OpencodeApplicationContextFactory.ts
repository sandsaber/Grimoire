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
  type OpencodeAcpDynamicConfig,
  OpencodeAcpDynamicConfigApplier,
  type OpencodeAcpDynamicConfigResolver,
} from '../execution/OpencodeAcpDynamicConfig';
import type {
  OpencodeAuxiliaryPort,
  OpencodeExecutionBackendContext,
  OpencodeExecutionDynamicApplier,
  OpencodeExecutionInvocation,
  OpencodeExecutionRequestResolver,
  OpencodeInteractionBridge,
} from '../execution/OpencodeExecutionBackend';
import type { OpencodeModuleWorkspace } from '../OpencodeProviderModule';

export const OPENCODE_EXECUTION_REQUEST_KIND = 'opencode-turn';
export const OPENCODE_AUXILIARY_REQUEST_KIND = 'opencode-auxiliary';
export const OPENCODE_DYNAMIC_CONFIG_KIND = 'opencode-dynamic-config';

export interface OpencodeWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<OpencodeModuleWorkspace>;
}

export interface OpencodeApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<
    ApplicationIdentityFactory,
    'nextSessionInstanceId' | 'nextInteractionId'
  >;
  readonly presentations: ExecutionInteractionPresentationPort;
  readonly workspace: OpencodeWorkspaceInitializer;
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
export class OpencodeApplicationContextFactory implements ProviderApplicationContextFactory {
  readonly providerId = 'opencode';

  constructor(private readonly options: OpencodeApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<OpencodeExecutionBackendContext> {
    const scheduler: ResultCommitScheduler = this.options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
    };
    const clientFactory: ManagedAcpClientFactory = new AcpManagedClientAdapterFactory({
      clientInfo: this.options.clientInfo,
      processLauncher: this.options.processLauncher,
    });
    const interactionBridge = this.createInteractionBridge();
    const requestResolver = this.createRequestResolver();
    const dynamicApplier = this.createDynamicApplier();
    const resultSink = createNativeScopedResultSink('opencode', this.options.results);
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
  }): Promise<{ initialize(signal: AbortSignal): Promise<OpencodeModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }

  protected createInteractionBridge(): OpencodeInteractionBridge {
    return new AcpPermissionInteractionBridge(this.options.presentations);
  }

  protected createRequestResolver(): OpencodeExecutionRequestResolver {
    return {
      resolve: async requestRef => this.options.requests.take<OpencodeExecutionInvocation>(
        requestRef,
        OPENCODE_EXECUTION_REQUEST_KIND,
      ),
    };
  }

  protected createDynamicApplier(): OpencodeExecutionDynamicApplier {
    const resolver: OpencodeAcpDynamicConfigResolver = {
      resolve: async (dynamicRef: string) => this.options.requests.take<OpencodeAcpDynamicConfig>(
        dynamicRef,
        OPENCODE_DYNAMIC_CONFIG_KIND,
      ),
    };
    return new OpencodeAcpDynamicConfigApplier(resolver);
  }

  protected createAuxiliaryQueries(
    clientFactory: ManagedAcpClientFactory,
    scheduler: ResultCommitScheduler,
  ): OpencodeAuxiliaryPort {
    const resolver = {
      resolve: async (requestRef: string) => this.options.requests.take<ManagedAcpAuxiliaryInvocation>(
        requestRef,
        OPENCODE_AUXILIARY_REQUEST_KIND,
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
