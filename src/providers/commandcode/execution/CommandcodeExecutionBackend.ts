import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  type ExecutionBackend, ExecutionDispatchError, type ExecutionRequest, type ExecutionRun,
  type ExecutionSession, type ExecutionSessionConfig, type RunTerminalKind, type RunTerminalReason,
} from '@/core/execution/ExecutionContracts';
import { ExecutionEventQueue } from '@/core/execution/ExecutionEventQueue';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import type { SessionInstanceId } from '@/core/execution/ExecutionIds';

import type {
  CommandcodeInvocation, CommandcodeProcessHandle, CommandcodeProcessRunner,
} from '../runtime/CommandcodeProcess';
import { CommandcodeOutputLimitError } from '../runtime/CommandcodeStream';
import { CommandcodeApprovals } from './CommandcodeApprovals';

export const COMMANDCODE_EXECUTION_DESCRIPTOR = {
  backendId: executionBackendId('provider-commandcode'),
  association: { kind: 'provider' as const, providerId: 'commandcode' },
};

export interface CommandcodeBackendContext {
  approvals?: CommandcodeApprovals;
  resolve(requestRef: string): Promise<CommandcodeInvocation>;
  runner: CommandcodeProcessRunner;
  sessionInstanceId(): SessionInstanceId;
  delay(ms: number): Promise<void>;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export class CommandcodeExecutionBackend implements ExecutionBackend {
  readonly interactions: CommandcodeApprovals;
  readonly descriptor = COMMANDCODE_EXECUTION_DESCRIPTOR;
  private readonly sessions = new Set<CommandcodeSession>();
  private disposed = false;

  constructor(private readonly context: CommandcodeBackendContext) {
    this.interactions = context.approvals ?? new CommandcodeApprovals();
    context.approvals = this.interactions;
  }

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposed) throw new Error('Command Code backend is disposed.');
    const session = new CommandcodeSession(config, this.context, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.sessions].map(session => session.dispose()));
  }
}

class CommandcodeSession implements ExecutionSession {
  readonly sessionInstanceId: SessionInstanceId;
  private nativeSessionRef: string | undefined;
  private readonly listeners = new Set<(event: ProviderExecutionEvent) => void>();
  private active: CommandcodeRun | undefined;
  private disposed = false;

  constructor(private readonly config: ExecutionSessionConfig, private readonly context: CommandcodeBackendContext,
    private readonly onDispose: () => void) {
    this.sessionInstanceId = context.sessionInstanceId();
    this.nativeSessionRef = config.nativeSessionRef;
  }

  get executionSessionId() { return this.config.executionSessionId; }

  createRun(request: ExecutionRequest): ExecutionRun {
    if (this.disposed || this.active) throw new ExecutionDispatchError('Command Code session is unavailable.', true);
    const run = new CommandcodeRun(request, this.config, this.sessionInstanceId, this.context,
      () => this.nativeSessionRef, id => { this.nativeSessionRef = id; },
      event => { for (const listener of this.listeners) listener(event); },
      () => { if (this.active === run) this.active = undefined; });
    this.active = run;
    run.start();
    return run;
  }

  getSnapshot() {
    return { executionSessionId: this.executionSessionId, sessionInstanceId: this.sessionInstanceId,
      ...(this.nativeSessionRef ? { nativeSessionRef: this.nativeSessionRef } : {}) };
  }

  subscribe(listener: (event: ProviderExecutionEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.active?.cancel();
    this.listeners.clear();
    this.onDispose();
  }
}

class CommandcodeRun implements ExecutionRun {
  readonly events = new ExecutionEventQueue<ProviderExecutionEvent>();
  private child: CommandcodeProcessHandle | undefined;
  private terminal = false;
  private cancelling = false;
  private stopping: Promise<boolean> | undefined;
  private timeout: unknown;
  private started = false;
  private readonly pending: ProviderExecutionEvent['event'][] = [];
  private streamed = false;
  private failing = false;

  constructor(private readonly request: ExecutionRequest, private readonly config: ExecutionSessionConfig,
    private readonly instance: SessionInstanceId, private readonly context: CommandcodeBackendContext,
    private readonly nativeSession: () => string | undefined, private readonly setSession: (id: string) => void,
    private readonly publish: (event: ProviderExecutionEvent) => void, private readonly onTerminal: () => void) {}

  get runId() { return this.request.runId; }
  start(): void { void this.execute(); }

  async cancel(): Promise<void> {
    if (this.terminal) return;
    this.cancelling = true;
    this.context.approvals?.cancelRun(this.runId);
    const stopped = await this.stopTree();
    this.finish(stopped ? 'cancelled' : 'indeterminate', stopped ? 'cancellation-confirmed' : 'cancellation-unknown');
  }

