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
  type RunTerminalKind,
  type RunTerminalReason,
  type Unsubscribe,
} from '@/core/execution/ExecutionContracts';
import { ExecutionEventQueue } from '@/core/execution/ExecutionEventQueue';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import type { InteractionId, RunId, SessionInstanceId } from '@/core/execution/ExecutionIds';
import {
  type ResultCommitOutcome,
  settleResultCommit,
} from '@/core/execution/ResultCommit';

import type {
  AgentMessageDeltaNotification,
  AgentMessageItem,
  CollabAgentToolCallItem,
  ItemCompletedNotification,
  ItemStartedNotification,
  ThreadForkResult,
  ThreadResumeParams,
  ThreadResumeResult,
  ThreadStartParams,
  ThreadStartResult,
  Turn,
  TurnCompletedNotification,
  TurnStartParams,
  TurnStartResult,
  TurnSteerResult,
  UserInput,
} from '../runtime/codexAppServerTypes';
import type {
  CodexExecutionConnection,
  CodexExecutionServerRequestHandler,
} from '../runtime/CodexExecutionConnection';

export interface CodexExecutionConnectionFactory {
  create(): CodexExecutionConnection;
}

export type CodexThreadIntent =
  | {
    readonly kind: 'new';
    readonly params: ThreadStartParams;
  }
  | {
    readonly kind: 'resume';
    readonly threadId: string;
    readonly params: Omit<ThreadResumeParams, 'threadId'>;
  }
  | {
    readonly kind: 'fork';
    readonly sourceThreadId: string;
    readonly resumeAtTurnId: string;
    readonly resumeParams: Omit<ThreadResumeParams, 'threadId'>;
  };

export interface CodexExecutionInvocation {
  readonly thread: CodexThreadIntent;
  readonly turn:
    | { readonly kind: 'start'; readonly params: Omit<TurnStartParams, 'threadId'> }
    | { readonly kind: 'compact' };
}

export interface CodexExecutionRequestResolver {
  resolve(requestRef: string): Promise<CodexExecutionInvocation>;
  resolveSteer(requestRef: string): Promise<readonly UserInput[]>;
}

export interface CodexExecutionResultSink {
  storeResult(input: {
    readonly runId: RunId;
    readonly output: string;
    readonly source: 'assistant' | 'native-agent';
    readonly nativeAgentKey?: string;
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome>;
}

export interface CodexPreparedInteraction {
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly providerResolvedResponseId: string;
  resolve(responseId: string): Promise<unknown>;
  cancel(): Promise<unknown>;
}

export interface CodexInteractionBridge {
  prepare(input: {
    readonly method: string;
    readonly params: unknown;
  }): Promise<CodexPreparedInteraction>;
}

export type CodexTurnReconciliationEvidence =
  | { readonly kind: 'turn'; readonly turn: Turn }
  | { readonly kind: 'running' }
  | { readonly kind: 'unknown' };

export interface CodexTurnReconciler {
  reconcile(input: {
    readonly threadId: string;
    readonly turnId: string;
  }): Promise<CodexTurnReconciliationEvidence>;
}

export interface CodexTurnReconcilerFactory {
  create(connection: CodexExecutionConnection): CodexTurnReconciler;
}

export interface CodexExecutionScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CodexExecutionBackendContext {
  readonly connectionFactory: CodexExecutionConnectionFactory;
  readonly requestResolver: CodexExecutionRequestResolver;
  readonly resultSink: CodexExecutionResultSink;
  readonly interactionBridge: CodexInteractionBridge;
  readonly turnReconcilerFactory: CodexTurnReconcilerFactory;
  readonly defaultResumeParams: Omit<ThreadResumeParams, 'threadId'>;
  readonly scheduler: CodexExecutionScheduler;
  readonly sessionInstanceIdFactory: () => SessionInstanceId;
  readonly interactionIdFactory: () => InteractionId;
  readonly now?: () => number;
  readonly resultCommitTimeoutMs?: number;
  readonly recoveryDelayMs?: number;
  readonly cancellationTurnIdTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly maxResultBytes?: number;
}

export const CODEX_EXECUTION_DESCRIPTOR: ExecutionBackendDescriptor = Object.freeze({
  backendId: executionBackendId('provider-codex'),
  association: Object.freeze({ kind: 'provider', providerId: 'codex' }),
});

interface PendingInteraction {
  readonly nativeRequestKey: string;
  readonly interactionId: InteractionId;
  readonly run: CodexExecutionRun;
  readonly prepared: CodexPreparedInteraction;
  readonly resolveNative: (response: unknown) => void;
  selectedResponseId?: string;
  settled: boolean;
}

interface CodexExecutionServices {
  readonly connection: CodexExecutionConnection;
  readonly turnReconciler: CodexTurnReconciler;
}

type CodexExecutionServicesProvider = () => Promise<CodexExecutionServices>;

export class CodexExecutionBackend implements
ExecutionBackend,
InteractionPort,
ExecutionRecoveryPort {
  readonly descriptor = CODEX_EXECUTION_DESCRIPTOR;
  private readonly sessions = new Set<CodexExecutionSession>();
  private readonly sessionsByThread = new Map<string, CodexExecutionSession>();
  private readonly interactions = new Map<InteractionId, PendingInteraction>();
  private readonly interactionsByNativeRequest = new Map<string, PendingInteraction>();
  private servicesTask: Promise<CodexExecutionServices> | undefined;
  private activeServices: CodexExecutionServices | undefined;
  private readonly retiredConnectionTasks = new Set<Promise<void>>();
  private disposing = false;

  constructor(private readonly context: CodexExecutionBackendContext) {
    requirePositive(context.resultCommitTimeoutMs ?? 2_000, 'Codex result commit timeout');
    requirePositive(context.recoveryDelayMs ?? 250, 'Codex recovery delay');
    requirePositive(
      context.cancellationTurnIdTimeoutMs ?? 2_000,
      'Codex cancellation turn-id timeout',
    );
    requirePositive(context.runTimeoutMs ?? 10 * 60_000, 'Codex run timeout');
    requirePositive(context.maxResultBytes ?? 1024 * 1024, 'Codex result byte limit');
  }

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposing) {
      throw new Error('Codex execution backend is disposing.');
    }
    await this.ensureServices();
    const session = new CodexExecutionSession(
      config,
      this.context,
      () => this.ensureServices(),
      (threadId, owner) => this.bindThread(threadId, owner),
      () => this.sessions.delete(session),
      run => this.handleRunTerminal(run),
    );
    if (config.nativeSessionRef) {
      session.restoreThreadRef(config.nativeSessionRef);
    }
    this.sessions.add(session);
    return session;
  }

