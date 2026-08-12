import type { ProviderId } from '../types/provider';
import type { ProviderCatalog } from './ProviderCatalog';

export type ProviderWorkspaceState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'failed'
  | 'disposing'
  | 'disposed';

export interface ProviderWorkspaceSnapshot {
  readonly providerId: ProviderId;
  readonly generation: number;
  readonly state: ProviderWorkspaceState;
  readonly transitionId?: string;
  readonly failurePhase?: 'initialize' | 'dispose';
}

export interface ProviderWorkspaceContextResolver {
  resolve(providerId: ProviderId, generation: number): Promise<unknown>;
}

export interface ProviderGenerationPort {
  getGeneration(providerId: ProviderId): number;
}

export interface ProviderWorkspaceScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ProviderWorkspaceManagerOptions {
  readonly settlementTimeoutMs: number;
  readonly scheduler: ProviderWorkspaceScheduler;
}

interface WorkspaceEntry {
  readonly providerId: ProviderId;
  generation: number;
  epoch: number;
  state: ProviderWorkspaceState;
  controller?: AbortController;
  initializeTask?: Promise<unknown>;
  disposeTask?: Promise<void>;
  workspace?: unknown;
  failurePhase?: 'initialize' | 'dispose';
}

interface RetainedInitialization {
  readonly providerId: ProviderId;
  task: Promise<void>;
  workspace?: unknown;
  settled: boolean;
  failure?: unknown;
}

export class ProviderWorkspaceUnavailableError extends Error {
  constructor(
    readonly providerId: ProviderId,
    readonly phase: 'initialize' | 'dispose',
    options?: ErrorOptions,
  ) {
    super(`Provider "${providerId}" workspace ${phase} failed.`, options);
    this.name = 'ProviderWorkspaceUnavailableError';
  }
}

export class ProviderWorkspaceTransitionError extends Error {
  constructor(
    readonly providerId: ProviderId,
    readonly transitionId: string,
  ) {
    super(`Provider "${providerId}" workspace is fenced by settings transition.`);
    this.name = 'ProviderWorkspaceTransitionError';
  }
}

class ProviderWorkspaceSettlementTimeoutError extends Error {
  constructor(
    readonly providerId: ProviderId,
    readonly phase: 'initialize' | 'dispose',
  ) {
    super(`Provider "${providerId}" workspace ${phase} did not settle before its deadline.`);
    this.name = 'ProviderWorkspaceSettlementTimeoutError';
  }
}

export class StaleProviderWorkspaceError extends Error {
  constructor(
    readonly providerId: ProviderId,
    readonly retainedWorkspace?: unknown,
    readonly disposalFailure?: unknown,
  ) {
    super(`Provider "${providerId}" workspace completed for a stale generation.`);
    this.name = 'StaleProviderWorkspaceError';
  }
}

/** Owns lazy provider workspaces independently from tabs and plugin startup. */
export class ProviderWorkspaceManager {
  private readonly entries = new Map<ProviderId, WorkspaceEntry>();
  private readonly transitionFences = new Map<ProviderId, string>();
  private readonly retainedInitializations = new Map<ProviderId, RetainedInitialization>();
  private closing = false;
  private disposed = false;
  private disposalTask?: Promise<void>;

  constructor(
    private readonly catalog: ProviderCatalog,
    private readonly contexts: ProviderWorkspaceContextResolver,
    private readonly generations: ProviderGenerationPort,
    private readonly options: ProviderWorkspaceManagerOptions,
  ) {
    if (!Number.isSafeInteger(options.settlementTimeoutMs)
      || options.settlementTimeoutMs < 1) {
      throw new Error('Provider workspace settlement timeout must be a positive integer.');
    }
  }

