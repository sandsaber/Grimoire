/**
 * The execution backend every managed-ACP provider runs on.
 *
 * Built for OpenCode's flip and named for it until this commit, when Grok's
 * wire recording showed how little of it was ever OpenCode's: three lines, of
 * which two were the descriptor. Everything else here is the protocol — the
 * client's lifetime, the session binding and its reload, the dispatch, the
 * recovery, the interactions and the result — and every provider-specific
 * decision arrives through a port.
 *
 * What a provider still owns is its launch, its permission vocabulary, its tool
 * normalization and what it does with the content this carries.
 */
import type { ExecutionBackendDescriptor } from '@/core/execution/ExecutionBackendDescriptor';
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
import { isAcpMissingSessionError } from '@/providers/acp/acpSessionResume';
import type { AcpContentPayload } from '@/providers/acp/execution/AcpContentPayload';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import { ManagedAcpTerminationUnconfirmedError } from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpContentBlock,
  AcpNewSessionRequest,
  AcpNewSessionResponse,
  AcpPromptResponse,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionConfigOption,
  AcpSessionModeState,
  AcpSessionNotification,
} from '@/providers/acp/types';

export interface ManagedAcpExecutionInvocation {
  readonly startupRef: string;
  readonly restartFingerprint: string;
  readonly cwd: string;
  readonly prompt: readonly AcpContentBlock[];
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
  readonly messageId?: string;
  readonly dynamicRef?: string;
}

export interface ManagedAcpExecutionRequestResolver {
  resolve(requestRef: string): Promise<ManagedAcpExecutionInvocation>;
}

export interface ManagedAcpExecutionDynamicApplier {
  apply(input: {
    readonly client: ManagedAcpClient;
    readonly sessionId: string;
    readonly dynamicRef?: string;
    readonly signal: AbortSignal;
    /**
     * What the session answered with when it opened, where this dispatch
     * opened one.
     *
     * A turn is composed before its session exists, so a setting whose id the
     * session names — the thinking level — cannot be resolved when the turn is
     * queued. This is the only moment both are known.
     */
    readonly sessionConfigOptions?: readonly AcpSessionConfigOption[];
    /**
     * The modes the session named, where it named any.
     *
     * Beside the config options for the same reason: a turn is composed in the
     * vault's own vocabulary, and only an id the live session offered may be
     * sent back to it. This is the one moment both are known.
     */
    readonly sessionModes?: AcpSessionModeState;
  }): Promise<void>;
}

export interface ManagedAcpPreparedInteraction {
  readonly kind: InteractionRequest['kind'];
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly providerResolvedResponseId: string;
  resolve(responseId: string): Promise<AcpRequestPermissionResponse>;
  cancel(): Promise<AcpRequestPermissionResponse>;
}

export interface ManagedAcpInteractionBridge {
  prepare(request: AcpRequestPermissionRequest): Promise<ManagedAcpPreparedInteraction>;
}

