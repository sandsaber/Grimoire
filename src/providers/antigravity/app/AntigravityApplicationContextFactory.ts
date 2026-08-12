import {
  clearTimeout as clearNodeTimeout,
  setTimeout as setNodeTimeout,
} from 'node:timers';

import { NodeAntigravityProcessTransport } from '@/app/execution/antigravity/NodeAntigravityProcessTransport';
import type { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import type { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import type { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import type { ProviderApplicationContextFactory } from '@/app/runtime/ProviderApplicationContextRegistry';
import { createRunScopedResultSink } from '@/app/runtime/ProviderExecutionResultAdapters';

import type { AntigravityModuleWorkspace } from '../AntigravityProviderModule';
import type {
  AntigravityExecutionBackendContext,
  AntigravityInvocation,
} from '../execution/AntigravityExecutionBackend';
import {
  AntigravityPrintProcessRunner,
  type AntigravityProcessTransport,
} from '../runtime/AntigravityPrintProcessRunner';

export const ANTIGRAVITY_EXECUTION_REQUEST_KIND = 'antigravity-turn';

export interface AntigravityWorkspaceInitializer {
  initialize(input: {
    readonly generation: number;
    readonly signal: AbortSignal;
  }): Promise<AntigravityModuleWorkspace>;
}

export interface AntigravityApplicationContextFactoryOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly identities: Pick<ApplicationIdentityFactory, 'nextSessionInstanceId'>;
  readonly workspace: AntigravityWorkspaceInitializer;
  readonly processTransport?: AntigravityProcessTransport;
  readonly scheduler?: AntigravityExecutionBackendContext['scheduler'];
}

/** Provider-owned composition from narrow application mechanisms to the print backend. */
export class AntigravityApplicationContextFactory
implements ProviderApplicationContextFactory {
  readonly providerId = 'antigravity';

  constructor(private readonly options: AntigravityApplicationContextFactoryOptions) {}

  async createBackendContext(): Promise<AntigravityExecutionBackendContext> {
    const scheduler = this.options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(
        handle as ReturnType<typeof setNodeTimeout>,
      ),
    };
    return {
      requestResolver: this.options.requests.resolver<AntigravityInvocation>(
        ANTIGRAVITY_EXECUTION_REQUEST_KIND,
      ),
      processRunner: new AntigravityPrintProcessRunner({
        transport: this.options.processTransport ?? new NodeAntigravityProcessTransport(),
      }),
      resultSink: createRunScopedResultSink('antigravity', this.options.results),
      scheduler,
      sessionInstanceIdFactory: () => this.options.identities.nextSessionInstanceId(),
    };
  }

  async createWorkspaceContext(input: {
    readonly generation: number;
  }): Promise<{ initialize(signal: AbortSignal): Promise<AntigravityModuleWorkspace> }> {
    return {
      initialize: signal => this.options.workspace.initialize({
        generation: input.generation,
        signal,
      }),
    };
  }
}
