import { createHash } from 'node:crypto';

import type { Options } from '@anthropic-ai/claude-agent-sdk';

import { createStopSubagentHook } from '@/providers/claude/hooks/SubagentHooks';

import type { ImageAttachment } from '../../../core/types';
import {
  type PersistentQueryContext,
  QueryOptionsBuilder,
  type QueryOptionsContext,
} from '../runtime/ClaudeQueryOptionsBuilder';
import { buildClaudeSDKUserMessage } from '../runtime/ClaudeUserMessageFactory';
import type {
  ClaudeExecutionInvocation,
  ClaudeExecutionRequestResolver,
  ClaudeSessionIntent,
} from './ClaudeExecutionBackend';

/** What one Claude turn decides, before it becomes an opaque reference. */
export interface ClaudeExecutionRequest {
  readonly prompt: string;
  readonly images?: readonly ImageAttachment[];
  /**
   * Where the turn continues from, read at dispatch rather than when queued.
   *
   * A conversation's session is written by the turn before it, and a turn can
   * wait in the queue across one — so a decision made at send time would resume
   * a session that has since moved on.
   */
  readonly session: () => ClaudeSessionIntent;
  readonly allowedTools?: readonly string[];
  readonly orchestratorMode?: boolean;
  readonly externalContextPaths?: readonly string[];
  /**
   * Whether the tab has a subagent running, asked when the SDK wants to stop.
   *
   * Per turn because it is per tab: the Stop hook is installed into the SDK
   * options a turn is started with, and a stop that lands while a subagent is
   * working must not end the turn under it. A turn that carries no answer keeps
   * the environment's, which blocks nothing.
   */
  readonly subagentState?: () => { readonly hasRunning: boolean }
    | Promise<{ readonly hasRunning: boolean }>;
}

/**
 * Everything ambient an SDK query is started with, read now rather than when
 * the turn was queued.
 */
export interface ClaudeInvocationEnvironment {
  readonly context: QueryOptionsContext;
  readonly hooks: Options['hooks'];
}

const DEFAULT_LIMIT = 64;

/**
 * The store behind Claude's request references, and behind the startup options
 * the SDK query is created with.
 *
 * Two references, one store, because they are two halves of one dispatch: the
 * kernel carries `requestRef` and hands it back at dispatch, and the query
 * factory carries `startupRef` and hands it back when it actually builds the
 * SDK options. Neither may be a copy — a reference minted against one store
 * resolves to nothing in another, which is the defect wave 1's end-to-end turn
 * found on its first run.
 *
 * In memory on purpose, and bounded: a reference that outlived a restart would
 * promise a re-dispatch nothing can make, and an unbounded map of prompts is a
 * leak made of the most sensitive thing this provider handles.
 */
export class ClaudeExecutionRequests implements ClaudeExecutionRequestResolver {
  private readonly pending = new Map<string, ClaudeExecutionRequest>();
  private readonly startups = new Map<string, ClaudeStartup>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: () => Promise<ClaudeInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Holds a turn and returns the reference the kernel will carry. */
  reference(request: ClaudeExecutionRequest): string {
    evict(this.pending, this.limit);
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<ClaudeExecutionInvocation> {
    const request = this.take(requestRef);
    const environment = await this.environment();
    const externalContextPaths = request.externalContextPaths
      ? [...request.externalContextPaths]
      : undefined;
    const config = QueryOptionsBuilder.buildPersistentQueryConfig(
      environment.context,
      externalContextPaths,
      request.orchestratorMode,
    );
    const session = request.session();
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, {
      environment: request.subagentState
        ? {
          ...environment,
          hooks: { Stop: [createStopSubagentHook(request.subagentState)] },
        }
        : environment,
      ...(externalContextPaths ? { externalContextPaths } : {}),
      ...(request.orchestratorMode === undefined
        ? {}
        : { orchestratorMode: request.orchestratorMode }),
    });
    return {
      startupRef,
      restartFingerprint: restartFingerprint(config),
      session,
      // The SDK stamps its own session on the reply; this is what the message
      // claims to belong to, which for a new session is nothing yet.
      message: buildClaudeSDKUserMessage(
        request.prompt,
        continuedSessionId(session) ?? '',
        request.images ? [...request.images] : undefined,
      ),
      dynamic: {
        ...(config.model ? { model: config.model } : {}),
        ...(config.sdkPermissionMode ? { permissionMode: config.sdkPermissionMode } : {}),
        effortLevel: config.effortLevel,
      },
      ...(request.allowedTools ? { allowedTools: [...request.allowedTools] } : {}),
    };
  }

