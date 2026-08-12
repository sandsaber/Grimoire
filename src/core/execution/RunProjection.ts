import type {
  ResultExpectation,
  ResultRef,
  RunState,
  RunTerminal,
} from './ExecutionContracts';
import type {
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ReconciliationEvidenceRecord,
} from './ExecutionControlRecords';
import type { ExecutionEventEnvelope } from './ExecutionEvents';
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
  readonly lastEnvelopeSequence: number;
  readonly lastRecordRevision: number;
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
    lastEnvelopeSequence: 0,
    lastRecordRevision: 0,
    recentEventIds: [],
    reconciledOutcomes: [],
  };
}

export function reduceRunProjection(
  projection: RunProjection,
  envelope: ExecutionEventEnvelope,
): RunProjection {
  if (projection.recentEventIds.includes(envelope.eventId)
    || !belongsToRun(envelope, projection.runId)) {
    return projection;
  }
  const recordIsAuthoritative = projection.lastRecordRevision > 0
    && envelope.sequence <= projection.lastSequence;
  if ((!recordIsAuthoritative && envelope.sequence <= projection.lastEnvelopeSequence)
    || (projection.terminal && !recordIsAuthoritative)) {
    return projection;
  }
  const base = {
    ...projection,
    lastSequence: Math.max(projection.lastSequence, envelope.sequence),
    lastEnvelopeSequence: Math.max(projection.lastEnvelopeSequence, envelope.sequence),
    recentEventIds: rememberEventId(projection.recentEventIds, envelope.eventId),
  };
  if (recordIsAuthoritative) {
    return reduceEnvelopeDetails(base, envelope);
  }
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

export function applyRunRecord(
  projection: RunProjection,
  record: Readonly<ExecutionRunRecord>,
  revision: number,
): RunProjection {
  if (record.runId !== projection.runId || revision <= projection.lastRecordRevision) {
    return projection;
  }
  const terminal = projection.terminal ?? record.terminal;
  const next: RunProjection = {
    ...projection,
    state: terminal?.kind ?? record.state,
    lastSequence: Math.max(projection.lastSequence, record.lastSequence),
    lastRecordRevision: revision,
    interactionIds: [...record.openInteractionIds],
    result: record.resultRef ?? projection.result,
    terminal,
  };
  return sameRunProjectionState(projection, next) ? projection : next;
}

function belongsToRun(envelope: ExecutionEventEnvelope, runId: RunId): boolean {
  return envelope.scope.kind === 'session' || envelope.scope.runId === runId;
}

function reduceEnvelopeDetails(
  projection: RunProjection,
  envelope: ExecutionEventEnvelope,
): RunProjection {
  switch (envelope.event.kind) {
    case 'thinking-activity':
      return projection.sawThinking ? projection : { ...projection, sawThinking: true };
    case 'tool-activity':
      return {
        ...projection,
        toolCallIds: appendUnique(projection.toolCallIds, envelope.event.toolCallId),
      };
    case 'progress':
      return {
        ...projection,
        progressIds: appendUnique(projection.progressIds, envelope.event.progressId),
      };
    case 'native-agent-observed':
    case 'native-agent-result':
    case 'native-agent-activity':
    case 'native-agent-status':
      return {
        ...projection,
        nativeAgentKeys: appendUnique(
          projection.nativeAgentKeys,
          envelope.event.nativeAgentKey,
        ),
      };
    case 'run-started':
    case 'result':
    case 'interaction-opened':
    case 'interaction-resolved':
    case 'connection-lost':
    case 'recovery-started':
    case 'recovered':
    case 'cancellation-acknowledged':
    case 'terminal':
      return projection;
  }
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

function sameRunProjectionState(left: RunProjection, right: RunProjection): boolean {
  return left.state === right.state
    && left.lastSequence === right.lastSequence
    && left.lastRecordRevision === right.lastRecordRevision
    && sameResultRef(left.result, right.result)
    && sameTerminal(left.terminal, right.terminal)
    && equalStrings(left.interactionIds, right.interactionIds);
}

function sameResultRef(left: ResultRef | undefined, right: ResultRef | undefined): boolean {
  return left?.resultId === right?.resultId
    && left?.storage === right?.storage
    && left?.digest === right?.digest;
}

function sameTerminal(left: RunTerminal | undefined, right: RunTerminal | undefined): boolean {
  return left?.kind === right?.kind
    && left?.reason === right?.reason
    && left?.occurredAt === right?.occurredAt
    && sameResultRef(left?.resultRef, right?.resultRef);
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
