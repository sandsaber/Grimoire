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

import type { CodexModuleWorkspace } from '../CodexProviderModule';
import type {
  CodexExecutionBackendContext,
  CodexExecutionConnectionFactory,
  CodexExecutionInvocation,
  CodexExecutionRequestResolver,
  CodexExecutionScheduler,
  CodexInteractionBridge,
  CodexTurnReconcilerFactory,
} from '../execution/CodexExecutionBackend';
import {
  type CodexExecutionTranscriptReader,
  CodexExecutionTurnReconciler,
} from '../execution/CodexExecutionTurnReconciler';
import { CodexInteractionPresentationBridge } from '../execution/CodexInteractionPresentationBridge';
import type { ThreadResumeParams, UserInput } from '../runtime/codexAppServerTypes';
import type {
  CodexExecutionConnection,
  CodexExecutionProcessFactory,
} from '../runtime/CodexExecutionConnection';
import { CodexJsonRpcExecutionConnection } from '../runtime/CodexExecutionConnection';

export const CODEX_EXECUTION_REQUEST_KIND = 'codex-turn';
export const CODEX_STEER_REQUEST_KIND = 'codex-steer';

export interface CodexWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<CodexModuleWorkspace>;
}

export interface CodexApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<
    ApplicationIdentityFactory,
    'nextSessionInstanceId' | 'nextInteractionId'
  >;
  readonly presentations: ExecutionInteractionPresentationPort;
  readonly workspace: CodexWorkspaceInitializer;
  readonly processFactory: CodexExecutionProcessFactory;
  readonly transcript?: CodexExecutionTranscriptReader;
  readonly scheduler?: CodexExecutionScheduler;
  readonly defaultResumeParams: Omit<ThreadResumeParams, 'threadId'>;
  readonly resultCommitTimeoutMs?: number;
  readonly recoveryDelayMs?: number;
  readonly cancellationTurnIdTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly maxResultBytes?: number;
}

/** Provider-owned composition from narrow application mechanisms to the app-server backend. */
export class CodexApplicationContextFactory implements ProviderApplicationContextFactory {
  readonly providerId = 'codex';

  constructor(private readonly options: CodexApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<CodexExecutionBackendContext> {
    const scheduler: CodexExecutionScheduler = this.options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
    };
    const connectionFactory: CodexExecutionConnectionFactory = {
      create: () => new CodexJsonRpcExecutionConnection(this.options.processFactory),
    };
    const turnReconcilerFactory: CodexTurnReconcilerFactory = {
      create: (connection: CodexExecutionConnection) => new CodexExecutionTurnReconciler(
        connection,
        this.options.transcript ?? noTranscript,
      ),
    };
    const interactionBridge: CodexInteractionBridge = new CodexInteractionPresentationBridge(
      this.options.presentations,
    );
    const requestResolver = this.createRequestResolver();
    const resultSink = createRunScopedResultSink('codex', this.options.results);
    return {
      connectionFactory,
      requestResolver,
      resultSink,
      interactionBridge,
      turnReconcilerFactory,
      defaultResumeParams: this.options.defaultResumeParams,
      scheduler,
      sessionInstanceIdFactory: () => this.options.identities.nextSessionInstanceId(),
      interactionIdFactory: () => this.options.identities.nextInteractionId(),
      ...(this.options.resultCommitTimeoutMs !== undefined
        ? { resultCommitTimeoutMs: this.options.resultCommitTimeoutMs }
        : {}),
      ...(this.options.recoveryDelayMs !== undefined
        ? { recoveryDelayMs: this.options.recoveryDelayMs }
        : {}),
      ...(this.options.cancellationTurnIdTimeoutMs !== undefined
        ? { cancellationTurnIdTimeoutMs: this.options.cancellationTurnIdTimeoutMs }
        : {}),
      ...(this.options.runTimeoutMs !== undefined ? { runTimeoutMs: this.options.runTimeoutMs } : {}),
      ...(this.options.maxResultBytes !== undefined
        ? { maxResultBytes: this.options.maxResultBytes }
        : {}),
    };
  }

  async createWorkspaceContext(input: {
    readonly generation: number;
  }): Promise<{ initialize(signal: AbortSignal): Promise<CodexModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }

  private createRequestResolver(): CodexExecutionRequestResolver {
    const broker = this.options.requests;
    return {
      resolve: async requestRef => broker.take<CodexExecutionInvocation>(
        requestRef,
        CODEX_EXECUTION_REQUEST_KIND,
      ),
      resolveSteer: async requestRef => broker.take<readonly UserInput[]>(
        requestRef,
        CODEX_STEER_REQUEST_KIND,
      ),
    };
  }
}

const noTranscript: CodexExecutionTranscriptReader = {
  async readTurn() {
    return null;
  },
};
