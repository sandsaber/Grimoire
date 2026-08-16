import { randomUUID } from 'node:crypto';

import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import {
  type BackendLifecycleRegistration,
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';
import type { DurableStorage } from '@/core/persistence/DurableStorage';

export interface ExecutionKernelHostOptions {
  readonly storage: DurableStorage;
  readonly now?: () => number;
  readonly scheduler?: ExecutionLifecycleScheduler;
  /** Reports a shutdown that could not finish; never thrown at the caller. */
  reportShutdownFailure?(error: unknown): void;
}

/**
 * The application's owner of the execution kernel.
 *
 * One explicit object per plugin load, not a module singleton: a singleton
 * outlives the instance a reload replaces, and two registries over one control
 * store would each believe they own every run in it.
 *
 * Load and unload are not ordered by the host's caller — Obsidian's `onload` is
 * async and `onunload` neither waits for it nor is withheld until it finishes.
 * So the two paths are serialized here: an unload that arrives first prevents
 * the gate from opening, and one that arrives mid-load closes the gate the load
 * goes on to open. Whichever order they run in, the gate is shut afterwards.
 */
export class ExecutionKernelHost {
  readonly registry: ExecutionLifecycleRegistry;
  private starting: Promise<void> | undefined;
  private shuttingDown: Promise<void> | undefined;
  private gateOpen = false;
  private unloading = false;

  constructor(private readonly options: ExecutionKernelHostOptions) {
    const now = options.now ?? Date.now;
    const repositories = new ExecutionControlRepositories(options.storage, now);
    this.registry = new ExecutionLifecycleRegistry({
      repositories,
      controlTransactions: new ExecutionControlTransactionCoordinator(
        options.storage,
        repositories,
        { now },
      ),
      nextTransactionId: () => `tx-${randomUUID().replaceAll('-', '')}`,
      now,
      scheduler: options.scheduler ?? {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    });
  }

  registerBackend(registration: BackendLifecycleRegistration): void {
    this.registry.registerBackend(registration);
  }

  /**
   * Starts the kernel, which is also when startup recovery runs.
   *
   * Idempotent because plugin load paths are not: a second call must not
   * re-run recovery over records the first call already reconciled. Callers
   * share the in-flight promise rather than a flag, so a second caller waits
   * for recovery instead of proceeding as though it had finished.
   */
  async start(): Promise<void> {
    this.starting ??= this.openGate();
    return this.starting;
  }

  private async openGate(): Promise<void> {
    if (this.unloading) {
      // Unload won the race. Opening the gate now would open one that the
      // shutdown which already ran can no longer close, and the kernel would
      // sit accepting work for a plugin instance that is gone.
      return;
    }
    await this.registry.start();
    // A store that requires migration leaves the registry read-only: it never
    // accepted work, so there is no gate for shutdown to close.
    this.gateOpen = this.registry.getMigrationRequirement() === null;
  }

  /**
   * Whether the control store holds a record this build cannot read.
   *
   * Persistence decision D5: such a store opens read-only and the host reports
   * it rather than guessing. This is the path a user takes when a shipped flip
   * is reverted, so it must be answerable without starting work.
   */
  migrationRequirement(): ReturnType<ExecutionLifecycleRegistry['getMigrationRequirement']> {
    return this.registry.getMigrationRequirement();
  }

  /**
   * Closes the kernel down, as far as a synchronous unload allows.
   *
   * Obsidian's `onunload` does not await, so the guarantee is split: the
   * acceptance gate closes **synchronously**, so nothing new is admitted the
   * moment unload begins, and the bounded cancellation and cleanup run after,
   * recording a shutdown checkpoint the next startup recovers from. Waiting for
   * providers inside `onunload` would freeze the application on a CLI that
   * never answers.
   *
   * The default checkpoint id carries the `sd-` prefix the registry requires;
   * a malformed one throws, and because failures here are reported rather than
   * raised, the shutdown would simply never happen.
   */
  dispose(checkpointId = `sd-${randomUUID().replaceAll('-', '')}`): Promise<void> {
    this.unloading = true;
    this.shuttingDown ??= this.closeGate(checkpointId);
    return this.shuttingDown;
  }

  private closeGate(checkpointId: string): Promise<void> {
    if (this.gateOpen) {
      // Called here rather than after an await, because that is what makes the
      // synchronous half true: `shutdown` leaves `accepting` before its own
      // first await, so nothing is admitted once unload has begun.
      return this.registry.shutdown(checkpointId).catch(error => {
        this.options.reportShutdownFailure?.(error);
      });
    }
    return this.closeAfterStart(checkpointId);
  }

  private async closeAfterStart(checkpointId: string): Promise<void> {
    try {
      // A start still in flight has to settle first: it may open the gate after
      // this call, and a shutdown that already ran cannot close that gate.
      // Nothing is admitted meanwhile — the registry refuses work until start
      // finishes — so waiting costs no guarantee.
      await this.starting?.catch(() => undefined);
      if (!this.gateOpen) {
        return;
      }
      await this.registry.shutdown(checkpointId);
    } catch (error) {
      this.options.reportShutdownFailure?.(error);
    }
  }
}
