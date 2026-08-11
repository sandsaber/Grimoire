import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type {
  ExecutionBackend,
  ExecutionRecoveryPort,
  ExecutionRequest,
  ExecutionRun,
  ExecutionSession,
  ExecutionSessionConfig,
  ExecutionSessionSnapshot,
  InteractionPort,
  InteractionResolution,
  RunRecoveryEvidence,
  RunRecoveryQuery,
  RunTerminalKind,
  RunTerminalReason,
  Unsubscribe,
} from '@/core/execution/ExecutionContracts';
import { ExecutionDispatchError } from '@/core/execution/ExecutionContracts';
import { ExecutionEventQueue } from '@/core/execution/ExecutionEventQueue';
import type {
  ExecutionEvent,
  ProviderExecutionEvent,
} from '@/core/execution/ExecutionEvents';
import type { InteractionId, SessionInstanceId } from '@/core/execution/ExecutionIds';
import {
  type ResultCommitOutcome,
  type ResultCommitScheduler,
  settleResultCommit,
} from '@/core/execution/ResultCommit';
import { isAcpMissingSessionError } from '@/providers/acp/acpSessionResume';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import { ManagedAcpTerminationUnconfirmedError } from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpAskUserQuestionRequest,
  AcpAskUserQuestionResponse,
  AcpContentBlock,
  AcpNewSessionRequest,
  AcpPromptResponse,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionNotification,
} from '@/providers/acp/types';
import {
  extractGrokSpawnResult,
  extractGrokWaitResult,
  GROK_SUBAGENT_SPAWN_TOOL,
  GROK_SUBAGENT_WAIT_TOOL,
  normalizeGrokSubagentExtensionNotification,
} from '@/providers/grok/normalization/grokSubagentNormalization';
import { normalizeGrokToolName } from '@/providers/grok/normalization/grokToolNormalization';
import { GrokSessionNotificationMirrorDeduplicator } from '@/providers/grok/runtime/GrokSessionNotificationMirrorDeduplicator';
import {
  GROK_SESSION_NOTIFICATION_METHODS,
  type GrokSessionNotificationSource,
  isGrokTurnCompletedUpdate,
  parseGrokSessionNotification,
} from '@/providers/grok/runtime/GrokSessionNotifications';
import type { GrokProviderState } from '@/providers/grok/types';

export const GROK_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-grok'),
  association: { kind: 'provider' as const, providerId: 'grok' },
});

export interface GrokExecutionInvocation {
  readonly startupRef: string;
  readonly restartFingerprint: string;
  readonly cwd: string;
  readonly prompt: readonly AcpContentBlock[];
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
  readonly messageId?: string;
  readonly dynamicRef?: string;
  readonly providerState?: GrokProviderState;
}

export interface GrokExecutionRequestResolver {
  resolve(requestRef: string): Promise<GrokExecutionInvocation>;
}

