import type {
  ResultExpectation,
  ResultRef,
  RunState,
  RunTerminal,
} from './ExecutionContracts';
import type {
  ExecutionReconciliationRecord,
  ReconciliationEvidenceRecord,
} from './ExecutionControlRecords';
import { type ExecutionEventEnvelope, isTransientExecutionEvent } from './ExecutionEvents';
import type { RunId } from './ExecutionIds';

export interface ReconciledOutcomeProjection {
  readonly reconciliationId: string;
  readonly observedOutcome: ExecutionReconciliationRecord['observedOutcome'];
  readonly observedResult?: ResultRef;
  readonly evidence: ReconciliationEvidenceRecord;
  readonly recordedAt: number;
}

export interface RunProjection {
  readonly runId: RunId;
  readonly resultExpectation: ResultExpectation;
  readonly state: RunState;
  readonly result?: ResultRef;
  readonly terminal?: RunTerminal;
  readonly sawThinking: boolean;
  readonly toolCallIds: readonly string[];
  readonly progressIds: readonly string[];
  readonly interactionIds: readonly string[];
  readonly nativeAgentKeys: readonly string[];
  readonly lastSequence: number;
  readonly recentEventIds: readonly string[];
  readonly reconciledOutcomes: readonly ReconciledOutcomeProjection[];
}

export function createRunProjection(
  runId: RunId,
  resultExpectation: ResultExpectation,
): RunProjection {
  return {
    runId,
    resultExpectation,
    state: 'queued',
    sawThinking: false,
    toolCallIds: [],
    progressIds: [],
    interactionIds: [],
    nativeAgentKeys: [],
    lastSequence: 0,
    recentEventIds: [],
    reconciledOutcomes: [],
  };
}

export function reduceRunProjection(
  projection: RunProjection,
  envelope: ExecutionEventEnvelope,
): RunProjection {
  // Transient content is not a fact about the run, so it changes nothing here.
  // Checked before the sequence guard on purpose: a transient envelope carries
  // the position it follows rather than a new one, which the guard below would
  // read as a replay.
  if (isTransientExecutionEvent(envelope.event)) {
    return projection;
  }
  if (projection.terminal
    // A synthesized envelope carries the position it follows rather than a new
    // one, for the same reason a transient one does and with the same
    // consequence if it is not excused: read as a replay, the terminal the
    // registry stated is dropped and the run stays running in every consumer
    // that closes a turn on it. Its event id still makes a second delivery a
    // no-op, which is what the ordering guard was protecting here.
    || (!envelope.synthesized && envelope.sequence <= projection.lastSequence)
    || projection.recentEventIds.includes(envelope.eventId)
    || !belongsToRun(envelope, projection.runId)) {
    return projection;
  }
  const base = {
    ...projection,
    lastSequence: Math.max(projection.lastSequence, envelope.sequence),
    recentEventIds: rememberEventId(projection.recentEventIds, envelope.eventId),
  };
  switch (envelope.event.kind) {
    case 'run-started':
      return { ...base, state: 'running' };
    case 'thinking-activity':
      return { ...base, state: 'running', sawThinking: true };
    case 'tool-activity':
      return {
        ...base,
        state: 'running',
        toolCallIds: appendUnique(base.toolCallIds, envelope.event.toolCallId),
      };
    case 'progress':
      return {
        ...base,
        state: 'running',
        progressIds: appendUnique(base.progressIds, envelope.event.progressId),
      };
    case 'result':
      return { ...base, state: 'running', result: envelope.event.result };
    case 'interaction-opened':
      return {
        ...base,
        state: 'waiting-interaction',
        interactionIds: appendUnique(
          base.interactionIds,
          envelope.event.interaction.interactionId,
        ),
      };
    case 'interaction-resolved': {
      const interactionId = envelope.event.interactionId;
      return {
        ...base,
        state: 'running',
        interactionIds: base.interactionIds.filter(id => id !== interactionId),
      };
    }
    case 'connection-lost':
      return { ...base, state: 'disconnected' };
    case 'recovery-started':
      return { ...base, state: 'recovering' };
    case 'recovered':
      return { ...base, state: envelope.event.state };
    case 'cancellation-acknowledged':
      return terminalProjection(base, 'cancelled', 'cancellation-confirmed', envelope.occurredAt);
    case 'terminal': {
      if (envelope.event.terminal === 'succeeded'
        && projection.resultExpectation === 'required'
        && !projection.result) {
        return terminalProjection(base, 'failed', 'missing-required-result', envelope.occurredAt);
      }
      return terminalProjection(
        base,
        envelope.event.terminal,
        envelope.event.reason,
        envelope.occurredAt,
      );
    }
    case 'native-agent-observed':
    case 'native-agent-result':
    case 'native-agent-activity':
    case 'native-agent-status':
      return {
        ...base,
        nativeAgentKeys: appendUnique(base.nativeAgentKeys, envelope.event.nativeAgentKey),
      };
  }
}

export function applyRunReconciliation(
  projection: RunProjection,
  record: ExecutionReconciliationRecord,
): RunProjection {
  if (record.runId !== projection.runId
    || projection.terminal?.kind !== 'indeterminate'
    || projection.reconciledOutcomes.some(item => (
      item.reconciliationId === record.reconciliationId
    ))) {
    return projection;
  }
  return {
    ...projection,
    reconciledOutcomes: [...projection.reconciledOutcomes, {
      reconciliationId: record.reconciliationId,
      observedOutcome: record.observedOutcome,
      ...(record.observedResult ? { observedResult: record.observedResult } : {}),
      evidence: record.evidence,
      recordedAt: record.recordedAt,
    }],
  };
}

function belongsToRun(envelope: ExecutionEventEnvelope, runId: RunId): boolean {
  return envelope.scope.kind === 'session' || envelope.scope.runId === runId;
}

function terminalProjection(
  projection: RunProjection,
  kind: RunTerminal['kind'],
  reason: RunTerminal['reason'],
  occurredAt: number,
): RunProjection {
  const terminal: RunTerminal = {
    kind,
    reason,
    occurredAt,
    ...(projection.result ? { resultRef: projection.result } : {}),
  };
  return {
    ...projection,
    state: kind,
    terminal,
    interactionIds: [],
  };
}

function appendUnique(values: readonly string[], value: string): readonly string[] {
  return values.includes(value) ? values : [...values, value];
}

function rememberEventId(values: readonly string[], value: string): readonly string[] {
  const next = appendUnique(values, value);
  return next.length > 256 ? next.slice(next.length - 256) : next;
}
