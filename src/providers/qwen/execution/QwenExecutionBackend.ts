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
  InteractionRequest,
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
import type { SlashCommand } from '@/core/types';
import { isAcpMissingSessionError } from '@/providers/acp/acpSessionResume';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import { ManagedAcpTerminationUnconfirmedError } from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpContentBlock,
  AcpNewSessionRequest,
  AcpPromptResponse,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionNotification,
} from '@/providers/acp/types';

export const QWEN_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-qwen'),
  association: { kind: 'provider' as const, providerId: 'qwen' },
});

export interface QwenExecutionInvocation {
  readonly startupRef: string;
  readonly restartFingerprint: string;
  readonly cwd: string;
  readonly prompt: readonly AcpContentBlock[];
  readonly replacementPrompt?: readonly AcpContentBlock[];
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
  readonly messageId?: string;
  readonly dynamicRef?: string;
}

export interface QwenExecutionRequestResolver {
  resolve(requestRef: string): Promise<QwenExecutionInvocation>;
}

export interface QwenExecutionDynamicApplier {
  apply(input: {
    readonly client: ManagedAcpClient;
    readonly sessionId: string;
    readonly dynamicRef?: string;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export interface QwenPreparedInteraction {
  readonly kind: InteractionRequest['kind'];
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly providerResolvedResponseId: string;
  resolve(responseId: string): Promise<AcpRequestPermissionResponse>;
  cancel(): Promise<AcpRequestPermissionResponse>;
}

export interface QwenInteractionBridge {
  prepare(request: AcpRequestPermissionRequest): Promise<QwenPreparedInteraction>;
}

export interface QwenExecutionResultSink {
  storeResult(input: {
    readonly output: string;
    readonly nativeSessionRef: string;
    readonly nativeRunRef?: string;
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome>;
}

export interface QwenExecutionCommandsPort {
  replace(sessionId: string, commands: readonly SlashCommand[]): void;
  clear(sessionId: string): void;
}

export interface QwenExecutionUsagePort {
  attach(input: {
    readonly ownerRef: string;
    readonly nativeSessionRef: string;
    readonly readContextUsage?: () => Promise<unknown>;
  }): void;
  detach(ownerRef: string): void;
  recordNotification(notification: AcpSessionNotification): void;
  recordTurn(input: {
    readonly nativeSessionRef: string;
    readonly response: AcpPromptResponse;
    readonly readContextUsage?: () => Promise<unknown>;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export type QwenExecutionScheduler = ResultCommitScheduler;

export interface QwenExecutionBackendContext {
  readonly clientFactory: ManagedAcpClientFactory;
  readonly requestResolver: QwenExecutionRequestResolver;
  readonly dynamicApplier: QwenExecutionDynamicApplier;
  readonly interactionBridge: QwenInteractionBridge;
  readonly resultSink: QwenExecutionResultSink;
  readonly reconciler: ExecutionRecoveryPort;
  readonly commands: QwenExecutionCommandsPort;
  readonly usage: QwenExecutionUsagePort;
  readonly scheduler: QwenExecutionScheduler;
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

interface PendingInteraction {
  readonly interactionId: InteractionId;
  readonly run: QwenExecutionRun;
  readonly prepared: QwenPreparedInteraction;
  readonly complete: (response: AcpRequestPermissionResponse) => void;
  selectedResponseId?: string;
  settlementTask?: Promise<void>;
  settled: boolean;
}

export class QwenExecutionBackend
implements ExecutionBackend, InteractionPort, ExecutionRecoveryPort {
  readonly descriptor = QWEN_EXECUTION_DESCRIPTOR;
  private readonly sessions = new Map<string, QwenExecutionSession>();
  private readonly interactions = new Map<InteractionId, PendingInteraction>();
  private readonly settledInteractions = new Map<InteractionId, string>();
  private disposeTask?: Promise<void>;
  private disposing = false;

  constructor(protected readonly context: QwenExecutionBackendContext) {}

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposing) {
      throw new Error('Managed ACP backend is disposing.');
    }
    const key = String(config.executionSessionId);
    if (this.sessions.has(key)) {
      throw new Error('Managed ACP execution session already exists.');
    }
    let session: QwenExecutionSession;
    session = new QwenExecutionSession(
      config,
      this.context,
      request => this.requestPermission(request, session.activeExecutionRun),
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
      () => pending.prepared.resolve(resolution.responseId),
    );
  }

  async cancel(interactionId: InteractionId): Promise<void> {
    const pending = this.interactions.get(interactionId);
    if (!pending || pending.settled) return;
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
    const active = session?.activeExecutionRun;
    if (active?.runId === query.runId && session?.isAttached(active)) {
      return { kind: 'running', sessionInstanceId: session.sessionInstanceId };
    }
    return this.context.reconciler.reconcile(query);
  }

  dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask;
    this.disposing = true;
    this.disposeTask = (async () => {
      const sessionResults = await Promise.allSettled(
        [...this.sessions.values()].map(session => session.dispose()),
      );
      const interactionResults = await Promise.allSettled(
        [...this.interactions.keys()].map(interactionId => this.cancel(interactionId)),
      );
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
    run: QwenExecutionRun | undefined,
  ): Promise<AcpRequestPermissionResponse> {
    if (!run || run.isTerminal || request.sessionId !== run.nativeSessionRef) {
      return { outcome: { outcome: 'cancelled' } };
    }
    const preparation = this.context.interactionBridge.prepare(request);
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
    operation: () => Promise<AcpRequestPermissionResponse>,
  ): Promise<void> {
    if (pending.settlementTask) {
      if (pending.selectedResponseId !== responseId) {
        throw new Error('Managed ACP interaction is resolving another response.');
      }
    } else {
      pending.selectedResponseId = responseId;
      const task = operation().then(response => {
        this.settleInteraction(pending, responseId, response);
      });
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

  private settleInteraction(
    pending: PendingInteraction,
    responseId: string,
    response: AcpRequestPermissionResponse,
  ): void {
    if (pending.settled) return;
    pending.settled = true;
    this.interactions.delete(pending.interactionId);
    this.settledInteractions.set(pending.interactionId, responseId);
    trimOldestMapEntries(this.settledInteractions, 1024);
    pending.run.resolveInteraction(pending.interactionId, responseId);
    pending.complete(response);
  }

  private failCloseInteraction(pending: PendingInteraction): void {
    this.settleInteraction(
      pending,
      pending.prepared.providerResolvedResponseId,
      { outcome: { outcome: 'cancelled' } },
    );
  }

  private async discardPreparedInteraction(
    prepared: QwenPreparedInteraction,
  ): Promise<void> {
    await withTimeout(
      prepared.cancel(),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
  }

  private cancelRunInteractions(run: QwenExecutionRun): void {
    for (const pending of this.interactions.values()) {
      if (pending.run !== run || pending.settled) continue;
      void this.cancel(pending.interactionId).catch(() => this.failCloseInteraction(pending));
    }
  }
}

class QwenExecutionSession implements ExecutionSession {
  readonly sessionInstanceId: SessionInstanceId;
  private readonly listeners = new Set<(event: ProviderExecutionEvent) => void>();
  private client?: ManagedAcpClient;
  private clientAbort?: AbortController;
  private clientCloseTask?: Promise<'confirmed' | 'unconfirmed'>;
  private clientCreationTask?: Promise<ManagedAcpClient>;
  private clientGeneration = 0;
  private readonly retainedClients = new Set<ManagedAcpClient>();
  private clientCloseUnsubscribe?: Unsubscribe;
  private notificationUnsubscribe?: Unsubscribe;
  private restartFingerprint?: string;
  private loadedSessionRef?: string;
  private nativeSessionRef?: string;
  private disposed = false;
  private disposeTask?: Promise<void>;
  private deliverySequence = 0;
  private activeRun?: QwenExecutionRun;
  private controlTurnToken?: object;
  private replacementSession = false;

  constructor(
    private readonly config: ExecutionSessionConfig,
    private readonly context: QwenExecutionBackendContext,
    private readonly permissionHandler: (
      request: AcpRequestPermissionRequest,
    ) => Promise<AcpRequestPermissionResponse>,
    private readonly cancelInteractions: (run: QwenExecutionRun) => void,
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

  get activeExecutionRun(): QwenExecutionRun | undefined {
    return this.activeRun;
  }

  get activeClient(): ManagedAcpClient | undefined {
    return this.client;
  }

  createRun(request: ExecutionRequest): ExecutionRun {
    const run = new QwenExecutionRun(
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

  isAttached(run: QwenExecutionRun): boolean {
    return this.activeRun === run && Boolean(this.client && this.nativeSessionRef);
  }

  async prepare(run: QwenExecutionRun, invocation: QwenExecutionInvocation): Promise<void> {
    await this.ensureClient(invocation);
    if (run.isTerminal) return;
    const generation = this.clientGeneration;
    await this.ensureSessionBinding(invocation, generation);
    if (run.isTerminal) return;
    if (generation !== this.clientGeneration) {
      throw new ExecutionDispatchError('Managed ACP preparation lost its client.', true);
    }
    if (!this.client || !this.nativeSessionRef) {
      throw new ExecutionDispatchError('Managed ACP session is not ready.', true);
    }
    const applied = await completesWithin(
      this.applyDynamic(invocation),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (run.isTerminal) return;
    if (generation !== this.clientGeneration) {
      throw new ExecutionDispatchError('Managed ACP preparation lost its client.', true);
    }
    if (!applied) {
      const termination = await this.closeClient();
      if (termination === 'unconfirmed') {
        throw new ExecutionDispatchError(
          'Qwen ACP dynamic configuration ended with unconfirmed process ownership.',
          false,
        );
      }
      throw new ExecutionDispatchError('Qwen ACP dynamic configuration was not confirmed.', true);
    }
  }

  dispatch(run: QwenExecutionRun, invocation: QwenExecutionInvocation): void {
    const client = this.client;
    const sessionId = this.nativeSessionRef;
    if (!client || !sessionId || run.isTerminal) return;
    const attempt = run.beginDispatch(sessionId, invocation.messageId);
    if (attempt === 1) run.emitRunStarted();
    const prompt = run.selectPrompt(invocation, this.replacementSession);
    this.replacementSession = false;
    void client.prompt({
      ...(invocation.messageId ? { messageId: invocation.messageId } : {}),
      prompt: [...prompt],
      sessionId,
    }).then(
      response => run.completeFromPrompt(response, attempt),
      error => this.recover(run, invocation, error, attempt),
    );
  }

  requestCancel(run: QwenExecutionRun): void {
    if (this.activeRun !== run || !this.client || !this.nativeSessionRef) return;
    this.client.cancel(this.nativeSessionRef);
  }

  cancelPreparation(run: QwenExecutionRun): void {
    if (this.activeRun !== run) return;
    this.clientGeneration += 1;
    this.clientAbort?.abort(new Error('Managed ACP run cancelled before dispatch.'));
    void this.closeClient().catch(() => undefined);
  }

  async reconcileRun(run: QwenExecutionRun): Promise<RunRecoveryEvidence> {
    const evidence = await withTimeout(
      this.context.reconciler.reconcile(run.recoveryQuery()),
      this.context.scheduler,
      this.context.recoveryTimeoutMs,
    );
    return evidence ?? { kind: 'unknown', effectsPossible: true };
  }

  private async recover(
    run: QwenExecutionRun,
    invocation: QwenExecutionInvocation,
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
        await this.applyDynamic(invocation);
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
    run.finishFromRecovery(evidence);
  }

  private async ensureClient(
    invocation: QwenExecutionInvocation,
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
    this.notificationUnsubscribe = client.onSessionNotification(notification => {
      if (generation === this.clientGeneration) this.handleNotification(notification);
    });
    this.clientCloseUnsubscribe = client.onConnectionLost(error => {
      const active = this.activeRun;
      if (generation === this.clientGeneration && active && !active.isTerminal) {
        if (active.hasDispatched) {
          void this.recover(active, active.invocation, error, active.currentAttempt);
        } else {
          this.cancelPreparation(active);
        }
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
  }

  private async applyDynamic(invocation: QwenExecutionInvocation): Promise<void> {
    if (!this.client || !this.nativeSessionRef) {
      throw new ExecutionDispatchError('Qwen ACP session is not ready.', true);
    }
    const token = {};
    this.controlTurnToken = token;
    try {
      await this.context.dynamicApplier.apply({
        client: this.client,
        sessionId: this.nativeSessionRef,
        dynamicRef: invocation.dynamicRef,
        signal: this.clientAbort?.signal ?? new AbortController().signal,
      });
    } finally {
      if (this.controlTurnToken === token) this.controlTurnToken = undefined;
    }
  }

  private async ensureSessionBinding(
    invocation: QwenExecutionInvocation,
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
        if (response.sessionId != null && response.sessionId !== target) {
          throw new ExecutionDispatchError('Managed ACP load returned another session.', true);
        }
        this.requireCurrentClient(client, generation);
        this.loadedSessionRef = target;
        this.attachSessionFeatures(client, target);
        return;
      } catch (error) {
        const missing = (this.context.isMissingSessionError ?? isAcpMissingSessionError)(error);
        if (!missing) throw new ExecutionDispatchError('Managed ACP session load failed.', true);
        this.nativeSessionRef = undefined;
        this.loadedSessionRef = undefined;
        this.replacementSession = true;
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
      this.attachSessionFeatures(client, response.sessionId);
    }
  }

  private attachSessionFeatures(client: ManagedAcpClient, sessionId: string): void {
    const requestExtension = client.requestExtension?.bind(client);
    try {
      this.context.usage.attach({
        ownerRef: String(this.executionSessionId),
        nativeSessionRef: sessionId,
        ...(requestExtension ? {
          readContextUsage: () => requestExtension(
            'qwen/status/session/context_usage',
            { detail: false, sessionId },
          ),
        } : {}),
      });
    } catch {
      // Usage projection cannot take ownership of the execution lifecycle.
    }
  }

  private handleNotification(notification: AcpSessionNotification): void {
    if (notification.sessionId !== this.nativeSessionRef) return;
    try {
      this.context.usage.recordNotification(notification);
    } catch {
      // Usage projection is optional and cannot interrupt provider execution.
    }
    if (notification.update.sessionUpdate === 'available_commands_update') {
      try {
        this.context.commands.replace(
          notification.sessionId,
          notification.update.availableCommands.map(toSlashCommand),
        );
      } catch {
        // Command projection is optional and cannot interrupt provider execution.
      }
    }
    if (this.controlTurnToken) return;
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
    this.clientCloseUnsubscribe?.();
    this.clientCloseUnsubscribe = undefined;
    this.clientAbort?.abort(new Error('Managed ACP client closed.'));
    this.clientAbort = undefined;
    const client = this.client;
    const nativeSessionRef = this.nativeSessionRef;
    const pendingCreation = this.clientCreationTask;
    this.client = undefined;
    this.restartFingerprint = undefined;
    this.loadedSessionRef = undefined;
    this.controlTurnToken = undefined;
    try {
      this.context.usage.detach(String(this.executionSessionId));
    } catch {
      // Usage projection cannot retain process ownership during cleanup.
    }
    if (nativeSessionRef) {
      try {
        this.context.commands.clear(nativeSessionRef);
      } catch {
        // Command projection cannot retain process ownership during cleanup.
      }
    }
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

class QwenExecutionRun implements ExecutionRun {
  readonly events = new ExecutionEventQueue<ProviderExecutionEvent>();
  readonly runId;
  invocation!: QwenExecutionInvocation;
  private terminal = false;
  private dispatched = false;
  private output = '';
  private observedProviderActivity = false;
  private timeoutHandle?: unknown;
  private attempt = 0;
  private recoveringAttempt?: number;
  private terminationTask?: Promise<void>;
  private completionTask?: Promise<void>;
  private readonly opaqueAgentRefs = new Set<string>();
  private selectedPrompt?: readonly AcpContentBlock[];
  private terminationIntent?: 'cancel' | 'shutdown' | 'timeout' | 'output-limit';
  private nativeRunRef?: string;
  private sessionRef?: string;

  constructor(
    private readonly request: ExecutionRequest,
    private readonly session: QwenExecutionSession,
    private readonly context: QwenExecutionBackendContext,
    private readonly cancelInteractions: (run: QwenExecutionRun) => void,
    private readonly onTerminal: () => void,
  ) {
    this.runId = request.runId;
  }

  get isTerminal(): boolean { return this.terminal; }
  get hasDispatched(): boolean { return this.dispatched; }
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

  selectPrompt(
    invocation: QwenExecutionInvocation,
    replacementSession: boolean,
  ): readonly AcpContentBlock[] {
    this.selectedPrompt ??= replacementSession
      ? invocation.replacementPrompt ?? invocation.prompt
      : invocation.prompt;
    return this.selectedPrompt;
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
    const opaqueAgentRef = getQwenOpaqueAgentRef(update);
    if (opaqueAgentRef) {
      if (!this.opaqueAgentRefs.has(opaqueAgentRef)) {
        this.opaqueAgentRefs.add(opaqueAgentRef);
        this.emit({ kind: 'tool-activity', toolCallId: opaqueAgentRef });
      }
      return;
    }
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
      this.emit({ kind: 'tool-activity', toolCallId: update.toolCallId });
    }
  }

  async completeFromPrompt(response: AcpPromptResponse, attempt: number): Promise<void> {
    if (this.terminal || attempt !== this.attempt || this.recoveringAttempt === attempt) return;
    const responseRunRef = response.userMessageId?.trim();
    if (responseRunRef && this.nativeRunRef && responseRunRef !== this.nativeRunRef) {
      this.finish('indeterminate', 'effects-unknown');
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
    const requestExtension = this.session.activeClient?.requestExtension?.bind(
      this.session.activeClient,
    );
    await completesWithin(
      Promise.resolve().then(() => this.context.usage.recordTurn({
        nativeSessionRef: this.sessionRef!,
        response,
        ...(requestExtension ? {
          readContextUsage: () => requestExtension(
            'qwen/status/session/context_usage',
            { detail: false, sessionId: this.sessionRef! },
          ),
        } : {}),
        signal: usageAbort.signal,
      })),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    usageAbort.abort(new Error('Qwen usage projection completed.'));
    if (this.terminal || attempt !== this.attempt || this.terminationIntent) return;
    if (/cancel/i.test(response.stopReason)) {
      this.finish('interrupted', 'known-process-exit');
      return;
    }
    const output = this.output.trim();
    if (!output) {
      this.finishForMissingResult();
      return;
    }
    await this.commitCompletion(output, attempt);
  }

  private async commitCompletion(output: string, attempt: number): Promise<void> {
    const abort = new AbortController();
    const settlement = await settleResultCommit(
      this.context.resultSink.storeResult({
        output,
        nativeSessionRef: this.sessionRef!,
        ...(this.nativeRunRef ? { nativeRunRef: this.nativeRunRef } : {}),
        signal: abort.signal,
      }),
      abort,
      this.context.scheduler,
      this.context.resultCommitTimeoutMs,
    );
    if (this.terminal || attempt !== this.attempt) return;
    if (settlement.kind === 'committed') {
      this.emit({ kind: 'result', result: settlement.result });
      this.finish('succeeded', 'completed');
    } else if (settlement.kind === 'aborted') {
      this.finish('failed', 'provider-failure');
    } else {
      this.finish('indeterminate', 'effects-unknown');
    }
  }

  emitConnectionLost(): void {
    if (this.terminal) return;
    this.emit({ kind: 'connection-lost' });
    this.emit({ kind: 'recovery-started' });
  }

  finishFromRecovery(evidence: RunRecoveryEvidence): void {
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
      backendId: QWEN_EXECUTION_DESCRIPTOR.backendId,
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

  openInteraction(interactionId: InteractionId, prepared: QwenPreparedInteraction): void {
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
    this.emit({ kind: 'interaction-resolved', interactionId, responseId });
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
      backendId: QWEN_EXECUTION_DESCRIPTOR.backendId,
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
    if (this.timeoutHandle !== undefined) this.context.scheduler.clearTimeout(this.timeoutHandle);
    this.cancelInteractions(this);
    this.emit({ kind: 'terminal', terminal, reason, sideEffectFree });
    this.events.close();
    this.onTerminal();
  }
}

function validateInvocation(invocation: QwenExecutionInvocation): void {
  if (!invocation.startupRef.trim() || !invocation.restartFingerprint.trim()) {
    throw new ExecutionDispatchError('Managed ACP invocation identity is invalid.', true);
  }
  if (!invocation.cwd.trim() || invocation.prompt.length === 0) {
    throw new ExecutionDispatchError('Managed ACP invocation payload is invalid.', true);
  }
  if (invocation.replacementPrompt && invocation.replacementPrompt.length === 0) {
    throw new ExecutionDispatchError('Qwen replacement prompt is empty.', true);
  }
}

function getQwenOpaqueAgentRef(
  update: AcpSessionNotification['update'],
): string | null {
  if (update.sessionUpdate !== 'agent_message_chunk'
    && update.sessionUpdate !== 'agent_thought_chunk'
    && update.sessionUpdate !== 'tool_call'
    && update.sessionUpdate !== 'tool_call_update') {
    return null;
  }
  const record = update as typeof update & {
    _meta?: Record<string, unknown>;
    parentToolCallId?: unknown;
    subagentType?: unknown;
  };
  const metadata = record._meta;
  const rawParentToolCallId = record.parentToolCallId ?? metadata?.parentToolCallId;
  const rawSubagentType = record.subagentType ?? metadata?.subagentType;
  const parentToolCallId = typeof rawParentToolCallId === 'string'
    ? rawParentToolCallId.trim()
    : '';
  const subagentType = typeof rawSubagentType === 'string'
    ? rawSubagentType.trim()
    : '';
  return parentToolCallId && subagentType ? parentToolCallId : null;
}

function toSlashCommand(
  command: Extract<
  AcpSessionNotification['update'],
  { sessionUpdate: 'available_commands_update' }
  >['availableCommands'][number],
): SlashCommand {
  const name = command.name.replace(/^\//, '');
  return {
    argumentHint: command.input?.hint ?? undefined,
    content: '',
    description: command.description ?? undefined,
    id: `acp:${name}`,
    name,
    source: 'sdk',
  };
}

function validatePreparedInteraction(prepared: QwenPreparedInteraction): void {
  if (!prepared.presentationRef.trim()
    || prepared.responseIds.length === 0
    || !prepared.responseIds.includes(prepared.providerResolvedResponseId)) {
    throw new Error('Managed ACP interaction contract is invalid.');
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  scheduler: QwenExecutionScheduler,
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
  scheduler: QwenExecutionScheduler,
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