  async resolve(resolution: InteractionResolution): Promise<void> {
    const pending = this.interactions.get(resolution.interactionId);
    if (!pending) {
      throw new Error('Codex interaction is not pending.');
    }
    if (pending.selectedResponseId && pending.selectedResponseId !== resolution.responseId) {
      throw new Error('Codex interaction is already resolving another response.');
    }
    if (pending.settled) {
      return;
    }
    if (!pending.prepared.responseIds.includes(resolution.responseId)) {
      throw new Error('Codex interaction response is not allowed.');
    }
    pending.selectedResponseId = resolution.responseId;
    const response = await pending.prepared.resolve(resolution.responseId);
    this.settleInteraction(pending, resolution.responseId, response, true);
  }

  async cancel(interactionId: InteractionId): Promise<void> {
    const pending = this.interactions.get(interactionId);
    if (!pending || pending.settled) {
      return;
    }
    const response = await pending.prepared.cancel();
    this.settleInteraction(
      pending,
      pending.prepared.providerResolvedResponseId,
      response,
      false,
    );
  }

  steer(executionSessionId: string, requestRef: string): Promise<boolean> {
    const session = [...this.sessions].find(
      candidate => candidate.executionSessionId === executionSessionId,
    );
    return session ? session.steer(requestRef) : Promise.resolve(false);
  }

  async reconcile(query: RunRecoveryQuery): Promise<RunRecoveryEvidence> {
    if (query.backendId !== this.descriptor.backendId
      || !query.nativeSessionRef
      || !query.nativeRunRef) {
      return { kind: 'unknown', effectsPossible: true };
    }
    try {
      const services = await this.ensureServices();
      const session = this.sessionsByThread.get(query.nativeSessionRef);
      if (!session?.getThreadState().loaded) {
        await services.connection.request<ThreadResumeResult>('thread/resume', {
          ...this.context.defaultResumeParams,
          threadId: query.nativeSessionRef,
        });
        session?.markLoaded();
      }
      const evidence = await services.turnReconciler.reconcile({
        threadId: query.nativeSessionRef,
        turnId: query.nativeRunRef,
      });
      if (evidence.kind === 'running') {
        // Durable recovery does not recreate an ExecutionRun event attachment yet.
        return { kind: 'unknown', effectsPossible: true };
      }
      if (evidence.kind === 'unknown') {
        return { kind: 'unknown', effectsPossible: true };
      }
      return this.recoveryEvidenceFromTurn(query, evidence.turn);
    } catch {
      return { kind: 'unknown', effectsPossible: true };
    }
  }

  async dispose(): Promise<void> {
    if (this.disposing) {
      return;
    }
    this.disposing = true;
    await Promise.all([...this.sessions].map(session => session.dispose()));
    const services = await this.servicesTask?.catch(() => undefined);
    await services?.connection.dispose();
    await Promise.all([...this.retiredConnectionTasks]);
    this.interactions.clear();
    this.interactionsByNativeRequest.clear();
  }

  private ensureServices(): Promise<CodexExecutionServices> {
    if (this.disposing) {
      return Promise.reject(new Error('Codex execution backend is disposing.'));
    }
    if (this.servicesTask) {
      return this.servicesTask;
    }
    const connection = this.context.connectionFactory.create();
    connection.onNotification((method, params) => this.handleNotification(method, params));
    connection.onServerRequest(this.handleServerRequest);
    connection.onConnectionLost(error => this.handleConnectionLost(connection, error));
    const task = (async () => {
      await connection.initialize();
      const services: CodexExecutionServices = {
        connection,
        turnReconciler: this.context.turnReconcilerFactory.create(connection),
      };
      if (this.disposing) {
        await connection.dispose();
        throw new Error('Codex execution backend was disposed during initialization.');
      }
      this.activeServices = services;
      return services;
    })();
    this.servicesTask = task;
    void task.catch(() => {
      if (this.servicesTask === task) {
        this.servicesTask = undefined;
        this.activeServices = undefined;
      }
      this.retireConnection(connection);
    });
    return task;
  }

  private handleConnectionLost(connection: CodexExecutionConnection, error?: Error): void {
    if (this.activeServices?.connection === connection) {
      this.activeServices = undefined;
      this.servicesTask = undefined;
    }
    if (!this.disposing) {
      for (const session of this.sessions) {
        session.handleConnectionLost(error);
      }
    }
    this.retireConnection(connection);
  }

  private retireConnection(connection: CodexExecutionConnection): void {
    const cleanup = connection.dispose().catch(() => undefined);
    this.retiredConnectionTasks.add(cleanup);
    void cleanup.finally(() => this.retiredConnectionTasks.delete(cleanup));
  }

