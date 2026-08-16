import type { ExecutionBackendId } from './ExecutionBackendDescriptor';
import {
  type ExecutionEventEnvelope,
  type ExecutionGapDiagnostic,
  isTransientExecutionEvent,
  type ProviderExecutionEvent,
} from './ExecutionEvents';
import type {
  ExecutionSessionId,
  RunId,
  SessionInstanceId,
} from './ExecutionIds';

export interface ExecutionEventIngestorOptions {
  readonly backendId: ExecutionBackendId;
  readonly backendGeneration: number;
  readonly executionSessionId: ExecutionSessionId;
  readonly sessionInstanceId: SessionInstanceId;
  readonly nextSequence?: number;
  readonly seenDeliveryIds?: readonly string[];
  readonly maxReorderDistance?: number;
  readonly maxRememberedDeliveryIds?: number;
}

export type IngestResult =
  | { readonly kind: 'accepted'; readonly envelopes: readonly ExecutionEventEnvelope[] }
  | { readonly kind: 'buffered' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'stale-generation' }
  | { readonly kind: 'stale-instance' }
  | { readonly kind: 'wrong-backend' }
  | { readonly kind: 'wrong-session' }
  | { readonly kind: 'stale-causal-position' }
  | { readonly kind: 'causal-conflict'; readonly diagnostic: ExecutionGapDiagnostic }
  | { readonly kind: 'gap'; readonly diagnostic: ExecutionGapDiagnostic };

export interface ExecutionEventIngestorCheckpoint {
  readonly backendGeneration: number;
  readonly sessionInstanceId: SessionInstanceId;
  readonly nextSequence: number;
  readonly seenDeliveryOrder: readonly string[];
  readonly pendingDeliveryIds: readonly string[];
  readonly causalStreams: readonly {
    readonly streamId: string;
    readonly nextSequence: number;
    readonly quarantined: boolean;
    readonly buffered: readonly ProviderExecutionEvent[];
  }[];
}

interface CausalStreamState {
  nextSequence: number;
  quarantined: boolean;
  buffered: Map<number, ProviderExecutionEvent>;
}

export class ExecutionEventIngestor {
  private readonly backendId: ExecutionBackendId;
  private readonly executionSessionId: ExecutionSessionId;
  private readonly maxReorderDistance: number;
  private readonly maxRememberedDeliveryIds: number;
  private backendGeneration: number;
  private sessionInstanceId: SessionInstanceId;
  private nextSequence: number;
  private readonly seenDeliveryIds = new Set<string>();
  private readonly seenDeliveryOrder: string[] = [];
  private readonly pendingDeliveryIds = new Set<string>();
  private readonly causalStreams = new Map<string, CausalStreamState>();

