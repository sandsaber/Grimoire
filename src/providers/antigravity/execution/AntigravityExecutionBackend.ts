import {
  type ExecutionBackendDescriptor,
  executionBackendId,
} from '@/core/execution/ExecutionBackendDescriptor';
import {
  type CancellationReason,
  type ExecutionBackend,
  ExecutionDispatchError,
  type ExecutionRequest,
  type ExecutionRun,
  type ExecutionSession,
  type ExecutionSessionConfig,
  type ExecutionSessionSnapshot,
  type ResultRef,
  type RunTerminalKind,
  type RunTerminalReason,
  type Unsubscribe,
} from '@/core/execution/ExecutionContracts';
import { ExecutionEventQueue } from '@/core/execution/ExecutionEventQueue';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import type { SessionInstanceId } from '@/core/execution/ExecutionIds';
import {
  type ResultCommitOutcome,
  type ResultCommitSettlement,
  settleResultCommit,
} from '@/core/execution/ResultCommit';

export interface AntigravityInvocation {
  readonly command: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly model: string | null;
  readonly permissionMode: string;
  readonly prompt: string;
}

export interface AntigravityRequestResolver {
  resolve(requestRef: string): Promise<AntigravityInvocation>;
}

export interface AntigravityProcessOutcome {
  readonly exitCode: number | null;
  readonly signal?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly transcriptOutput?: string;
  readonly outputLimitExceeded?: boolean;
}

export interface AntigravityProcessHandle {
  /** Resolves only after the process tree is owned and the print process has started. */
  readonly started: Promise<void>;
  /** Output is bounded by the provider runner and contains no hidden reasoning. */
  readonly completed: Promise<AntigravityProcessOutcome>;
  /** Resolves once when either stdout or stderr exceeds its byte ceiling. */
  readonly outputLimitExceeded: Promise<void>;
  confirmTerminated(): Promise<boolean>;
  terminate(mode: 'graceful' | 'forced'): Promise<'confirmed' | 'unconfirmed'>;
}

export interface AntigravityProcessRunner {
  /** Returns durable process-tree ownership synchronously. */
  start(invocation: AntigravityInvocation): AntigravityProcessHandle;
}

export interface AntigravityResultSink {
  storeResult(input: {
    readonly runId: string;
    readonly output: string;
    readonly source: 'stdout' | 'transcript';
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome>;
}

export type AntigravityResultCommitOutcome = ResultCommitOutcome;

export interface AntigravityScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AntigravityExecutionBackendContext {
  readonly requestResolver: AntigravityRequestResolver;
  readonly processRunner: AntigravityProcessRunner;
  readonly resultSink: AntigravityResultSink;
  readonly scheduler: AntigravityScheduler;
  readonly sessionInstanceIdFactory: () => SessionInstanceId;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly gracefulTerminationMs?: number;
  readonly forcedTerminationMs?: number;
  readonly resultCommitTimeoutMs?: number;
}

export const ANTIGRAVITY_EXECUTION_DESCRIPTOR: ExecutionBackendDescriptor = Object.freeze({
  backendId: executionBackendId('provider-antigravity'),
  association: Object.freeze({ kind: 'provider', providerId: 'antigravity' }),
});

export class AntigravityExecutionBackend implements ExecutionBackend {
  readonly descriptor = ANTIGRAVITY_EXECUTION_DESCRIPTOR;
  private readonly sessions = new Set<AntigravityExecutionSession>();
  private disposing = false;

  constructor(private readonly context: AntigravityExecutionBackendContext) {
    requirePositive(context.timeoutMs ?? 5 * 60_000, 'Antigravity timeout');
    requirePositive(
      context.gracefulTerminationMs ?? 2_000,
      'Antigravity graceful termination timeout',
    );
    requirePositive(
      context.forcedTerminationMs ?? 2_000,
      'Antigravity forced termination timeout',
    );
    requirePositive(
      context.resultCommitTimeoutMs ?? 2_000,
      'Antigravity result commit timeout',
    );
  }

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposing) {
      throw new Error('Antigravity execution backend is disposing.');
    }
    const session = new AntigravityExecutionSession(
      config,
      this.context,
      () => this.sessions.delete(session),
    );
    this.sessions.add(session);
    return session;
  }

  async dispose(): Promise<void> {
    if (this.disposing) {
      return;
    }
    this.disposing = true;
    await Promise.all([...this.sessions].map(session => session.dispose()));
  }
}

class AntigravityExecutionSession implements ExecutionSession {
  readonly sessionInstanceId: SessionInstanceId;
  private readonly listeners = new Set<(event: ProviderExecutionEvent) => void>();
  private activeRun: AntigravityExecutionRun | undefined;
  private disposed = false;

  constructor(
    private readonly config: ExecutionSessionConfig,
    private readonly context: AntigravityExecutionBackendContext,
    private readonly onDispose: () => void,
  ) {
    this.sessionInstanceId = context.sessionInstanceIdFactory();
  }

  get executionSessionId() {
    return this.config.executionSessionId;
  }

