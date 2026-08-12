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
  type QwenAcpDynamicConfig,
  QwenAcpDynamicConfigApplier,
  type QwenAcpDynamicConfigResolver,
} from '../execution/QwenAcpDynamicConfig';
import type {
  QwenExecutionBackendContext,
  QwenExecutionCommandsPort,
  QwenExecutionDynamicApplier,
  QwenExecutionInvocation,
  QwenExecutionRequestResolver,
  QwenExecutionUsagePort,
  QwenInteractionBridge,
} from '../execution/QwenExecutionBackend';
import type { QwenModuleWorkspace } from '../QwenProviderModule';

export const QWEN_EXECUTION_REQUEST_KIND = 'qwen-turn';
export const QWEN_DYNAMIC_CONFIG_KIND = 'qwen-dynamic-config';

export interface QwenWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<QwenModuleWorkspace>;
}

export interface QwenApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<
    ApplicationIdentityFactory,
    'nextSessionInstanceId' | 'nextInteractionId'
  >;
  readonly presentations: ExecutionInteractionPresentationPort;
  readonly workspace: QwenWorkspaceInitializer;
  readonly processLauncher: AcpManagedProcessLauncher;
  readonly reconciler: ExecutionRecoveryPort;
  readonly commands: QwenExecutionCommandsPort;
  readonly usage: QwenExecutionUsagePort;
  readonly clientInfo: AcpImplementation;
  readonly resultCommitTimeoutMs: number;
  readonly recoveryTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly maxResultBytes: number;
  readonly scheduler?: ResultCommitScheduler;
}

/** Provider-owned composition from narrow application mechanisms to the managed ACP backend. */
export class QwenApplicationContextFactory implements ProviderApplicationContextFactory {
  readonly providerId = 'qwen';

  constructor(private readonly options: QwenApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<QwenExecutionBackendContext> {
    const scheduler: ResultCommitScheduler = this.options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
    };
    const clientFactory: ManagedAcpClientFactory = new AcpManagedClientAdapterFactory({
      clientInfo: this.options.clientInfo,
      processLauncher: this.options.processLauncher,
    });
    const interactionBridge: QwenInteractionBridge = new AcpPermissionInteractionBridge(
      this.options.presentations,
    );
    const requestResolver = this.createRequestResolver();
    const dynamicApplier = this.createDynamicApplier();
    const resultSink = createNativeScopedResultSink('qwen', this.options.results);
    return {
      clientFactory,
      requestResolver,
      dynamicApplier,
      interactionBridge,
      resultSink,
      reconciler: this.options.reconciler,
      commands: this.options.commands,
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
  }): Promise<{ initialize(signal: AbortSignal): Promise<QwenModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }

  protected createRequestResolver(): QwenExecutionRequestResolver {
    return {
      resolve: async requestRef => this.options.requests.take<QwenExecutionInvocation>(
        requestRef,
        QWEN_EXECUTION_REQUEST_KIND,
      ),
    };
  }

  protected createDynamicApplier(): QwenExecutionDynamicApplier {
    const resolver: QwenAcpDynamicConfigResolver = {
      resolve: async (dynamicRef: string) => this.options.requests.take<QwenAcpDynamicConfig>(
        dynamicRef,
        QWEN_DYNAMIC_CONFIG_KIND,
      ),
    };
    return new QwenAcpDynamicConfigApplier(resolver);
  }
}
