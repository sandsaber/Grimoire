import type { Readable, Writable } from 'node:stream';
import { setTimeout as setNodeTimeout } from 'node:timers';

import {
  localShellPlatformForNode,
  NodeLocalShellProcessAdapter,
  type SpawnedLocalProcess,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type {
  LocalShellLaunchSpec,
  LocalShellProcessSupervisor,
} from '@/core/execution/local/LocalShellBackend';
import type {
  AcpManagedOwnedProcess,
  AcpManagedProcessLauncher,
} from '@/providers/acp/execution/AcpManagedClientAdapter';

export interface ManagedAcpLaunchInvocation {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}

export interface ManagedAcpLaunchResolver {
  resolve(startupRef: string): Promise<ManagedAcpLaunchInvocation>;
}

export interface ManagedAcpProcessAdapter extends LocalShellProcessSupervisor {
  launch(spec: LocalShellLaunchSpec): SpawnedLocalProcess;
}

export interface ManagedAcpProcessDelay {
  wait(delayMs: number): Promise<void>;
}

/** Cross-platform ACP daemon ownership using POSIX groups or Windows Job Objects. */
export class NodeManagedAcpProcessLauncher implements AcpManagedProcessLauncher {
  private readonly ownedProcesses = new Set<OwnedManagedAcpProcess>();
  private disposing = false;

  constructor(
    private readonly resolver: ManagedAcpLaunchResolver,
    private readonly processAdapter: ManagedAcpProcessAdapter = new NodeLocalShellProcessAdapter(),
    private readonly delay: ManagedAcpProcessDelay = {
      wait: delayMs => new Promise(resolve => setNodeTimeout(resolve, delayMs)),
    },
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly gracefulTimeoutMs = 2_000,
    private readonly forcedTimeoutMs = 2_000,
  ) {}

  async launch(startupRef: string, signal: AbortSignal): Promise<AcpManagedOwnedProcess> {
    if (this.disposing) throw new Error('Managed ACP process launcher is disposing.');
    const invocation = await raceAbort(this.resolver.resolve(startupRef), signal);
    if (this.disposing) throw new Error('Managed ACP process launcher is disposing.');
    const child = this.processAdapter.launch({
      executable: invocation.executable,
      arguments: [...invocation.arguments],
      cwd: invocation.cwd,
      environment: { ...invocation.environment },
      stdin: 'pipe',
      terminationKind: localShellPlatformForNode(this.platform) === 'windows'
        ? 'windows-process-tree'
        : 'posix-process-group',
      ...(this.platform === 'win32' ? { windowsInvocationMode: 'argument-array' } : {}),
    });
    const owned = new OwnedManagedAcpProcess(
      child,
      this.processAdapter,
      this.delay,
      this.gracefulTimeoutMs,
      this.forcedTimeoutMs,
      process => this.ownedProcesses.delete(process),
    );
    this.ownedProcesses.add(owned);
    try {
      await raceAbort(child.started, signal);
      owned.requirePipes();
      owned.startObserving();
      return owned;
    } catch (error) {
      await owned.terminate().catch(() => 'unconfirmed');
      throw toError(error);
    }
  }

  async dispose(): Promise<'confirmed' | 'unconfirmed'> {
    this.disposing = true;
    const outcomes = await Promise.all(
      [...this.ownedProcesses].map(process => process.terminate()),
    );
    return outcomes.every(outcome => outcome === 'confirmed') ? 'confirmed' : 'unconfirmed';
  }
}

class OwnedManagedAcpProcess implements AcpManagedOwnedProcess {
  private readonly listeners = new Set<(error?: Error) => void>();
  private closeError?: Error;
  private closed = false;
  private observing = false;
  private terminateTask?: Promise<'confirmed' | 'unconfirmed'>;

  constructor(
    private readonly child: SpawnedLocalProcess,
    private readonly supervisor: LocalShellProcessSupervisor,
    private readonly delay: ManagedAcpProcessDelay,
    private readonly gracefulTimeoutMs: number,
    private readonly forcedTimeoutMs: number,
    private readonly onTerminationConfirmed: (process: OwnedManagedAcpProcess) => void,
  ) {}

  get input(): Readable {
    this.requirePipes();
    return this.child.stdoutReadable!;
  }

  get output(): Writable {
    this.requirePipes();
    return this.child.stdin!;
  }

  requirePipes(): void {
    if (!this.child.stdin || !this.child.stdoutReadable) {
      throw new Error('Managed ACP process did not expose required stdio pipes.');
    }
  }

  startObserving(): void {
    if (this.observing) return;
    this.observing = true;
    this.child.stdin?.on('error', error => this.notifyClose(toError(error)));
    this.child.stdoutReadable?.on('error', error => this.notifyClose(toError(error)));
    void this.drainStderr();
    void this.child.exited.then(
      exit => {
        this.notifyClose(exit.code === 0
          ? undefined
          : new Error(`Managed ACP process exited with code ${exit.code ?? 'unknown'}.`));
      },
      error => this.notifyClose(toError(error)),
    );
  }

  onClose(listener: (error?: Error) => void): () => void {
    if (this.closed) {
      listener(this.closeError);
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  terminate(): Promise<'confirmed' | 'unconfirmed'> {
    if (this.terminateTask) return this.terminateTask;
    const task = this.terminateOwnedTree();
    this.terminateTask = task;
    void task.then((outcome) => {
      if (outcome === 'confirmed') {
        this.onTerminationConfirmed(this);
      } else if (this.terminateTask === task) {
        this.terminateTask = undefined;
      }
    });
    return task;
  }

  private async terminateOwnedTree(): Promise<'confirmed' | 'unconfirmed'> {
    if (await this.supervisor.confirmTerminated(this.child.termination)) {
      return 'confirmed';
    }
    if (await this.supervisor.terminate(this.child.termination, 'graceful') === 'confirmed') {
      return 'confirmed';
    }
    await this.delay.wait(this.gracefulTimeoutMs);
    if (await this.supervisor.confirmTerminated(this.child.termination)) {
      return 'confirmed';
    }
    if (await this.supervisor.terminate(this.child.termination, 'forced') === 'confirmed') {
      return 'confirmed';
    }
    await this.delay.wait(this.forcedTimeoutMs);
    return await this.supervisor.confirmTerminated(this.child.termination)
      ? 'confirmed'
      : 'unconfirmed';
  }

  private async drainStderr(): Promise<void> {
    try {
      for await (const chunk of this.child.stderr) {
        void chunk;
        // Draining prevents a blocked daemon; diagnostics remain ephemeral.
      }
    } catch {
      // Process exit/termination owns the authoritative lifecycle result.
    }
  }

  private notifyClose(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    for (const listener of this.listeners) {
      try {
        listener(error);
      } catch {
        // One observer cannot prevent other owners from seeing process closure.
      }
    }
  }
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(toError(error)); },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Managed ACP launch aborted.');
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
