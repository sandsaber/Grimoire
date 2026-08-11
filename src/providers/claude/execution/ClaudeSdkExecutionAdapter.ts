import {
  type CanUseTool,
  type Options,
  type Query,
  query as agentQuery,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type { Unsubscribe } from '@/core/execution/ExecutionContracts';

import type {
  ClaudeExecutionQuery,
  ClaudeExecutionQueryFactory,
  ClaudeExecutionQueryFactoryInput,
} from './ClaudeExecutionBackend';

export interface ClaudeSdkStartupOptionsResolver {
  resolve(startupRef: string, signal: AbortSignal): Promise<Options>;
}

export type ClaudeSdkQueryFunction = typeof agentQuery;

/**
 * Provider-owned bridge to the official SDK. Startup options remain outside the
 * durable control plane and every created wrapper owns exactly one SDK query.
 */
export class ClaudeSdkExecutionQueryFactory implements ClaudeExecutionQueryFactory {
  constructor(
    private readonly optionsResolver: ClaudeSdkStartupOptionsResolver,
    private readonly queryFunction: ClaudeSdkQueryFunction = agentQuery,
  ) {}

  async create(input: ClaudeExecutionQueryFactoryInput): Promise<ClaudeExecutionQuery> {
    const resolved = await this.optionsResolver.resolve(input.startupRef, input.signal);
    throwIfAborted(input.signal);
    const canUseTool: CanUseTool = (toolName, toolInput, options) => input.canUseTool(
      toolName,
      toolInput,
      {
        signal: options.signal,
        requestId: options.requestId,
        toolUseId: options.toolUseID,
        ...(options.decisionReason ? { decisionReason: options.decisionReason } : {}),
        ...(options.blockedPath ? { blockedPath: options.blockedPath } : {}),
        ...(options.agentID ? { agentID: options.agentID } : {}),
        ...(options.suggestions ? { suggestions: options.suggestions } : {}),
        ...(options.title ? { title: options.title } : {}),
        ...(options.displayName ? { displayName: options.displayName } : {}),
        ...(options.description ? { description: options.description } : {}),
      },
    );
    const options: Options = {
      ...resolved,
      canUseTool,
      ...(input.nativeSessionRef ? { resume: input.nativeSessionRef } : {}),
      ...(input.resumeAt ? { resumeSessionAt: input.resumeAt } : {}),
      ...(input.forkSession ? { forkSession: true } : {}),
    };
    const query = this.queryFunction({
      prompt: input.messages,
      options,
    });
    if (input.signal.aborted) {
      query.close();
      throwIfAborted(input.signal);
    }
    return new ClaudeSdkExecutionQuery(query);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted.');
}

class ClaudeSdkExecutionQuery implements ClaudeExecutionQuery {
  private readonly connectionLossListeners = new Set<(error?: Error) => void>();
  private readonly stdin: NodeJS.WritableStream | undefined;
  private closed = false;

  constructor(private readonly query: Query) {
    this.stdin = readProcessStdin(query);
    this.stdin?.on('error', this.handleStdinError);
    this.stdin?.once('close', this.handleStdinClose);
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.query[Symbol.asyncIterator]();
  }

  interrupt(): Promise<unknown> {
    return this.query.interrupt();
  }

  setPermissionMode(mode: Parameters<Query['setPermissionMode']>[0]): Promise<void> {
    return this.query.setPermissionMode(mode);
  }

  setModel(model?: string): Promise<void> {
    return this.query.setModel(model);
  }

  applyFlagSettings(settings: Parameters<Query['applyFlagSettings']>[0]): Promise<void> {
    return this.query.applyFlagSettings(settings);
  }

  setMcpServers(servers: Parameters<Query['setMcpServers']>[0]): Promise<unknown> {
    return this.query.setMcpServers(servers);
  }

  rewindFiles(
    userMessageId: string,
    options?: { readonly dryRun?: boolean },
  ): ReturnType<Query['rewindFiles']> {
    return this.query.rewindFiles(userMessageId, options);
  }

  stopTask(taskId: string): Promise<void> {
    return this.query.stopTask(taskId);
  }

  onConnectionLost(listener: (error?: Error) => void): Unsubscribe {
    this.connectionLossListeners.add(listener);
    return () => this.connectionLossListeners.delete(listener);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.detachStdinListeners();
    this.connectionLossListeners.clear();
    this.query.close();
  }

  private readonly handleStdinError = (error: Error): void => {
    if (this.closed) {
      return;
    }
    for (const listener of this.connectionLossListeners) {
      listener(error);
    }
  };

  private readonly handleStdinClose = (): void => {
    this.detachStdinListeners();
  };

  private detachStdinListeners(): void {
    this.stdin?.removeListener('error', this.handleStdinError);
    this.stdin?.removeListener('close', this.handleStdinClose);
  }
}

function readProcessStdin(query: Query): NodeJS.WritableStream | undefined {
  const transport = (query as unknown as {
    readonly transport?: { readonly processStdin?: NodeJS.WritableStream };
  }).transport;
  const stdin = transport?.processStdin;
  return stdin && typeof stdin.on === 'function' && typeof stdin.removeListener === 'function'
    ? stdin
    : undefined;
}
