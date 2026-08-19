import type {
  McpServerConfig,
  PermissionMode,
  PermissionResult,
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import {
  type ExecutionBackendDescriptor,
  executionBackendId,
} from '@/core/execution/ExecutionBackendDescriptor';
import {
  type CancellationReason,
  type ExecutionBackend,
  ExecutionDispatchError,
  type ExecutionRecoveryPort,
  type ExecutionRequest,
  type ExecutionRun,
  type ExecutionSession,
  type ExecutionSessionConfig,
  type ExecutionSessionSnapshot,
  type InteractionPort,
  type InteractionResolution,
  type ResultRef,
  type RunRecoveryEvidence,
  type RunRecoveryQuery,
  type RunTerminal,
  type RunTerminalKind,
  type RunTerminalReason,
  type Unsubscribe,
} from '@/core/execution/ExecutionContracts';
import { ExecutionEventQueue } from '@/core/execution/ExecutionEventQueue';
import type {
  ExecutionEvent,
  ExecutionEventScope,
  ProviderExecutionEvent,
} from '@/core/execution/ExecutionEvents';
import type { InteractionId, RunId, SessionInstanceId } from '@/core/execution/ExecutionIds';
import {
  type ResultCommitOutcome,
  settleResultCommit,
} from '@/core/execution/ResultCommit';

import type { EffortLevel } from '../types/models';
import { ClaudeExecutionMessageChannel } from './ClaudeExecutionMessageChannel';

export type ClaudeSessionIntent =
  | { readonly kind: 'new' }
  | { readonly kind: 'resume'; readonly sessionId: string; readonly resumeAt?: string }
  | {
    readonly kind: 'fork';
    readonly sourceSessionId: string;
    readonly resumeAt: string;
  };

export interface ClaudeDynamicExecutionConfig {
  readonly model?: string;
  readonly permissionMode?: PermissionMode;
  readonly effortLevel?: EffortLevel | null;
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
}

export interface ClaudeExecutionInvocation {
  /** Opaque provider-owned reference resolved only by the query factory. */
  readonly startupRef: string;
  /** Exact startup-only configuration identity. */
  readonly restartFingerprint: string;
  readonly session?: ClaudeSessionIntent;
  readonly message: SDKUserMessage;
  readonly dynamic?: ClaudeDynamicExecutionConfig;
  readonly allowedTools?: readonly string[];
}

export interface ClaudeExecutionRequestResolver {
  resolve(requestRef: string): Promise<ClaudeExecutionInvocation>;
}

export interface ClaudeExecutionQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: { readonly effortLevel: EffortLevel | null }): Promise<void>;
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<unknown>;
  rewindFiles(userMessageId: string, options?: { readonly dryRun?: boolean }): Promise<RewindFilesResult>;
  stopTask(taskId: string): Promise<void>;
  onConnectionLost(listener: (error?: Error) => void): Unsubscribe;
  close(): void;
}

export interface ClaudeExecutionQueryFactoryInput {
  readonly startupRef: string;
  readonly messages: AsyncIterable<SDKUserMessage>;
  readonly nativeSessionRef?: string;
  readonly resumeAt?: string;
  readonly forkSession: boolean;
  readonly signal: AbortSignal;
  readonly canUseTool: (
    toolName: string,
    input: Record<string, unknown>,
    options: ClaudeToolPermissionOptions,
  ) => Promise<PermissionResult>;
}

export interface ClaudeExecutionQueryFactory {
  create(input: ClaudeExecutionQueryFactoryInput): Promise<ClaudeExecutionQuery>;
}

export interface ClaudeToolPermissionOptions {
  readonly signal: AbortSignal;
  readonly requestId: string;
  readonly toolUseId: string;
  readonly decisionReason?: string;
  readonly blockedPath?: string;
  readonly agentID?: string;
  readonly suggestions?: readonly unknown[];
  readonly title?: string;
  readonly displayName?: string;
  readonly description?: string;
}

export interface ClaudePreparedInteraction {
  readonly kind: 'approval' | 'question' | 'plan-decision';
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly providerResolvedResponseId: string;
  resolve(responseId: string): Promise<PermissionResult>;
  cancel(): Promise<PermissionResult>;
}

/**
 * A permission the provider answered itself, with nobody asked.
 *
 * Two of Claude's rules are policy rather than questions: a tool outside the
 * allow-list this query was started with, and a read-only MCP tool the vault
 * trusts. Opening an interaction for either would put a prompt on screen that
 * has only one possible answer, so the bridge answers instead — and the shape
 * says so, rather than a prepared interaction that resolves itself.
 */
export interface ClaudeResolvedPermission {
  readonly kind: 'resolved';
  readonly result: PermissionResult;
}

export interface ClaudeInteractionBridge {
  prepare(input: {
    readonly toolName: string;
    readonly toolInput: Readonly<Record<string, unknown>>;
    readonly options: ClaudeToolPermissionOptions;
    readonly allowedTools?: readonly string[];
  }): Promise<ClaudePreparedInteraction | ClaudeResolvedPermission>;
}

export interface ClaudeExecutionResultSink {
  storeResult(input: {
    readonly runId: RunId;
    readonly output: string;
    readonly source: 'assistant' | 'native-agent';
    readonly nativeAgentKey?: string;
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome>;
}

export interface ClaudeTaskResultLoader {
  load(input: {
    readonly nativeSessionRef: string;
    readonly taskId: string;
    readonly outputFile: string;
    readonly maxBytes: number;
    readonly signal: AbortSignal;
  }): Promise<string | null>;
}

export type ClaudeReconciliationEvidence =
  | { readonly kind: 'terminal'; readonly terminal: RunTerminal }
  | { readonly kind: 'unknown'; readonly effectsPossible: boolean };

export interface ClaudeExecutionReconciler {
  reconcile(input: {
    readonly nativeSessionRef: string;
    readonly userMessageId: string;
  }): Promise<ClaudeReconciliationEvidence>;
}

export interface ClaudeAuxiliaryQueryPort {
  execute(requestRef: string, signal: AbortSignal): Promise<string>;
}

export interface ClaudeExecutionScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ClaudeExecutionBackendContext {
  readonly queryFactory: ClaudeExecutionQueryFactory;
  readonly requestResolver: ClaudeExecutionRequestResolver;
  readonly interactionBridge: ClaudeInteractionBridge;
  readonly resultSink: ClaudeExecutionResultSink;
  readonly taskResultLoader: ClaudeTaskResultLoader;
  readonly reconciler: ClaudeExecutionReconciler;
  readonly auxiliaryQueries: ClaudeAuxiliaryQueryPort;
  readonly scheduler: ClaudeExecutionScheduler;
  readonly sessionInstanceIdFactory: () => SessionInstanceId;
  readonly interactionIdFactory: () => InteractionId;
  readonly now?: () => number;
  readonly runTimeoutMs?: number;
  readonly resultCommitTimeoutMs?: number;
  readonly recoveryTimeoutMs?: number;
  readonly controlTimeoutMs?: number;
  readonly taskResultLoadTimeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly maxTaskResultBytes?: number;
}

export type ClaudeRewindMode = 'conversation' | 'code-and-conversation';

export interface ClaudeRewindResult {
  readonly canRewind: boolean;
  readonly filesChanged?: readonly string[];
  readonly error?: string;
}

export const CLAUDE_EXECUTION_DESCRIPTOR: ExecutionBackendDescriptor = Object.freeze({
  backendId: executionBackendId('provider-claude'),
  association: Object.freeze({ kind: 'provider', providerId: 'claude' }),
});

interface PendingInteraction {
  readonly interactionId: InteractionId;
  readonly run: ClaudeExecutionRun;
  readonly prepared: ClaudePreparedInteraction;
  readonly complete: (result: PermissionResult) => void;
  selectedResponseId?: string;
  settlementTask?: Promise<void>;
  settled: boolean;
}

interface NativeTaskOwner {
  readonly taskId: string;
  readonly run: ClaudeExecutionRun;
  readonly runId: RunId;
  readonly turnId: string;
  readonly toolUseId?: string;
  readonly parentTaskId?: string;
  readonly terminalNotification: Promise<'completed' | 'failed' | 'stopped'>;
  readonly resolveTerminalNotification: (status: 'completed' | 'failed' | 'stopped') => void;
  cancellationTask?: Promise<void>;
  terminal: boolean;
}

interface NativeTaskFinalization {
  readonly abort: AbortController;
  readonly task: Promise<void>;
}

export class ClaudeExecutionBackend implements
ExecutionBackend,
InteractionPort,
ExecutionRecoveryPort {
  readonly descriptor = CLAUDE_EXECUTION_DESCRIPTOR;
  private readonly sessions = new Map<string, ClaudeExecutionSession>();
  private readonly interactions = new Map<InteractionId, PendingInteraction>();
  private readonly settledInteractions = new Map<InteractionId, string>();
  private readonly permissionTasksByNativeRequest = new Map<string, Promise<PermissionResult>>();
  private readonly completedPermissionRequests: string[] = [];
  private readonly auxiliaryTasks = new Map<AbortController, Promise<string>>();
  private disposalTask: Promise<void> | undefined;
  private disposing = false;

  constructor(private readonly context: ClaudeExecutionBackendContext) {
    requirePositive(context.runTimeoutMs ?? 10 * 60_000, 'Claude run timeout');
    requirePositive(context.resultCommitTimeoutMs ?? 2_000, 'Claude result commit timeout');
    requirePositive(context.recoveryTimeoutMs ?? 2_000, 'Claude recovery timeout');
    requirePositive(context.controlTimeoutMs ?? 2_000, 'Claude control timeout');
    requirePositive(
      context.taskResultLoadTimeoutMs ?? 2_000,
      'Claude task result load timeout',
    );
    requirePositive(context.maxResultBytes ?? 1024 * 1024, 'Claude result byte limit');
    requirePositive(context.maxTaskResultBytes ?? 1024 * 1024, 'Claude task result byte limit');
  }

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposing) {
      throw new Error('Claude execution backend is disposing.');
    }
    const key = String(config.executionSessionId);
    if (this.sessions.has(key)) {
      throw new Error('Claude execution session already exists.');
    }
    const session = new ClaudeExecutionSession(
      config,
      this.context,
      (input, run) => this.requestPermission(input, run),
      run => this.cancelRunInteractions(run),
      () => this.sessions.delete(key),
    );
    this.sessions.set(key, session);
    return session;
  }

