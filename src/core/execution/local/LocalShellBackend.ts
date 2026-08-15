import {
  type ExecutionBackendDescriptor,
  executionBackendId,
  internalExecutionServiceId,
} from '../ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionBackend,
  ExecutionRequest,
  ExecutionRun,
  ExecutionSession,
  ExecutionSessionConfig,
  ExecutionSessionSnapshot,
  RunTerminalKind,
  RunTerminalReason,
  Unsubscribe,
} from '../ExecutionContracts';
import type { ProviderExecutionEvent } from '../ExecutionEvents';
import type { SessionInstanceId } from '../ExecutionIds';

export type LocalShellPlatform = 'posix' | 'windows';

/** Raw shell inputs are resolved only in memory immediately before launch. */
export interface LocalShellInvocation {
  readonly command: string;
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface LocalShellRequestResolver {
  resolve(requestRef: string): Promise<LocalShellInvocation>;
}

export interface LocalShellLaunchSpec {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly terminationKind: LocalShellTerminationTarget['kind'];
  /** Application-owned protocol daemons may request a writable stdin pipe. */
  readonly stdin?: 'ignore' | 'pipe';
  /** Windows-only wrapper for executable forms that CreateProcess cannot invoke directly. */
  readonly windowsInvocationMode?: 'direct' | 'argument-array';
}

export type LocalShellTerminationTarget =
  | { readonly pid: number; readonly kind: 'posix-process-group' }
  | {
    readonly pid: number;
    readonly kind: 'windows-process-tree';
    /** Opaque application-owned handle to a durable Windows Job Object guardian. */
    readonly ownershipId: string;
  };

export interface LocalShellExit {
  readonly code: number | null;
}

export interface LocalShellChildProcess {
  readonly termination: LocalShellTerminationTarget;
  readonly started: Promise<void>;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exited: Promise<LocalShellExit>;
}

export interface LocalShellProcessLauncher {
  /** Returns process ownership synchronously; readiness is exposed by child.started. */
  launch(spec: LocalShellLaunchSpec): LocalShellChildProcess;
}

/**
 * Implementations own OS-specific process termination. POSIX targets must
 * address a process group; Windows targets must address the complete tree.
 */
export interface LocalShellProcessSupervisor {
  confirmTerminated(target: LocalShellTerminationTarget): Promise<boolean>;
  terminate(
    target: LocalShellTerminationTarget,
    mode: 'graceful' | 'forced',
  ): Promise<'confirmed' | 'unconfirmed'>;
}

export interface LocalShellOutputObserver {
  onStdout(runId: string, chunk: Uint8Array): void | Promise<void>;
  onStderr(runId: string, chunk: Uint8Array): void | Promise<void>;
  onOutputLimit(runId: string): void | Promise<void>;
}

export interface LocalShellScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LocalShellBackendOptions {
  readonly platform: LocalShellPlatform;
  readonly requestResolver: LocalShellRequestResolver;
  readonly launcher: LocalShellProcessLauncher;
  readonly supervisor: LocalShellProcessSupervisor;
  readonly sessionInstanceIdFactory: () => SessionInstanceId;
  readonly now?: () => number;
  readonly scheduler: LocalShellScheduler;
  readonly outputObserver?: LocalShellOutputObserver;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly gracefulTerminationMs?: number;
  readonly forcedTerminationMs?: number;
}

const descriptor: ExecutionBackendDescriptor = {
  backendId: executionBackendId('internal-local-shell'),
  association: {
    kind: 'internal',
    service: internalExecutionServiceId('shell'),
  },
};

export class LocalShellBackend implements ExecutionBackend {
  readonly descriptor = descriptor;
  private readonly sessions = new Set<LocalShellSession>();
  private disposing = false;

  constructor(private readonly options: LocalShellBackendOptions) {
    requirePositive(options.timeoutMs ?? 60_000, 'Timeout');
    requirePositive(options.maxOutputBytes ?? 1_048_576, 'Output limit');
    requirePositive(options.gracefulTerminationMs ?? 2_000, 'Graceful termination timeout');
    requirePositive(options.forcedTerminationMs ?? 2_000, 'Forced termination timeout');
  }

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposing) {
      throw new Error('Local shell backend is disposing.');
    }
    const session = new LocalShellSession(config, this.options, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
  }

  async dispose(): Promise<void> {
    if (this.disposing) {
      return;
    }
    this.disposing = true;
    await Promise.all([...this.sessions].map((session) => session.dispose()));
  }
}

class LocalShellSession implements ExecutionSession {
  readonly sessionInstanceId: SessionInstanceId;
  private readonly listeners = new Set<(event: ProviderExecutionEvent) => void>();
  private readonly runs = new Set<LocalShellRun>();
  private disposed = false;

