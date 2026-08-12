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
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpImplementation } from '@/providers/acp/types';

import {
  type GeminiAcpDynamicConfig,
  GeminiAcpDynamicConfigApplier,
  type GeminiAcpDynamicConfigResolver,
} from '../execution/GeminiAcpDynamicConfig';
import type {
  GeminiExecutionBackendContext,
  GeminiExecutionDynamicApplier,
  GeminiExecutionInvocation,
  GeminiExecutionRequestResolver,
  GeminiExecutionUsagePort,
  GeminiHistoryReplayPort,
  GeminiInteractionBridge,
} from '../execution/GeminiExecutionBackend';
import type { GeminiModuleWorkspace } from '../GeminiProviderModule';

export const GEMINI_EXECUTION_REQUEST_KIND = 'gemini-turn';
export const GEMINI_DYNAMIC_CONFIG_KIND = 'gemini-dynamic-config';

export interface GeminiWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<GeminiModuleWorkspace>;
}

export interface GeminiApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<
    ApplicationIdentityFactory,
    'nextSessionInstanceId' | 'nextInteractionId'
  >;
  readonly presentations: ExecutionInteractionPresentationPort;
  readonly workspace: GeminiWorkspaceInitializer;
  readonly processLauncher: AcpManagedProcessLauncher;
  readonly reconciler: ExecutionRecoveryPort;
  readonly historyReplay: GeminiHistoryReplayPort;
  readonly usage: GeminiExecutionUsagePort;
  readonly clientInfo: AcpImplementation;
  readonly resultCommitTimeoutMs: number;
  readonly recoveryTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly maxResultBytes: number;
  readonly scheduler?: ResultCommitScheduler;
}

/** Provider-owned composition from narrow application mechanisms to the managed ACP backend. */
export class GeminiApplicationContextFactory implements ProviderApplicationContextFactory {
  readonly providerId = 'gemini';

  constructor(private readonly options: GeminiApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<GeminiExecutionBackendContext> {
    const scheduler: ResultCommitScheduler = this.options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
    };
    const clientFactory: ManagedAcpClientFactory = new AcpManagedClientAdapterFactory({
      clientInfo: this.options.clientInfo,
      processLauncher: this.options.processLauncher,
    });
    const interactionBridge: GeminiInteractionBridge = new AcpPermissionInteractionBridge(
      this.options.presentations,
    );
    const requestResolver = this.createRequestResolver();
    const dynamicApplier = this.createDynamicApplier();
    const resultSink = createNativeScopedResultSink('gemini', this.options.results);
    return {
      clientFactory,
      requestResolver,
      dynamicApplier,
      interactionBridge,
      resultSink,
      reconciler: this.options.reconciler,
      historyReplay: this.options.historyReplay,
      usage: this.options.usage,
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
  }): Promise<{ initialize(signal: AbortSignal): Promise<GeminiModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }

  protected createRequestResolver(): GeminiExecutionRequestResolver {
    return {
      resolve: async requestRef => this.options.requests.take<GeminiExecutionInvocation>(
        requestRef,
        GEMINI_EXECUTION_REQUEST_KIND,
      ),
    };
  }

  protected createDynamicApplier(): GeminiExecutionDynamicApplier {
    const resolver: GeminiAcpDynamicConfigResolver = {
      resolve: async (dynamicRef: string) => this.options.requests.take<GeminiAcpDynamicConfig>(
        dynamicRef,
        GEMINI_DYNAMIC_CONFIG_KIND,
      ),
    };
    return new GeminiAcpDynamicConfigApplier(resolver);
  }
}
