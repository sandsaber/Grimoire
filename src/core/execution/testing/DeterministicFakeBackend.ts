import {
  type ExecutionBackendDescriptor,
  executionBackendId,
  internalExecutionServiceId,
} from '../ExecutionBackendDescriptor';
import {
  type CancellationReason,
  type ExecutionBackend,
  ExecutionDispatchError,
  type ExecutionRecoveryPort,
  type ExecutionRequest,
  type ExecutionRun,
  type ExecutionSession,
  type ExecutionSessionConfig,
  type ExecutionSessionSnapshot,
  type InteractionPort,
  type InteractionResolution,
  type RunRecoveryEvidence,
  type RunRecoveryQuery,
  type Unsubscribe,
} from '../ExecutionContracts';
import type {
  CausalDeliveryPosition,
  ExecutionEvent,
  ExecutionEventScope,
  ProviderExecutionEvent,
} from '../ExecutionEvents';
import type {
  ExecutionSessionId,
  InteractionId,
  RunId,
  SessionInstanceId,
} from '../ExecutionIds';

export type FakeDispatchMode = 'accept' | 'reject-side-effect-free' | 'lose-acknowledgement';
export type FakeCancellationMode = 'acknowledge' | 'silent' | 'reject';
export type FakeDeliveryDestination = 'run' | 'session' | 'both';

export interface FakeDeliveryOptions {
  readonly deliveryId?: string;
  readonly destination?: FakeDeliveryDestination;
  readonly causal?: CausalDeliveryPosition;
  readonly occurredAt?: number;
  readonly scope?: ExecutionEventScope;
}

export interface DeterministicFakeBackendOptions {
  readonly sessionInstanceIdFactory: () => SessionInstanceId;
  readonly now?: () => number;
}

const descriptor: ExecutionBackendDescriptor = {
  backendId: executionBackendId('internal-deterministic-fake'),
  association: {
    kind: 'internal',
    service: internalExecutionServiceId('deterministic-test'),
  },
};

export class DeterministicFakeRecoveryPort implements ExecutionRecoveryPort {
  readonly queries: RunRecoveryQuery[] = [];
  private readonly evidence = new Map<RunId, RunRecoveryEvidence[]>();
  private fallback: RunRecoveryEvidence = { kind: 'unknown', effectsPossible: true };
  private readonly neverResolve = new Set<RunId>();

  setEvidence(runId: RunId, ...evidence: readonly RunRecoveryEvidence[]): void {
    this.evidence.set(runId, [...evidence]);
  }

  setFallback(evidence: RunRecoveryEvidence): void {
    this.fallback = evidence;
  }

  setNeverResolve(runId: RunId): void {
    this.neverResolve.add(runId);
  }

  reconcile(query: RunRecoveryQuery): Promise<RunRecoveryEvidence> {
    this.queries.push(query);
    if (this.neverResolve.has(query.runId)) {
      return new Promise(() => undefined);
    }
    const queued = this.evidence.get(query.runId);
    return Promise.resolve(queued?.shift() ?? this.fallback);
  }
}

export class DeterministicFakeBackend implements ExecutionBackend, InteractionPort {
  readonly descriptor = descriptor;
  readonly nativeStatusRecovery = new DeterministicFakeRecoveryPort();
  readonly snapshotRecovery = new DeterministicFakeRecoveryPort();
  readonly resolutions: InteractionResolution[] = [];
  readonly cancelledInteractions: InteractionId[] = [];
  readonly sessions = new Map<ExecutionSessionId, DeterministicFakeSession>();
  readonly dispatchAttempts = new Map<RunId, number>();
  dispatchMode: FakeDispatchMode = 'accept';
  cancellationMode: FakeCancellationMode = 'acknowledge';
  interactionResolutionError: Error | undefined;
  interactionCancellationError: Error | undefined;
  disposeCount = 0;
  private disposed = false;
  private deliveryOrdinal = 0;