  createRun(request: ExecutionRequest): ExecutionRun {
    if (this.disposed) {
      throw new ExecutionDispatchError('Antigravity execution session is disposed.', true);
    }
    if (this.activeRun) {
      throw new ExecutionDispatchError(
        'Antigravity supports one active print process per session.',
        true,
      );
    }
    const run = new AntigravityExecutionRun(
      request,
      this.config,
      this.sessionInstanceId,
      this.context,
      event => {
        for (const listener of this.listeners) {
          listener(event);
        }
      },
      () => {
        if (this.activeRun === run) {
          this.activeRun = undefined;
        }
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
    };
  }

  subscribe(listener: (event: ProviderExecutionEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

type TerminationTrigger = 'cancel' | 'timeout' | 'output-limit' | 'failure' | 'exit-cleanup';

class AntigravityExecutionRun implements ExecutionRun {
  readonly events: AsyncIterable<ProviderExecutionEvent>;
  private readonly queue = new ExecutionEventQueue<ProviderExecutionEvent>();
  private process: AntigravityProcessHandle | undefined;
  private terminal = false;
  private cancellation: CancellationReason | undefined;
  private timeoutHandle: unknown;
  private terminationPromise: Promise<void> | undefined;
  private outcome: AntigravityProcessOutcome | undefined;
  private resultCommit: Promise<ResultCommitSettlement> | undefined;
  private resultCommitAbort: AbortController | undefined;
  private committedResult: ResultRef | undefined;
  private resultPublished = false;

  constructor(
    private readonly request: ExecutionRequest,
    private readonly config: ExecutionSessionConfig,
    private readonly sessionInstanceId: SessionInstanceId,
    private readonly context: AntigravityExecutionBackendContext,
    private readonly publish: (event: ProviderExecutionEvent) => void,
    private readonly onTerminal: () => void,
  ) {
    this.events = this.queue;
  }

  get runId() {
    return this.request.runId;
  }

  start(): void {
    void this.execute();
  }

  async cancel(reason: CancellationReason = { code: 'user' }): Promise<void> {
    if (this.terminal) {
      return;
    }
    this.cancellation ??= reason;
    if (!this.process) {
      this.finish('cancelled', 'cancellation-confirmed', true);
      return;
    }
    await this.requestTermination('cancel');
  }

  private async execute(): Promise<void> {
    let invocation: AntigravityInvocation;
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
    if (invocation.permissionMode !== 'full_access') {
      this.finish('invalidated', 'pre-dispatch-rejected', true);
      return;
    }
    try {
      requireInvocation(invocation);
    } catch {
      this.finish('invalidated', 'pre-dispatch-rejected', true);
      return;
    }
    try {
      const process = this.context.processRunner.start(invocation);
      this.process = process;
      void process.outputLimitExceeded.then(() => this.requestTermination('output-limit'));
      this.timeoutHandle = this.context.scheduler.setTimeout(() => {
        void this.requestTermination('timeout');
      }, this.context.timeoutMs ?? 5 * 60_000);
      await process.started;
      if (this.cancellation) {
        await this.requestTermination('cancel');
        return;
      }
      this.emit({ kind: 'run-started' });
      const outcome = await process.completed;
      this.outcome = outcome;
      await this.terminationPromise;
      if (this.terminal) {
        return;
      }
      if (outcome.outputLimitExceeded) {
        await this.requestTermination('output-limit');
        return;
      }
      let targetGone = false;
      try {
        targetGone = await process.confirmTerminated();
      } catch {
        targetGone = false;
      }
      if (!targetGone) {
        await this.requestTermination('exit-cleanup');
        return;
      }
      await this.finishFromOutcome(outcome);
    } catch {
      if (this.terminal) {
        return;
      }
      if (!this.process) {
        this.finish('failed', 'spawn-failed');
      } else {
        await this.requestTermination('failure');
      }
    }
  }

  private requestTermination(trigger: TerminationTrigger): Promise<void> {
    if (this.terminationPromise) {
      return this.terminationPromise;
    }
    this.clearTimeout();
    this.resultCommitAbort?.abort();
    const process = this.process;
    if (!process) {
      return Promise.resolve();
    }
    this.terminationPromise = this.terminate(process, trigger);
    return this.terminationPromise;
  }

  private async terminate(
    process: AntigravityProcessHandle,
    trigger: TerminationTrigger,
  ): Promise<void> {
    let graceful: 'confirmed' | 'unconfirmed';
    try {
      graceful = await process.terminate('graceful');
    } catch {
      graceful = 'unconfirmed';
    }
    if (graceful === 'confirmed') {
      await this.finishTermination(trigger, true);
      return;
    }
    await delay(this.context.scheduler, this.context.gracefulTerminationMs ?? 2_000);
    let forced: 'confirmed' | 'unconfirmed';
    try {
      forced = await process.terminate('forced');
    } catch {
      forced = 'unconfirmed';
    }
    if (forced === 'confirmed') {
      await this.finishTermination(trigger, true);
      return;
    }
    await delay(this.context.scheduler, this.context.forcedTerminationMs ?? 2_000);
    let confirmed = false;
    try {
      confirmed = await process.confirmTerminated();
    } catch {
      confirmed = false;
    }
    await this.finishTermination(trigger, confirmed);
  }

  private async finishTermination(trigger: TerminationTrigger, confirmed: boolean): Promise<void> {
    const resultCommit = await this.resultCommit;
    if (this.terminal) {
      return;
    }
    if (resultCommit?.kind === 'committed') {
      this.committedResult = resultCommit.result;
      this.publishCommittedResult(resultCommit.result);
      return;
    }
    if (resultCommit?.kind === 'unknown') {
      this.finish('indeterminate', 'effects-unknown');
      return;
    }
    if (!confirmed) {
      this.finish(
        'indeterminate',
        trigger === 'cancel' ? 'cancellation-unknown' : 'effects-unknown',
      );
      return;
    }
    if (trigger === 'cancel') {
      this.emit({ kind: 'cancellation-acknowledged' });
      this.finish('cancelled', 'cancellation-confirmed');
    } else if (trigger === 'timeout') {
      this.finish('failed', 'timeout');
    } else if (trigger === 'output-limit') {
      this.finish('failed', 'output-limit');
    } else if (trigger === 'exit-cleanup' && this.outcome) {
      await this.finishFromOutcome(this.outcome);
    } else {
      this.finish('failed', 'provider-failure');
    }
  }

  private async finishFromOutcome(outcome: AntigravityProcessOutcome): Promise<void> {
    if (outcome.exitCode === null) {
      this.finish('interrupted', 'known-process-exit');
      return;
    }
    if (outcome.exitCode !== 0) {
      this.finish('failed', 'nonzero-exit');
      return;
    }
    const stdout = outcome.stdout.trim();
    const transcript = outcome.transcriptOutput?.trim() ?? '';
    const output = stdout || transcript;
    if (!output) {
      this.finish(
        this.request.resultExpectation === 'required' ? 'failed' : 'succeeded',
        this.request.resultExpectation === 'required' ? 'missing-required-result' : 'completed',
      );
      return;
    }
    const abort = new AbortController();
    this.resultCommitAbort = abort;
    const commit = Promise.resolve().then(() => {
      if (abort.signal.aborted) {
        return { kind: 'aborted' } as const;
      }
      return this.context.resultSink.storeResult({
        runId: this.request.runId,
        output,
        source: stdout ? 'stdout' : 'transcript',
        signal: abort.signal,
      });
    });
    this.resultCommit = settleResultCommit(
      commit,
      abort,
      this.context.scheduler,
      this.context.resultCommitTimeoutMs ?? 2_000,
    );
    const settlement = await this.resultCommit;
    if (settlement.kind === 'unknown') {
      this.finish('indeterminate', 'effects-unknown');
      return;
    }
    if (settlement.kind === 'aborted') {
      if (!this.cancellation && !this.terminationPromise) {
        this.finish('failed', 'provider-failure');
      }
      return;
    }
    const result = settlement.result;
    this.committedResult = result;
    if (this.terminal || !this.committedResult) {
      return;
    }
    this.publishCommittedResult(result);
  }

  private publishCommittedResult(result: ResultRef): void {
    if (this.terminal || this.resultPublished) {
      return;
    }
    this.resultPublished = true;
    this.emit({ kind: 'result', result });
    this.finish('succeeded', 'completed');
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
    this.resultCommitAbort?.abort();
    this.clearTimeout();
    this.emit({
      kind: 'terminal',
      terminal,
      reason,
      ...(sideEffectFree ? { sideEffectFree: true } : {}),
    });
    this.queue.close();
    this.onTerminal();
  }

  private emit(event: ProviderExecutionEvent['event']): void {
    const delivery: ProviderExecutionEvent = {
      backendId: ANTIGRAVITY_EXECUTION_DESCRIPTOR.backendId,
      backendGeneration: this.config.backendGeneration,
      executionSessionId: this.config.executionSessionId,
      sessionInstanceId: this.sessionInstanceId,
      deliveryId: `${this.request.runId}:${this.queue.count + 1}`,
      occurredAt: (this.context.now ?? Date.now)(),
      scope: { kind: 'run', runId: this.request.runId },
      event,
    };
    this.queue.push(delivery);
    this.publish(delivery);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== undefined) {
      this.context.scheduler.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
  }
}

function requireInvocation(invocation: AntigravityInvocation): void {
  if (!invocation.command.trim()) {
    throw new Error('Antigravity command must not be empty.');
  }
  if (!invocation.cwd.trim()) {
    throw new Error('Antigravity working directory must not be empty.');
  }
  if (!invocation.prompt.trim()) {
    throw new Error('Antigravity prompt must not be empty.');
  }
}

function requirePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function delay(scheduler: AntigravityScheduler, delayMs: number): Promise<void> {
  return new Promise(resolve => scheduler.setTimeout(resolve, delayMs));
}