export interface GrokExecutionDynamicApplier {
  apply(input: {
    readonly client: ManagedAcpClient;
    readonly sessionId: string;
    readonly dynamicRef?: string;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

interface GrokPreparedInteractionBase {
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly providerResolvedResponseId: string;
}

export interface GrokPreparedApproval extends GrokPreparedInteractionBase {
  readonly kind: 'approval';
  resolve(responseId: string): Promise<AcpRequestPermissionResponse>;
  cancel(): Promise<AcpRequestPermissionResponse>;
}

export interface GrokPreparedQuestion extends GrokPreparedInteractionBase {
  readonly kind: 'question';
  resolve(responseId: string): Promise<AcpAskUserQuestionResponse>;
  cancel(): Promise<AcpAskUserQuestionResponse>;
}

export type GrokPreparedInteraction = GrokPreparedApproval | GrokPreparedQuestion;

export interface GrokInteractionBridge {
  prepareApproval(request: AcpRequestPermissionRequest): Promise<GrokPreparedApproval>;
  prepareQuestion(request: AcpAskUserQuestionRequest): Promise<GrokPreparedQuestion>;
}

export interface GrokExecutionResultSink {
  storeResult(input: {
    readonly output: string;
    readonly nativeSessionRef: string;
    readonly nativeRunRef?: string;
    readonly source: 'assistant' | 'native-agent';
    readonly nativeAgentKey?: string;
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome>;
}

export interface GrokExecutionUsagePort {
  attach(input: {
    readonly ownerRef: string;
    readonly readBilling?: () => Promise<unknown>;
  }): void;
  detach(ownerRef: string): void;
  recordNotification(notification: AcpSessionNotification): void;
  recordTurn(input: {
    readonly nativeSessionRef: string;
    readonly providerState?: GrokProviderState;
    readonly response: AcpPromptResponse;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export interface GrokAuxiliaryPort {
  execute(requestRef: string, signal: AbortSignal): Promise<string>;
}

export type GrokExecutionScheduler = ResultCommitScheduler;

export interface GrokExecutionBackendContext {
  readonly clientFactory: ManagedAcpClientFactory;
  readonly requestResolver: GrokExecutionRequestResolver;
  readonly dynamicApplier: GrokExecutionDynamicApplier;
  readonly interactionBridge: GrokInteractionBridge;
  readonly resultSink: GrokExecutionResultSink;
  readonly usage: GrokExecutionUsagePort;
  readonly reconciler: ExecutionRecoveryPort;
  readonly auxiliaryQueries: GrokAuxiliaryPort;
  readonly scheduler: GrokExecutionScheduler;
  readonly sessionInstanceIdFactory: () => SessionInstanceId;
  readonly interactionIdFactory: () => InteractionId;
  readonly now?: () => number;
  readonly controlTimeoutMs?: number;
  readonly resultCommitTimeoutMs: number;
  readonly recoveryTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly maxResultBytes: number;
  readonly isMissingSessionError?: (error: unknown) => boolean;
}

interface PendingInteractionBase {
  readonly interactionId: InteractionId;
  readonly run: GrokExecutionRun;
  selectedResponseId?: string;
  settlementTask?: Promise<void>;
  settled: boolean;
}

type PendingInteraction =
  | (PendingInteractionBase & {
    readonly kind: 'approval';
    readonly prepared: GrokPreparedApproval;
    readonly complete: (response: AcpRequestPermissionResponse) => void;
  })
  | (PendingInteractionBase & {
    readonly kind: 'question';
    readonly prepared: GrokPreparedQuestion;
    readonly complete: (response: AcpAskUserQuestionResponse) => void;
  });

export class GrokExecutionBackend
implements ExecutionBackend, InteractionPort, ExecutionRecoveryPort {
  readonly descriptor = GROK_EXECUTION_DESCRIPTOR;
  private readonly sessions = new Map<string, GrokExecutionSession>();
  private readonly interactions = new Map<InteractionId, PendingInteraction>();
  private readonly settledInteractions = new Map<InteractionId, string>();
  private readonly auxiliaryControllers = new Set<AbortController>();
  private readonly auxiliaryTasks = new Set<Promise<string>>();
  private disposeTask?: Promise<void>;
  private disposing = false;

  constructor(protected readonly context: GrokExecutionBackendContext) {}

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposing) {
      throw new Error('Managed ACP backend is disposing.');
    }
    const key = String(config.executionSessionId);
    if (this.sessions.has(key)) {
      throw new Error('Managed ACP execution session already exists.');
    }
    let session: GrokExecutionSession;
    session = new GrokExecutionSession(
      config,
      this.context,
      request => this.requestPermission(request, session.activeExecutionRun),
      request => this.askUserQuestion(request, session.activeExecutionRun),
      run => this.cancelRunInteractions(run),
      () => this.sessions.delete(key),
    );
    this.sessions.set(key, session);
    return session;
  }

  async resolve(resolution: InteractionResolution): Promise<void> {
    const pending = this.interactions.get(resolution.interactionId);
    if (!pending) {
      const settled = this.settledInteractions.get(resolution.interactionId);
      if (settled === resolution.responseId) return;
      if (settled) throw new Error('Managed ACP interaction already resolved differently.');
      throw new Error('Managed ACP interaction is not pending.');
    }
    if (!pending.prepared.responseIds.includes(resolution.responseId)) {
      throw new Error('Managed ACP interaction response is not allowed.');
    }
    await this.settlePendingInteraction(
      pending,
      resolution.responseId,
      () => this.resolveNativeInteraction(pending, resolution.responseId),
    );
  }

  async cancel(interactionId: InteractionId): Promise<void> {
    const pending = this.interactions.get(interactionId);
    if (!pending || pending.settled) return;
    await this.settlePendingInteraction(
      pending,
      pending.prepared.providerResolvedResponseId,
      () => this.cancelNativeInteraction(pending),
    );
  }

  async reconcile(query: RunRecoveryQuery): Promise<RunRecoveryEvidence> {
    if (query.backendId !== this.descriptor.backendId) {
      return { kind: 'unknown', effectsPossible: false };
    }
    const session = this.sessions.get(String(query.executionSessionId));
    const active = session?.activeExecutionRun;
    if (active?.runId === query.runId && session?.isAttached(active)) {
      return { kind: 'running', sessionInstanceId: session.sessionInstanceId };
    }
    return this.context.reconciler.reconcile(query);
  }

  async runAuxiliaryQuery(requestRef: string): Promise<string> {
    if (this.disposing) throw new Error('Managed ACP backend is disposing.');
    const controller = new AbortController();
    this.auxiliaryControllers.add(controller);
    const task = Promise.resolve().then(
      () => this.context.auxiliaryQueries.execute(requestRef, controller.signal),
    );
    this.auxiliaryTasks.add(task);
    try {
      return await task;
    } finally {
      this.auxiliaryControllers.delete(controller);
      this.auxiliaryTasks.delete(task);
    }
  }

  dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask;
    this.disposing = true;
    for (const controller of this.auxiliaryControllers) {
      controller.abort(new Error('Managed ACP backend disposed.'));
    }
    this.disposeTask = (async () => {
      const sessionResults = await Promise.allSettled(
        [...this.sessions.values()].map(session => session.dispose()),
      );
      const interactionResults = await Promise.allSettled(
        [...this.interactions.keys()].map(interactionId => this.cancel(interactionId)),
      );
      await Promise.allSettled([...this.auxiliaryTasks]);
      const lifecycleResults = [...sessionResults, ...interactionResults];
      const terminationFailure = lifecycleResults.some(result => (
        result.status === 'rejected'
        && result.reason instanceof ManagedAcpTerminationUnconfirmedError
      ));
      const factoryTermination = this.context.clientFactory.dispose
        ? await this.context.clientFactory.dispose()
        : terminationFailure ? 'unconfirmed' : 'confirmed';
      const failure = lifecycleResults
        .find((result): result is PromiseRejectedResult => (
          result.status === 'rejected'
          && !(result.reason instanceof ManagedAcpTerminationUnconfirmedError)
        ));
      if (factoryTermination === 'unconfirmed') {
        throw new ManagedAcpTerminationUnconfirmedError();
      }
      if (failure) throw toError(failure.reason);
      this.sessions.clear();
    })();
    return this.disposeTask;
  }

  private async requestPermission(
    request: AcpRequestPermissionRequest,
    run: GrokExecutionRun | undefined,
  ): Promise<AcpRequestPermissionResponse> {
    if (!run || run.isTerminal || request.sessionId !== run.nativeSessionRef) {
      return { outcome: { outcome: 'cancelled' } };
    }
    const preparation = this.context.interactionBridge.prepareApproval(request);
    const prepared = await withTimeout(
      preparation,
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (!prepared) {
      void preparation
        .then(latePrepared => this.discardPreparedInteraction(latePrepared), () => undefined)
        .catch(() => undefined);
      return { outcome: { outcome: 'cancelled' } };
    }
    validatePreparedInteraction(prepared);
    if (run.isTerminal) {
      return await withTimeout(
        prepared.cancel(),
        this.context.scheduler,
        this.context.controlTimeoutMs ?? 2_000,
      ) ?? { outcome: { outcome: 'cancelled' } };
    }
    const interactionId = this.context.interactionIdFactory();
    return new Promise(resolve => {
      const pending: PendingInteraction = {
        kind: 'approval',
        interactionId,
        run,
        prepared,
        complete: resolve,
        settled: false,
      };
      this.interactions.set(interactionId, pending);
      run.openInteraction(interactionId, prepared);
    });
  }

  private async askUserQuestion(
    request: AcpAskUserQuestionRequest,
    run: GrokExecutionRun | undefined,
  ): Promise<AcpAskUserQuestionResponse> {
    if (!run || run.isTerminal || request.sessionId !== run.nativeSessionRef) {
      return { outcome: 'cancelled' };
    }
    const preparation = this.context.interactionBridge.prepareQuestion(request);
    const prepared = await withTimeout(
      preparation,
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (!prepared) {
      void preparation
        .then(latePrepared => this.discardPreparedInteraction(latePrepared), () => undefined)
        .catch(() => undefined);
      return { outcome: 'cancelled' };
    }
    validatePreparedInteraction(prepared);
    if (run.isTerminal) {
      return await withTimeout(
        prepared.cancel(),
        this.context.scheduler,
        this.context.controlTimeoutMs ?? 2_000,
      ) ?? { outcome: 'cancelled' };
    }
    const interactionId = this.context.interactionIdFactory();
    return new Promise(resolve => {
      const pending: PendingInteraction = {
        kind: 'question',
        interactionId,
        run,
        prepared,
        complete: resolve,
        settled: false,
      };
      this.interactions.set(interactionId, pending);
      run.openInteraction(interactionId, prepared);
    });
  }

  private async settlePendingInteraction(
    pending: PendingInteraction,
    responseId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    if (pending.settlementTask) {
      if (pending.selectedResponseId !== responseId) {
        throw new Error('Managed ACP interaction is resolving another response.');
      }
    } else {
      pending.selectedResponseId = responseId;
      const task = operation();
      pending.settlementTask = task;
      void task.catch(() => {
        if (!pending.settled && pending.settlementTask === task) {
          pending.settlementTask = undefined;
          pending.selectedResponseId = undefined;
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
      throw new Error('Managed ACP interaction settlement was not confirmed.');
    }
  }

  private settleApproval(
    pending: Extract<PendingInteraction, { kind: 'approval' }>,
    responseId: string,
    response: AcpRequestPermissionResponse,
  ): void {
    if (!this.markInteractionSettled(pending, responseId)) return;
    pending.complete(response);
  }

  private settleQuestion(
    pending: Extract<PendingInteraction, { kind: 'question' }>,
    responseId: string,
    response: AcpAskUserQuestionResponse,
  ): void {
    if (!this.markInteractionSettled(pending, responseId)) return;
    pending.complete(response);
  }

  private markInteractionSettled(
    pending: PendingInteraction,
    responseId: string,
  ): boolean {
    if (pending.settled) return false;
    pending.settled = true;
    this.interactions.delete(pending.interactionId);
    this.settledInteractions.set(pending.interactionId, responseId);
    trimOldestMapEntries(this.settledInteractions, 1024);
    pending.run.resolveInteraction(pending.interactionId, responseId);
    return true;
  }

  private async resolveNativeInteraction(
    pending: PendingInteraction,
    responseId: string,
  ): Promise<void> {
    if (pending.kind === 'approval') {
      this.settleApproval(pending, responseId, await pending.prepared.resolve(responseId));
      return;
    }
    this.settleQuestion(pending, responseId, await pending.prepared.resolve(responseId));
  }

  private async cancelNativeInteraction(pending: PendingInteraction): Promise<void> {
    const responseId = pending.prepared.providerResolvedResponseId;
    if (pending.kind === 'approval') {
      this.settleApproval(pending, responseId, await pending.prepared.cancel());
      return;
    }
    this.settleQuestion(pending, responseId, await pending.prepared.cancel());
  }

  private failCloseInteraction(pending: PendingInteraction): void {
    const responseId = pending.prepared.providerResolvedResponseId;
    if (pending.kind === 'approval') {
      this.settleApproval(pending, responseId, { outcome: { outcome: 'cancelled' } });
      return;
    }
    this.settleQuestion(pending, responseId, { outcome: 'cancelled' });
  }

  private async discardPreparedInteraction(
    prepared: GrokPreparedInteraction,
  ): Promise<void> {
    if (prepared.kind === 'approval') {
      await withTimeout(
        prepared.cancel(),
        this.context.scheduler,
        this.context.controlTimeoutMs ?? 2_000,
      );
      return;
    }
    await withTimeout(
      prepared.cancel(),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
  }

  private cancelRunInteractions(run: GrokExecutionRun): void {
    for (const pending of this.interactions.values()) {
      if (pending.run !== run || pending.settled) continue;
      void this.cancel(pending.interactionId).catch(() => this.failCloseInteraction(pending));
    }
  }
}

class GrokExecutionSession implements ExecutionSession {
  readonly sessionInstanceId: SessionInstanceId;
  private readonly listeners = new Set<(event: ProviderExecutionEvent) => void>();
  private client?: ManagedAcpClient;
  private clientAbort?: AbortController;
  private clientCloseTask?: Promise<'confirmed' | 'unconfirmed'>;
  private clientCreationTask?: Promise<ManagedAcpClient>;
  private clientGeneration = 0;
  private readonly retainedClients = new Set<ManagedAcpClient>();
  private readonly notificationDeduplicator = new GrokSessionNotificationMirrorDeduplicator();
  private clientCloseUnsubscribe?: Unsubscribe;
  private notificationUnsubscribe?: Unsubscribe;
  private extensionNotificationUnsubscribe?: Unsubscribe;
  private restartFingerprint?: string;
  private loadedSessionRef?: string;
  private nativeSessionRef?: string;
  private disposed = false;
  private disposeTask?: Promise<void>;
  private deliverySequence = 0;
  private activeRun?: GrokExecutionRun;

  constructor(
    private readonly config: ExecutionSessionConfig,
    private readonly context: GrokExecutionBackendContext,
    private readonly permissionHandler: (
      request: AcpRequestPermissionRequest,
    ) => Promise<AcpRequestPermissionResponse>,
    private readonly questionHandler: (
      request: AcpAskUserQuestionRequest,
    ) => Promise<AcpAskUserQuestionResponse>,
    private readonly cancelInteractions: (run: GrokExecutionRun) => void,
    private readonly onDisposed: () => void,
  ) {
    this.sessionInstanceId = context.sessionInstanceIdFactory();
    this.nativeSessionRef = config.nativeSessionRef;
  }

  get executionSessionId() {
    return this.config.executionSessionId;
  }

  get backendGeneration(): number {
    return this.config.backendGeneration;
  }

  get activeExecutionRun(): GrokExecutionRun | undefined {
    return this.activeRun;
  }

  createRun(request: ExecutionRequest): ExecutionRun {
    const run = new GrokExecutionRun(
      request,
      this,
      this.context,
      this.cancelInteractions,
      () => {
        if (this.activeRun === run) this.activeRun = undefined;
      },
    );
    if (this.disposed || this.activeRun) {
      run.rejectBeforeDispatch();
      return run;
    }
    this.activeRun = run;
    void run.start();
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

  isAttached(run: GrokExecutionRun): boolean {
    return this.activeRun === run && Boolean(this.client && this.nativeSessionRef);
  }

  async prepare(run: GrokExecutionRun, invocation: GrokExecutionInvocation): Promise<void> {
    await this.ensureClient(invocation);
    if (run.isTerminal) return;
    const generation = this.clientGeneration;
    await this.ensureSessionBinding(invocation, generation);
    if (run.isTerminal || generation !== this.clientGeneration) return;
    if (!this.client || !this.nativeSessionRef) {
      throw new ExecutionDispatchError('Managed ACP session is not ready.', true);
    }
    const applied = await completesWithin(
      this.context.dynamicApplier.apply({
        client: this.client,
        sessionId: this.nativeSessionRef,
        dynamicRef: invocation.dynamicRef,
        signal: this.clientAbort?.signal ?? new AbortController().signal,
      }),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (run.isTerminal || generation !== this.clientGeneration) return;
    if (!applied) {
      throw new ExecutionDispatchError('Managed ACP dynamic configuration timed out.', true);
    }
  }

  dispatch(run: GrokExecutionRun, invocation: GrokExecutionInvocation): void {
    const client = this.client;
    const sessionId = this.nativeSessionRef;
    if (!client || !sessionId || run.isTerminal) return;
    const attempt = run.beginDispatch(sessionId, invocation.messageId);
    if (attempt === 1) run.emitRunStarted();
    void client.prompt({
      ...(invocation.messageId ? { messageId: invocation.messageId } : {}),
      prompt: [...invocation.prompt],
      sessionId,
    }).then(
      response => run.completeFromPrompt(response, attempt),
      error => this.recover(run, invocation, error, attempt),
    );
  }

  requestCancel(run: GrokExecutionRun): void {
    if (this.activeRun !== run || !this.client || !this.nativeSessionRef) return;
    this.client.cancel(this.nativeSessionRef);
  }

  cancelPreparation(run: GrokExecutionRun): void {
    if (this.activeRun !== run) return;
    this.clientGeneration += 1;
    this.clientAbort?.abort(new Error('Managed ACP run cancelled before dispatch.'));
    void this.closeClient().catch(() => undefined);
  }

  async reconcileRun(run: GrokExecutionRun): Promise<RunRecoveryEvidence> {
    const evidence = await withTimeout(
      this.context.reconciler.reconcile(run.recoveryQuery()),
      this.context.scheduler,
      this.context.recoveryTimeoutMs,
    );
    return evidence ?? { kind: 'unknown', effectsPossible: true };
  }

  private async recover(
    run: GrokExecutionRun,
    invocation: GrokExecutionInvocation,
    _error: unknown,
    attempt: number,
  ): Promise<void> {
    if (!run.claimRecovery(attempt)) return;
    if (!run.sawObservableActivity && attempt === 1) {
      try {
        const termination = await this.closeClient();
        if (termination === 'unconfirmed') {
          throw new Error('Managed ACP retry process termination was not confirmed.');
        }
        await this.ensureClient(invocation, true);
        await this.ensureSessionBinding(invocation, this.clientGeneration);
        await this.context.dynamicApplier.apply({
          client: this.client!,
          sessionId: this.nativeSessionRef!,
          dynamicRef: invocation.dynamicRef,
          signal: this.clientAbort!.signal,
        });
        run.releaseRecovery();
        this.dispatch(run, invocation);
        return;
      } catch {
        // Authoritative reconciliation below owns the terminal classification.
      }
    }
    await this.closeClient();
    run.emitConnectionLost();
    const evidence = await this.reconcileRun(run);
    await run.finishFromRecovery(evidence);
  }

  private async ensureClient(
    invocation: GrokExecutionInvocation,
    force = false,
  ): Promise<void> {
    if (this.disposed) throw new ExecutionDispatchError('Managed ACP session disposed.', true);
    if (!force && this.client && this.restartFingerprint === invocation.restartFingerprint) return;
    const previousTermination = await this.closeClient();
    if (previousTermination === 'unconfirmed') {
      throw new ExecutionDispatchError('Managed ACP process ownership is unconfirmed.', true);
    }
    const abort = new AbortController();
    this.clientAbort = abort;
    const generation = ++this.clientGeneration;
    const creation = this.context.clientFactory.create({
      startupRef: invocation.startupRef,
      signal: abort.signal,
      requestPermission: this.permissionHandler,
      askUserQuestion: this.questionHandler,
    });
    this.clientCreationTask = creation;
    let client: ManagedAcpClient;
    try {
      client = await creation;
    } catch (error) {
      if (this.clientAbort === abort) this.clientAbort = undefined;
      throw error;
    } finally {
      if (this.clientCreationTask === creation) this.clientCreationTask = undefined;
    }
    if (this.disposed || generation !== this.clientGeneration) {
      abort.abort();
      try {
        if (await client.close() === 'unconfirmed') this.retainedClients.add(client);
      } catch {
        this.retainedClients.add(client);
      }
      throw new ExecutionDispatchError('Managed ACP startup became stale.', true);
    }
    this.client = client;
    this.restartFingerprint = invocation.restartFingerprint;
    this.loadedSessionRef = undefined;
    this.notificationDeduplicator.reset();
    this.notificationUnsubscribe = client.onSessionNotification(notification => {
      if (generation === this.clientGeneration) this.handleNotification(notification, 'standard');
    });
    this.extensionNotificationUnsubscribe = client.onExtensionNotification?.(
      GROK_SESSION_NOTIFICATION_METHODS,
      (method, params) => {
        if (generation !== this.clientGeneration) return;
        const notification = parseGrokSessionNotification(method, params);
        if (notification) {
          this.handleNotification(notification, method as GrokSessionNotificationSource);
        }
      },
    );
    this.clientCloseUnsubscribe = client.onConnectionLost(error => {
      const active = this.activeRun;
      if (generation === this.clientGeneration && active && !active.isTerminal) {
        void this.recover(active, active.invocation, error, active.currentAttempt);
      }
    });
    const initialized = await completesWithin(
      client.initialize(),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (!initialized) {
      await this.closeClient();
      throw new ExecutionDispatchError('Managed ACP initialize timed out.', true);
    }
    try {
      const requestExtension = client.requestExtension?.bind(client);
      this.context.usage.attach({
        ownerRef: String(this.executionSessionId),
        ...(requestExtension
          ? { readBilling: () => requestExtension('x.ai/billing', {}) }
          : {}),
      });
    } catch {
      // Usage projection cannot take ownership of the execution lifecycle.
    }
  }

  private async ensureSessionBinding(
    invocation: GrokExecutionInvocation,
    generation: number,
  ): Promise<void> {
    const client = this.client;
    if (!client) throw new ExecutionDispatchError('Managed ACP client is unavailable.', true);
    if (this.nativeSessionRef && this.loadedSessionRef !== this.nativeSessionRef) {
      const target = this.nativeSessionRef;
      try {
        const response = await client.loadSession({
          cwd: invocation.cwd,
          mcpServers: [...invocation.mcpServers],
          sessionId: target,
        });
        if (response.sessionId !== target) {
          throw new ExecutionDispatchError('Managed ACP load returned another session.', true);
        }
        this.requireCurrentClient(client, generation);
        this.loadedSessionRef = target;
        return;
      } catch (error) {
        const missing = (this.context.isMissingSessionError ?? isAcpMissingSessionError)(error);
        if (!missing) throw new ExecutionDispatchError('Managed ACP session load failed.', true);
        this.nativeSessionRef = undefined;
        this.loadedSessionRef = undefined;
      }
    }
    if (!this.nativeSessionRef) {
      const response = await client.newSession({
        cwd: invocation.cwd,
        mcpServers: [...invocation.mcpServers],
      });
      if (!response.sessionId?.trim()) {
        throw new ExecutionDispatchError('Managed ACP returned an empty session id.', true);
      }
      this.requireCurrentClient(client, generation);
      this.nativeSessionRef = response.sessionId;
      this.loadedSessionRef = response.sessionId;
    }
  }

  private handleNotification(
    notification: AcpSessionNotification,
    source: GrokSessionNotificationSource,
  ): void {
    if (notification.sessionId !== this.nativeSessionRef) return;
    if (!this.notificationDeduplicator.shouldProcess(notification, source)) return;
    if (notification.update.sessionUpdate === 'usage_update') {
      try {
        this.context.usage.recordNotification(notification);
      } catch {
        // The provider transcript remains the authoritative fallback for usage.
      }
    }
    this.activeRun?.handleNotification(notification);
  }

  private closeClient(): Promise<'confirmed' | 'unconfirmed'> {
    if (this.clientCloseTask) return this.clientCloseTask;
    const task = this.closeCurrentClient();
    this.clientCloseTask = task;
    void task.finally(() => {
      if (this.clientCloseTask === task) this.clientCloseTask = undefined;
    }).catch(() => undefined);
    return task;
  }

  private async closeCurrentClient(): Promise<'confirmed' | 'unconfirmed'> {
    this.notificationUnsubscribe?.();
    this.notificationUnsubscribe = undefined;
    this.extensionNotificationUnsubscribe?.();
    this.extensionNotificationUnsubscribe = undefined;
    try {
      this.context.usage.detach(String(this.executionSessionId));
    } catch {
      // Detaching an optional projection cannot weaken process cleanup.
    }
    this.notificationDeduplicator.reset();
    this.clientCloseUnsubscribe?.();
    this.clientCloseUnsubscribe = undefined;
    this.clientAbort?.abort(new Error('Managed ACP client closed.'));
    this.clientAbort = undefined;
    const client = this.client;
    const pendingCreation = this.clientCreationTask;
    this.client = undefined;
    this.restartFingerprint = undefined;
    this.loadedSessionRef = undefined;
    this.clientGeneration += 1;
    const candidates = new Set(this.retainedClients);
    this.retainedClients.clear();
    if (client) candidates.add(client);
    let pendingUnknown = false;
    if (pendingCreation) {
      const pendingClient = await withTimeout(
        pendingCreation,
        this.context.scheduler,
        this.context.controlTimeoutMs ?? 2_000,
      );
      if (!pendingClient) {
        pendingUnknown = true;
      } else {
        candidates.add(pendingClient);
      }
    }
    for (const candidate of candidates) {
      try {
        if (await candidate.close() === 'unconfirmed') this.retainedClients.add(candidate);
      } catch {
        this.retainedClients.add(candidate);
      }
    }
    return !pendingUnknown && this.retainedClients.size === 0 ? 'confirmed' : 'unconfirmed';
  }

  private requireCurrentClient(client: ManagedAcpClient, generation: number): void {
    if (this.disposed
      || this.client !== client
      || this.clientGeneration !== generation
      || this.clientAbort?.signal.aborted) {
      throw new ExecutionDispatchError('Managed ACP preparation became stale.', true);
    }
  }

  dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask;
    this.disposed = true;
    const run = this.activeRun;
    this.disposeTask = (async () => {
      if (run && !run.isTerminal) await run.cancel({ code: 'shutdown' });
      const termination = await this.closeClient();
      if (termination === 'unconfirmed') {
        throw new ManagedAcpTerminationUnconfirmedError();
      }
      this.listeners.clear();
      this.onDisposed();
    })();
    return this.disposeTask;
  }

  publish(event: ProviderExecutionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  nextDeliveryId(runId: string): string {
    return `${runId}:${++this.deliverySequence}`;
  }
}

class GrokExecutionRun implements ExecutionRun {
  readonly events = new ExecutionEventQueue<ProviderExecutionEvent>();
  readonly runId;
  invocation!: GrokExecutionInvocation;
  private terminal = false;
  private dispatched = false;
  private output = '';
  private observedProviderActivity = false;
  private timeoutHandle?: unknown;
  private attempt = 0;
  private recoveringAttempt?: number;
  private terminationTask?: Promise<void>;
  private completionTask?: Promise<void>;
  private agentTaskChain: Promise<void> = Promise.resolve();
  private acceptingAgentEvidence = true;
  private readonly observedAgentKeys = new Set<string>();
  private readonly agentTerminalStatuses = new Map<string, 'completed' | 'failed'>();
  private readonly agentResultKeys = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  private terminationIntent?: 'cancel' | 'shutdown' | 'timeout' | 'output-limit';
  private nativeRunRef?: string;
  private sessionRef?: string;

  constructor(
    private readonly request: ExecutionRequest,
    private readonly session: GrokExecutionSession,
    private readonly context: GrokExecutionBackendContext,
    private readonly cancelInteractions: (run: GrokExecutionRun) => void,
    private readonly onTerminal: () => void,
  ) {
    this.runId = request.runId;
  }

  get isTerminal(): boolean { return this.terminal; }
  get sawObservableActivity(): boolean { return this.observedProviderActivity; }
  get currentAttempt(): number { return this.attempt; }
  get nativeSessionRef(): string | undefined { return this.sessionRef; }

  async start(): Promise<void> {
    try {
      const invocation = await this.context.requestResolver.resolve(this.request.requestRef);
      if (this.terminal) return;
      validateInvocation(invocation);
      this.invocation = invocation;
      await this.session.prepare(this, invocation);
      if (this.terminal) return;
      this.session.dispatch(this, invocation);
    } catch (error) {
      if (this.terminal) return;
      const sideEffectFree = error instanceof ExecutionDispatchError
        ? error.sideEffectFree
        : !this.dispatched;
      this.finish('invalidated', sideEffectFree ? 'pre-dispatch-rejected' : 'dispatch-unknown', sideEffectFree);
    }
  }

  beginDispatch(sessionRef: string, nativeRunRef?: string): number {
    this.dispatched = true;
    this.sessionRef = sessionRef;
    this.nativeRunRef = nativeRunRef;
    this.attempt += 1;
    this.recoveringAttempt = undefined;
    if (this.timeoutHandle !== undefined) this.context.scheduler.clearTimeout(this.timeoutHandle);
    this.timeoutHandle = this.context.scheduler.setTimeout(() => {
      void this.terminate('timeout');
    }, this.context.runTimeoutMs);
    return this.attempt;
  }

  emitRunStarted(): void {
    this.emit({ kind: 'run-started' });
  }

  claimRecovery(attempt: number): boolean {
    if (this.terminal || attempt !== this.attempt || this.recoveringAttempt === attempt) return false;
    this.recoveringAttempt = attempt;
    return true;
  }

  releaseRecovery(): void {
    this.recoveringAttempt = undefined;
  }

  handleNotification(notification: AcpSessionNotification): void {
    if (this.terminal || notification.sessionId !== this.sessionRef) return;
    this.observedProviderActivity = true;
    const update = notification.update;
    const asyncAgentResult = normalizeGrokSubagentExtensionNotification(
      notification,
      this.sessionRef ?? null,
    );
    if (asyncAgentResult) {
      this.queueAgentTask(() => this.completeNativeAgent(
        asyncAgentResult.agentId,
        asyncAgentResult.status === 'completed' ? 'completed' : 'failed',
        asyncAgentResult.result,
      ));
      return;
    }
    if (isGrokTurnCompletedUpdate(update)) return;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      const next = `${this.output}${update.content.text}`;
      if (Buffer.byteLength(next, 'utf8') > this.context.maxResultBytes) {
        void this.terminate('output-limit');
        return;
      }
      this.output = next;
      return;
    }
    if (update.sessionUpdate === 'agent_thought_chunk') {
      this.emit({ kind: 'thinking-activity' });
      return;
    }
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const rememberedName = this.toolNames.get(update.toolCallId);
      const toolName = normalizeGrokToolName(update.title ?? rememberedName);
      this.toolNames.set(update.toolCallId, toolName);
      this.emit({ kind: 'tool-activity', toolCallId: update.toolCallId });
      if (update.status !== 'completed' && update.status !== 'failed') return;
      const raw = stringifyProviderValue(update.rawOutput);
      if (toolName === GROK_SUBAGENT_SPAWN_TOOL) {
        if (!this.acceptingAgentEvidence) return;
        const { agentId } = extractGrokSpawnResult(raw);
        if (agentId) this.observeNativeAgent(agentId);
        return;
      }
      if (toolName === GROK_SUBAGENT_WAIT_TOOL) {
        if (!this.acceptingAgentEvidence) return;
        const waitResult = extractGrokWaitResult(raw);
        for (const [agentId, status] of Object.entries(waitResult.statuses)) {
          this.observeNativeAgent(agentId);
          this.emit({
            kind: 'native-agent-activity',
            nativeAgentKey: agentId,
            activity: 'wait-observed',
          });
          if (status.completed) {
            this.queueAgentTask(() => this.completeNativeAgent(
              agentId,
              'completed',
              status.completed,
            ));
          } else if (status.error || status.failed) {
            this.queueAgentTask(() => this.completeNativeAgent(
              agentId,
              'failed',
              status.error ?? status.failed,
            ));
          } else {
            this.emit({ kind: 'native-agent-status', nativeAgentKey: agentId, status: 'waiting' });
          }
        }
      }
    }
  }

  async completeFromPrompt(response: AcpPromptResponse, attempt: number): Promise<void> {
    if (this.terminal || attempt !== this.attempt || this.recoveringAttempt === attempt) return;
    const responseRunRef = response.userMessageId?.trim();
    if (responseRunRef && this.nativeRunRef && responseRunRef !== this.nativeRunRef) {
      this.completionTask = this.finishAfterAgentDrain('indeterminate', 'effects-unknown');
      await this.completionTask;
      return;
    }
    if (responseRunRef) this.nativeRunRef = responseRunRef;
    if (this.terminationIntent) return;
    if (this.completionTask) return this.completionTask;
    this.completionTask = this.finishPrompt(response, attempt).catch(() => {
      if (!this.terminal) this.finish('indeterminate', 'effects-unknown');
    });
    await this.completionTask;
  }

  private async finishPrompt(response: AcpPromptResponse, attempt: number): Promise<void> {
    const usageAbort = new AbortController();
    await completesWithin(
      Promise.resolve().then(() => this.context.usage.recordTurn({
        nativeSessionRef: this.sessionRef!,
        ...(this.invocation.providerState ? { providerState: this.invocation.providerState } : {}),
        response,
        signal: usageAbort.signal,
      })),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    usageAbort.abort(new Error('Grok Build usage projection completed.'));
    await this.agentTaskChain;
    if (this.terminal || attempt !== this.attempt || this.terminationIntent) return;
    if (/cancel/i.test(response.stopReason)) {
      await this.finishAfterAgentDrain('interrupted', 'known-process-exit');
      return;
    }
    const output = this.output.trim();
    if (!output) {
      await this.drainAgentTasksAndCloseAdmission();
      if (this.terminal) return;
      this.finishForMissingResult();
      return;
    }
    await this.commitCompletion(output, attempt);
  }

  private async commitCompletion(output: string, attempt: number): Promise<void> {
    const abort = new AbortController();
    const settlement = await settleResultCommit(
      Promise.resolve().then(() => this.context.resultSink.storeResult({
        output,
        nativeSessionRef: this.sessionRef!,
        ...(this.nativeRunRef ? { nativeRunRef: this.nativeRunRef } : {}),
        source: 'assistant',
        signal: abort.signal,
      })),
      abort,
      this.context.scheduler,
      this.context.resultCommitTimeoutMs,
    );
    if (this.terminal || attempt !== this.attempt) return;
    if (settlement.kind === 'committed') {
      this.emit({ kind: 'result', result: settlement.result });
      await this.drainAgentTasksAndCloseAdmission();
      if (this.terminal) return;
      this.finish('succeeded', 'completed');
    } else if (settlement.kind === 'aborted') {
      await this.drainAgentTasksAndCloseAdmission();
      if (this.terminal) return;
      this.finish('failed', 'provider-failure');
    } else {
      await this.drainAgentTasksAndCloseAdmission();
      if (this.terminal) return;
      this.finish('indeterminate', 'effects-unknown');
    }
  }

  emitConnectionLost(): void {
    if (this.terminal) return;
    this.emit({ kind: 'connection-lost' });
    this.emit({ kind: 'recovery-started' });
  }

  async finishFromRecovery(evidence: RunRecoveryEvidence): Promise<void> {
    if (this.terminal) return;
    await this.drainAgentTasksAndCloseAdmission();
    if (this.terminal) return;
    if (evidence.kind === 'terminal') {
      if (evidence.terminal.resultRef) this.emit({ kind: 'result', result: evidence.terminal.resultRef });
      this.finish(evidence.terminal.kind, evidence.terminal.reason);
      return;
    }
    if (evidence.kind === 'stopped-safe') {
      this.finish('interrupted', 'recovery-exhausted-safe');
      return;
    }
    this.finish(
      evidence.kind === 'unknown' && evidence.effectsPossible ? 'indeterminate' : 'interrupted',
      evidence.kind === 'unknown' && evidence.effectsPossible
        ? 'effects-unknown'
        : 'recovery-exhausted-safe',
    );
  }

  cancel(reason: { readonly code: 'user' | 'shutdown' | 'settings-transition' | 'parent-cancelled' } = { code: 'user' }): Promise<void> {
    return this.terminate(reason.code === 'shutdown' ? 'shutdown' : 'cancel');
  }

  private terminate(intent: 'cancel' | 'shutdown' | 'timeout' | 'output-limit'): Promise<void> {
    if (this.terminal) return Promise.resolve();
    if (this.completionTask) return this.completionTask;
    if (this.terminationTask) return this.terminationTask;
    this.terminationIntent = intent;
    this.terminationTask = (async () => {
      if (!this.dispatched) {
        this.session.cancelPreparation(this);
        this.finish('cancelled', 'cancellation-confirmed', true);
        return;
      }
      this.session.requestCancel(this);
      const evidence = await this.session.reconcileRun(this);
      await this.drainAgentTasksAndCloseAdmission();
      if (this.terminal) return;
      if (evidence.kind === 'terminal') {
        if (evidence.terminal.resultRef) {
          this.emit({ kind: 'result', result: evidence.terminal.resultRef });
        }
        this.finish(evidence.terminal.kind, evidence.terminal.reason);
        return;
      }
      if (evidence.kind === 'stopped-safe') {
        if (intent === 'timeout') this.finish('failed', 'timeout');
        else if (intent === 'output-limit') this.finish('failed', 'output-limit');
        else this.finish('cancelled', 'cancellation-confirmed');
        return;
      }
      this.finish(
        'indeterminate',
        intent === 'shutdown'
          ? 'shutdown-unknown'
          : intent === 'cancel'
            ? 'cancellation-unknown'
            : 'effects-unknown',
      );
    })();
    return this.terminationTask;
  }

  recoveryQuery(): RunRecoveryQuery {
    return {
      backendId: GROK_EXECUTION_DESCRIPTOR.backendId,
      backendGeneration: this.session.backendGeneration,
      executionSessionId: this.session.executionSessionId,
      sessionInstanceId: this.session.sessionInstanceId,
      runId: this.request.runId,
      ...(this.sessionRef ? { nativeSessionRef: this.sessionRef } : {}),
      ...(this.nativeRunRef ? { nativeRunRef: this.nativeRunRef } : {}),
      cancellationRequested: Boolean(this.terminationIntent),
      resultExpectation: this.request.resultExpectation,
    };
  }

  openInteraction(interactionId: InteractionId, prepared: GrokPreparedInteraction): void {
    this.emit({
      kind: 'interaction-opened',
      interaction: {
        interactionId,
        runId: this.request.runId,
        kind: prepared.kind,
        presentationRef: prepared.presentationRef,
        responseIds: [...prepared.responseIds],
      },
    });
  }

  resolveInteraction(interactionId: InteractionId, responseId: string): void {
    if (this.terminal) return;
    this.emit({ kind: 'interaction-resolved', interactionId, responseId });
  }

  private queueAgentTask(task: () => Promise<void>): void {
    if (!this.acceptingAgentEvidence || this.terminal) return;
    this.agentTaskChain = this.agentTaskChain.then(task).catch(() => {
      if (!this.terminal) this.finish('indeterminate', 'effects-unknown');
    });
  }

  private observeNativeAgent(nativeAgentKey: string): void {
    if (this.terminal || this.observedAgentKeys.has(nativeAgentKey)) return;
    this.observedAgentKeys.add(nativeAgentKey);
    this.emit({ kind: 'native-agent-observed', nativeAgentKey });
    this.emit({ kind: 'native-agent-status', nativeAgentKey, status: 'running' });
  }

  private async completeNativeAgent(
    nativeAgentKey: string,
    status: 'completed' | 'failed',
    output?: string,
  ): Promise<void> {
    if (this.terminal) return;
    this.observeNativeAgent(nativeAgentKey);
    const knownTerminal = this.agentTerminalStatuses.get(nativeAgentKey);
    if (knownTerminal === 'failed') return;
    const normalizedOutput = output?.trim();
    if (status === 'completed' && normalizedOutput && !this.agentResultKeys.has(nativeAgentKey)) {
      if (Buffer.byteLength(normalizedOutput, 'utf8') > this.context.maxResultBytes) {
        if (!knownTerminal) {
          this.agentTerminalStatuses.set(nativeAgentKey, 'completed');
          this.emit({ kind: 'native-agent-status', nativeAgentKey, status: 'completed' });
        }
        return;
      }
      this.agentResultKeys.add(nativeAgentKey);
      const abort = new AbortController();
      const settlement = await settleResultCommit(
        Promise.resolve().then(() => this.context.resultSink.storeResult({
          output: normalizedOutput,
          nativeSessionRef: this.sessionRef!,
          ...(this.nativeRunRef ? { nativeRunRef: this.nativeRunRef } : {}),
          source: 'native-agent',
          nativeAgentKey,
          signal: abort.signal,
        })),
        abort,
        this.context.scheduler,
        this.context.resultCommitTimeoutMs,
      );
      if (this.terminal) return;
      if (settlement.kind === 'committed') {
        this.emit({ kind: 'native-agent-result', nativeAgentKey, result: settlement.result });
        if (!knownTerminal) {
          this.agentTerminalStatuses.set(nativeAgentKey, 'completed');
          this.emit({ kind: 'native-agent-status', nativeAgentKey, status: 'completed' });
        }
        return;
      }
      if (settlement.kind === 'unknown') {
        this.finish('indeterminate', 'effects-unknown');
        return;
      }
      this.agentResultKeys.delete(nativeAgentKey);
      if (!knownTerminal) {
        this.agentTerminalStatuses.set(nativeAgentKey, 'completed');
        this.emit({ kind: 'native-agent-status', nativeAgentKey, status: 'completed' });
      }
      return;
    }
    if (!this.terminal && !knownTerminal) {
      this.agentTerminalStatuses.set(nativeAgentKey, status);
      this.emit({
        kind: 'native-agent-status',
        nativeAgentKey,
        status: status === 'completed' ? 'completed' : 'failed',
      });
    }
  }

  private async drainAgentTasksAndCloseAdmission(): Promise<void> {
    this.acceptingAgentEvidence = false;
    await this.agentTaskChain;
  }

  private async finishAfterAgentDrain(
    terminal: RunTerminalKind,
    reason: RunTerminalReason,
    sideEffectFree = false,
  ): Promise<void> {
    await this.drainAgentTasksAndCloseAdmission();
    if (!this.terminal) this.finish(terminal, reason, sideEffectFree);
  }

  rejectBeforeDispatch(): void {
    this.finish('invalidated', 'pre-dispatch-rejected', true);
  }

  private finishForMissingResult(): void {
    if (this.request.resultExpectation === 'required') {
      this.finish('failed', 'missing-required-result');
    } else {
      this.finish('succeeded', 'completed');
    }
  }

  private emit(event: ExecutionEvent): void {
    const delivery: ProviderExecutionEvent = {
      backendId: GROK_EXECUTION_DESCRIPTOR.backendId,
      backendGeneration: this.session.backendGeneration,
      executionSessionId: this.session.executionSessionId,
      sessionInstanceId: this.session.sessionInstanceId,
      deliveryId: this.session.nextDeliveryId(String(this.request.runId)),
      occurredAt: (this.context.now ?? Date.now)(),
      scope: {
        kind: 'run',
        runId: this.request.runId,
        ...(this.nativeRunRef ? { nativeRunRef: this.nativeRunRef } : {}),
      },
      event,
    };
    this.events.push(delivery);
    this.session.publish(delivery);
  }

  private finish(
    terminal: RunTerminalKind,
    reason: RunTerminalReason,
    sideEffectFree = false,
  ): void {
    if (this.terminal) return;
    this.terminal = true;
    this.acceptingAgentEvidence = false;
    if (this.timeoutHandle !== undefined) this.context.scheduler.clearTimeout(this.timeoutHandle);
    this.cancelInteractions(this);
    this.emit({ kind: 'terminal', terminal, reason, sideEffectFree });
    this.events.close();
    this.onTerminal();
  }
}

function validateInvocation(invocation: GrokExecutionInvocation): void {
  if (!invocation.startupRef.trim() || !invocation.restartFingerprint.trim()) {
    throw new ExecutionDispatchError('Managed ACP invocation identity is invalid.', true);
  }
  if (!invocation.cwd.trim() || invocation.prompt.length === 0) {
    throw new ExecutionDispatchError('Managed ACP invocation payload is invalid.', true);
  }
}

function validatePreparedInteraction(prepared: GrokPreparedInteraction): void {
  if (!prepared.presentationRef.trim()
    || prepared.responseIds.length === 0
    || !prepared.responseIds.includes(prepared.providerResolvedResponseId)) {
    throw new Error('Managed ACP interaction contract is invalid.');
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  scheduler: GrokExecutionScheduler,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise(resolve => {
    let settled = false;
    const handle = scheduler.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    }, timeoutMs);
    void operation.then(
      value => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(handle);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(handle);
        resolve(undefined);
      },
    );
  });
}

function completesWithin(
  operation: Promise<void>,
  scheduler: GrokExecutionScheduler,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const handle = scheduler.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    void operation.then(
      () => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(handle);
        resolve(true);
      },
      () => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(handle);
        resolve(false);
      },
    );
  });
}

function trimOldestMapEntries<TKey, TValue>(map: Map<TKey, TValue>, maximum: number): void {
  while (map.size > maximum) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

function stringifyProviderValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