  private async execute(): Promise<void> {
    try {
      if (this.request.resumeCheckpoint) throw new Error('Command Code checkpoint resume is unsupported.');
      const invocation = await this.context.resolve(this.request.requestRef);
      if (this.cancelling || this.terminal || this.failing) return;
      invocation.sessionId ??= this.nativeSession();
      this.child = this.context.runner.start(invocation, event => this.content(event), id => {
        if (this.terminal || this.cancelling || this.failing) return;
        this.setSession(id);
        this.content({ type: 'session', sessionId: id });
      }, (tool, signal) => this.terminal || this.cancelling || this.failing ? Promise.resolve(false)
        : this.context.approvals!.request(this.runId, tool, signal, event => {
          if (this.started) this.emit(event); else this.pending.push(event);
        }));
      this.timeout = this.context.setTimeout(() => { void this.failAndStop('timeout'); }, 30 * 60_000);
      await this.child.started;
      if (this.cancelling || this.terminal || this.failing) return;
      this.started = true;
      this.emit({ kind: 'run-started' });
      for (const event of this.pending.splice(0)) this.emit(event);
      const outcome = await this.child.completed;
      if (this.cancelling || this.terminal || this.failing) return;
      if (!await this.stopTree()) {
        this.finish('indeterminate', 'effects-unknown');
        return;
      }
      if (this.cancelling || this.terminal || this.failing) return;
      if (outcome.code !== 0 || outcome.result?.subtype !== 'success') {
        this.finish('failed', outcome.code !== 0 ? 'nonzero-exit' : 'missing-required-result');
        return;
      }
      if (!outcome.result.finalText.trim()) {
        this.finish(this.request.resultExpectation === 'required' ? 'failed' : 'succeeded',
          this.request.resultExpectation === 'required' ? 'missing-required-result' : 'completed');
        return;
      }
      if (!this.streamed) this.emit({ kind: 'output-delta', channel: 'assistant', text: outcome.result.finalText });
      // Content is persisted by the chat projection, never duplicated under control/.
      this.emit({ kind: 'result', result: { resultId: `result-${this.runId}`, storage: 'projection' } });
      this.finish('succeeded', 'completed');
    } catch (error) {
      await this.failAndStop(error instanceof CommandcodeOutputLimitError ? 'output-limit'
        : this.child ? 'provider-failure' : 'pre-dispatch-rejected');
    }
  }

  private content(payload: Record<string, unknown>): void {
    if (this.terminal || this.cancelling || this.failing) return;
    let event: ProviderExecutionEvent['event'];
    if (payload.type === 'text_delta' && typeof payload.delta === 'string') {
      this.streamed = true;
      event = { kind: 'output-delta', channel: 'assistant', text: payload.delta };
    } else {
      event = { kind: 'provider-content', payload };
    }
    if (this.started) this.emit(event);
    else this.pending.push(event);
  }

  private async failAndStop(reason: RunTerminalReason): Promise<void> {
    if (this.terminal || this.cancelling || this.failing) return;
    this.failing = true;
    this.context.approvals?.cancelRun(this.runId);
    const stopped = await this.stopTree();
    if (this.cancelling) return;
    this.finish(stopped ? (this.child ? 'failed' : 'invalidated') : 'indeterminate',
      stopped ? reason : 'effects-unknown');
  }

  private stopTree(): Promise<boolean> {
    if (!this.child) return Promise.resolve(true);
    return this.stopping ??= (async () => {
      const child = this.child!;
      try {
        if (await child.confirmTerminated()) return true;
        for (const mode of ['graceful', 'forced'] as const) {
          if (await child.terminate(mode) === 'confirmed') return true;
          await this.context.delay(1000);
          if (await child.confirmTerminated()) return true;
        }
      } catch { return false; }
      return false;
    })();
  }

  private finish(terminal: RunTerminalKind, reason: RunTerminalReason): void {
    if (this.terminal) return;
    this.context.approvals?.cancelRun(this.runId);
    this.terminal = true;
    if (this.timeout !== undefined) this.context.clearTimeout(this.timeout);
    this.emit({ kind: 'terminal', terminal, reason, ...(!this.child ? { sideEffectFree: true } : {}) });
    this.events.close();
    this.onTerminal();
  }

  private emit(event: ProviderExecutionEvent['event']): void {
    const delivery: ProviderExecutionEvent = {
      backendId: COMMANDCODE_EXECUTION_DESCRIPTOR.backendId, backendGeneration: this.config.backendGeneration,
      executionSessionId: this.config.executionSessionId, sessionInstanceId: this.instance,
      deliveryId: `${this.runId}:${this.events.count + 1}`, occurredAt: Date.now(),
      scope: { kind: 'run', runId: this.runId }, event,
    };
    this.events.push(delivery);
    this.publish(delivery);
  }
}
