import { randomUUID } from 'node:crypto';

import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import {
  type BackendLifecycleRegistration,
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';
import type { DurableStorage } from '@/core/persistence/DurableStorage';

/**
 * The application's owner of the execution kernel.
 *
 * One explicit object, constructed in `onload` and disposed in `onunload` — not
 * a module singleton, because a singleton outlives the plugin instance that a
 * reload replaces, and two registries over one control store would each believe
 * they own every run in it.
 *
 * This is the interim host the first provider flip owns. It grows into
 * `ApplicationRuntime` at M5 by absorbing the rest of composition; it is the
 * seed of that owner rather than a parallel structure to be thrown away.
 */
export interface ExecutionKernelHostOptions {
  readonly storage: DurableStorage;
  readonly now?: () => number;
  readonly scheduler?: ExecutionLifecycleScheduler;
  /** Reports a shutdown that could not finish; never thrown at the caller. */
  reportShutdownFailure?(error: unknown): void;
}

export class ExecutionKernelHost {
  readonly registry: ExecutionLifecycleRegistry;
  private started = false;
  private shuttingDown: Promise<void> | undefined;

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
   * re-run recovery over records the first call already reconciled.
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await this.registry.start();
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
    this.shuttingDown ??= this.registry.shutdown(checkpointId)
      .catch(error => {
        this.options.reportShutdownFailure?.(error);
      });
    return this.shuttingDown;
  }
}