  private async recoveryEvidenceFromTurn(
    query: RunRecoveryQuery,
    turn: Turn,
  ): Promise<RunRecoveryEvidence> {
    if (turn.status === 'inProgress') {
      // Startup recovery has no live ExecutionRun attachment for this turn yet.
      return { kind: 'unknown', effectsPossible: true };
    }
    const occurredAt = (this.context.now ?? Date.now)();
    if (turn.status === 'failed') {
      return {
        kind: 'terminal',
        terminal: { kind: 'failed', reason: 'provider-failure', occurredAt },
      };
    }
    if (turn.status === 'interrupted') {
      return {
        kind: 'terminal',
        terminal: query.cancellationRequested
          ? { kind: 'cancelled', reason: 'cancellation-confirmed', occurredAt }
          : { kind: 'interrupted', reason: 'known-process-exit', occurredAt },
      };
    }
    const output = extractTurnOutput(turn);
    if (!output) {
      return {
        kind: 'terminal',
        terminal: query.resultExpectation === 'required'
          ? { kind: 'failed', reason: 'missing-required-result', occurredAt }
          : { kind: 'succeeded', reason: 'completed', occurredAt },
      };
    }
    if (Buffer.byteLength(output, 'utf8') > (this.context.maxResultBytes ?? 1024 * 1024)) {
      return {
        kind: 'terminal',
        terminal: { kind: 'failed', reason: 'output-limit', occurredAt },
      };
    }
    const abort = new AbortController();
    const settlement = await settleResultCommit(
      this.context.resultSink.storeResult({
        runId: query.runId,
        output,
        source: 'assistant',
        signal: abort.signal,
      }),
      abort,
      this.context.scheduler,
      this.context.resultCommitTimeoutMs ?? 2_000,
    );
    if (settlement.kind !== 'committed') {
      return { kind: 'unknown', effectsPossible: true };
    }
    return {
      kind: 'terminal',
      terminal: {
        kind: 'succeeded',
        reason: 'completed',
        occurredAt,
        resultRef: settlement.result,
      },
    };
  }

  private readonly handleServerRequest: CodexExecutionServerRequestHandler = async (
    requestId,
    method,
    params,
  ) => {
    const scope = extractScope(params);
    const session = scope ? this.sessionsByThread.get(scope.threadId) : undefined;
    const run = session?.activeExecutionRun;
    if (!run || !scope) {
      throw new Error('Codex server request has no owned execution run.');
    }
    const prepared = await this.context.interactionBridge.prepare({ method, params });
    validatePreparedInteraction(prepared);
    if (run.isTerminal || !await run.matchesNativeTurn(scope.turnId)) {
      return prepared.cancel();
    }
    const interactionId = this.context.interactionIdFactory();
    const nativeKey = nativeRequestKey(requestId);
    return new Promise<unknown>(resolveNative => {
      const pending: PendingInteraction = {
        nativeRequestKey: nativeKey,
        interactionId,
        run,
        prepared,
        resolveNative,
        settled: false,
      };
      this.interactions.set(interactionId, pending);
      this.interactionsByNativeRequest.set(nativeKey, pending);
      run.openInteraction(interactionId, method, prepared);
    });
  };

  private handleNotification(method: string, params: unknown): void {
    if (method === 'serverRequest/resolved') {
      const requestId = readRecord(params)?.requestId;
      if (typeof requestId === 'string' || typeof requestId === 'number') {
        const pending = this.interactionsByNativeRequest.get(nativeRequestKey(requestId));
        if (pending && !pending.settled) {
          void pending.prepared.cancel().then(
            response => {
              this.settleInteraction(
                pending,
                pending.prepared.providerResolvedResponseId,
                response,
                true,
              );
            },
            () => this.settleInteraction(
              pending,
              pending.prepared.providerResolvedResponseId,
              undefined,
              true,
            ),
          );
        }
      }
      return;
    }
    const scope = extractScope(params);
    if (!scope) {
      return;
    }
    this.sessionsByThread.get(scope.threadId)?.handleNotification(method, params);
  }

  private settleInteraction(
    pending: PendingInteraction,
    responseId: string,
    response: unknown,
    emit: boolean,
  ): void {
    if (pending.settled) {
      return;
    }
    pending.settled = true;
    pending.resolveNative(response);
    this.interactions.delete(pending.interactionId);
    this.interactionsByNativeRequest.delete(pending.nativeRequestKey);
    if (emit) {
      pending.run.resolveInteraction(pending.interactionId, responseId);
    }
  }

  private bindThread(threadId: string, session: CodexExecutionSession): void {
    for (const [existingThreadId, owner] of this.sessionsByThread) {
      if (owner === session && existingThreadId !== threadId) {
        this.sessionsByThread.delete(existingThreadId);
      }
    }
    const existing = this.sessionsByThread.get(threadId);
    if (existing && existing !== session) {
      throw new Error('Codex native thread is already owned by another execution session.');
    }
    this.sessionsByThread.set(threadId, session);
  }

  private handleRunTerminal(run: CodexExecutionRun): void {
    for (const pending of this.interactions.values()) {
      if (pending.run !== run || pending.settled) {
        continue;
      }
      void pending.prepared.cancel().then(
        response => this.settleInteraction(
          pending,
          pending.prepared.providerResolvedResponseId,
          response,
          false,
        ),
        () => this.settleInteraction(
          pending,
          pending.prepared.providerResolvedResponseId,
          undefined,
          false,
        ),
      );
    }
  }
}

class CodexExecutionSession implements ExecutionSession {
  readonly sessionInstanceId: SessionInstanceId;
  private readonly listeners = new Set<(event: ProviderExecutionEvent) => void>();
  private activeRun: CodexExecutionRun | undefined;
  private nativeThreadId: string | undefined;
  private lastNativeTurnId: string | undefined;
  private loadedInConnection = false;
  private disposed = false;

  constructor(
    private readonly config: ExecutionSessionConfig,
    private readonly context: CodexExecutionBackendContext,
    private readonly servicesProvider: CodexExecutionServicesProvider,
    private readonly onBindThread: (threadId: string, session: CodexExecutionSession) => void,
    private readonly onDispose: () => void,
    private readonly onRunTerminal: (run: CodexExecutionRun) => void,
  ) {
    this.sessionInstanceId = context.sessionInstanceIdFactory();
  }

