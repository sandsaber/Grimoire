import {
  clearTimeout as clearNodeTimeout,
  setTimeout as setNodeTimeout,
} from 'node:timers';

import type { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import type { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import type { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import type { ExecutionInteractionPresentationPort } from '@/app/runtime/ExecutionInteractionPresentationStore';
import type { ProviderApplicationContextFactory } from '@/app/runtime/ProviderApplicationContextRegistry';
import { createRunScopedResultSink } from '@/app/runtime/ProviderExecutionResultAdapters';

import type { ClaudeModuleWorkspace } from '../ClaudeProviderModule';
import type {
  ClaudeAuxiliaryQueryPort,
  ClaudeExecutionBackendContext,
  ClaudeExecutionInvocation,
  ClaudeExecutionQueryFactory,
  ClaudeExecutionReconciler,
  ClaudeExecutionRequestResolver,
  ClaudeExecutionScheduler,
  ClaudeInteractionBridge,
  ClaudeTaskResultLoader,
} from '../execution/ClaudeExecutionBackend';
import { ClaudeInteractionPresentationBridge } from '../execution/ClaudeInteractionPresentationBridge';

export const CLAUDE_EXECUTION_REQUEST_KIND = 'claude-turn';
export const CLAUDE_AUXILIARY_REQUEST_KIND = 'claude-auxiliary';

export interface ClaudeWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<ClaudeModuleWorkspace>;
}

export interface ClaudeApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<
    ApplicationIdentityFactory,
    'nextSessionInstanceId' | 'nextInteractionId'
  >;
  readonly presentations: ExecutionInteractionPresentationPort;
  readonly workspace: ClaudeWorkspaceInitializer;
  readonly queryFactory: ClaudeExecutionQueryFactory;
  readonly taskResultLoader: ClaudeTaskResultLoader;
  readonly reconciler: ClaudeExecutionReconciler;
  readonly auxiliaryQueries: ClaudeAuxiliaryQueryPort;
  readonly scheduler?: ClaudeExecutionScheduler;
  readonly runTimeoutMs?: number;
  readonly resultCommitTimeoutMs?: number;
  readonly recoveryTimeoutMs?: number;
  readonly controlTimeoutMs?: number;
  readonly taskResultLoadTimeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly maxTaskResultBytes?: number;
}

/** Provider-owned composition from narrow application mechanisms to the SDK backend. */
export class ClaudeApplicationContextFactory implements ProviderApplicationContextFactory {
  readonly providerId = 'claude';

  constructor(private readonly options: ClaudeApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<ClaudeExecutionBackendContext> {
    const scheduler: ClaudeExecutionScheduler = this.options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
    };
    const interactionBridge: ClaudeInteractionBridge = new ClaudeInteractionPresentationBridge(
      this.options.presentations,
    );
    const requestResolver = this.createRequestResolver();
    const resultSink = createRunScopedResultSink('claude', this.options.results);
    return {
      queryFactory: this.options.queryFactory,
      requestResolver,
      interactionBridge,
      resultSink,
      taskResultLoader: this.options.taskResultLoader,
      reconciler: this.options.reconciler,
      auxiliaryQueries: this.options.auxiliaryQueries,
      scheduler,
      sessionInstanceIdFactory: () => this.options.identities.nextSessionInstanceId(),
      interactionIdFactory: () => this.options.identities.nextInteractionId(),
      ...(this.options.runTimeoutMs !== undefined ? { runTimeoutMs: this.options.runTimeoutMs } : {}),
      ...(this.options.resultCommitTimeoutMs !== undefined
        ? { resultCommitTimeoutMs: this.options.resultCommitTimeoutMs }
        : {}),
      ...(this.options.recoveryTimeoutMs !== undefined
        ? { recoveryTimeoutMs: this.options.recoveryTimeoutMs }
        : {}),
      ...(this.options.controlTimeoutMs !== undefined
        ? { controlTimeoutMs: this.options.controlTimeoutMs }
        : {}),
      ...(this.options.taskResultLoadTimeoutMs !== undefined
        ? { taskResultLoadTimeoutMs: this.options.taskResultLoadTimeoutMs }
        : {}),
      ...(this.options.maxResultBytes !== undefined
        ? { maxResultBytes: this.options.maxResultBytes }
        : {}),
      ...(this.options.maxTaskResultBytes !== undefined
        ? { maxTaskResultBytes: this.options.maxTaskResultBytes }
        : {}),
    };
  }

  async createWorkspaceContext(input: {
    readonly generation: number;
  }): Promise<{ initialize(signal: AbortSignal): Promise<ClaudeModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }

  protected createRequestResolver(): ClaudeExecutionRequestResolver {
    return {
      resolve: async requestRef => this.options.requests.take<ClaudeExecutionInvocation>(
        requestRef,
        CLAUDE_EXECUTION_REQUEST_KIND,
      ),
    };
  }
}