export interface ManagedAcpExecutionResultSink {
  storeResult(input: {
    readonly output: string;
    readonly nativeSessionRef: string;
    readonly nativeRunRef?: string;
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome>;
  /**
   * The turn is ending; this is the provider's last look at it.
   *
   * Called when the prompt returns, whatever the stop reason, and before any
   * terminal — so what it finds reaches the turn that earned it rather than the
   * next one. Two things need it, both Grok's: no Grok turn reports a context
   * window over ACP at all, and a cancelled turn still spent tokens whose cost
   * is only in the session log. Hanging it off `storeResult` would lose exactly
   * the cancelled ones, since nothing is committed for those.
   */
  noteTurnEnded?(input: {
    readonly nativeSessionRef: string;
    readonly nativeRunRef?: string;
    readonly presentContent: (payload: unknown) => void;
  }): Promise<void>;
  /**
   * The answer a turn produced without sending it, where the provider can find
   * one.
   *
   * Grok finishes turns whose final message never reaches ACP while writing the
   * answer to its own session log; before the legacy runtime read that back, it
   * surfaced as an empty answer or as a credentials error. Asked only when the
   * turn produced no output at all, so a provider that has nothing to recover
   * declines by not declaring it.
   */
  recoverOutput?(input: {
    readonly nativeSessionRef: string;
    readonly nativeRunRef?: string;
  }): Promise<string | null>;
}

export interface ManagedAcpClientObserver {
  onClientReady(client: ManagedAcpClient): void;
  onClientLost(): void;
}

export interface ManagedAcpAuxiliaryPort {
  execute(requestRef: string, signal: AbortSignal): Promise<string>;
}

export type ManagedAcpExecutionScheduler = ResultCommitScheduler;

export interface ManagedAcpExecutionBackendContext {
  /**
   * Which provider this backend is, which is the only thing about it that is
   * not the protocol. Everything else in this file is ACP.
   */
  readonly descriptor: ExecutionBackendDescriptor;
  readonly clientFactory: ManagedAcpClientFactory;
  /**
   * The live process, for the provider features that are not turns.
   *
   * Grok reads its account's billing over the same transport a turn runs on,
   * and the composition that answers the plan indicator owns neither the
   * process nor its lifetime. Reported after `initialize`, because a client
   * that has not handshaken answers nothing — and withdrawn when the client
   * goes, so a feature cannot keep asking a process that is gone.
   */
  readonly clientObserver?: ManagedAcpClientObserver;
  readonly requestResolver: ManagedAcpExecutionRequestResolver;
  readonly dynamicApplier: ManagedAcpExecutionDynamicApplier;
  readonly interactionBridge: ManagedAcpInteractionBridge;
  readonly resultSink: ManagedAcpExecutionResultSink;
  readonly reconciler: ExecutionRecoveryPort;
  readonly auxiliaryQueries: ManagedAcpAuxiliaryPort;
  readonly scheduler: ManagedAcpExecutionScheduler;
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
  readonly run: ManagedAcpExecutionRun;
  readonly prepared: ManagedAcpPreparedInteraction;
  readonly complete: (response: AcpRequestPermissionResponse) => void;
  selectedResponseId?: string;
  settlementTask?: Promise<void>;
  settled: boolean;
}

export class ManagedAcpExecutionBackend
implements ExecutionBackend, InteractionPort, ExecutionRecoveryPort {
  readonly descriptor: ExecutionBackendDescriptor;
  private readonly sessions = new Map<string, ManagedAcpExecutionSession>();
  private readonly interactions = new Map<InteractionId, PendingInteraction>();
  private readonly settledInteractions = new Map<InteractionId, string>();
  private readonly auxiliaryControllers = new Set<AbortController>();
  private readonly auxiliaryTasks = new Set<Promise<string>>();
  private disposeTask?: Promise<void>;
  private disposing = false;

  constructor(protected readonly context: ManagedAcpExecutionBackendContext) {
    this.descriptor = context.descriptor;
  }

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposing) {
      throw new Error('Managed ACP backend is disposing.');
    }
    const key = String(config.executionSessionId);
    if (this.sessions.has(key)) {
      throw new Error('Managed ACP execution session already exists.');
    }
    let session: ManagedAcpExecutionSession;
    session = new ManagedAcpExecutionSession(
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
    run: ManagedAcpExecutionRun | undefined,
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
    prepared: ManagedAcpPreparedInteraction,
  ): Promise<void> {
    await withTimeout(
      prepared.cancel(),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
  }

  private cancelRunInteractions(run: ManagedAcpExecutionRun): void {
    for (const pending of this.interactions.values()) {
      if (pending.run !== run || pending.settled) continue;
      void this.cancel(pending.interactionId).catch(() => this.failCloseInteraction(pending));
    }
  }
}

class ManagedAcpExecutionSession implements ExecutionSession {
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
  private activeRun?: ManagedAcpExecutionRun;

  constructor(
    private readonly config: ExecutionSessionConfig,
    private readonly context: ManagedAcpExecutionBackendContext,
    private readonly permissionHandler: (
      request: AcpRequestPermissionRequest,
    ) => Promise<AcpRequestPermissionResponse>,
    private readonly cancelInteractions: (run: ManagedAcpExecutionRun) => void,
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

  get activeExecutionRun(): ManagedAcpExecutionRun | undefined {
    return this.activeRun;
  }

  createRun(request: ExecutionRequest): ExecutionRun {
    const run = new ManagedAcpExecutionRun(
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

  isAttached(run: ManagedAcpExecutionRun): boolean {
    return this.activeRun === run && Boolean(this.client && this.nativeSessionRef);
  }

  async prepare(run: ManagedAcpExecutionRun, invocation: ManagedAcpExecutionInvocation): Promise<void> {
    await this.ensureClient(invocation);
    if (run.isTerminal) return;
    const generation = this.clientGeneration;
    const opened = await this.ensureSessionBinding(invocation, generation);
    if (run.isTerminal || generation !== this.clientGeneration) return;
    if (opened) run.presentSessionConfig(opened);
    if (!this.client || !this.nativeSessionRef) {
      throw new ExecutionDispatchError('Managed ACP session is not ready.', true);
    }
    const applied = await completesWithin(
      this.context.dynamicApplier.apply({
        client: this.client,
        sessionId: this.nativeSessionRef,
        dynamicRef: invocation.dynamicRef,
        signal: this.clientAbort?.signal ?? new AbortController().signal,
        ...(opened?.configOptions ? { sessionConfigOptions: opened.configOptions } : {}),
        ...(opened?.modes ? { sessionModes: opened.modes } : {}),
      }),
      this.context.scheduler,
      this.context.controlTimeoutMs ?? 2_000,
    );
    if (run.isTerminal || generation !== this.clientGeneration) return;
    if (!applied) {
      throw new ExecutionDispatchError('Managed ACP dynamic configuration timed out.', true);
    }
  }

  dispatch(run: ManagedAcpExecutionRun, invocation: ManagedAcpExecutionInvocation): void {
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

  requestCancel(run: ManagedAcpExecutionRun): void {
    if (this.activeRun !== run || !this.client || !this.nativeSessionRef) return;
    this.client.cancel(this.nativeSessionRef);
  }

  cancelPreparation(run: ManagedAcpExecutionRun): void {
    if (this.activeRun !== run) return;
    this.clientGeneration += 1;
    this.clientAbort?.abort(new Error('Managed ACP run cancelled before dispatch.'));
    void this.closeClient().catch(() => undefined);
  }

  async reconcileRun(run: ManagedAcpExecutionRun): Promise<RunRecoveryEvidence> {
    const evidence = await withTimeout(
      this.context.reconciler.reconcile(run.recoveryQuery()),
      this.context.scheduler,
      this.context.recoveryTimeoutMs,
    );
    return evidence ?? { kind: 'unknown', effectsPossible: true };
  }

  private async recover(
    run: ManagedAcpExecutionRun,
    invocation: ManagedAcpExecutionInvocation,
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
        const reopened = await this.ensureSessionBinding(invocation, this.clientGeneration);
        // The reconnected session answers with its own configuration, and the
        // tab that is still open would otherwise keep the dead one's.
        if (reopened) run.presentSessionConfig(reopened);
        await this.context.dynamicApplier.apply({
          client: this.client!,
          sessionId: this.nativeSessionRef!,
          dynamicRef: invocation.dynamicRef,
          signal: this.clientAbort!.signal,
          ...(reopened?.configOptions ? { sessionConfigOptions: reopened.configOptions } : {}),
          ...(reopened?.modes ? { sessionModes: reopened.modes } : {}),
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
    run.finishFromRecovery(evidence);
  }

  private async ensureClient(
    invocation: ManagedAcpExecutionInvocation,
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
      if (generation !== this.clientGeneration) return;
      const active = this.activeRun;
      if (active && !active.isTerminal) {
        void this.recover(active, active.invocation, error, active.currentAttempt);
        return;
      }
      // Nothing is running, so there is no run to recover — but the client is
      // dead, and the next turn would dispatch into a closed transport, fail
      // `invalidated`, and leave the same dead client in place for the turn
      // after that. The conversation stays wedged until a reload. Closing here
      // is what makes the next turn launch a process instead. The legacy path
      // had this; the migration dropped it.
      void this.closeClient().catch(() => undefined);
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
    this.context.clientObserver?.onClientReady(client);
  }

  /**
   * Binds the session, and answers with what it reported when it opened.
   *
   * Returned rather than swallowed: the models, the modes and the config
   * options a tab's selectors are built from are in this reply and in no
   * notification afterwards. Nothing is returned when the session the client
   * already holds is reused, because nothing new was said about it.
   */
  private async ensureSessionBinding(
    invocation: ManagedAcpExecutionInvocation,
    generation: number,
  ): Promise<AcpNewSessionResponse | undefined> {
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
        // A load confirms the session by succeeding. OpenCode answers with its
        // config options and no id at all, so requiring an echo turned every
        // resume into "the agent returned another session" — a new session per
        // reload, with the conversation left behind. An id that *is* echoed
        // still has to be the one that was asked for.
        if (response.sessionId && response.sessionId !== target) {
          throw new ExecutionDispatchError('Managed ACP load returned another session.', true);
        }
        this.requireCurrentClient(client, generation);
        this.loadedSessionRef = target;
        return { ...response, sessionId: target };
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
      return response;
    }
    return undefined;
  }

  private handleNotification(notification: AcpSessionNotification): void {
    if (notification.sessionId !== this.nativeSessionRef) return;
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
    if (this.client) this.context.clientObserver?.onClientLost();
    this.notificationUnsubscribe?.();
    this.notificationUnsubscribe = undefined;
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

class ManagedAcpExecutionRun implements ExecutionRun {
  readonly events = new ExecutionEventQueue<ProviderExecutionEvent>();
  readonly runId;
  invocation!: ManagedAcpExecutionInvocation;
  private terminal = false;
  private dispatched = false;
  private output = '';
  private observedProviderActivity = false;
  private timeoutHandle?: unknown;
  private attempt = 0;
  private recoveringAttempt?: number;
  private terminationTask?: Promise<void>;
  private completionTask?: Promise<void>;
  private terminationIntent?: 'cancel' | 'shutdown' | 'timeout' | 'output-limit';
  private nativeRunRef?: string;
  private sessionRef?: string;

  constructor(
    private readonly request: ExecutionRequest,
    private readonly session: ManagedAcpExecutionSession,
    private readonly context: ManagedAcpExecutionBackendContext,
    private readonly cancelInteractions: (run: ManagedAcpExecutionRun) => void,
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

  /**
   * What the session answered with when it was created or loaded.
   *
   * Carried on the content channel like every other thing the surface is drawn
   * from, and before the run has started, because that is when the session is
   * opened — a transient event writes no record and advances no state machine,
   * so it needs no run to have begun.
   */
  /** One payload the provider produced itself, on the same content channel. */
  presentProviderContent(payload: unknown): void {
    if (this.terminal) return;
    this.emit({ kind: 'provider-content', payload });
  }

  presentSessionConfig(session: AcpNewSessionResponse): void {
    if (this.terminal) return;
    this.emit({
      kind: 'provider-content',
      payload: { kind: 'session-config', session } satisfies AcpContentPayload,
    });
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
    const text = update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
      ? update.content.text
      : undefined;
    if (text !== undefined) {
      const next = `${this.output}${text}`;
      if (Buffer.byteLength(next, 'utf8') > this.context.maxResultBytes) {
        void this.terminate('output-limit');
        return;
      }
      this.output = next;
    }
    // The surface's copy of the update, forwarded once and before any branch
    // below reads it: a tool card, a plan and a context badge are drawn from
    // the update itself, and the kernel carries it without interpreting it.
    // After the bound above, because the content channel is a reader like any
    // other and must see only a prefix of what will be committed.
    this.emit({
      kind: 'provider-content',
      payload: { kind: 'session-update', notification } satisfies AcpContentPayload,
    });
    if (text !== undefined) {
      this.emit({ kind: 'output-delta', channel: 'assistant', text });
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
    // The tokens this prompt cost are in the answer and nowhere else: the
    // window update arrives while the turn is still running and knows only how
    // full the context is. Forwarded whatever the stop reason, because a turn
    // that was cancelled still spent them.
    this.emit({
      kind: 'provider-content',
      payload: { kind: 'prompt-result', response } satisfies AcpContentPayload,
    });
    await this.noteTurnEnded();
    if (this.terminal || attempt !== this.attempt) return;
    const responseRunRef = response.userMessageId?.trim();
    if (responseRunRef && this.nativeRunRef && responseRunRef !== this.nativeRunRef) {
      this.finish('indeterminate', 'effects-unknown');
      return;
    }
    if (responseRunRef) this.nativeRunRef = responseRunRef;
    if (this.terminationIntent) return;
    if (/cancel/i.test(response.stopReason)) {
      this.finish('interrupted', 'known-process-exit');
      return;
    }
    const output = this.output.trim() || await this.recoverOutput();
    if (this.terminal || attempt !== this.attempt) return;
    if (!output) {
      this.finishForMissingResult();
      return;
    }
    this.completionTask = this.commitCompletion(output, attempt);
    await this.completionTask;
  }

  /**
   * The provider's last look at a turn, whatever became of it.
   *
   * Failures are swallowed: a badge that could not be filled is a badge, and
   * the turn's own outcome is not this call's to change.
   */
  private async noteTurnEnded(): Promise<void> {
    const sink = this.context.resultSink;
    if (!sink.noteTurnEnded || !this.sessionRef) return;
    try {
      await sink.noteTurnEnded({
        nativeSessionRef: this.sessionRef,
        ...(this.nativeRunRef ? { nativeRunRef: this.nativeRunRef } : {}),
        presentContent: payload => this.presentProviderContent(payload),
      });
    } catch {
      // See above.
    }
  }

  /** What the provider can still find, for a turn that streamed nothing. */
  private async recoverOutput(): Promise<string> {
    const sink = this.context.resultSink;
    if (!sink.recoverOutput || !this.sessionRef) return '';
    try {
      const recovered = (await sink.recoverOutput({
        nativeSessionRef: this.sessionRef,
        ...(this.nativeRunRef ? { nativeRunRef: this.nativeRunRef } : {}),
      }))?.trim() ?? '';
      if (recovered) {
        // The surface draws an answer from the deltas, never from the result
        // reference — so a recovered answer that is only committed is a turn
        // that succeeds with an empty bubble.
        this.emit({ kind: 'output-delta', channel: 'assistant', text: recovered });
      }
      return recovered;
    } catch {
      // A recovery that failed is a turn with no answer, which is what it
      // already was.
      return '';
    }
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
      backendId: this.context.descriptor.backendId,
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

  openInteraction(interactionId: InteractionId, prepared: ManagedAcpPreparedInteraction): void {
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
      backendId: this.context.descriptor.backendId,
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

function validateInvocation(invocation: ManagedAcpExecutionInvocation): void {
  if (!invocation.startupRef.trim() || !invocation.restartFingerprint.trim()) {
    throw new ExecutionDispatchError('Managed ACP invocation identity is invalid.', true);
  }
  if (!invocation.cwd.trim() || invocation.prompt.length === 0) {
    throw new ExecutionDispatchError('Managed ACP invocation payload is invalid.', true);
  }
}

function validatePreparedInteraction(prepared: ManagedAcpPreparedInteraction): void {
  if (!prepared.presentationRef.trim()
    || prepared.responseIds.length === 0
    || !prepared.responseIds.includes(prepared.providerResolvedResponseId)) {
    throw new Error('Managed ACP interaction contract is invalid.');
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  scheduler: ManagedAcpExecutionScheduler,
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
  scheduler: ManagedAcpExecutionScheduler,
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