  constructor(options: ExecutionEventIngestorOptions) {
    if (!Number.isSafeInteger(options.backendGeneration) || options.backendGeneration < 0) {
      throw new Error('Backend generation must be a non-negative safe integer.');
    }
    if (!Number.isSafeInteger(options.nextSequence ?? 1) || (options.nextSequence ?? 1) < 1) {
      throw new Error('Next sequence must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(options.maxReorderDistance ?? 16)
      || (options.maxReorderDistance ?? 16) < 1) {
      throw new Error('Reorder distance must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(options.maxRememberedDeliveryIds ?? 256)
      || (options.maxRememberedDeliveryIds ?? 256) < 1) {
      throw new Error('Remembered delivery limit must be a positive safe integer.');
    }
    this.backendId = options.backendId;
    this.backendGeneration = options.backendGeneration;
    this.executionSessionId = options.executionSessionId;
    this.sessionInstanceId = options.sessionInstanceId;
    this.nextSequence = options.nextSequence ?? 1;
    this.maxReorderDistance = options.maxReorderDistance ?? 16;
    this.maxRememberedDeliveryIds = options.maxRememberedDeliveryIds ?? 256;
    for (const deliveryId of options.seenDeliveryIds ?? []) {
      requireDeliveryId(deliveryId);
      this.rememberDeliveryId(deliveryId);
    }
  }

  ingest(event: ProviderExecutionEvent): IngestResult {
    const scopeResult = this.validateScope(event);
    if (scopeResult) {
      return scopeResult;
    }
    requireDeliveryId(event.deliveryId);
    if (this.seenDeliveryIds.has(event.deliveryId)
      || this.pendingDeliveryIds.has(event.deliveryId)) {
      return { kind: 'duplicate' };
    }
    if (!event.causal) {
      return { kind: 'accepted', envelopes: [this.accept(event)] };
    }
    requireCausalPosition(event.causal.streamId, event.causal.sequence);
    const state = this.getCausalStream(event.causal.streamId);
    if (state.quarantined) {
      return {
        kind: 'gap',
        diagnostic: createGapDiagnostic(event.causal.streamId, state, event),
      };
    }
    if (event.causal.sequence < state.nextSequence) {
      return { kind: 'stale-causal-position' };
    }
    if (event.causal.sequence === state.nextSequence) {
      this.pendingDeliveryIds.delete(event.deliveryId);
      const envelope = this.accept(event);
      state.nextSequence += 1;
      return { kind: 'accepted', envelopes: [envelope] };
    }
    if (event.causal.sequence - state.nextSequence > this.maxReorderDistance
      || state.buffered.size >= this.maxReorderDistance) {
      const diagnostic = createGapDiagnostic(event.causal.streamId, state, event);
      this.quarantine(state);
      return {
        kind: 'gap',
        diagnostic,
      };
    }
    const occupying = state.buffered.get(event.causal.sequence);
    if (occupying) {
      const diagnostic = createGapDiagnostic(event.causal.streamId, state, event);
      this.quarantine(state);
      return {
        kind: 'causal-conflict',
        diagnostic,
      };
    }
    state.buffered.set(event.causal.sequence, event);
    this.pendingDeliveryIds.add(event.deliveryId);
    return { kind: 'buffered' };
  }

  /**
   * Accepts at most one buffered event. The caller must durably apply that
   * envelope before asking for another, so rollback never spans multiple
   * lifecycle commits.
   */
  drainReady(): ExecutionEventEnvelope | null {
    for (const state of this.causalStreams.values()) {
      if (state.quarantined) {
        continue;
      }
      const event = state.buffered.get(state.nextSequence);
      if (!event) {
        continue;
      }
      state.buffered.delete(state.nextSequence);
      this.pendingDeliveryIds.delete(event.deliveryId);
      const envelope = this.accept(event);
      state.nextSequence += 1;
      return envelope;
    }
    return null;
  }

  createCheckpoint(): ExecutionEventIngestorCheckpoint {
    return {
      backendGeneration: this.backendGeneration,
      sessionInstanceId: this.sessionInstanceId,
      nextSequence: this.nextSequence,
      seenDeliveryOrder: [...this.seenDeliveryOrder],
      pendingDeliveryIds: [...this.pendingDeliveryIds],
      causalStreams: [...this.causalStreams].map(([streamId, state]) => ({
        streamId,
        nextSequence: state.nextSequence,
        quarantined: state.quarantined,
        buffered: [...state.buffered.values()],
      })),
    };
  }

  restoreCheckpoint(checkpoint: ExecutionEventIngestorCheckpoint): void {
    this.backendGeneration = checkpoint.backendGeneration;
    this.sessionInstanceId = checkpoint.sessionInstanceId;
    this.nextSequence = checkpoint.nextSequence;
    this.seenDeliveryIds.clear();
    this.seenDeliveryOrder.length = 0;
    for (const deliveryId of checkpoint.seenDeliveryOrder) {
      this.rememberDeliveryId(deliveryId);
    }
    this.pendingDeliveryIds.clear();
    for (const deliveryId of checkpoint.pendingDeliveryIds) {
      this.pendingDeliveryIds.add(deliveryId);
    }
    this.causalStreams.clear();
    for (const stream of checkpoint.causalStreams) {
      this.causalStreams.set(stream.streamId, {
        nextSequence: stream.nextSequence,
        quarantined: stream.quarantined,
        buffered: new Map(stream.buffered.map(event => [
          event.causal?.sequence as number,
          event,
        ])),
      });
    }
  }

  flushGaps(): ExecutionGapDiagnostic[] {
    const diagnostics: ExecutionGapDiagnostic[] = [];
    for (const [streamId, state] of this.causalStreams) {
      if (state.buffered.size === 0) {
        continue;
      }
      const first = Math.min(...state.buffered.keys());
      diagnostics.push(createGapDiagnostic(
        streamId,
        state,
        state.buffered.get(first) as ProviderExecutionEvent,
      ));
      for (const event of state.buffered.values()) {
        this.pendingDeliveryIds.delete(event.deliveryId);
      }
      state.buffered.clear();
      state.quarantined = true;
    }
    return diagnostics;
  }

  rebaseCausalStream(streamId: string, nextCausalSequence: number): void {
    requireCausalPosition(streamId, nextCausalSequence);
    const state = this.getCausalStream(streamId);
    for (const event of state.buffered.values()) {
      this.pendingDeliveryIds.delete(event.deliveryId);
    }
    state.buffered.clear();
    state.nextSequence = nextCausalSequence;
    state.quarantined = false;
  }

  rotateSessionInstance(sessionInstanceId: SessionInstanceId): void {
    this.sessionInstanceId = sessionInstanceId;
    this.pendingDeliveryIds.clear();
    this.causalStreams.clear();
  }

  advanceBackendGeneration(backendGeneration: number): void {
    if (!Number.isSafeInteger(backendGeneration) || backendGeneration <= this.backendGeneration) {
      throw new Error('Backend generation must advance monotonically.');
    }
    this.backendGeneration = backendGeneration;
    this.seenDeliveryIds.clear();
    this.seenDeliveryOrder.length = 0;
    this.pendingDeliveryIds.clear();
    this.causalStreams.clear();
  }

  getLastAssignedSequence(): number {
    return this.nextSequence - 1;
  }

  getRecentDeliveryIds(): readonly string[] {
    return [...this.seenDeliveryOrder];
  }

  private validateScope(event: ProviderExecutionEvent): Exclude<IngestResult, {
    readonly kind: 'accepted' | 'buffered' | 'duplicate' | 'stale-causal-position' | 'gap';
  }> | null {
    if (event.backendId !== this.backendId) {
      return { kind: 'wrong-backend' };
    }
    if (event.backendGeneration !== this.backendGeneration) {
      return { kind: 'stale-generation' };
    }
    if (event.executionSessionId !== this.executionSessionId) {
      return { kind: 'wrong-session' };
    }
    if (event.sessionInstanceId !== this.sessionInstanceId) {
      return { kind: 'stale-instance' };
    }
    return null;
  }

  private accept(event: ProviderExecutionEvent): ExecutionEventEnvelope {
    // Transient content neither consumes a sequence number nor enters the
    // bounded delivery-id set: the sequence space belongs to durable facts, so
    // a run's `lastSequence` still counts what actually happened, and a turn's
    // worth of deltas cannot evict the ids that protect against redelivery.
    // It is stamped with the position it follows, which keeps it ordered
    // against the surrounding events without claiming one of their places.
    if (isTransientExecutionEvent(event.event)) {
      return {
        schemaVersion: 1,
        backendId: event.backendId,
        backendGeneration: event.backendGeneration,
        executionSessionId: event.executionSessionId,
        sessionInstanceId: event.sessionInstanceId,
        eventId: event.deliveryId,
        sequence: this.nextSequence - 1,
        occurredAt: event.occurredAt,
        scope: event.scope,
        event: event.event,
      };
    }
    this.rememberDeliveryId(event.deliveryId);
    return {
      schemaVersion: 1,
      backendId: event.backendId,
      backendGeneration: event.backendGeneration,
      executionSessionId: event.executionSessionId,
      sessionInstanceId: event.sessionInstanceId,
      eventId: event.deliveryId,
      sequence: this.nextSequence++,
      occurredAt: event.occurredAt,
      scope: event.scope,
      event: event.event,
    };
  }

  private rememberDeliveryId(deliveryId: string): void {
    if (this.seenDeliveryIds.has(deliveryId)) {
      return;
    }
    this.seenDeliveryIds.add(deliveryId);
    this.seenDeliveryOrder.push(deliveryId);
    while (this.seenDeliveryOrder.length > this.maxRememberedDeliveryIds) {
      const evicted = this.seenDeliveryOrder.shift();
      if (evicted) {
        this.seenDeliveryIds.delete(evicted);
      }
    }
  }

  private getCausalStream(streamId: string): CausalStreamState {
    const current = this.causalStreams.get(streamId);
    if (current) {
      return current;
    }
    const created = {
      nextSequence: 1,
      quarantined: false,
      buffered: new Map<number, ProviderExecutionEvent>(),
    };
    this.causalStreams.set(streamId, created);
    return created;
  }

  private quarantine(state: CausalStreamState): void {
    for (const buffered of state.buffered.values()) {
      this.pendingDeliveryIds.delete(buffered.deliveryId);
    }
    state.buffered.clear();
    state.quarantined = true;
  }
}

function createGapDiagnostic(
  streamId: string,
  state: CausalStreamState,
  firstEvent: ProviderExecutionEvent,
): ExecutionGapDiagnostic {
  const affectedRunIds = new Set<RunId>();
  for (const event of [...state.buffered.values(), firstEvent]) {
    if (event.scope.kind === 'run' || event.scope.kind === 'agent') {
      affectedRunIds.add(event.scope.runId);
    }
  }
  return {
    streamId,
    expectedCausalSequence: state.nextSequence,
    firstObservedCausalSequence: firstEvent.causal?.sequence ?? state.nextSequence,
    affectedRunIds: [...affectedRunIds],
  };
}

function requireDeliveryId(deliveryId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deliveryId)) {
    throw new Error('Delivery id must be a constrained stable identifier.');
  }
}

function requireCausalPosition(streamId: string, sequence: number): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(streamId)) {
    throw new Error('Causal stream id must be a constrained identifier.');
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Causal sequence must be a positive safe integer.');
  }
}