  async resolve(resolution: InteractionResolution): Promise<void> {
    const pending = this.interactions.get(resolution.interactionId);
    if (!pending) {
      const settledResponse = this.settledInteractions.get(resolution.interactionId);
      if (settledResponse === resolution.responseId) {
        return;
      }
      if (settledResponse) {
        throw new Error('Claude interaction is already resolved with another response.');
      }
      throw new Error('Claude interaction is not pending.');
    }
    if (pending.selectedResponseId && pending.selectedResponseId !== resolution.responseId) {
      throw new Error('Claude interaction is already resolving another response.');
    }
    if (pending.settled) {
      return;
    }
    if (!pending.prepared.responseIds.includes(resolution.responseId)) {
      throw new Error('Claude interaction response is not allowed.');
    }
    await this.settlePendingInteraction(
      pending,
      resolution.responseId,
      () => pending.prepared.resolve(resolution.responseId),
    );
  }

  async cancel(interactionId: InteractionId): Promise<void> {
    const pending = this.interactions.get(interactionId);
    if (!pending || pending.settled || this.settledInteractions.has(interactionId)) {
      return;
    }
    if (pending.settlementTask) {
      const completed = await withTimeout(
        pending.settlementTask.then(() => true),
        this.context.scheduler,
        this.context.controlTimeoutMs ?? 2_000,
      );
      if (completed !== true) {
        this.failCloseInteraction(pending);
      }
      return;
    }
    await this.settlePendingInteraction(
      pending,
      pending.prepared.providerResolvedResponseId,
      () => pending.prepared.cancel(),
    );
  }

  async reconcile(query: RunRecoveryQuery): Promise<RunRecoveryEvidence> {
    if (query.backendId !== this.descriptor.backendId) {
      return { kind: 'unknown', effectsPossible: false };
    }
    const session = this.sessions.get(String(query.executionSessionId));
    const activeRun = session?.activeExecutionRun;
    if (activeRun?.runId === query.runId
      && activeRun.nativeRunRef === query.nativeRunRef
      && session?.isAttached(activeRun)) {
      return { kind: 'running', sessionInstanceId: session.sessionInstanceId };
    }
    if (!query.nativeSessionRef || !query.nativeRunRef) {
      return { kind: 'unknown', effectsPossible: true };
    }
    const evidence = await withTimeout(
      this.context.reconciler.reconcile({
        nativeSessionRef: query.nativeSessionRef,
        userMessageId: query.nativeRunRef,
      }),
      this.context.scheduler,
      this.context.recoveryTimeoutMs ?? 2_000,
    );
    if (!evidence) {
      return { kind: 'unknown', effectsPossible: true };
    }
    if (evidence.kind === 'terminal') {
      return evidence;
    }
    return evidence;
  }

  async rewind(input: {
    readonly executionSessionId: string;
    readonly userMessageId: string;
    readonly assistantMessageId: string;
    readonly mode: ClaudeRewindMode;
  }): Promise<ClaudeRewindResult> {
    if (this.disposing) {
      return { canRewind: false, error: 'Claude execution backend is disposing.' };
    }
    const session = this.sessions.get(input.executionSessionId);
    if (!session) {
      return { canRewind: false, error: 'Claude execution session is not active.' };
    }
    return session.rewind(input);
  }

  runAuxiliaryQuery(requestRef: string): Promise<string> {
    if (this.disposing) {
      return Promise.reject(new Error('Claude execution backend is disposing.'));
    }
    requireOpaqueRef(requestRef, 'Claude auxiliary request reference');
    const abort = new AbortController();
    const task = Promise.resolve().then(
      () => this.context.auxiliaryQueries.execute(requestRef, abort.signal),
    );
    this.auxiliaryTasks.set(abort, task);
    void task.then(
      () => this.auxiliaryTasks.delete(abort),
      () => this.auxiliaryTasks.delete(abort),
    );
    return task;
  }

  async cancelNativeTask(input: {
    readonly executionSessionId: string;
    readonly taskId: string;
  }): Promise<void> {
    if (this.disposing) {
      throw new Error('Claude execution backend is disposing.');
    }
    const session = this.sessions.get(input.executionSessionId);
    if (!session) {
      throw new Error('Claude execution session is not active.');
    }
    await session.stopNativeTask(input.taskId);
  }

  dispose(): Promise<void> {
    if (this.disposalTask) {
      return this.disposalTask;
    }
    this.disposing = true;
    this.disposalTask = this.disposeOnce();
    return this.disposalTask;
  }