  constructor(private readonly options: DeterministicFakeBackendOptions) {}

  async createSession(config: ExecutionSessionConfig): Promise<ExecutionSession> {
    if (this.disposed) {
      throw new Error('Deterministic fake backend is disposed.');
    }
    const session = new DeterministicFakeSession(
      this,
      config,
      this.options.sessionInstanceIdFactory(),
    );
    this.sessions.set(config.executionSessionId, session);
    return session;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeCount += 1;
    await Promise.all([...this.sessions.values()].map(session => session.dispose()));
  }

  resolve(resolution: InteractionResolution): Promise<void> {
    this.resolutions.push(resolution);
    return this.interactionResolutionError
      ? Promise.reject(this.interactionResolutionError)
      : Promise.resolve();
  }

  cancel(interactionId: InteractionId): Promise<void> {
    this.cancelledInteractions.push(interactionId);
    return this.interactionCancellationError
      ? Promise.reject(this.interactionCancellationError)
      : Promise.resolve();
  }

  emit(runId: RunId, event: ExecutionEvent, options: FakeDeliveryOptions = {}): ProviderExecutionEvent {
    const run = this.requireRun(runId);
    return run.emit(event, options);
  }

  emitSession(
    executionSessionId: ExecutionSessionId,
    event: Extract<ExecutionEvent, {
      readonly kind: 'connection-lost' | 'recovery-started' | 'recovered';
    }>,
    options: Omit<FakeDeliveryOptions, 'scope'> = {},
  ): ProviderExecutionEvent {
    const session = this.requireSession(executionSessionId);
    const delivery = this.createDelivery(session, { kind: 'session' }, event, options);
    session.publish(delivery);
    return delivery;
  }

  closeRunStream(runId: RunId): void {
    this.requireRun(runId).closeStream();
  }

  failRunStream(runId: RunId, error = new Error('Fake run stream failed.')): void {
    this.requireRun(runId).failStream(error);
  }

  reconnectSession(executionSessionId: ExecutionSessionId, instanceId: SessionInstanceId): void {
    this.requireSession(executionSessionId).rotateInstance(instanceId);
  }

  getRun(runId: RunId): DeterministicFakeRun | null {
    for (const session of this.sessions.values()) {
      const run = session.runs.get(runId);
      if (run) {
        return run;
      }
    }
    return null;
  }

  createDelivery(
    session: DeterministicFakeSession,
    scope: ExecutionEventScope,
    event: ExecutionEvent,
    options: Omit<FakeDeliveryOptions, 'scope'> = {},
  ): ProviderExecutionEvent {
    return {
      backendId: descriptor.backendId,
      backendGeneration: session.config.backendGeneration,
      executionSessionId: session.executionSessionId,
      sessionInstanceId: session.sessionInstanceId,
      deliveryId: options.deliveryId ?? `fake-event-${++this.deliveryOrdinal}`,
      occurredAt: options.occurredAt ?? (this.options.now ?? Date.now)(),
      scope,
      ...(options.causal ? { causal: options.causal } : {}),
      event,
    };
  }

  recordDispatchAttempt(runId: RunId): void {
    this.dispatchAttempts.set(runId, (this.dispatchAttempts.get(runId) ?? 0) + 1);
  }

  private requireSession(executionSessionId: ExecutionSessionId): DeterministicFakeSession {
    const session = this.sessions.get(executionSessionId);
    if (!session) {
      throw new Error(`Unknown fake session "${executionSessionId}".`);
    }
    return session;
  }