  async get(providerId: ProviderId): Promise<unknown> {
    this.requireOpen();
    if (this.retainedInitializations.has(providerId)) {
      await this.requireRetainedInitializationSettled(providerId);
    }
    const transitionId = this.transitionFences.get(providerId);
    if (transitionId) {
      throw new ProviderWorkspaceTransitionError(providerId, transitionId);
    }
    const module = this.catalog.require(providerId);
    const generation = this.requireGeneration(providerId);
    const entry = this.getEntry(providerId, generation);
    if (entry.generation !== generation) {
      await this.recycle(entry, generation, false);
    }
    if (entry.state === 'disposing') {
      await entry.disposeTask;
      return this.get(providerId);
    }
    if (entry.state === 'ready') return entry.workspace;
    if (entry.state === 'initializing') return entry.initializeTask;
    if (entry.state === 'failed') {
      throw new ProviderWorkspaceUnavailableError(
        providerId,
        entry.failurePhase ?? 'initialize',
      );
    }
    if (entry.state === 'disposed') {
      throw new Error(`Provider "${providerId}" workspace manager is disposed.`);
    }

    const epoch = ++entry.epoch;
    const controller = new AbortController();
    entry.state = 'initializing';
    entry.controller = controller;
    entry.failurePhase = undefined;
    const initialization = (async () => {
      const context = await this.contexts.resolve(providerId, generation);
      return module.workspace.initialize(context, controller.signal);
    })();
    const task = (async () => {
      try {
        let workspace: unknown;
        try {
          workspace = await this.settleWithin(initialization, providerId, 'initialize');
        } catch (error) {
          if (error instanceof ProviderWorkspaceSettlementTimeoutError) {
            controller.abort();
            this.retainInitialization(providerId, initialization);
          }
          throw error;
        }
        if (this.disposed
          || entry.epoch !== epoch
          || entry.generation !== generation
          || this.requireGeneration(providerId) !== generation) {
          throw new StaleProviderWorkspaceError(providerId, workspace);
        }
        entry.workspace = workspace;
        entry.initializeTask = undefined;
        entry.controller = undefined;
        entry.state = 'ready';
        return workspace;
      } catch (error) {
        if (entry.epoch === epoch && entry.state === 'initializing') {
          entry.initializeTask = undefined;
          entry.controller = undefined;
          if (error instanceof StaleProviderWorkspaceError
            && error.retainedWorkspace !== undefined) {
            entry.workspace = error.retainedWorkspace;
            entry.state = 'failed';
            entry.failurePhase = 'dispose';
          } else {
            entry.state = 'failed';
            entry.failurePhase = 'initialize';
          }
        }
        throw error;
      }
    })();
    entry.initializeTask = task;
    return task;
  }

  async retry(providerId: ProviderId): Promise<unknown> {
    this.requireOpen();
    if (this.retainedInitializations.has(providerId)) {
      await this.requireRetainedInitializationSettled(providerId);
    }
    const transitionId = this.transitionFences.get(providerId);
    if (transitionId) {
      throw new ProviderWorkspaceTransitionError(providerId, transitionId);
    }
    const generation = this.requireGeneration(providerId);
    const entry = this.getEntry(providerId, generation);
    if (entry.state !== 'failed') return this.get(providerId);
    if (entry.workspace !== undefined || entry.failurePhase === 'dispose') {
      await this.recycle(entry, generation, false);
    } else {
      entry.state = 'uninitialized';
      entry.failurePhase = undefined;
    }
    return this.get(providerId);
  }

  async invalidate(providerId: ProviderId): Promise<void> {
    this.requireOpen();
    const generation = this.requireGeneration(providerId);
    const entry = this.getEntry(providerId, generation);
    await this.recycle(entry, generation, false);
  }

  async beginSettingsTransition(providerId: ProviderId, transitionId: string): Promise<void> {
    this.requireOpen();
    requireTransitionId(transitionId);
    const existing = this.transitionFences.get(providerId);
    if (existing && existing !== transitionId) {
      throw new Error(`Provider "${providerId}" already has a workspace transition.`);
    }
    this.transitionFences.set(providerId, transitionId);
    const generation = this.requireGeneration(providerId);
    const entry = this.getEntry(providerId, generation);
    await this.recycle(entry, generation, false);
  }

