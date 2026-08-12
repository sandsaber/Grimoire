import type {
  ExecutionOwner,
  ResultExpectation,
  ResultRef,
  RunState,
  RunTerminal,
} from '../../../core/execution/ExecutionContracts';
import type {
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
} from '../../../core/execution/ExecutionControlRecords';
import type { ExecutionSessionId, RunId } from '../../../core/execution/ExecutionIds';
import type { ReconciledOutcomeProjection } from '../../../core/execution/RunProjection';

export type AuxiliaryOperationKind =
  | 'title'
  | 'refine'
  | 'inline-edit'
  | 'command-probe'
  | 'model-probe'
  | 'warm-up'
  | 'other';

const AUXILIARY_OWNER_PREFIX = 'aux.';

export interface AuxiliaryOperationProjection {
  readonly operationId: string;
  readonly owner: ExecutionOwner;
  readonly kind: AuxiliaryOperationKind;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
  readonly resultExpectation: ResultExpectation;
  readonly state: RunState;
  readonly runRevision: number;
  readonly result?: ResultRef;
  readonly terminal?: RunTerminal;
  readonly reconciledOutcomes: readonly ReconciledOutcomeProjection[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function createAuxiliaryOperationProjection(input: {
  readonly operationId: string;
  readonly kind: AuxiliaryOperationKind;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
  readonly resultExpectation: ResultExpectation;
  readonly createdAt: number;
}): AuxiliaryOperationProjection {
  return {
    ...input,
    owner: auxiliaryOperationOwner(input.kind, input.operationId),
    state: 'queued',
    runRevision: 0,
    reconciledOutcomes: [],
    updatedAt: input.createdAt,
  };
}

export function applyAuxiliaryReconciliation(
  projection: AuxiliaryOperationProjection,
  record: Readonly<ExecutionReconciliationRecord>,
): AuxiliaryOperationProjection {
  if (record.runId !== projection.runId
    || projection.terminal?.kind !== 'indeterminate'
    || projection.reconciledOutcomes.some(outcome => (
      outcome.reconciliationId === record.reconciliationId
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
    updatedAt: Math.max(projection.updatedAt, record.recordedAt),
  };
}

export function applyAuxiliaryRunRecord(
  projection: AuxiliaryOperationProjection,
  record: Readonly<ExecutionRunRecord>,
  revision: number,
): AuxiliaryOperationProjection {
  if (record.runId !== projection.runId
    || record.owner.kind !== 'auxiliary-operation'
    || record.owner.ownerId !== projection.owner.ownerId
    || revision <= projection.runRevision) {
    return projection;
  }
  const terminal = projection.terminal ?? record.terminal;
  return {
    ...projection,
    state: terminal?.kind ?? record.state,
    runRevision: revision,
    ...(record.resultRef ? { result: record.resultRef } : {}),
    ...(terminal ? { terminal } : {}),
    updatedAt: Math.max(projection.updatedAt, record.updatedAt),
  };
}

export function auxiliaryOperationOwner(
  kind: AuxiliaryOperationKind,
  operationId: string,
): ExecutionOwner {
  const ownerId = `${AUXILIARY_OWNER_PREFIX}${kind}:${operationId}`;
  if (ownerId.length > 128) {
    throw new Error('Auxiliary operation identity exceeds the durable owner limit.');
  }
  return { kind: 'auxiliary-operation', ownerId };
}

export function parseAuxiliaryOperationOwner(owner: ExecutionOwner): {
  readonly kind: AuxiliaryOperationKind;
  readonly operationId: string;
} | null {
  if (owner.kind !== 'auxiliary-operation'
    || !owner.ownerId.startsWith(AUXILIARY_OWNER_PREFIX)) {
    return null;
  }
  const separator = owner.ownerId.indexOf(':', AUXILIARY_OWNER_PREFIX.length);
  if (separator < 0) return null;
  const kind = owner.ownerId.slice(AUXILIARY_OWNER_PREFIX.length, separator);
  const operationId = owner.ownerId.slice(separator + 1);
  if (!isAuxiliaryOperationKind(kind) || operationId.length === 0) return null;
  return { kind, operationId };
}

function isAuxiliaryOperationKind(value: string): value is AuxiliaryOperationKind {
  return value === 'title'
    || value === 'refine'
    || value === 'inline-edit'
    || value === 'command-probe'
    || value === 'model-probe'
    || value === 'warm-up'
    || value === 'other';
}