  private requireRun(runId: RunId): DeterministicFakeRun {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Unknown fake run "${runId}".`);
    }
    return run;
  }
}

export class DeterministicFakeSession implements ExecutionSession {
  readonly runs = new Map<RunId, DeterministicFakeRun>();
  readonly config: ExecutionSessionConfig;
  disposeCount = 0;
  private readonly listeners = new Set<(event: ProviderExecutionEvent) => void>();
  private instanceId: SessionInstanceId;
  private disposed = false;

  constructor(
    private readonly backend: DeterministicFakeBackend,
    config: ExecutionSessionConfig,
    instanceId: SessionInstanceId,
  ) {
    this.config = config;
    this.instanceId = instanceId;
  }

  get executionSessionId(): ExecutionSessionId {
    return this.config.executionSessionId;
  }

  get sessionInstanceId(): SessionInstanceId {
    return this.instanceId;
  }

  createRun(request: ExecutionRequest): ExecutionRun {
    if (this.disposed) {
      throw new Error('Deterministic fake session is disposed.');
    }
    if (this.backend.dispatchMode === 'reject-side-effect-free') {
      throw new ExecutionDispatchError('Fake dispatch rejected before side effects.', true);
    }
    const run = new DeterministicFakeRun(this.backend, this, request);
    this.runs.set(request.runId, run);
    this.backend.recordDispatchAttempt(request.runId);
    if (this.backend.dispatchMode === 'lose-acknowledgement') {
      throw new Error('Fake dispatch acknowledgement was lost.');
    }
    return run;
  }

  getSnapshot(): ExecutionSessionSnapshot {
    return {
      executionSessionId: this.executionSessionId,
      sessionInstanceId: this.sessionInstanceId,
      nativeSessionRef: `fake-session-${this.executionSessionId}`,
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
    this.disposeCount += 1;
    await Promise.all([...this.runs.values()].map(run => run.cancel({ code: 'shutdown' })));
  }

  publish(event: ProviderExecutionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  rotateInstance(instanceId: SessionInstanceId): void {
    this.instanceId = instanceId;
  }
}

export class DeterministicFakeRun implements ExecutionRun {
  readonly events: AsyncIterable<ProviderExecutionEvent>;
  readonly cancellationReasons: CancellationReason[] = [];
  private readonly queue = new ControllableAsyncQueue<ProviderExecutionEvent>();
  private closed = false;

  constructor(
    private readonly backend: DeterministicFakeBackend,
    private readonly session: DeterministicFakeSession,
    private readonly request: ExecutionRequest,
  ) {
    this.events = this.queue;
  }

  get runId(): RunId {
    return this.request.runId;
  }

  async cancel(reason: CancellationReason = { code: 'user' }): Promise<void> {
    this.cancellationReasons.push(reason);
    if (this.backend.cancellationMode === 'reject') {
      throw new Error('Fake cancellation was rejected.');
    }
    if (this.backend.cancellationMode === 'acknowledge') {
      this.emit({ kind: 'cancellation-acknowledged' });
      this.closeStream();
    }
  }

  emit(event: ExecutionEvent, options: FakeDeliveryOptions = {}): ProviderExecutionEvent {
    const destination = options.destination ?? 'both';
    const scope = options.scope ?? { kind: 'run', runId: this.runId };
    const delivery = this.backend.createDelivery(this.session, scope, event, options);
    if (destination === 'run' || destination === 'both') {
      this.queue.push(delivery);
    }
    if (destination === 'session' || destination === 'both') {
      this.session.publish(delivery);
    }
    return delivery;
  }

  closeStream(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.queue.close();
  }

  failStream(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.queue.fail(error);
  }
}

class ControllableAsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<{
    resolve(result: IteratorResult<T>): void;
    reject(error: Error): void;
  }> = [];
  private closed = false;
  private failure: Error | undefined;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const reader = this.readers.shift();
    if (reader) {
      reader.resolve({ value, done: false });
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
      reader.resolve({ value: undefined as never, done: true });
    }
  }

  fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.failure = error;
    this.closed = true;
    for (const reader of this.readers.splice(0)) {
      reader.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.failure) {
          return Promise.reject(this.failure);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.readers.push({ resolve, reject });
        });
      },
    };
  }
}