  async completeSettingsTransition(providerId: ProviderId, transitionId: string): Promise<void> {
    this.requireOpen();
    requireTransitionId(transitionId);
    const existing = this.transitionFences.get(providerId);
    if (existing === undefined) return;
    if (existing !== transitionId) {
      throw new Error(`Provider "${providerId}" workspace transition does not match.`);
    }
    const generation = this.requireGeneration(providerId);
    const entry = this.getEntry(providerId, generation);
    await this.recycle(entry, generation, false);
    this.transitionFences.delete(providerId);
  }

  snapshot(providerId: ProviderId): ProviderWorkspaceSnapshot {
    const generation = this.requireGeneration(providerId);
    const entry = this.entries.get(providerId);
    return Object.freeze({
      providerId,
      generation: entry?.generation ?? generation,
      state: entry?.state ?? (this.disposed ? 'disposed' : 'uninitialized'),
      ...(this.transitionFences.has(providerId)
        ? { transitionId: this.transitionFences.get(providerId) }
        : {}),
      ...(entry?.failurePhase ? { failurePhase: entry.failurePhase } : {}),
    });
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.disposalTask) return this.disposalTask;
    this.closing = true;
    const task = this.disposeAll();
    this.disposalTask = task;
    return task;
  }

  private async disposeAll(): Promise<void> {
    const failures: string[] = [];
    try {
      const results = await Promise.allSettled(this.catalog.list().map(async module => {
        await this.requireRetainedInitializationSettled(module.manifest.id);
        const generation = this.requireGeneration(module.manifest.id);
        const entry = this.getEntry(module.manifest.id, generation);
        await this.recycle(entry, generation, true);
      }));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failures.push(`${this.catalog.list()[index]?.manifest.id ?? 'unknown'}: ${toMessage(
            result.reason,
          )}`);
        }
      });
      if (failures.length > 0) {
        throw new Error(`Provider workspace disposal failed: ${failures.join(', ')}.`);
      }
      this.disposed = true;
      this.transitionFences.clear();
    } finally {
      this.closing = false;
      if (!this.disposed) this.disposalTask = undefined;
    }
  }

  private async recycle(
    entry: WorkspaceEntry,
    nextGeneration: number,
    terminal: boolean,
  ): Promise<void> {
    if (this.retainedInitializations.has(entry.providerId)) {
      await this.requireRetainedInitializationSettled(entry.providerId);
    }
    if (entry.disposeTask) {
      await this.settleWithin(entry.disposeTask, entry.providerId, 'dispose');
      if (terminal && entry.state === 'uninitialized') entry.state = 'disposed';
      return;
    }
    const module = this.catalog.require(entry.providerId);
    const initializeTask = entry.initializeTask;
    const retainedWorkspace = entry.workspace;
    const epoch = ++entry.epoch;
    entry.controller?.abort();
    entry.controller = undefined;
    entry.initializeTask = undefined;
    entry.state = 'disposing';
    entry.failurePhase = undefined;
    let workspaceToDispose = retainedWorkspace;
    try {
      try {
        await initializeTask;
      } catch (error) {
        if (error instanceof StaleProviderWorkspaceError
          && error.retainedWorkspace !== undefined) {
          workspaceToDispose = error.retainedWorkspace;
        }
      }
      if (this.retainedInitializations.has(entry.providerId)) {
        await this.requireRetainedInitializationSettled(entry.providerId);
      }
      if (workspaceToDispose === undefined) {
        if (entry.epoch === epoch) {
          entry.workspace = undefined;
          entry.generation = nextGeneration;
          entry.state = terminal ? 'disposed' : 'uninitialized';
        }
        return;
      }

      entry.workspace = workspaceToDispose;
      const rawDisposal = module.workspace.dispose(workspaceToDispose);
      const trackedDisposal = rawDisposal.then(() => {
        if (entry.epoch === epoch) {
          entry.disposeTask = undefined;
          entry.workspace = undefined;
          entry.generation = nextGeneration;
          entry.state = terminal ? 'disposed' : 'uninitialized';
          entry.failurePhase = undefined;
        }
      }, error => {
        if (entry.epoch === epoch) {
          entry.disposeTask = undefined;
          entry.workspace = workspaceToDispose;
          entry.state = 'failed';
          entry.failurePhase = 'dispose';
        }
        throw error;
      });
      entry.disposeTask = trackedDisposal;
      await this.settleWithin(trackedDisposal, entry.providerId, 'dispose');
    } catch (error) {
      if (entry.epoch === epoch) {
        entry.workspace = workspaceToDispose;
        entry.state = 'failed';
        entry.failurePhase = 'dispose';
      }
      throw error instanceof ProviderWorkspaceUnavailableError
        ? error
        : new ProviderWorkspaceUnavailableError(entry.providerId, 'dispose', { cause: error });
    }
  }

  private retainInitialization(providerId: ProviderId, initialization: Promise<unknown>): void {
    if (this.retainedInitializations.has(providerId)) return;
    const module = this.catalog.require(providerId);
    const retained: RetainedInitialization = {
      providerId,
      task: Promise.resolve(),
      settled: false,
    };
    const task = initialization.then(async workspace => {
      retained.workspace = workspace;
      await module.workspace.dispose(workspace);
      retained.workspace = undefined;
    }, () => undefined).then(() => {
      retained.settled = true;
      retained.failure = undefined;
    }, error => {
      retained.settled = true;
      retained.failure = error;
    });
    retained.task = task;
    this.retainedInitializations.set(providerId, retained);
  }

  private async requireRetainedInitializationSettled(providerId: ProviderId): Promise<void> {
    const retained = this.retainedInitializations.get(providerId);
    if (!retained) return;
    if (!retained.settled) {
      await this.settleWithin(retained.task, providerId, 'dispose');
    }
    if (retained.failure !== undefined && retained.workspace !== undefined) {
      retained.settled = false;
      retained.failure = undefined;
      const module = this.catalog.require(providerId);
      const task = module.workspace.dispose(retained.workspace).then(() => {
        retained.workspace = undefined;
        retained.settled = true;
      }, error => {
        retained.failure = error;
        retained.settled = true;
      });
      retained.task = task;
      await this.settleWithin(task, providerId, 'dispose');
    }
    if (retained.failure !== undefined || retained.workspace !== undefined) {
      throw new ProviderWorkspaceUnavailableError(providerId, 'dispose', {
        cause: retained.failure,
      });
    }
    this.retainedInitializations.delete(providerId);
  }

  private async settleWithin<TResult>(
    task: Promise<TResult>,
    providerId: ProviderId,
    phase: 'initialize' | 'dispose',
  ): Promise<TResult> {
    let timeoutHandle: unknown;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = this.options.scheduler.setTimeout(() => {
        reject(new ProviderWorkspaceSettlementTimeoutError(providerId, phase));
      }, this.options.settlementTimeoutMs);
    });
    try {
      return await Promise.race([task, timeout]);
    } finally {
      this.options.scheduler.clearTimeout(timeoutHandle);
    }
  }

  private getEntry(providerId: ProviderId, generation: number): WorkspaceEntry {
    const existing = this.entries.get(providerId);
    if (existing) return existing;
    const entry: WorkspaceEntry = {
      providerId,
      generation,
      epoch: 0,
      state: this.disposed ? 'disposed' : 'uninitialized',
    };
    this.entries.set(providerId, entry);
    return entry;
  }

  private requireGeneration(providerId: ProviderId): number {
    const generation = this.generations.getGeneration(providerId);
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error(`Provider "${providerId}" has invalid backend generation ${generation}.`);
    }
    return generation;
  }

  private requireOpen(): void {
    if (this.closing || this.disposed) {
      throw new Error('Provider workspace manager is not accepting work.');
    }
  }
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function requireTransitionId(value: string): void {
  if (!/^st-[0-9a-f]{32}$/.test(value)) {
    throw new Error('Provider workspace settings transition id is invalid.');
  }
}