  constructor(
    private readonly config: ExecutionSessionConfig,
    private readonly options: LocalShellBackendOptions,
    private readonly onDispose: () => void,
  ) {
    this.sessionInstanceId = options.sessionInstanceIdFactory();
  }

  get executionSessionId() {
    return this.config.executionSessionId;
  }

  createRun(request: ExecutionRequest): ExecutionRun {
    if (this.disposed) {
      throw new Error('Local shell session is disposed.');
    }
    const run = new LocalShellRun(request, this.config, this.sessionInstanceId, this.options, (event) => {
      for (const listener of this.listeners) {
        listener(event);
      }
    }, () => this.runs.delete(run));
    this.runs.add(run);
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
    await Promise.all([...this.runs].map((run) => run.cancel({ code: 'shutdown' })));
    this.onDispose();
  }
}

class LocalShellRun implements ExecutionRun {
  readonly events: AsyncIterable<ProviderExecutionEvent>;
  private readonly queue = new AsyncEventQueue<ProviderExecutionEvent>();
  private child: LocalShellChildProcess | undefined;
  private terminal = false;
  private cancellation: CancellationReason | undefined;
  private timeoutHandle: unknown;
  private terminationPromise: Promise<void> | undefined;
  private observedExit: LocalShellExit | undefined;
  private readonly outputBytes = { stdout: 0, stderr: 0 };

  constructor(
    private readonly request: ExecutionRequest,
    private readonly config: ExecutionSessionConfig,
    private readonly sessionInstanceId: SessionInstanceId,
    private readonly options: LocalShellBackendOptions,
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
    if (!this.child) {
      this.finish('cancelled', 'cancellation-confirmed', true);
      return;
    }
    await this.requestTermination('cancel');
  }

  private async execute(): Promise<void> {
    try {
      const invocation = await this.options.requestResolver.resolve(this.request.requestRef);
      if (this.cancellation) {
        this.finish('cancelled', 'cancellation-confirmed', true);
        return;
      }
      const child = this.options.launcher.launch(this.createLaunchSpec(invocation));
      this.child = child;
      this.timeoutHandle = this.scheduler().setTimeout(() => {
        void this.requestTermination('timeout');
      }, this.timeoutMs());
      await child.started;
      if (this.cancellation) {
        await this.requestTermination('cancel');
        return;
      }
      this.emit({ kind: 'run-started' });
      const output = Promise.all([
        this.consumeOutput(child.stdout, 'stdout'),
        this.consumeOutput(child.stderr, 'stderr'),
      ]);
      const [exited] = await Promise.all([child.exited, output]);
      this.observedExit = exited;
      await this.terminationPromise;
      if (!this.terminal) {
        let targetGone = false;
        try {
          targetGone = await this.options.supervisor.confirmTerminated(child.termination);
        } catch {
          targetGone = false;
        }
        if (!targetGone) {
          await this.requestTermination('exit-cleanup');
        } else {
          this.finishFromExit(exited);
        }
      }
    } catch {
      if (!this.terminal) {
        if (this.child) {
          await this.requestTermination('failure');
        } else {
          this.finish('failed', 'spawn-failed');
        }
      }
    }
  }

  private createLaunchSpec(invocation: LocalShellInvocation): LocalShellLaunchSpec {
    return this.options.platform === 'posix'
      ? {
        executable: '/bin/bash',
        arguments: ['-lc', invocation.command],
        cwd: invocation.cwd,
        environment: invocation.environment,
        terminationKind: 'posix-process-group',
      }
      : {
        executable: 'cmd.exe',
        arguments: ['/d', '/s', '/c', invocation.command],
        cwd: invocation.cwd,
        environment: invocation.environment,
        terminationKind: 'windows-process-tree',
      };
  }

  private async consumeOutput(stream: AsyncIterable<Uint8Array>, channel: 'stdout' | 'stderr'): Promise<void> {
    for await (const chunk of stream) {
      if (this.terminal) {
        return;
      }
      this.outputBytes[channel] += chunk.byteLength;
      if (this.outputBytes.stdout + this.outputBytes.stderr > this.maxOutputBytes()) {
        await this.options.outputObserver?.onOutputLimit(this.request.runId);
        await this.requestTermination('output-limit');
        return;
      }
      if (channel === 'stdout') {
        await this.options.outputObserver?.onStdout(this.request.runId, chunk);
      } else {
        await this.options.outputObserver?.onStderr(this.request.runId, chunk);
      }
    }
  }