  private async disposeOnce(): Promise<void> {
    const auxiliaryTasks = [...this.auxiliaryTasks.entries()];
    for (const [abort] of auxiliaryTasks) {
      abort.abort(new Error('Claude execution backend was disposed.'));
    }
    await Promise.all([...this.sessions.values()].map(session => session.dispose()));
    await Promise.all([...this.interactions.values()].map(async pending => {
      try {
        await this.cancel(pending.interactionId);
      } catch {
        this.failCloseInteraction(pending);
      }
    }));
    this.permissionTasksByNativeRequest.clear();
    this.completedPermissionRequests.length = 0;
    await withTimeout(
      Promise.allSettled(auxiliaryTasks.map(([, task]) => task)),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    this.auxiliaryTasks.clear();
  }

  private async requestPermission(
    input: {
      readonly toolName: string;
      readonly toolInput: Record<string, unknown>;
      readonly options: ClaudeToolPermissionOptions;
      readonly allowedTools?: readonly string[];
    },
    run: ClaudeExecutionRun,
  ): Promise<PermissionResult> {
    requireNativeId(input.options.requestId, 'Claude permission request id');
    const existing = this.permissionTasksByNativeRequest.get(input.options.requestId);
    if (existing) {
      return existing;
    }
    const task = this.preparePermission(input, run);
    this.permissionTasksByNativeRequest.set(input.options.requestId, task);
    void task.then(
      () => this.rememberCompletedPermission(input.options.requestId),
      () => this.rememberCompletedPermission(input.options.requestId),
    );
    return task;
  }

  private async preparePermission(
    input: {
      readonly toolName: string;
      readonly toolInput: Record<string, unknown>;
      readonly options: ClaudeToolPermissionOptions;
      readonly allowedTools?: readonly string[];
    },
    run: ClaudeExecutionRun,
  ): Promise<PermissionResult> {
    if (run.isTerminal || input.options.signal.aborted) {
      return { behavior: 'deny', message: 'The owning Claude run is no longer active.' };
    }
    const prepared = await withTimeout(
      this.context.interactionBridge.prepare(input),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (!prepared) {
      return { behavior: 'deny', message: 'Claude interaction preparation timed out.' };
    }
    if (prepared.kind === 'resolved') {
      // Answered by policy: no interaction is opened, so nothing has to be
      // shown, settled, or cancelled when the run ends.
      return prepared.result;
    }
    validatePreparedInteraction(prepared);
    if (run.isTerminal || input.options.signal.aborted) {
      const cancelled = await withTimeout(
        prepared.cancel(),
        this.context.scheduler,
        this.context.controlTimeoutMs ?? 2_000,
      );
      return cancelled ?? { behavior: 'deny', message: 'The Claude interaction was cancelled.' };
    }
    const interactionId = this.context.interactionIdFactory();
    return new Promise<PermissionResult>(complete => {
      const pending: PendingInteraction = {
        interactionId,
        run,
        prepared,
        complete,
        settled: false,
      };
      this.interactions.set(interactionId, pending);
      run.openInteraction(interactionId, prepared);
      const cancelOnAbort = (): void => {
        void this.cancel(interactionId).catch(() => {
          this.failCloseInteraction(pending);
        });
      };
      if (input.options.signal.aborted) {
        cancelOnAbort();
      } else {
        input.options.signal.addEventListener('abort', cancelOnAbort, { once: true });
      }
    });
  }

  private settleInteraction(
    pending: PendingInteraction,
    responseId: string,
    result: PermissionResult,
  ): void {
    if (pending.settled) {
      return;
    }
    pending.settled = true;
    this.interactions.delete(pending.interactionId);
    this.settledInteractions.set(pending.interactionId, responseId);
    trimOldestMapEntries(this.settledInteractions, 1024);
    pending.run.resolveInteraction(pending.interactionId, responseId);
    pending.complete(result);
  }

  private async settlePendingInteraction(
    pending: PendingInteraction,
    responseId: string,
    operation: () => Promise<PermissionResult>,
  ): Promise<void> {
    if (pending.settlementTask) {
      if (pending.selectedResponseId !== responseId) {
        throw new Error('Claude interaction is already resolving another response.');
      }
    } else {
      pending.selectedResponseId = responseId;
      const task = (async () => {
        const result = await operation();
        this.settleInteraction(pending, responseId, result);
      })();
      pending.settlementTask = task;
      void task.catch(() => {
        if (!pending.settled && pending.settlementTask === task) {
          pending.selectedResponseId = undefined;
          pending.settlementTask = undefined;
        }
      });
    }
    const completed = await withTimeout(
      pending.settlementTask.then(() => true),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (completed !== true) {
      this.failCloseInteraction(pending);
      throw new Error('Claude interaction settlement did not complete safely.');
    }
  }

  private failCloseInteraction(pending: PendingInteraction): void {
    this.settleInteraction(
      pending,
      pending.prepared.providerResolvedResponseId,
      {
        behavior: 'deny',
        message: 'Claude interaction settlement was not confirmed.',
        interrupt: true,
      },
    );
  }

  private rememberCompletedPermission(requestId: string): void {
    this.completedPermissionRequests.push(requestId);
    while (this.completedPermissionRequests.length > 1024) {
      const oldest = this.completedPermissionRequests.shift();
      if (oldest) {
        this.permissionTasksByNativeRequest.delete(oldest);
      }
    }
  }

  private cancelRunInteractions(run: ClaudeExecutionRun): void {
    for (const pending of this.interactions.values()) {
      if (pending.run !== run || pending.settled) {
        continue;
      }
      void this.cancel(pending.interactionId).catch(() => {
        this.failCloseInteraction(pending);
      });
    }
  }
}

class ClaudeExecutionSession implements ExecutionSession {
  readonly sessionInstanceId: SessionInstanceId;
  private readonly listeners = new Set<(event: ProviderExecutionEvent) => void>();
  private readonly tasks = new Map<string, NativeTaskOwner>();
  private readonly toolUseToTask = new Map<string, string>();
  private readonly pendingTaskParents = new Map<string, string>();
  private readonly liveTaskIds = new Set<string>();
  private readonly backgroundTaskLevelIds = new Set<string>();
  private readonly completedTaskIds = new Set<string>();
  private readonly seenResultMessageIds = new Set<string>();
  private readonly taskFinalizations = new Map<string, NativeTaskFinalization>();
  private activeRun: ClaudeExecutionRun | undefined;
  private preparingRun: ClaudeExecutionRun | undefined;
  private nativeSessionRef: string | undefined;
  private query: ClaudeExecutionQuery | undefined;
  private messageChannel: ClaudeExecutionMessageChannel | undefined;
  private queryGeneration = 0;
  private querySessionIntent: ClaudeSessionIntent | undefined;
  private queryObservedSessionRef: string | undefined;
  private restartFingerprint: string | undefined;
  private appliedDynamic: ClaudeDynamicExecutionConfig = {};
  private resumeAtOverride: string | undefined;
  private detachedDeliverySequence = 0;
  private queryCreationAbort: AbortController | undefined;
  private controlTask: Promise<ClaudeRewindResult> | undefined;
  private disposalTask: Promise<void> | undefined;
  private disposed = false;

  constructor(
    private readonly config: ExecutionSessionConfig,
    private readonly context: ClaudeExecutionBackendContext,
    private readonly requestPermission: (
      input: {
        readonly toolName: string;
        readonly toolInput: Record<string, unknown>;
        readonly options: ClaudeToolPermissionOptions;
        readonly allowedTools?: readonly string[];
      },
      run: ClaudeExecutionRun,
    ) => Promise<PermissionResult>,
    private readonly onRunTerminal: (run: ClaudeExecutionRun) => void,
    private readonly onDispose: () => void,
  ) {
    this.sessionInstanceId = context.sessionInstanceIdFactory();
    this.nativeSessionRef = config.nativeSessionRef;
  }

  get executionSessionId() {
    return this.config.executionSessionId;
  }

  get activeExecutionRun(): ClaudeExecutionRun | undefined {
    return this.activeRun;
  }

  isAttached(run: ClaudeExecutionRun): boolean {
    return this.activeRun === run && this.query !== undefined && !this.disposed;
  }

  createRun(request: ExecutionRequest): ExecutionRun {
    if (this.disposed) {
      throw new ExecutionDispatchError('Claude execution session is disposed.', true);
    }
    if (this.activeRun || this.preparingRun || this.controlTask) {
      throw new ExecutionDispatchError('Claude execution session already has an active turn.', true);
    }
    let run: ClaudeExecutionRun;
    run = new ClaudeExecutionRun(
      request,
      this.config,
      this.sessionInstanceId,
      this.context,
      this,
      event => this.publish(event),
      (input) => this.requestPermission(input, run),
      () => {
        if (this.activeRun === run) {
          this.activeRun = undefined;
        }
        this.onRunTerminal(run);
      },
    );
    this.activeRun = run;
    run.start();
    return run;
  }

  getSnapshot(): ExecutionSessionSnapshot {
    return {
      executionSessionId: this.config.executionSessionId,
      sessionInstanceId: this.sessionInstanceId,
      ...(this.nativeSessionRef ? { nativeSessionRef: this.nativeSessionRef } : {}),
    };
  }

  subscribe(listener: (event: ProviderExecutionEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prepareRun(
    invocation: ClaudeExecutionInvocation,
    run: ClaudeExecutionRun,
  ): Promise<void> {
    if (this.preparingRun && this.preparingRun !== run) {
      throw new ExecutionDispatchError('Claude execution preparation is already active.', true);
    }
    this.preparingRun = run;
    try {
      const restartRequired = this.query !== undefined
        && this.restartFingerprint !== invocation.restartFingerprint;
      if ((!this.query || restartRequired) && this.hasLiveNativeTasks()) {
        throw new ExecutionDispatchError(
          'Claude query ownership cannot change while native tasks are active.',
          true,
        );
      }
      if (!this.query || restartRequired) {
        await this.startQuery(invocation, run);
      }
      await this.applyDynamicUpdates(invocation.dynamic ?? {}, run);
    } finally {
      if (this.preparingRun === run) {
        this.preparingRun = undefined;
      }
    }
  }

  dispatch(message: SDKUserMessage): void {
    if (!this.messageChannel || !this.query) {
      throw new Error('Claude persistent query is not ready.');
    }
    this.messageChannel.enqueue({
      ...message,
      session_id: this.nativeSessionRef ?? message.session_id,
    });
  }

  completeTurn(): void {
    // The execution session admits only one run, so the exact-message channel
    // needs no UI-style queue release or message reconstruction.
  }

  async interrupt(): Promise<void> {
    const query = this.query;
    if (!query) {
      throw new Error('Claude persistent query is not active.');
    }
    const acknowledged = await withTimeout(
      query.interrupt().then(() => true),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (acknowledged !== true) {
      throw new Error('Claude interrupt acknowledgement timed out.');
    }
  }

  async stopNativeTask(taskId: string): Promise<void> {
    requireNativeId(taskId, 'Claude native task id');
    const owner = this.tasks.get(taskId);
    if (!owner || owner.terminal || !this.liveTaskIds.has(taskId)) {
      throw new Error('Claude native task is not owned by this execution session.');
    }
    if (owner.cancellationTask) {
      return owner.cancellationTask;
    }
    const task = this.requestNativeTaskCancellation(owner);
    owner.cancellationTask = task;
    return task;
  }

  private async requestNativeTaskCancellation(owner: NativeTaskOwner): Promise<void> {
    const query = this.query;
    if (!query) {
      throw new Error('Claude persistent query is not active.');
    }
    const acknowledged = await withTimeout(
      query.stopTask(owner.taskId).then(() => true),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (acknowledged !== true) {
      throw new Error('Claude native task cancellation acknowledgement timed out.');
    }
    const terminalStatus = await withTimeout(
      owner.terminalNotification,
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (!terminalStatus) {
      throw new Error('Claude native task terminal notification timed out.');
    }
  }

  async reconcileRun(run: ClaudeExecutionRun): Promise<ClaudeReconciliationEvidence> {
    const sessionId = this.nativeSessionRef;
    const nativeRunRef = run.nativeRunRef;
    if (!sessionId || !nativeRunRef) {
      return { kind: 'unknown', effectsPossible: run.dispatchStarted };
    }
    const evidence = await withTimeout(
      this.context.reconciler.reconcile({
        nativeSessionRef: sessionId,
        userMessageId: nativeRunRef,
      }),
      this.context.scheduler,
      this.context.recoveryTimeoutMs ?? 2_000,
    );
    return evidence ?? { kind: 'unknown', effectsPossible: true };
  }

  async rewind(input: {
    readonly userMessageId: string;
    readonly assistantMessageId: string;
    readonly mode: ClaudeRewindMode;
  }): Promise<ClaudeRewindResult> {
    if (this.disposed || this.controlTask || this.activeRun || this.hasLiveNativeTasks()) {
      return { canRewind: false, error: 'Claude session is not quiescent.' };
    }
    const task = this.performRewind(input);
    this.controlTask = task;
    void task.then(
      () => { if (this.controlTask === task) this.controlTask = undefined; },
      () => { if (this.controlTask === task) this.controlTask = undefined; },
    );
    return task;
  }

  private async performRewind(input: {
    readonly userMessageId: string;
    readonly assistantMessageId: string;
    readonly mode: ClaudeRewindMode;
  }): Promise<ClaudeRewindResult> {
    let filesChanged: readonly string[] | undefined;
    if (input.mode === 'code-and-conversation') {
      if (!this.query) {
        return { canRewind: false, error: 'Claude persistent query is not active.' };
      }
      const preview = await withTimeout(
        this.query.rewindFiles(input.userMessageId, { dryRun: true }),
        this.context.scheduler,
        this.context.controlTimeoutMs ?? 2_000,
      );
      if (!preview) {
        await this.closeQuery();
        return { canRewind: false, error: 'Claude rewind preview timed out.' };
      }
      if (!preview.canRewind) {
        return { canRewind: false, error: preview.error };
      }
      filesChanged = preview.filesChanged;
      const applied = await withTimeout(
        this.query.rewindFiles(input.userMessageId),
        this.context.scheduler,
        this.context.controlTimeoutMs ?? 2_000,
      );
      if (!applied) {
        await this.closeQuery();
        return {
          canRewind: false,
          error: 'Claude rewind acknowledgement timed out.',
          ...(filesChanged ? { filesChanged } : {}),
        };
      }
      if (!applied.canRewind) {
        await this.closeQuery();
        return { canRewind: false, error: applied.error, ...(filesChanged ? { filesChanged } : {}) };
      }
    }
    this.resumeAtOverride = input.assistantMessageId;
    await this.closeQuery();
    return { canRewind: true, ...(filesChanged ? { filesChanged } : {}) };
  }

  dispose(): Promise<void> {
    if (this.disposalTask) {
      return this.disposalTask;
    }
    this.disposed = true;
    this.disposalTask = this.disposeOnce();
    return this.disposalTask;
  }

  private async disposeOnce(): Promise<void> {
    this.queryCreationAbort?.abort();
    try {
      await this.controlTask;
    } catch {
      // The bounded control operation owns its own cleanup path.
    }
    await this.activeRun?.cancel({ code: 'shutdown' });
    const taskFinalizations = [...this.taskFinalizations.values()];
    for (const finalization of taskFinalizations) {
      finalization.abort.abort(new Error('Claude execution session was disposed.'));
    }
    const query = this.query;
    if (query) {
      const taskIds = new Set([...this.liveTaskIds, ...this.backgroundTaskLevelIds]);
      await Promise.all([...taskIds].map(async taskId => {
        try {
          const owner = this.tasks.get(taskId);
          if (owner && !owner.terminal) {
            owner.cancellationTask ??= this.requestNativeTaskCancellation(owner);
            await owner.cancellationTask;
          } else {
            await withTimeout(
              query.stopTask(taskId),
              this.context.scheduler,
              this.context.controlTimeoutMs ?? 2_000,
            );
          }
        } catch {
          // The lifecycle registry retains uncertainty for the owning work in later phases.
        }
      }));
    }
    await withTimeout(
      Promise.allSettled(taskFinalizations.map(finalization => finalization.task)),
      this.context.scheduler,
      Math.max(
        this.context.controlTimeoutMs ?? 2_000,
        this.context.resultCommitTimeoutMs ?? 2_000,
      ),
    );
    this.taskFinalizations.clear();
    await this.closeQuery();
    this.listeners.clear();
    this.onDispose();
  }

  private async startQuery(
    invocation: ClaudeExecutionInvocation,
    run: ClaudeExecutionRun,
  ): Promise<void> {
    await this.closeQuery();
    this.completedTaskIds.clear();
    const channel = new ClaudeExecutionMessageChannel();
    const intent = this.resolveSessionIntent(invocation.session);
    const sessionRef = intent.kind === 'new'
      ? undefined
      : intent.kind === 'resume'
        ? intent.sessionId
        : intent.sourceSessionId;
    const creationAbort = new AbortController();
    this.queryCreationAbort = creationAbort;
    const creation = this.context.queryFactory.create({
      startupRef: invocation.startupRef,
      messages: channel,
      ...(sessionRef ? { nativeSessionRef: sessionRef } : {}),
      ...(intent.kind !== 'new' && intent.resumeAt ? { resumeAt: intent.resumeAt } : {}),
      forkSession: intent.kind === 'fork',
      signal: creationAbort.signal,
      canUseTool: (toolName, toolInput, options) => {
        const activeRun = this.activeRun;
        return activeRun && !activeRun.isTerminal
          ? activeRun.requestPermission(toolName, toolInput, options)
          : Promise.resolve({
            behavior: 'deny',
            message: 'No active Claude run owns this permission request.',
          });
      },
    });
    const query = await withAbortableTimeout(
      creation,
      creationAbort,
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (this.queryCreationAbort === creationAbort) {
      this.queryCreationAbort = undefined;
    }
    if (!query) {
      channel.close();
      void creation.then(lateQuery => lateQuery.close(), () => undefined);
      throw new ExecutionDispatchError('Claude query creation did not complete safely.', true);
    }
    if (this.disposed || this.activeRun !== run || run.isTerminal) {
      channel.close();
      query.close();
      throw new ExecutionDispatchError('Claude execution preparation lost ownership.', true);
    }
    this.query = query;
    this.messageChannel = channel;
    this.querySessionIntent = intent;
    this.queryObservedSessionRef = undefined;
    this.restartFingerprint = invocation.restartFingerprint;
    this.appliedDynamic = {};
    this.queryGeneration += 1;
    const generation = this.queryGeneration;
    query.onConnectionLost(error => this.handleConnectionLost(query, generation, error));
    void this.consume(query, generation);
    this.resumeAtOverride = undefined;
  }

  private resolveSessionIntent(intent: ClaudeSessionIntent | undefined): ClaudeSessionIntent {
    if (intent?.kind === 'fork') {
      return intent;
    }
    const sessionId = intent?.kind === 'resume'
      ? intent.sessionId
      : this.nativeSessionRef;
    const resumeAt = this.resumeAtOverride
      ?? (intent?.kind === 'resume' ? intent.resumeAt : undefined);
    return sessionId
      ? { kind: 'resume', sessionId, ...(resumeAt ? { resumeAt } : {}) }
      : { kind: 'new' };
  }

  private async applyDynamicUpdates(
    next: ClaudeDynamicExecutionConfig,
    run: ClaudeExecutionRun,
  ): Promise<void> {
    const query = this.query;
    if (!query) {
      throw new Error('Claude persistent query is not active.');
    }
    if (next.model !== this.appliedDynamic.model) {
      await this.applyControl(query, run, query.setModel(next.model));
    }
    if (next.permissionMode !== undefined
      && next.permissionMode !== this.appliedDynamic.permissionMode) {
      await this.applyControl(query, run, query.setPermissionMode(next.permissionMode));
    }
    if (next.effortLevel !== undefined
      && next.effortLevel !== this.appliedDynamic.effortLevel) {
      await this.applyControl(
        query,
        run,
        query.applyFlagSettings({ effortLevel: next.effortLevel }),
      );
    }
    if (next.mcpServers !== undefined
      && stableStringify(next.mcpServers) !== stableStringify(this.appliedDynamic.mcpServers)) {
      await this.applyControl(query, run, query.setMcpServers({ ...next.mcpServers }));
    }
    this.appliedDynamic = copyDynamicConfig(next);
  }

  private async applyControl(
    query: ClaudeExecutionQuery,
    run: ClaudeExecutionRun,
    operation: Promise<unknown>,
  ): Promise<void> {
    const generation = this.queryGeneration;
    const completed = await withTimeout(
      operation.then(() => true),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (completed === true
      && this.isCurrentQuery(query, generation)
      && this.activeRun === run
      && !run.isTerminal) {
      return;
    }
    if (this.isCurrentQuery(query, generation)) {
      await this.closeQuery();
    }
    throw new ExecutionDispatchError('Claude dynamic control update lost ownership.', true);
  }

  private async consume(query: ClaudeExecutionQuery, generation: number): Promise<void> {
    try {
      for await (const message of query) {
        if (!this.isCurrentQuery(query, generation)) {
          return;
        }
        await this.routeMessage(message);
      }
      if (this.isCurrentQuery(query, generation) && !this.disposed) {
        this.handleConnectionLost(query, generation);
      }
    } catch (error) {
      if (this.isCurrentQuery(query, generation) && !this.disposed) {
        this.handleConnectionLost(
          query,
          generation,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  private async routeMessage(message: SDKMessage): Promise<void> {
    if ('session_id' in message && typeof message.session_id === 'string') {
      if (message.type === 'system' && message.subtype === 'init') {
        if (!await this.captureNativeSession(message.session_id)) {
          return;
        }
      } else if (this.nativeSessionRef && message.session_id !== this.nativeSessionRef) {
        return;
      }
    }
    if (!this.queryObservedSessionRef) {
      if (message.type === 'result') {
        await this.rejectSessionIdentity();
      }
      return;
    }
    // Before anything is read out of it, and before the branches below start
    // consuming messages the surface would never see otherwise: a subagent's
    // tool call, a task notification, the init that names the session. What the
    // renderer draws is the message itself, and the kernel carries it without
    // interpreting it.
    this.activeRun?.presentMessage(message);
    if (message.type === 'system') {
      if (message.subtype === 'task_started') {
        this.handleTaskStarted(message);
        return;
      }
      if (message.subtype === 'task_progress') {
        this.handleTaskProgress(message);
        return;
      }
      if (message.subtype === 'task_updated') {
        this.handleTaskUpdated(message);
        return;
      }
      if (message.subtype === 'task_notification') {
        this.handleTaskNotification(message);
        return;
      }
      if (message.subtype === 'background_tasks_changed') {
        this.handleBackgroundTasksChanged(message);
        return;
      }
    }
    if (message.type === 'assistant' && message.parent_tool_use_id) {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          this.observeSubagentTool(message.parent_tool_use_id, block.id, block.name);
        }
      }
      return;
    }
    if (message.type === 'stream_event'
      && message.parent_tool_use_id
      && message.event.type === 'content_block_start'
      && message.event.content_block.type === 'tool_use') {
      this.observeSubagentTool(
        message.parent_tool_use_id,
        message.event.content_block.id,
        message.event.content_block.name,
      );
      return;
    }
    if (message.type === 'result') {
      const messageId = typeof message.uuid === 'string' ? message.uuid : '';
      if (messageId) {
        if (this.seenResultMessageIds.has(messageId)) {
          return;
        }
        this.seenResultMessageIds.add(messageId);
        trimOldestSetEntries(this.seenResultMessageIds, 2048);
      }
      this.activeRun?.handleResult(message);
      return;
    }
    this.activeRun?.handleMessage(message);
  }

  private async captureNativeSession(sessionId: string): Promise<boolean> {
    requireNativeId(sessionId, 'Claude session id');
    if (this.queryObservedSessionRef) {
      if (this.queryObservedSessionRef === sessionId) {
        return true;
      }
      await this.rejectSessionIdentity();
      return false;
    }
    const intent = this.querySessionIntent;
    const valid = !intent
      || intent.kind === 'new'
      || (intent.kind === 'resume' && sessionId === intent.sessionId)
      || (intent.kind === 'fork' && sessionId !== intent.sourceSessionId);
    if (!valid) {
      await this.rejectSessionIdentity();
      return false;
    }
    this.queryObservedSessionRef = sessionId;
    this.nativeSessionRef = sessionId;
    return true;
  }

  private async rejectSessionIdentity(): Promise<void> {
    await this.closeQuery();
    this.activeRun?.handleSessionIdentityMismatch();
  }

  private handleTaskStarted(message: Extract<SDKMessage, {
    type: 'system'; subtype: 'task_started';
  }>): void {
    if (this.tasks.has(message.task_id) || this.completedTaskIds.has(message.task_id)) {
      return;
    }
    const parentTaskId = message.tool_use_id
      ? this.pendingTaskParents.get(message.tool_use_id)
      : undefined;
    const parentOwner = parentTaskId ? this.tasks.get(parentTaskId) : undefined;
    const owningRun = parentOwner?.run ?? this.activeRun;
    if (!owningRun || (owningRun.isTerminal && !parentOwner)) {
      return;
    }
    if (message.tool_use_id) {
      this.pendingTaskParents.delete(message.tool_use_id);
    }
    const owner: NativeTaskOwner = {
      taskId: message.task_id,
      run: owningRun,
      runId: owningRun.runId,
      turnId: owningRun.nativeRunRef ?? String(owningRun.runId),
      ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
      ...(parentTaskId ? { parentTaskId } : {}),
      ...createTerminalNotification(),
      terminal: false,
    };
    this.tasks.set(message.task_id, owner);
    this.liveTaskIds.add(message.task_id);
    if (message.tool_use_id) {
      this.toolUseToTask.set(message.tool_use_id, message.task_id);
    }
    this.emitTask(owner, {
      kind: 'native-agent-observed',
      nativeAgentKey: message.task_id,
      ...(parentTaskId ? { parentNativeAgentKey: parentTaskId } : {}),
    });
    this.emitTask(owner, {
      kind: 'native-agent-status',
      nativeAgentKey: message.task_id,
      status: 'running',
    });
  }

  private handleTaskProgress(message: Extract<SDKMessage, {
    type: 'system'; subtype: 'task_progress';
  }>): void {
    const owner = this.tasks.get(message.task_id);
    if (!owner || owner.terminal) {
      return;
    }
    this.emitTask(owner, {
      kind: 'progress',
      progressId: message.task_id,
      completed: message.usage.tool_uses,
    });
  }

  private handleTaskUpdated(message: Extract<SDKMessage, {
    type: 'system'; subtype: 'task_updated';
  }>): void {
    const owner = this.tasks.get(message.task_id);
    if (!owner || owner.terminal || !message.patch.status) {
      return;
    }
    const status = message.patch.status;
    this.emitTask(owner, {
      kind: 'native-agent-status',
      nativeAgentKey: message.task_id,
      status: status === 'completed'
        ? 'completed'
        : status === 'failed' || status === 'killed'
          ? 'failed'
          : status === 'paused'
            ? 'waiting'
            : 'running',
    });
  }

  private handleBackgroundTasksChanged(message: Extract<SDKMessage, {
    type: 'system'; subtype: 'background_tasks_changed';
  }>): void {
    this.backgroundTaskLevelIds.clear();
    for (const task of message.tasks) {
      this.backgroundTaskLevelIds.add(task.task_id);
    }
  }

  private hasLiveNativeTasks(): boolean {
    return this.liveTaskIds.size > 0
      || this.backgroundTaskLevelIds.size > 0
      || this.taskFinalizations.size > 0;
  }

  private handleTaskNotification(message: Extract<SDKMessage, {
    type: 'system'; subtype: 'task_notification';
  }>): void {
    if (this.completedTaskIds.has(message.task_id)) {
      return;
    }
    const owner = this.tasks.get(message.task_id);
    if (!owner || owner.terminal) {
      return;
    }
    owner.terminal = true;
    owner.resolveTerminalNotification(message.status);
    this.completedTaskIds.add(message.task_id);
    trimOldestSetEntries(this.completedTaskIds, 2048);
    this.liveTaskIds.delete(message.task_id);
    this.backgroundTaskLevelIds.delete(message.task_id);
    for (const [toolUseId, taskId] of this.toolUseToTask) {
      if (taskId === message.task_id) {
        this.toolUseToTask.delete(toolUseId);
      }
    }
    this.removePendingChildren(message.task_id);
    const abort = new AbortController();
    const task = this.finalizeTaskNotification(message, owner, abort.signal);
    this.taskFinalizations.set(message.task_id, { abort, task });
    void task.then(
      () => this.taskFinalizations.delete(message.task_id),
      () => this.taskFinalizations.delete(message.task_id),
    );
  }

  private async finalizeTaskNotification(
    message: Extract<SDKMessage, { type: 'system'; subtype: 'task_notification' }>,
    owner: NativeTaskOwner,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      if (message.status === 'completed') {
        const output = await this.loadTaskResult(message, this.nativeSessionRef, signal);
        if (signal.aborted || this.disposed) {
          return;
        }
      if (output) {
        const result = await owner.run.storeExternalResult(
          output,
          'native-agent',
          message.task_id,
          this.context.maxTaskResultBytes ?? 1024 * 1024,
        );
          if (result && !signal.aborted && !this.disposed) {
          this.emitTask(owner, {
            kind: 'native-agent-result',
            nativeAgentKey: message.task_id,
            result,
          });
        }
      }
        if (signal.aborted || this.disposed) {
          return;
        }
      this.emitTask(owner, {
        kind: 'native-agent-status',
        nativeAgentKey: message.task_id,
        status: 'completed',
      });
      } else if (!signal.aborted && !this.disposed) {
        this.emitTask(owner, {
          kind: 'native-agent-status',
          nativeAgentKey: message.task_id,
          status: message.status === 'stopped' ? 'closed' : 'failed',
        });
      }
    } finally {
      this.tasks.delete(message.task_id);
    }
  }

  private async loadTaskResult(message: Extract<SDKMessage, {
    type: 'system'; subtype: 'task_notification';
  }>, sessionId: string | undefined, signal: AbortSignal): Promise<string> {
    if (sessionId && message.output_file) {
      const abort = new AbortController();
      const forwardAbort = () => abort.abort(signal.reason);
      signal.addEventListener('abort', forwardAbort, { once: true });
      try {
        const output = await withAbortableTimeout(
          this.context.taskResultLoader.load({
            nativeSessionRef: sessionId,
            taskId: message.task_id,
            outputFile: message.output_file,
            maxBytes: this.context.maxTaskResultBytes ?? 1024 * 1024,
            signal: abort.signal,
          }),
          abort,
          this.context.scheduler,
          this.context.taskResultLoadTimeoutMs ?? 2_000,
        );
        if (output?.trim()) {
          return output.trim();
        }
      } catch {
        // The SDK summary is the bounded fallback when sidecar hydration fails.
      } finally {
        signal.removeEventListener('abort', forwardAbort);
      }
    }
    return signal.aborted ? '' : message.summary.trim();
  }

  observeSubagentTool(parentToolUseId: string, toolCallId: string, toolName?: string): void {
    const taskId = this.toolUseToTask.get(parentToolUseId);
    const owner = taskId ? this.tasks.get(taskId) : undefined;
    if (owner && !owner.terminal) {
      if (toolName === 'Task' && taskId) {
        this.pendingTaskParents.set(toolCallId, taskId);
      }
      this.emitTask(owner, { kind: 'tool-activity', toolCallId });
    }
  }

  private removePendingChildren(parentTaskId: string): void {
    for (const [toolUseId, taskId] of this.pendingTaskParents) {
      if (taskId === parentTaskId) {
        this.pendingTaskParents.delete(toolUseId);
      }
    }
  }

  private emitTask(owner: NativeTaskOwner, event: ExecutionEvent): void {
    const scope: ExecutionEventScope = {
      kind: 'agent',
      runId: owner.runId,
      agentInstanceId: owner.taskId,
      agentRunId: owner.taskId,
    };
    if (!owner.run.isTerminal) {
      owner.run.emitScoped(scope, event);
      return;
    }
    const delivery: ProviderExecutionEvent = {
      backendId: CLAUDE_EXECUTION_DESCRIPTOR.backendId,
      backendGeneration: this.config.backendGeneration,
      executionSessionId: this.config.executionSessionId,
      sessionInstanceId: this.sessionInstanceId,
      deliveryId: `${owner.runId}:detached:${++this.detachedDeliverySequence}`,
      occurredAt: (this.context.now ?? Date.now)(),
      scope,
      event,
    };
    this.publish(delivery);
  }

  private publish(event: ProviderExecutionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private handleConnectionLost(
    query: ClaudeExecutionQuery,
    generation: number,
    _error?: Error,
  ): void {
    if (!this.isCurrentQuery(query, generation)) {
      return;
    }
    this.query = undefined;
    this.queryGeneration += 1;
    this.querySessionIntent = undefined;
    this.queryObservedSessionRef = undefined;
    this.messageChannel?.close();
    this.messageChannel = undefined;
    this.restartFingerprint = undefined;
    this.backgroundTaskLevelIds.clear();
    query.close();
    this.activeRun?.handleConnectionLost();
  }

  private async closeQuery(): Promise<void> {
    const query = this.query;
    this.query = undefined;
    this.queryGeneration += 1;
    this.restartFingerprint = undefined;
    this.querySessionIntent = undefined;
    this.queryObservedSessionRef = undefined;
    this.appliedDynamic = {};
    this.backgroundTaskLevelIds.clear();
    this.messageChannel?.close();
    this.messageChannel = undefined;
    if (query) {
      query.close();
    }
  }

  private isCurrentQuery(query: ClaudeExecutionQuery, generation: number): boolean {
    return this.query === query && this.queryGeneration === generation;
  }
}

class ClaudeExecutionRun implements ExecutionRun {
  readonly events: AsyncIterable<ProviderExecutionEvent>;
  private readonly queue = new ExecutionEventQueue<ProviderExecutionEvent>();
  private readonly resultCommitAborts = new Set<AbortController>();
  private readonly seenMessageIds = new Set<string>();
  private readonly presentedMessageIds = new Set<string>();
  private terminal = false;
  private cancellation: CancellationReason | undefined;
  private nativeUserMessageId: string | undefined;
  private allowedTools: readonly string[] | undefined;
  private dispatched = false;
  private timeoutTriggered = false;
  private providerCompletionObserved = false;
  private completionTask: Promise<void> | undefined;
  private terminationTask: Promise<void> | undefined;
  private timeoutHandle: unknown;
  private deliverySequence = 0;
  private resolveFinished!: () => void;
  private readonly finished: Promise<void>;

  constructor(
    private readonly request: ExecutionRequest,
    private readonly config: ExecutionSessionConfig,
    private readonly sessionInstanceId: SessionInstanceId,
    private readonly context: ClaudeExecutionBackendContext,
    private readonly session: ClaudeExecutionSession,
    private readonly publish: (event: ProviderExecutionEvent) => void,
    private readonly permissionRequester: (input: {
      readonly toolName: string;
      readonly toolInput: Record<string, unknown>;
      readonly options: ClaudeToolPermissionOptions;
      readonly allowedTools?: readonly string[];
    }) => Promise<PermissionResult>,
    private readonly onTerminal: () => void,
  ) {
    this.events = this.queue;
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
  }

  get runId(): RunId {
    return this.request.runId;
  }

  get nativeRunRef(): string | undefined {
    return this.nativeUserMessageId;
  }

  get isTerminal(): boolean {
    return this.terminal;
  }

  get dispatchStarted(): boolean {
    return this.dispatched;
  }

  start(): void {
    void this.execute();
  }

  async cancel(reason: CancellationReason = { code: 'user' }): Promise<void> {
    if (this.terminal) {
      return;
    }
    this.cancellation ??= reason;
    if (this.providerCompletionObserved) {
      await this.completionTask;
      await this.finished;
      return;
    }
    if (!this.dispatched) {
      this.finish('cancelled', 'cancellation-confirmed', true);
      return;
    }
    await this.requestTermination();
    await this.finished;
  }

  /**
   * Forwards the message the surface renders, exactly as the SDK sent it.
   *
   * The backend was harvested before the kernel had a content channel, so it
   * reported facts about a turn — a tool started, a thought happened — and the
   * answer's text, and nothing a tool card, a plan or a task could be drawn
   * from. This is that channel: opaque to core, normalized by the provider's
   * own presenter, which is the same code the legacy runtime rendered with.
   *
   * Deduplicated against its own set: `handleMessage` keeps one for the facts
   * it derives, and sharing it would make the first reader hide the message
   * from the second.
   */
  presentMessage(message: SDKMessage): void {
    if (this.terminal) {
      return;
    }
    const uuid = 'uuid' in message && typeof message.uuid === 'string' ? message.uuid : undefined;
    if (uuid) {
      if (this.presentedMessageIds.has(uuid)) {
        return;
      }
      this.presentedMessageIds.add(uuid);
      trimOldestSetEntries(this.presentedMessageIds, 2048);
    }
    this.emit({ kind: 'provider-content', payload: message });
  }

  handleMessage(message: SDKMessage): void {
    if (this.terminal || this.isDuplicate(message)) {
      return;
    }
    if (message.type === 'assistant') {
      if (message.parent_tool_use_id) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            this.session.observeSubagentTool(message.parent_tool_use_id, block.id, block.name);
          }
        }
      } else if (message.error) {
        this.emit({ kind: 'tool-activity', toolCallId: `assistant-error:${message.uuid}` });
      } else {
        this.emit({ kind: 'thinking-activity' });
      }
      return;
    }
    if (message.type === 'stream_event') {
      const event = message.event;
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        if (message.parent_tool_use_id) {
          this.session.observeSubagentTool(
            message.parent_tool_use_id,
            event.content_block.id,
            event.content_block.name,
          );
        } else {
          this.emit({ kind: 'tool-activity', toolCallId: event.content_block.id });
        }
      } else if (event.type === 'content_block_delta' && !message.parent_tool_use_id) {
        // The SDK reports the answer twice: as deltas here and whole in the
        // final result message. The result stays the durable copy; these are
        // what let a turn be read while it is still running. Subagent deltas
        // are excluded — a nested agent's text is not the conversation's.
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          this.emit({ kind: 'output-delta', channel: 'assistant', text: delta.text });
        } else if (delta.type === 'thinking_delta') {
          this.emit({ kind: 'output-delta', channel: 'reasoning', text: delta.thinking });
        } else {
          this.emit({ kind: 'thinking-activity' });
        }
      } else if (!message.parent_tool_use_id) {
        this.emit({ kind: 'thinking-activity' });
      }
      return;
    }
  }

  handleResult(message: Extract<SDKMessage, { type: 'result' }>): void {
    if (this.terminal) {
      return;
    }
    const userMessageId = 'user_message_uuid' in message
      && typeof message.user_message_uuid === 'string'
      ? message.user_message_uuid.trim()
      : '';
    if (!userMessageId) {
      this.handleUncorrelatedResult();
      return;
    }
    if (userMessageId !== this.nativeUserMessageId) {
      return;
    }
    this.beginProviderCompletion(message);
  }

  handleConnectionLost(): void {
    if (this.terminal) {
      return;
    }
    this.emit({ kind: 'connection-lost' });
    void this.reconcileSafely();
  }

  handleSessionIdentityMismatch(): void {
    if (this.terminal) {
      return;
    }
    this.finish(
      this.dispatched ? 'indeterminate' : 'invalidated',
      this.dispatched ? 'effects-unknown' : 'pre-dispatch-rejected',
      !this.dispatched,
    );
  }

  openInteraction(interactionId: InteractionId, prepared: ClaudePreparedInteraction): void {
    if (this.terminal) {
      return;
    }
    this.emit({
      kind: 'interaction-opened',
      interaction: {
        interactionId,
        runId: this.request.runId,
        kind: prepared.kind,
        presentationRef: prepared.presentationRef,
        responseIds: prepared.responseIds,
      },
    });
  }

  resolveInteraction(interactionId: InteractionId, responseId: string): void {
    if (!this.terminal) {
      this.emit({ kind: 'interaction-resolved', interactionId, responseId });
    }
  }

  requestPermission(
    toolName: string,
    toolInput: Record<string, unknown>,
    options: ClaudeToolPermissionOptions,
  ): Promise<PermissionResult> {
    if (!this.dispatched || this.terminal) {
      return Promise.resolve({
        behavior: 'deny',
        message: 'The Claude run has not established dispatch ownership.',
      });
    }
    const allowedTools = this.allowedTools;
    if (allowedTools && !allowedTools.includes(toolName)) {
      return Promise.resolve({
        behavior: 'deny',
        message: `Tool "${toolName}" is outside the prepared Claude run policy.`,
      });
    }
    return this.permissionRequester({ toolName, toolInput, options, allowedTools });
  }

  emitScoped(scope: ExecutionEventScope, event: ExecutionEvent): void {
    this.emit(event, scope);
  }

  storeExternalResult(
    output: string,
    source: 'native-agent',
    nativeAgentKey: string,
    maxBytes: number,
  ): Promise<ResultRef | undefined> {
    return this.storeResult(output, source, maxBytes, nativeAgentKey, true);
  }

  private async execute(): Promise<void> {
    let invocation: ClaudeExecutionInvocation;
    try {
      invocation = await this.context.requestResolver.resolve(this.request.requestRef);
      validateInvocation(invocation);
      this.nativeUserMessageId = invocation.message.uuid;
      this.allowedTools = invocation.allowedTools ? [...invocation.allowedTools] : undefined;
    } catch {
      if (!this.terminal) {
        this.finish(
          this.cancellation ? 'cancelled' : 'invalidated',
          this.cancellation ? 'cancellation-confirmed' : 'pre-dispatch-rejected',
          true,
        );
      }
      return;
    }
    if (this.terminal || this.cancellation) {
      if (!this.terminal) {
        this.finish('cancelled', 'cancellation-confirmed', true);
      }
      return;
    }
    try {
      await this.session.prepareRun(invocation, this);
      if (this.terminal || this.cancellation) {
        if (!this.terminal) {
          this.finish('cancelled', 'cancellation-confirmed', true);
        }
        return;
      }
      this.dispatched = true;
      this.session.dispatch(invocation.message);
      this.emit({ kind: 'run-started' });
      this.timeoutHandle = this.context.scheduler.setTimeout(() => {
        if (this.providerCompletionObserved) {
          return;
        }
        this.timeoutTriggered = true;
        void this.requestTermination();
      }, this.context.runTimeoutMs ?? 10 * 60_000);
    } catch (error) {
      if (this.terminal) {
        return;
      }
      const sideEffectFree = !this.dispatched
        || (error instanceof ExecutionDispatchError && error.sideEffectFree);
      this.finish(
        sideEffectFree ? 'invalidated' : 'indeterminate',
        sideEffectFree ? 'pre-dispatch-rejected' : 'dispatch-unknown',
        sideEffectFree,
      );
    }
  }

  private async completeFromResult(
    message: Extract<SDKMessage, { type: 'result' }>,
  ): Promise<void> {
    if (this.terminal) {
      return;
    }
    this.session.completeTurn();
    if (message.subtype !== 'success' || message.is_error) {
      this.finish('failed', 'provider-failure');
      return;
    }
    const output = message.result.trim();
    if (!output) {
      this.finish(
        this.request.resultExpectation === 'required' ? 'failed' : 'succeeded',
        this.request.resultExpectation === 'required' ? 'missing-required-result' : 'completed',
      );
      return;
    }
    const result = await this.storeResult(
      output,
      'assistant',
      this.context.maxResultBytes ?? 1024 * 1024,
    );
    if (result && !this.terminal) {
      this.emit({ kind: 'result', result });
      this.finish('succeeded', 'completed');
    }
  }

  private beginProviderCompletion(
    message: Extract<SDKMessage, { type: 'result' }>,
  ): void {
    if (this.terminal || this.completionTask || this.cancellation || this.timeoutTriggered) {
      return;
    }
    this.providerCompletionObserved = true;
    if (this.timeoutHandle !== undefined) {
      this.context.scheduler.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    this.completionTask = this.completeFromResult(message);
  }

  private handleUncorrelatedResult(): void {
    if (this.terminal || this.completionTask || this.cancellation || this.timeoutTriggered) {
      return;
    }
    this.providerCompletionObserved = true;
    if (this.timeoutHandle !== undefined) {
      this.context.scheduler.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    this.completionTask = this.reconcileSafely();
  }

  private async storeResult(
    output: string,
    source: 'assistant' | 'native-agent',
    maxBytes: number,
    nativeAgentKey?: string,
    allowAfterTerminal = false,
  ): Promise<ResultRef | undefined> {
    if (this.terminal && !allowAfterTerminal) {
      return undefined;
    }
    if (Buffer.byteLength(output, 'utf8') > maxBytes) {
      if (!this.terminal) {
        this.finish('failed', 'output-limit');
      }
      return undefined;
    }
    const abort = new AbortController();
    this.resultCommitAborts.add(abort);
    const settlement = await settleResultCommit(
      Promise.resolve().then(() => this.context.resultSink.storeResult({
        runId: this.request.runId,
        output,
        source,
        ...(nativeAgentKey ? { nativeAgentKey } : {}),
        signal: abort.signal,
      })),
      abort,
      this.context.scheduler,
      this.context.resultCommitTimeoutMs ?? 2_000,
    );
    this.resultCommitAborts.delete(abort);
    if (settlement.kind === 'committed') {
      return settlement.result;
    }
    if (!this.terminal) {
      this.finish(
        settlement.kind === 'unknown' ? 'indeterminate' : 'failed',
        settlement.kind === 'unknown' ? 'effects-unknown' : 'provider-failure',
      );
    }
    return undefined;
  }

  private requestTermination(): Promise<void> {
    if (this.terminationTask) {
      return this.terminationTask;
    }
    this.terminationTask = this.terminate();
    return this.terminationTask;
  }

  private async terminate(): Promise<void> {
    try {
      await this.session.interrupt();
      if (this.terminal) {
        return;
      }
      if (this.timeoutTriggered) {
        this.finish('failed', 'timeout');
      } else {
        this.emit({ kind: 'cancellation-acknowledged' });
        this.finish('cancelled', 'cancellation-confirmed');
      }
    } catch {
      await this.reconcileSafely();
    }
  }

  private async reconcileSafely(): Promise<void> {
    if (this.terminal) {
      return;
    }
    this.emit({ kind: 'recovery-started' });
    let evidence: ClaudeReconciliationEvidence;
    try {
      evidence = await this.session.reconcileRun(this);
    } catch {
      evidence = { kind: 'unknown', effectsPossible: true };
    }
    if (this.terminal) {
      return;
    }
    if (evidence.kind === 'terminal') {
      if (evidence.terminal.resultRef) {
        this.emit({ kind: 'result', result: evidence.terminal.resultRef });
      }
      this.finish(evidence.terminal.kind, evidence.terminal.reason);
      return;
    }
    this.finish(
      evidence.effectsPossible ? 'indeterminate' : 'interrupted',
      this.cancellation
        ? 'cancellation-unknown'
        : evidence.effectsPossible
          ? 'effects-unknown'
          : 'recovery-exhausted-safe',
    );
  }

  private isDuplicate(message: SDKMessage): boolean {
    const uuid = 'uuid' in message && typeof message.uuid === 'string' ? message.uuid : undefined;
    if (!uuid) {
      return false;
    }
    if (this.seenMessageIds.has(uuid)) {
      return true;
    }
    this.seenMessageIds.add(uuid);
    return false;
  }

  private emit(event: ExecutionEvent, scope?: ExecutionEventScope): void {
    const delivery: ProviderExecutionEvent = {
      backendId: CLAUDE_EXECUTION_DESCRIPTOR.backendId,
      backendGeneration: this.config.backendGeneration,
      executionSessionId: this.config.executionSessionId,
      sessionInstanceId: this.sessionInstanceId,
      deliveryId: `${this.request.runId}:${++this.deliverySequence}`,
      occurredAt: (this.context.now ?? Date.now)(),
      scope: scope ?? {
        kind: 'run',
        runId: this.request.runId,
        ...(this.nativeUserMessageId ? { nativeRunRef: this.nativeUserMessageId } : {}),
      },
      event,
    };
    this.queue.push(delivery);
    this.publish(delivery);
  }

  private finish(
    terminal: RunTerminalKind,
    reason: RunTerminalReason,
    sideEffectFree = false,
  ): void {
    if (this.terminal) {
      return;
    }
    this.terminal = true;
    if (this.timeoutHandle !== undefined) {
      this.context.scheduler.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    for (const abort of this.resultCommitAborts) {
      abort.abort();
    }
    this.emit({
      kind: 'terminal',
      terminal,
      reason,
      ...(sideEffectFree ? { sideEffectFree: true } : {}),
    });
    this.queue.close();
    this.onTerminal();
    this.resolveFinished();
  }
}

function validateInvocation(invocation: ClaudeExecutionInvocation): void {
  requireOpaqueRef(invocation.startupRef, 'Claude startup reference');
  if (!invocation.restartFingerprint.trim() || invocation.restartFingerprint.length > 512) {
    throw new Error('Claude restart fingerprint is invalid.');
  }
  requireNativeId(invocation.message.uuid ?? '', 'Claude user message id');
  if (invocation.session?.kind === 'resume') {
    requireNativeId(invocation.session.sessionId, 'Claude resume session id');
  } else if (invocation.session?.kind === 'fork') {
    requireNativeId(invocation.session.sourceSessionId, 'Claude fork session id');
    requireNativeId(invocation.session.resumeAt, 'Claude fork checkpoint id');
  }
}

function validatePreparedInteraction(prepared: ClaudePreparedInteraction): void {
  requireOpaqueRef(prepared.presentationRef, 'Claude interaction presentation');
  if (prepared.responseIds.length === 0
    || !prepared.responseIds.includes(prepared.providerResolvedResponseId)) {
    throw new Error('Claude interaction responses are invalid.');
  }
  for (const responseId of prepared.responseIds) {
    requireOpaqueRef(responseId, 'Claude interaction response');
  }
}

function requireNativeId(value: string, label: string): void {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || hasControlCharacter(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 31) {
      return true;
    }
  }
  return false;
}

function requireOpaqueRef(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive.`);
  }
}

function copyDynamicConfig(config: ClaudeDynamicExecutionConfig): ClaudeDynamicExecutionConfig {
  return {
    ...(config.model !== undefined ? { model: config.model } : {}),
    ...(config.permissionMode !== undefined ? { permissionMode: config.permissionMode } : {}),
    ...(config.effortLevel !== undefined ? { effortLevel: config.effortLevel } : {}),
    ...(config.mcpServers !== undefined ? { mcpServers: { ...config.mcpServers } } : {}),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function trimOldestMapEntries<K, V>(map: Map<K, V>, maximum: number): void {
  while (map.size > maximum) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    map.delete(oldest);
  }
}

function trimOldestSetEntries<T>(set: Set<T>, maximum: number): void {
  while (set.size > maximum) {
    const oldest = set.values().next().value;
    if (oldest === undefined) {
      return;
    }
    set.delete(oldest);
  }
}

function createTerminalNotification(): Pick<
NativeTaskOwner,
'terminalNotification' | 'resolveTerminalNotification'
> {
  let resolveTerminalNotification!: (status: 'completed' | 'failed' | 'stopped') => void;
  const terminalNotification = new Promise<'completed' | 'failed' | 'stopped'>(resolve => {
    resolveTerminalNotification = resolve;
  });
  return { terminalNotification, resolveTerminalNotification };
}

function withTimeout<T>(
  operation: Promise<T>,
  scheduler: ClaudeExecutionScheduler,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: T | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      scheduler.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = scheduler.setTimeout(() => finish(undefined), timeoutMs);
    void operation.then(value => finish(value), () => finish(undefined));
  });
}

function withAbortableTimeout<T>(
  operation: Promise<T>,
  abort: AbortController,
  scheduler: ClaudeExecutionScheduler,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: T | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      scheduler.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = scheduler.setTimeout(() => {
      abort.abort();
      finish(undefined);
    }, timeoutMs);
    void operation.then(value => finish(value), () => finish(undefined));
  });
}
