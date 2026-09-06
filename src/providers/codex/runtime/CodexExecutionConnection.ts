import type { Unsubscribe } from '@/core/execution/ExecutionContracts';

import type { InitializeResult } from './codexAppServerTypes';
import { CODEX_ROUTED_NOTIFICATION_METHODS } from './CodexNotificationRouter';
import type { CodexRpcProcessPort } from './CodexRpcTransport';
import { CodexRpcTransport } from './CodexRpcTransport';

/**
 * What this connection subscribes to.
 *
 * Derived from the renderer's own list rather than repeated beside it: the flip
 * shipped eleven of the nineteen it handles, and the eight missing ones were
 * the streamed command output, the patch updates, the raw response items, the
 * plan updates and the token usage — most of what a turn shows.
 *
 * The rest are the run's own: the turn it owns, the thread's status, a request
 * the daemon answered by itself, and the plan-limit updates the usage store
 * reads.
 */
export const CODEX_EXECUTION_NOTIFICATION_METHODS = [...new Set([
  ...CODEX_ROUTED_NOTIFICATION_METHODS,
  'turn/started',
  'thread/status/changed',
  'serverRequest/resolved',
  'account/rateLimits/updated',
])] as const;

const SERVER_REQUEST_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
] as const;

export interface CodexExecutionProcess extends CodexRpcProcessPort {
  start(): void;
  shutdown(): Promise<void>;
}

export interface CodexExecutionProcessFactory {
  create(): CodexExecutionProcess;
}

export type CodexExecutionNotificationListener = (method: string, params: unknown) => void;
export type CodexExecutionServerRequestHandler = (
  requestId: string | number,
  method: string,
  params: unknown,
) => Promise<unknown>;

export interface CodexExecutionConnection {
  readonly initializeResult: InitializeResult | null;
  initialize(): Promise<InitializeResult>;
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: CodexExecutionNotificationListener): Unsubscribe;
  onServerRequest(handler: CodexExecutionServerRequestHandler): Unsubscribe;
  onConnectionLost(listener: (error?: Error) => void): Unsubscribe;
  dispose(): Promise<void>;
}

/** Provider-owned JSON-RPC connection; process ownership is injected by the application. */
export class CodexJsonRpcExecutionConnection implements CodexExecutionConnection {
  initializeResult: InitializeResult | null = null;
  private readonly notifications = new Set<CodexExecutionNotificationListener>();
  private readonly serverRequests = new Set<CodexExecutionServerRequestHandler>();
  private readonly connectionLost = new Set<(error?: Error) => void>();
  private process: CodexExecutionProcess | undefined;
  private transport: CodexRpcTransport | undefined;
  private initializeTask: Promise<InitializeResult> | undefined;
  private disposed = false;

  constructor(private readonly processFactory: CodexExecutionProcessFactory) {}

  initialize(): Promise<InitializeResult> {
    if (this.disposed) {
      return Promise.reject(new Error('Codex execution connection is disposed.'));
    }
    this.initializeTask ??= this.start();
    return this.initializeTask;
  }

  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!this.transport || !this.initializeResult) {
      return Promise.reject(new Error('Codex execution connection is not initialized.'));
    }
    return this.transport.request<T>(method, params, timeoutMs);
  }

  notify(method: string, params?: unknown): void {
    if (!this.transport || !this.initializeResult) {
      throw new Error('Codex execution connection is not initialized.');
    }
    this.transport.notify(method, params);
  }

  onNotification(listener: CodexExecutionNotificationListener): Unsubscribe {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onServerRequest(handler: CodexExecutionServerRequestHandler): Unsubscribe {
    this.serverRequests.add(handler);
    return () => this.serverRequests.delete(handler);
  }

  onConnectionLost(listener: (error?: Error) => void): Unsubscribe {
    this.connectionLost.add(listener);
    return () => this.connectionLost.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.transport?.dispose();
    this.transport = undefined;
    const process = this.process;
    this.process = undefined;
    await process?.shutdown();
    this.notifications.clear();
    this.serverRequests.clear();
    this.connectionLost.clear();
  }

  private async start(): Promise<InitializeResult> {
    const process = this.processFactory.create();
    this.process = process;
    process.start();
    const transport = new CodexRpcTransport(process);
    this.transport = transport;
    transport.onConnectionLost(error => {
      if (this.disposed) {
        return;
      }
      for (const listener of this.connectionLost) {
        listener(error);
      }
    });
    transport.start();
    for (const method of CODEX_EXECUTION_NOTIFICATION_METHODS) {
      transport.onNotification(method, params => {
        for (const listener of this.notifications) {
          listener(method, params);
        }
      });
    }
    for (const method of SERVER_REQUEST_METHODS) {
      transport.onServerRequest(method, async (requestId, params) => {
        // A server request has exactly one answer, so exactly one handler may
        // own it. Taking the first of a set silently ignored every later
        // registration — a second one would have looked installed and never
        // been called.
        const handlers = [...this.serverRequests];
        if (handlers.length === 0) {
          throw new Error(`No Codex execution handler for ${method}.`);
        }
        if (handlers.length > 1) {
          throw new Error(
            `Codex execution has ${handlers.length} handlers for ${method}; exactly one may answer.`,
          );
        }
        return handlers[0](requestId, method, params);
      });
    }
    const result = await transport.request<InitializeResult>('initialize', {
      clientInfo: { name: 'grimoire', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    transport.notify('initialized');
    this.initializeResult = result;
    return result;
  }
}