  /**
   * The SDK options for a query the backend is starting.
   *
   * Resolved rather than carried, because the backend restarts a query on its
   * own terms — a fingerprint change, a recovery — and the options it starts
   * with must be the ones this vault is configured with then.
   */
  async resolveStartupOptions(startupRef: string, signal: AbortSignal): Promise<Options> {
    const startup = this.startups.get(startupRef);
    if (!startup) {
      throw new Error('Unknown Claude startup reference.');
    }
    if (signal.aborted) {
      throw new Error('Claude startup options were resolved after the run was aborted.');
    }
    const context: PersistentQueryContext = {
      ...startup.environment.context,
      hooks: startup.environment.hooks,
      ...(startup.externalContextPaths
        ? { externalContextPaths: [...startup.externalContextPaths] }
        : {}),
      ...(startup.orchestratorMode === undefined
        ? {}
        : { orchestratorMode: startup.orchestratorMode }),
    };
    // No `resume` and no `canUseTool` here, and neither is an omission: the
    // query factory sets both from the invocation it was created for, and a
    // second answer to either question would be the one that loses.
    return QueryOptionsBuilder.buildPersistentQueryOptions(context);
  }

  /** Drops everything held for turns that will never dispatch. */
  dispose(): void {
    this.pending.clear();
    this.startups.clear();
  }

  private take(requestRef: string): ClaudeExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Unknown Claude request reference.');
    }
    // Removed on resolve: holding a prompt after its run dispatched is
    // retention nobody asked for.
    this.pending.delete(requestRef);
    return request;
  }
}

interface ClaudeStartup {
  readonly environment: ClaudeInvocationEnvironment;
  readonly externalContextPaths?: readonly string[];
  readonly orchestratorMode?: boolean;
}

/**
 * What makes the backend start a new SDK query rather than reuse the one it
 * has.
 *
 * The same question `QueryOptionsBuilder.needsRestart` answers, expressed as a
 * value the kernel can carry: every field that cannot be changed on a running
 * query. Permission mode, model and effort are deliberately absent — those are
 * the dynamic updates, and folding them in here would restart the SDK for a
 * change it can apply in place.
 */
function restartFingerprint(config: {
  readonly systemPromptKey: string;
  readonly disallowedToolsKey: string;
  readonly pluginsKey: string;
  readonly settingSources: string;
  readonly claudeCliPath: string;
  readonly enableChrome: boolean;
  readonly enableAutoMode: boolean;
  readonly externalContextPaths: readonly string[];
}): string {
  return createHash('sha256').update([
    config.systemPromptKey,
    config.disallowedToolsKey,
    config.pluginsKey,
    config.settingSources,
    config.claudeCliPath,
    String(config.enableChrome),
    String(config.enableAutoMode),
    [...config.externalContextPaths].join('|'),
  ].join(' ')).digest('hex');
}

function continuedSessionId(session: ClaudeSessionIntent): string | undefined {
  if (session.kind === 'resume') {
    return session.sessionId;
  }
  return session.kind === 'fork' ? session.sourceSessionId : undefined;
}

function evict(store: Map<string, unknown>, limit: number): void {
  while (store.size >= limit) {
    const oldest = store.keys().next();
    if (oldest.done) {
      return;
    }
    store.delete(oldest.value);
  }
}