  private requestTermination(
    trigger: 'cancel' | 'timeout' | 'output-limit' | 'failure' | 'exit-cleanup',
  ): Promise<void> {
    if (this.terminationPromise) {
      return this.terminationPromise;
    }
    if (this.timeoutHandle !== undefined) {
      this.scheduler().clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    const child = this.child;
    if (!child) {
      return Promise.resolve();
    }
    this.terminationPromise = this.terminate(child, trigger);
    return this.terminationPromise;
  }

  private async terminate(
    child: LocalShellChildProcess,
    trigger: 'cancel' | 'timeout' | 'output-limit' | 'failure' | 'exit-cleanup',
  ): Promise<void> {
    let graceful: 'confirmed' | 'unconfirmed';
    try {
      graceful = await this.options.supervisor.terminate(child.termination, 'graceful');
    } catch {
      graceful = 'unconfirmed';
    }
    if (graceful === 'confirmed') {
      this.finishTermination(trigger, true);
      return;
    }
    await delay(this.scheduler(), this.gracefulTerminationMs());
    let forced: 'confirmed' | 'unconfirmed';
    try {
      forced = await this.options.supervisor.terminate(child.termination, 'forced');
    } catch {
      forced = 'unconfirmed';
    }
    if (forced === 'confirmed') {
      this.finishTermination(trigger, true);
      return;
    }
    await delay(this.scheduler(), this.forcedTerminationMs());
    let confirmed = false;
    try {
      confirmed = await this.options.supervisor.confirmTerminated(child.termination);
    } catch {
      confirmed = false;
    }
    this.finishTermination(trigger, confirmed);
  }

  private finishTermination(
    trigger: 'cancel' | 'timeout' | 'output-limit' | 'failure' | 'exit-cleanup',
    confirmed: boolean,
  ): void {
    if (!confirmed) {
      this.finish('indeterminate', trigger === 'cancel' ? 'cancellation-unknown' : 'effects-unknown');
      return;
    }
    if (trigger === 'cancel') {
      this.emit({ kind: 'cancellation-acknowledged' });
      this.finish('cancelled', 'cancellation-confirmed');
    } else if (trigger === 'timeout') {
      this.finish('failed', 'timeout');
    } else if (trigger === 'output-limit') {
      this.finish('failed', 'output-limit');
    } else if (trigger === 'exit-cleanup') {
      if (this.observedExit) {
        this.finishFromExit(this.observedExit);
      } else {
        this.finish('indeterminate', 'effects-unknown');
      }
    } else {
      this.finish('failed', 'provider-failure');
    }
  }

  private finishFromExit(exited: LocalShellExit): void {
    if (exited.code === 0) {
      if (this.request.resultExpectation === 'required') {
        this.finish('failed', 'missing-required-result');
      } else {
        this.finish('succeeded', 'completed');
      }
    } else if (exited.code === null) {
      this.finish('interrupted', 'known-process-exit');
    } else {
      this.finish('failed', 'nonzero-exit');
    }
  }

  private finish(terminal: RunTerminalKind, reason: RunTerminalReason, sideEffectFree = false): void {
    if (this.terminal) {
      return;
    }
    this.terminal = true;
    if (this.timeoutHandle !== undefined) {
      this.scheduler().clearTimeout(this.timeoutHandle);
    }
    this.emit({ kind: 'terminal', terminal, reason, sideEffectFree: sideEffectFree || undefined });
    this.queue.close();
    this.onTerminal();
  }

  private emit(event: ProviderExecutionEvent['event']): void {
    const emitted: ProviderExecutionEvent = {
      backendId: descriptor.backendId,
      backendGeneration: this.config.backendGeneration,
      executionSessionId: this.config.executionSessionId,
      sessionInstanceId: this.sessionInstanceId,
      deliveryId: `${this.request.runId}:${this.queue.count + 1}`,
      occurredAt: (this.options.now ?? Date.now)(),
      scope: { kind: 'run', runId: this.request.runId },
      event,
    };
    this.queue.push(emitted);
    this.publish(emitted);
  }

  private scheduler(): LocalShellScheduler {
    return this.options.scheduler;
  }

  private timeoutMs(): number {
    return this.options.timeoutMs ?? 60_000;
  }

  private maxOutputBytes(): number {
    return this.options.maxOutputBytes ?? 1_048_576;
  }

  private gracefulTerminationMs(): number {
    return this.options.gracefulTerminationMs ?? 2_000;
  }

  private forcedTerminationMs(): number {
    return this.options.forcedTerminationMs ?? 2_000;
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;
  count = 0;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    this.count += 1;
    const reader = this.readers.shift();
    if (reader) {
      reader({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const reader of this.readers.splice(0)) {
      reader({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => this.readers.push(resolve));
      },
    };
  }
}

function delay(scheduler: LocalShellScheduler, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    scheduler.setTimeout(resolve, delayMs);
  });
}

function requirePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}
