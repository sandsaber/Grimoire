import type { ProviderId } from '../types/provider';

export type ProviderWorkspaceState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'failed'
  | 'disposed';

/**
 * One provider's workspace lifecycle, both halves.
 *
 * `dispose` is required rather than optional: shipping initialization without
 * teardown is app-level inventory row 3, and the v1 attempt is what named it.
 * A provider whose workspace holds nothing says so in a one-line `dispose`,
 * which is a statement; an absent method is a gap nobody can see.
 */
export interface ProviderWorkspaceContribution<TWorkspace> {
  initialize(signal: AbortSignal): Promise<TWorkspace>;
  dispose(workspace: TWorkspace): Promise<void>;
}

export interface ProviderWorkspaceFailure {
  readonly providerId: ProviderId;
  readonly phase: 'initialize' | 'dispose';
  readonly error: unknown;
}

export interface ProviderWorkspaceManagerPorts<TWorkspace> {
  /** The contribution for a provider, or null when it has no workspace. */
  contribution(providerId: ProviderId): ProviderWorkspaceContribution<TWorkspace> | null;
  /** Publishes a ready workspace, or withdraws one with `null`. */
  publish(providerId: ProviderId, workspace: TWorkspace | null): void;
  reportFailure(failure: ProviderWorkspaceFailure): void;
}

interface WorkspaceEntry<TWorkspace> {
  state: ProviderWorkspaceState;
  controller?: AbortController;
  task?: Promise<void>;
  workspace?: TWorkspace;
}

/**
 * Owns provider workspaces for the life of one plugin instance.
 *
 * It replaces a loop that awaited each provider's initializer in turn, with no
 * `try`, no teardown, and a static services map that outlived the instance
 * that filled it. Three consequences, all of them reachable today:
 *
 * - **one provider took down every provider.** A single initializer throwing
 *   propagated out of the loop, so the providers after it in the iteration
 *   order never initialized — and which ones those were depended on object key
 *   order, not on anything anybody chose;
 * - **a failed provider stayed failed until the next plugin load**, because
 *   nothing could ask for the workspace again;
 * - **nothing was released at unload**, and the next load found the previous
 *   instance's services still published until its own initializer overwrote
 *   them.
 *
 * Initialization is concurrent and isolated, a failure is recorded and
 * retryable, and `disposeAll` is the half that did not exist.
 *
 * Not here yet, deliberately: initialization is still eager, and there is no
 * generation fence. Laziness belongs with the move of workspace consumers onto
 * the module slots, since every consumer reads its service synchronously
 * today; a fence belongs with the first settings transition that recycles a
 * workspace, and no code recycles one yet. A mechanism with no producer is the
 * kind of dark machinery this migration is unwinding.
 */
export class ProviderWorkspaceManager<TWorkspace> {
  private readonly entries = new Map<ProviderId, WorkspaceEntry<TWorkspace>>();
  private disposed = false;

  constructor(private readonly ports: ProviderWorkspaceManagerPorts<TWorkspace>) {}

  /**
   * Initializes every provider concurrently, and never rejects.
   *
   * A provider that fails is recorded through `reportFailure` and leaves the
   * others untouched, which is the whole point: plugin startup awaits this.
   */
  async initializeAll(providerIds: readonly ProviderId[]): Promise<void> {
    await Promise.all(providerIds.map(providerId => this.initialize(providerId)));
  }

  /**
   * Brings one provider's workspace up, and says whether it is ready.
   *
   * Safe to call again after a failure — that is the retry — and safe to call
   * concurrently: a second caller joins the in-flight attempt rather than
   * starting a second one.
   */
  async initialize(providerId: ProviderId): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    const entry = this.entryFor(providerId);
    if (entry.state === 'ready') {
      return true;
    }
    if (entry.state === 'initializing') {
      await entry.task;
      return this.entryFor(providerId).state === 'ready';
    }

    const contribution = this.ports.contribution(providerId);
    if (!contribution) {
      return false;
    }

    const controller = new AbortController();
    entry.state = 'initializing';
    entry.controller = controller;
    entry.task = this.run(providerId, entry, contribution, controller);
    await entry.task;
    return this.stateOf(providerId) === 'ready';
  }

  /**
   * What the manager currently believes about a provider.
   *
   * A closed manager answers `disposed` for every provider, including ones it
   * never held: the entries are released at teardown, and answering
   * `uninitialized` would invite a caller to try initializing into an instance
   * that is gone.
   */
  stateOf(providerId: ProviderId): ProviderWorkspaceState {
    if (this.disposed) {
      return 'disposed';
    }
    return this.entries.get(providerId)?.state ?? 'uninitialized';
  }

  /**
   * Releases every workspace and closes the manager for good.
   *
   * Called from `onunload`, which returns void, so this must never reject: a
   * teardown that throws on the way out leaves the rest of the teardown unrun.
   */
  async disposeAll(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
    }
    // In-flight attempts are awaited before their workspaces are released, so
    // one that completes during teardown is disposed rather than leaked. `run`
    // absorbs its own failures, so this cannot reject.
    const inFlight = [...this.entries.values()]
      .map(entry => entry.task)
      .filter((task): task is Promise<void> => task !== undefined);
    await Promise.all(inFlight);
    await Promise.all([...this.entries.entries()].map(
      ([providerId, entry]) => this.release(providerId, entry),
    ));
    this.entries.clear();
  }

  private async run(
    providerId: ProviderId,
    entry: WorkspaceEntry<TWorkspace>,
    contribution: ProviderWorkspaceContribution<TWorkspace>,
    controller: AbortController,
  ): Promise<void> {
    try {
      const workspace = await contribution.initialize(controller.signal);
      if (this.disposed || controller.signal.aborted) {
        // Completed for an instance that is gone. Released rather than
        // published: publishing here is how a reload ends up with the previous
        // load's services.
        await this.disposeQuietly(providerId, contribution, workspace);
        entry.state = 'disposed';
        return;
      }
      entry.workspace = workspace;
      entry.state = 'ready';
      this.ports.publish(providerId, workspace);
    } catch (error) {
      entry.state = 'failed';
      entry.workspace = undefined;
      this.ports.publish(providerId, null);
      this.ports.reportFailure({ providerId, phase: 'initialize', error });
    }
  }

  private async release(providerId: ProviderId, entry: WorkspaceEntry<TWorkspace>): Promise<void> {
    const workspace = entry.workspace;
    entry.workspace = undefined;
    entry.state = 'disposed';
    this.ports.publish(providerId, null);
    if (workspace === undefined) {
      return;
    }
    const contribution = this.ports.contribution(providerId);
    if (contribution) {
      await this.disposeQuietly(providerId, contribution, workspace);
    }
  }

  private async disposeQuietly(
    providerId: ProviderId,
    contribution: ProviderWorkspaceContribution<TWorkspace>,
    workspace: TWorkspace,
  ): Promise<void> {
    try {
      await contribution.dispose(workspace);
    } catch (error) {
      this.ports.reportFailure({ providerId, phase: 'dispose', error });
    }
  }

  private entryFor(providerId: ProviderId): WorkspaceEntry<TWorkspace> {
    const existing = this.entries.get(providerId);
    if (existing) {
      return existing;
    }
    const entry: WorkspaceEntry<TWorkspace> = { state: 'uninitialized' };
    this.entries.set(providerId, entry);
    return entry;
  }
}