  get executionSessionId() {
    return this.config.executionSessionId;
  }

  get activeExecutionRun(): CodexExecutionRun | undefined {
    return this.activeRun;
  }

  createRun(request: ExecutionRequest): ExecutionRun {
    if (this.disposed) {
      throw new ExecutionDispatchError('Codex execution session is disposed.', true);
    }
    if (this.activeRun) {
      throw new ExecutionDispatchError('Codex execution session already has an active turn.', true);
    }
    const run = new CodexExecutionRun(
      request,
      this.config,
      this.sessionInstanceId,
      this.context,
      this.servicesProvider,
      this,
      event => {
        for (const listener of this.listeners) {
          listener(event);
        }
      },
      () => {
        this.lastNativeTurnId = run.nativeTurnId ?? this.lastNativeTurnId;
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
      ...(this.nativeThreadId ? { nativeSessionRef: this.nativeThreadId } : {}),
    };
  }

  subscribe(listener: (event: ProviderExecutionEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async steer(requestRef: string): Promise<boolean> {
    const run = this.activeRun;
    if (!run) {
      return false;
    }
    const input = await this.context.requestResolver.resolveSteer(requestRef);
    return run.steer(input);
  }

  handleNotification(method: string, params: unknown): void {
    this.activeRun?.handleNotification(method, params);
  }

  handleConnectionLost(_error?: Error): void {
    this.activeRun?.handleConnectionLost();
    this.loadedInConnection = false;
  }

  getThreadState(): { readonly threadId?: string; readonly loaded: boolean } {
    return { threadId: this.nativeThreadId, loaded: this.loadedInConnection };
  }

  getPreviousNativeTurnId(): string | undefined {
    return this.lastNativeTurnId;
  }

  bindThread(threadId: string): void {
    requireNativeId(threadId, 'Codex thread id');
    this.onBindThread(threadId, this);
    this.nativeThreadId = threadId;
    this.loadedInConnection = true;
  }

  restoreThreadRef(threadId: string): void {
    requireNativeId(threadId, 'Codex restored thread id');
    this.onBindThread(threadId, this);
    this.nativeThreadId = threadId;
    this.loadedInConnection = false;
  }

  markLoaded(): void {
    this.loadedInConnection = true;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.activeRun?.cancel({ code: 'shutdown' });
    this.activeRun = undefined;
    this.listeners.clear();
    this.onDispose();
  }
}

interface BufferedNotification {
  readonly method: string;
  readonly params: unknown;
}

class CodexExecutionRun implements ExecutionRun {
  readonly events: AsyncIterable<ProviderExecutionEvent>;
  private readonly queue = new ExecutionEventQueue<ProviderExecutionEvent>();
  private readonly bufferedNotifications: BufferedNotification[] = [];
  private agentTaskChain: Promise<void> = Promise.resolve();
  private readonly resultCommitAborts = new Set<AbortController>();
  private readonly completedItemIds = new Set<string>();
  private readonly turnWaiters = new Set<(turnId: string | undefined) => void>();
  private terminal = false;
  private cancellation: CancellationReason | undefined;
  private nativePreparationStarted = false;
  private turnDispatchStarted = false;
  private turnId: string | undefined;
  private turnStartedMayEstablish = false;
  private turnStartedEmitted = false;
  private assistantOutput = '';
  private outputLimitTriggered = false;
  private cancellationAcknowledged = false;
  private timeoutTriggered = false;
  private runTimeoutHandle: unknown;
  private recoveryTask: Promise<void> | undefined;
  private completionTask: Promise<void> | undefined;
  private terminationTask: Promise<void> | undefined;
  private resolveFinished!: () => void;
  private readonly finished: Promise<void>;

  constructor(
    private readonly request: ExecutionRequest,
    private readonly config: ExecutionSessionConfig,
    private readonly sessionInstanceId: SessionInstanceId,
    private readonly context: CodexExecutionBackendContext,
    private readonly servicesProvider: CodexExecutionServicesProvider,
    private readonly session: CodexExecutionSession,
    private readonly publish: (event: ProviderExecutionEvent) => void,
    private readonly onTerminal: () => void,
  ) {
    this.events = this.queue;
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
  }

  private connection: CodexExecutionConnection | undefined;
  private turnReconciler: CodexTurnReconciler | undefined;

  get runId() {
    return this.request.runId;
  }

  get isTerminal(): boolean {
    return this.terminal;
  }

  get nativeTurnId(): string | undefined {
    return this.turnId;
  }

  start(): void {
    void this.execute();
  }

  async cancel(reason: CancellationReason = { code: 'user' }): Promise<void> {
    if (this.terminal) {
      return;
    }
    this.cancellation ??= reason;
    for (const abort of this.resultCommitAborts) {
      abort.abort();
    }
    if (!this.turnDispatchStarted) {
      if (!this.nativePreparationStarted) {
        this.finish('cancelled', 'cancellation-confirmed', true);
        return;
      }
      if (!await this.waitForFinishedWithin(
        this.context.cancellationTurnIdTimeoutMs ?? 2_000,
      )) {
        this.finish('indeterminate', 'effects-unknown');
      }
      return;
    }
    const turnId = this.turnId ?? await this.waitForTurnId();
    const threadId = this.session.getThreadState().threadId;
    if (!turnId || !threadId || this.terminal) {
      if (!this.terminal) {
        this.finish('indeterminate', 'dispatch-unknown');
      }
      return;
    }
    await this.requestTurnTermination();
    await this.finished;
  }

  async steer(input: readonly UserInput[]): Promise<boolean> {
    const threadId = this.session.getThreadState().threadId;
    const turnId = this.turnId;
    if (this.terminal || this.cancellation || !threadId || !turnId || input.length === 0) {
      return false;
    }
    const result = await this.requireConnection().request<TurnSteerResult>('turn/steer', {
      threadId,
      input,
      expectedTurnId: turnId,
    });
    return !this.terminal && !this.cancellation && result.turnId === turnId;
  }

  handleNotification(method: string, params: unknown): void {
    if (this.terminal) {
      return;
    }
    if (method === 'turn/started') {
      const record = readRecord(params);
      const turn = readRecord(record?.turn);
      const turnId = readString(turn?.id);
      if (turnId
        && (this.turnId !== undefined || (
          this.turnStartedMayEstablish
          && turnId !== this.session.getPreviousNativeTurnId()
        ))) {
        this.establishTurn(turnId);
      }
      return;
    }
    const scope = extractScope(params);
    if (!scope || scope.threadId !== this.session.getThreadState().threadId) {
      return;
    }
    if (!this.turnId) {
      this.bufferedNotifications.push({ method, params });
      return;
    }
    if (scope.turnId && scope.turnId !== this.turnId) {
      return;
    }
    this.applyNotification(method, params);
  }

  async matchesNativeTurn(turnId: string | undefined): Promise<boolean> {
    if (!turnId) {
      return false;
    }
    const ownedTurnId = this.turnId ?? await this.waitForTurnId();
    return !this.terminal && ownedTurnId === turnId;
  }

  handleConnectionLost(): void {
    if (this.terminal) {
      return;
    }
    this.emit({ kind: 'connection-lost' });
    void this.reconcileSafely();
  }

  openInteraction(
    interactionId: InteractionId,
    method: string,
    prepared: CodexPreparedInteraction,
  ): void {
    if (this.terminal) {
      return;
    }
    this.emit({
      kind: 'interaction-opened',
      interaction: {
        interactionId,
        runId: this.request.runId,
        kind: method === 'item/tool/requestUserInput' ? 'question' : 'approval',
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

  private async execute(): Promise<void> {
    let invocation: CodexExecutionInvocation;
    try {
      invocation = await this.context.requestResolver.resolve(this.request.requestRef);
    } catch {
      this.finish(
        this.cancellation ? 'cancelled' : 'invalidated',
        this.cancellation ? 'cancellation-confirmed' : 'pre-dispatch-rejected',
        true,
      );
      return;
    }
    if (this.cancellation) {
      this.finish('cancelled', 'cancellation-confirmed', true);
      return;
    }
    try {
      const services = await this.servicesProvider();
      if (this.terminal || this.cancellation) {
        if (!this.terminal) {
          this.finish('cancelled', 'cancellation-confirmed', true);
        }
        return;
      }
      this.connection = services.connection;
      this.turnReconciler = services.turnReconciler;
      const threadId = await this.ensureThread(invocation.thread);
      if (this.cancellation) {
        this.finish(
          'cancelled',
          'cancellation-confirmed',
          !this.nativePreparationStarted,
        );
        return;
      }
      this.turnDispatchStarted = true;
      this.runTimeoutHandle = this.context.scheduler.setTimeout(() => {
        void this.handleTimeout();
      }, this.context.runTimeoutMs ?? 10 * 60_000);
      if (invocation.turn.kind === 'compact') {
        this.turnStartedMayEstablish = true;
        await services.connection.request('thread/compact/start', { threadId });
      } else {
        const result = await services.connection.request<TurnStartResult>('turn/start', {
          ...invocation.turn.params,
          threadId,
        });
        if (!this.establishTurn(result.turn.id)) {
          this.finish('indeterminate', 'dispatch-unknown');
        }
      }
      if (this.cancellation && !this.terminal) {
        void this.cancel(this.cancellation);
      }
    } catch {
      if (!this.terminal) {
        const effectsPossible = this.turnDispatchStarted || this.nativePreparationStarted;
        this.finish(
          effectsPossible ? 'indeterminate' : 'invalidated',
          effectsPossible
            ? (this.turnDispatchStarted ? 'dispatch-unknown' : 'effects-unknown')
            : 'pre-dispatch-rejected',
          !effectsPossible,
        );
      }
    }
  }

  private async ensureThread(intent: CodexThreadIntent): Promise<string> {
    const state = this.session.getThreadState();
    if (state.threadId) {
      if (!state.loaded) {
        await this.requestNativePreparation<ThreadResumeResult>('thread/resume', {
          ...resumeParams(intent),
          threadId: state.threadId,
        });
        this.session.markLoaded();
      }
      return state.threadId;
    }
    if (intent.kind === 'new') {
      const result = await this.requestNativePreparation<ThreadStartResult>(
        'thread/start',
        intent.params,
      );
      this.session.bindThread(result.thread.id);
      return result.thread.id;
    }
    if (intent.kind === 'resume') {
      const result = await this.requestNativePreparation<ThreadResumeResult>('thread/resume', {
        ...intent.params,
        threadId: intent.threadId,
      });
      this.session.bindThread(result.thread.id);
      return result.thread.id;
    }
    const fork = await this.requestNativePreparation<ThreadForkResult>('thread/fork', {
      threadId: intent.sourceThreadId,
    });
    const checkpoint = fork.thread.turns.findIndex(turn => turn.id === intent.resumeAtTurnId);
    if (checkpoint < 0) {
      throw new Error('Codex fork checkpoint was not found.');
    }
    const threadId = fork.thread.id;
    await this.requestNativePreparation<ThreadResumeResult>('thread/resume', {
      ...intent.resumeParams,
      threadId,
    });
    const rollback = fork.thread.turns.length - checkpoint - 1;
    if (rollback > 0) {
      await this.requestNativePreparation('thread/rollback', { threadId, numTurns: rollback });
    }
    this.session.bindThread(threadId);
    return threadId;
  }

  private requestNativePreparation<T>(method: string, params: unknown): Promise<T> {
    this.nativePreparationStarted = true;
    return this.requireConnection().request<T>(method, params);
  }

  private waitForFinishedWithin(timeoutMs: number): Promise<boolean> {
    if (this.terminal) {
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      let settled = false;
      const finish = (completed: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        this.context.scheduler.clearTimeout(timeout);
        resolve(completed);
      };
      const timeout = this.context.scheduler.setTimeout(() => finish(false), timeoutMs);
      void this.finished.then(() => finish(true));
    });
  }

  private establishTurn(turnId: string): boolean {
    if (this.terminal || this.turnId === turnId) {
      return !this.terminal;
    }
    requireNativeId(turnId, 'Codex turn id');
    if (this.turnId && this.turnId !== turnId) {
      return false;
    }
    this.turnId = turnId;
    for (const waiter of this.turnWaiters) {
      waiter(turnId);
    }
    this.turnWaiters.clear();
    if (!this.turnStartedEmitted) {
      this.turnStartedEmitted = true;
      this.emit({ kind: 'run-started' });
    }
    for (const buffered of this.bufferedNotifications.splice(0)) {
      this.handleNotification(buffered.method, buffered.params);
    }
    return true;
  }

  private applyNotification(method: string, params: unknown): void {
    if (method === 'item/agentMessage/delta') {
      const notification = params as AgentMessageDeltaNotification;
      if (notification.delta) {
        this.appendAssistantOutput(notification.delta);
      }
      return;
    }
    if (method === 'item/started') {
      this.handleItemStarted((params as ItemStartedNotification).item);
      return;
    }
    if (method === 'item/completed') {
      this.handleItemCompleted((params as ItemCompletedNotification).item);
      return;
    }
    if (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
      this.emit({ kind: 'thinking-activity' });
      return;
    }
    if (method === 'turn/completed') {
      void this.completeFromTurn((params as TurnCompletedNotification).turn);
      return;
    }
    if (method === 'thread/status/changed') {
      const record = readRecord(params);
      const status = readRecord(record?.status);
      if (status?.type === 'idle') {
        this.scheduleRecovery();
      }
      return;
    }
    if (method === 'error') {
      this.emit({ kind: 'connection-lost' });
      this.scheduleRecovery();
    }
  }

  private handleItemStarted(item: unknown): void {
    const record = readRecord(item);
    const type = readString(record?.type);
    const id = readString(record?.id);
    if (!type || !id) {
      return;
    }
    if (type === 'reasoning') {
      this.emit({ kind: 'thinking-activity' });
    } else if (type !== 'userMessage' && type !== 'agentMessage') {
      this.emit({ kind: 'tool-activity', toolCallId: id });
    }
  }

  private handleItemCompleted(item: unknown): void {
    const record = readRecord(item);
    const type = readString(record?.type);
    const itemId = readString(record?.id);
    if (itemId && this.completedItemIds.has(itemId)) {
      return;
    }
    if (itemId) {
      this.completedItemIds.add(itemId);
    }
    if (type === 'agentMessage') {
      const text = (item as AgentMessageItem).text;
      if (text) {
        this.replaceAssistantOutput(text);
      }
      return;
    }
    if (type !== 'collabAgentToolCall') {
      return;
    }
    const collab = item as CollabAgentToolCallItem;
    this.agentTaskChain = this.agentTaskChain
      .then(() => this.handleNativeAgent(collab))
      .catch(() => {
        this.finish('indeterminate', 'effects-unknown');
      });
  }

  private async handleNativeAgent(item: CollabAgentToolCallItem): Promise<void> {
    const result = readRecord(item.result);
    if (item.tool === 'spawnAgent') {
      const nativeAgentKey = readString(result?.agent_id) ?? readString(result?.agentId);
      if (nativeAgentKey) {
        this.emit({
          kind: 'native-agent-observed',
          nativeAgentKey,
          ...(readString(item.arguments?.parent_agent_id)
            ? { parentNativeAgentKey: readString(item.arguments?.parent_agent_id)! }
            : {}),
        });
        this.emit({ kind: 'native-agent-status', nativeAgentKey, status: 'running' });
      }
      return;
    }
    const argumentAgentKey = readString(item.arguments?.agent_id)
      ?? readString(item.arguments?.agentId);
    if (item.tool === 'sendInput' && argumentAgentKey) {
      this.emit({
        kind: 'native-agent-activity',
        nativeAgentKey: argumentAgentKey,
        activity: 'input-sent',
      });
      return;
    }
    if (item.tool === 'resumeAgent' && argumentAgentKey) {
      this.emit({
        kind: 'native-agent-activity',
        nativeAgentKey: argumentAgentKey,
        activity: 'resume-observed',
      });
      this.emit({
        kind: 'native-agent-status',
        nativeAgentKey: argumentAgentKey,
        status: 'running',
      });
      return;
    }
    if (item.tool === 'closeAgent' && argumentAgentKey) {
      this.emit({
        kind: 'native-agent-activity',
        nativeAgentKey: argumentAgentKey,
        activity: 'close-observed',
      });
      this.emit({
        kind: 'native-agent-status',
        nativeAgentKey: argumentAgentKey,
        status: 'closed',
      });
      return;
    }
    if (item.tool !== 'wait') {
      return;
    }
    const statuses = readRecord(result?.status);
    if (!statuses) {
      return;
    }
    for (const [nativeAgentKey, statusValue] of Object.entries(statuses)) {
      const status = readRecord(statusValue);
      this.emit({
        kind: 'native-agent-activity',
        nativeAgentKey,
        activity: 'wait-observed',
      });
      const completed = readString(status?.completed);
      if (completed) {
        const resultRef = await this.storeResult(completed, 'native-agent', nativeAgentKey);
        if (resultRef) {
          this.emit({ kind: 'native-agent-result', nativeAgentKey, result: resultRef });
          this.emit({
            kind: 'native-agent-status',
            nativeAgentKey,
            status: 'completed',
          });
        }
      } else if (readString(status?.error) || readString(status?.failed)) {
        this.emit({ kind: 'native-agent-status', nativeAgentKey, status: 'failed' });
      } else if (status?.state === 'completed') {
        this.emit({ kind: 'native-agent-status', nativeAgentKey, status: 'completed' });
      } else {
        this.emit({ kind: 'native-agent-status', nativeAgentKey, status: 'waiting' });
      }
    }
  }

  private async finishFromTurn(turn: Turn): Promise<void> {
    if (this.terminal || (this.turnId && turn.id !== this.turnId)) {
      return;
    }
    this.establishTurn(turn.id);
    if (turn.status === 'inProgress') {
      return;
    }
    for (const item of turn.items) {
      this.handleItemCompleted(item);
    }
    await this.agentTaskChain;
    if (this.terminal) {
      return;
    }
    if (this.outputLimitTriggered) {
      this.finish('failed', 'output-limit');
      return;
    }
    if (turn.status === 'failed') {
      this.finish('failed', 'provider-failure');
      return;
    }
    if (turn.status === 'interrupted') {
      if (this.timeoutTriggered) {
        this.finish('failed', 'timeout');
      } else if (this.cancellation) {
        this.acknowledgeCancellation();
        this.finish('cancelled', 'cancellation-confirmed');
      } else {
        this.finish('interrupted', 'known-process-exit');
      }
      return;
    }
    const replayOutput = [...turn.items]
      .reverse()
      .find((item): item is AgentMessageItem => item.type === 'agentMessage')
      ?.text;
    const output = (this.assistantOutput || replayOutput || '').trim();
    if (!output) {
      this.finish(
        this.request.resultExpectation === 'required' ? 'failed' : 'succeeded',
        this.request.resultExpectation === 'required' ? 'missing-required-result' : 'completed',
      );
      return;
    }
    const result = await this.storeResult(output, 'assistant');
    if (result && !this.terminal) {
      this.emit({ kind: 'result', result });
      this.finish('succeeded', 'completed');
    }
  }

  private async storeResult(
    output: string,
    source: 'assistant' | 'native-agent',
    nativeAgentKey?: string,
  ): Promise<ResultRef | undefined> {
    if (this.terminal) {
      return undefined;
    }
    if (Buffer.byteLength(output, 'utf8') > (this.context.maxResultBytes ?? 1024 * 1024)) {
      this.triggerOutputLimit();
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
    if (settlement.kind === 'unknown') {
      this.finish('indeterminate', 'effects-unknown');
    } else if (!this.cancellation) {
      this.finish('failed', 'provider-failure');
    }
    return undefined;
  }

  private scheduleRecovery(): void {
    if (this.recoveryTask || this.terminal || !this.turnId) {
      return;
    }
    this.recoveryTask = delay(this.context.scheduler, this.context.recoveryDelayMs ?? 250)
      .then(() => this.reconcileSafely())
      .finally(() => { this.recoveryTask = undefined; });
  }

  private async reconcileSafely(): Promise<void> {
    try {
      await this.reconcile();
    } catch {
      if (!this.terminal) {
        this.finish(
          'indeterminate',
          this.reconciliationUnknownReason(),
        );
      }
    }
  }

  private async reconcile(): Promise<void> {
    const threadId = this.session.getThreadState().threadId;
    const turnId = this.turnId;
    if (this.terminal || !threadId || !turnId) {
      return;
    }
    this.emit({ kind: 'recovery-started' });
    const evidence = await this.requireTurnReconciler().reconcile({ threadId, turnId });
    if (this.terminal) {
      return;
    }
    if (evidence.kind === 'turn') {
      await this.completeFromTurn(evidence.turn);
      if (!this.terminal
        && evidence.turn.status === 'inProgress'
        && (this.cancellation || this.timeoutTriggered || this.outputLimitTriggered)) {
        this.finish('indeterminate', this.terminationUnknownReason());
      }
    } else if (evidence.kind === 'running') {
      if (this.cancellation || this.timeoutTriggered || this.outputLimitTriggered) {
        this.finish('indeterminate', this.terminationUnknownReason());
      } else {
        this.emit({ kind: 'recovered', state: 'running' });
      }
    } else {
      this.finish('indeterminate', this.reconciliationUnknownReason());
    }
  }

  private waitForTurnId(): Promise<string | undefined> {
    if (this.turnId || this.terminal) {
      return Promise.resolve(this.turnId);
    }
    return new Promise(resolve => {
      const waiter = (turnId: string | undefined) => {
        this.context.scheduler.clearTimeout(timeout);
        this.turnWaiters.delete(waiter);
        resolve(turnId);
      };
      const timeout = this.context.scheduler.setTimeout(() => waiter(undefined),
        this.context.cancellationTurnIdTimeoutMs ?? 2_000);
      this.turnWaiters.add(waiter);
    });
  }

  private async handleTimeout(): Promise<void> {
    if (this.terminal || this.timeoutTriggered) {
      return;
    }
    this.timeoutTriggered = true;
    const threadId = this.session.getThreadState().threadId;
    const turnId = this.turnId ?? await this.waitForTurnId();
    if (!threadId || !turnId || this.terminal) {
      if (!this.terminal) {
        this.finish('indeterminate', 'effects-unknown');
      }
      return;
    }
    await this.requestTurnTermination();
  }

  private appendAssistantOutput(delta: string): void {
    if (this.outputLimitTriggered) {
      return;
    }
    const limit = this.context.maxResultBytes ?? 1024 * 1024;
    if (Buffer.byteLength(delta, 'utf8') > limit) {
      this.triggerOutputLimit();
      return;
    }
    const next = this.assistantOutput + delta;
    if (Buffer.byteLength(next, 'utf8') > limit) {
      this.triggerOutputLimit();
      return;
    }
    this.assistantOutput = next;
  }

  private replaceAssistantOutput(output: string): void {
    if (this.outputLimitTriggered) {
      return;
    }
    if (Buffer.byteLength(output, 'utf8') > (this.context.maxResultBytes ?? 1024 * 1024)) {
      this.triggerOutputLimit();
      return;
    }
    this.assistantOutput = output;
  }

  private triggerOutputLimit(): void {
    if (this.outputLimitTriggered || this.terminal) {
      return;
    }
    this.outputLimitTriggered = true;
    void this.handleOutputLimit();
  }

  private async handleOutputLimit(): Promise<void> {
    const threadId = this.session.getThreadState().threadId;
    const turnId = this.turnId;
    if (!threadId || !turnId) {
      this.finish('indeterminate', 'effects-unknown');
      return;
    }
    await this.requestTurnTermination();
  }

  private requestTurnTermination(): Promise<void> {
    this.terminationTask ??= this.interruptAndReconcile();
    return this.terminationTask;
  }

  private async interruptAndReconcile(): Promise<void> {
    const threadId = this.session.getThreadState().threadId;
    const turnId = this.turnId;
    if (!threadId || !turnId) {
      if (!this.terminal) {
        this.finish('indeterminate', this.terminationUnknownReason());
      }
      return;
    }
    try {
      await this.requireConnection().request('turn/interrupt', { threadId, turnId });
      if (this.terminal) {
        return;
      }
      if (this.cancellation) {
        this.acknowledgeCancellation();
      }
      await this.reconcile();
    } catch {
      if (!this.terminal) {
        this.finish('indeterminate', this.terminationUnknownReason());
      }
    }
  }

  private terminationUnknownReason(): RunTerminalReason {
    return this.outputLimitTriggered || this.timeoutTriggered
      ? 'effects-unknown'
      : 'cancellation-unknown';
  }

  private reconciliationUnknownReason(): RunTerminalReason {
    return this.cancellation || this.timeoutTriggered || this.outputLimitTriggered
      ? this.terminationUnknownReason()
      : 'effects-unknown';
  }

  private completeFromTurn(turn: Turn): Promise<void> {
    this.completionTask ??= this.finishFromTurn(turn).finally(() => {
      this.completionTask = undefined;
    });
    return this.completionTask;
  }

  private acknowledgeCancellation(): void {
    if (!this.cancellationAcknowledged && !this.terminal) {
      this.cancellationAcknowledged = true;
      this.emit({ kind: 'cancellation-acknowledged' });
    }
  }

  private requireConnection(): CodexExecutionConnection {
    if (!this.connection) {
      throw new Error('Codex run connection is not initialized.');
    }
    return this.connection;
  }

  private requireTurnReconciler(): CodexTurnReconciler {
    if (!this.turnReconciler) {
      throw new Error('Codex run reconciler is not initialized.');
    }
    return this.turnReconciler;
  }

  private emit(event: ProviderExecutionEvent['event']): void {
    const delivery: ProviderExecutionEvent = {
      backendId: CODEX_EXECUTION_DESCRIPTOR.backendId,
      backendGeneration: this.config.backendGeneration,
      executionSessionId: this.config.executionSessionId,
      sessionInstanceId: this.sessionInstanceId,
      deliveryId: `${this.request.runId}:${this.queue.count + 1}`,
      occurredAt: (this.context.now ?? Date.now)(),
      scope: {
        kind: 'run',
        runId: this.request.runId,
        ...(this.turnId ? { nativeRunRef: this.turnId } : {}),
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
    if (this.runTimeoutHandle !== undefined) {
      this.context.scheduler.clearTimeout(this.runTimeoutHandle);
      this.runTimeoutHandle = undefined;
    }
    for (const abort of this.resultCommitAborts) {
      abort.abort();
    }
    for (const waiter of this.turnWaiters) {
      waiter(undefined);
    }
    this.turnWaiters.clear();
    this.emit({ kind: 'terminal', terminal, reason, ...(sideEffectFree ? { sideEffectFree: true } : {}) });
    this.queue.close();
    this.onTerminal();
    this.resolveFinished();
  }
}

function extractScope(value: unknown): { readonly threadId: string; readonly turnId?: string } | null {
  const record = readRecord(value);
  const threadId = readString(record?.threadId);
  const turnId = readString(record?.turnId) ?? readString(readRecord(record?.turn)?.id);
  return threadId ? { threadId, ...(turnId ? { turnId } : {}) } : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function extractTurnOutput(turn: Turn): string {
  return [...turn.items]
    .reverse()
    .find((item): item is AgentMessageItem => item.type === 'agentMessage')
    ?.text.trim() ?? '';
}

function nativeRequestKey(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function validatePreparedInteraction(prepared: CodexPreparedInteraction): void {
  const validId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  if (!validId(prepared.presentationRef)
    || prepared.responseIds.length === 0
    || prepared.responseIds.some(responseId => !validId(responseId))) {
    throw new Error('Codex interaction bridge returned an invalid presentation.');
  }
  if (!prepared.responseIds.includes(prepared.providerResolvedResponseId)) {
    throw new Error('Codex interaction must include its provider-resolved response.');
  }
}

function resumeParams(intent: CodexThreadIntent): Omit<ThreadResumeParams, 'threadId'> {
  if (intent.kind === 'resume') {
    return intent.params;
  }
  if (intent.kind === 'fork') {
    return intent.resumeParams;
  }
  return {
    model: intent.params.model,
    approvalPolicy: intent.params.approvalPolicy,
    sandbox: intent.params.sandbox,
    serviceTier: intent.params.serviceTier,
    baseInstructions: intent.params.baseInstructions,
    experimentalRawEvents: intent.params.experimentalRawEvents,
    persistExtendedHistory: intent.params.persistExtendedHistory,
  };
}

function requireNativeId(value: string, label: string): void {
  if (!value.trim() || value.length > 512) {
    throw new Error(`${label} is invalid.`);
  }
}

function requirePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function delay(scheduler: CodexExecutionScheduler, delayMs: number): Promise<void> {
  return new Promise(resolve => scheduler.setTimeout(resolve, delayMs));
}
