import type { ExecutionOwner, RunState, RunTerminal } from '../../../core/execution/ExecutionContracts';
import type {
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
} from '../../../core/execution/ExecutionControlRecords';
import type { ExecutionSessionId, RunId } from '../../../core/execution/ExecutionIds';
import type { ReconciledOutcomeProjection } from '../../../core/execution/RunProjection';

export interface LocalShellOutputEntry {
  readonly sequence: number;
  readonly channel: 'stdout' | 'stderr';
  readonly text: string;
}

export interface LocalShellProjection {
  readonly operationId: string;
  readonly owner: ExecutionOwner;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
  readonly displayLabel: string;
  readonly state: RunState;
  readonly runRevision: number;
  readonly outputHistory: 'complete' | 'partial-after-restart';
  readonly output: readonly LocalShellOutputEntry[];
  readonly outputBytes: number;
  readonly outputLimitReached: boolean;
  readonly terminal?: RunTerminal;
  readonly reconciledOutcomes: readonly ReconciledOutcomeProjection[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type LocalShellProjectionEvent =
  | {
    readonly kind: 'output';
    readonly channel: LocalShellOutputEntry['channel'];
    readonly text: string;
    readonly byteLength: number;
    readonly updatedAt: number;
  }
  | { readonly kind: 'reconciliation'; readonly record: ExecutionReconciliationRecord }
  | { readonly kind: 'output-limit'; readonly updatedAt: number }
  | {
    readonly kind: 'run-record';
    readonly record: Readonly<ExecutionRunRecord>;
    readonly revision: number;
  };

export function createLocalShellProjection(input: {
  readonly operationId: string;
  readonly owner: ExecutionOwner;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
  readonly displayLabel: string;
  readonly outputHistory: LocalShellProjection['outputHistory'];
  readonly createdAt: number;
}): LocalShellProjection {
  return {
    ...input,
    state: 'queued',
    runRevision: 0,
    output: [],
    outputBytes: 0,
    outputLimitReached: false,
    reconciledOutcomes: [],
    updatedAt: input.createdAt,
  };
}

export function reduceLocalShellProjection(
  projection: LocalShellProjection,
  event: LocalShellProjectionEvent,
): LocalShellProjection {
  if (event.kind === 'output') {
    if (projection.terminal) return projection;
    return {
      ...projection,
      output: event.text.length === 0
        ? projection.output
        : [...projection.output, {
          sequence: projection.output.length + 1,
          channel: event.channel,
          text: event.text,
        }],
      outputBytes: projection.outputBytes + event.byteLength,
      updatedAt: Math.max(projection.updatedAt, event.updatedAt),
    };
  }
  if (event.kind === 'output-limit') {
    if (projection.outputLimitReached) return projection;
    return {
      ...projection,
      outputLimitReached: true,
      updatedAt: Math.max(projection.updatedAt, event.updatedAt),
    };
  }
  if (event.kind === 'reconciliation') {
    if (event.record.runId !== projection.runId
      || projection.terminal?.kind !== 'indeterminate'
      || projection.reconciledOutcomes.some(outcome => (
        outcome.reconciliationId === event.record.reconciliationId
      ))) {
      return projection;
    }
    return {
      ...projection,
      reconciledOutcomes: [...projection.reconciledOutcomes, {
        reconciliationId: event.record.reconciliationId,
        observedOutcome: event.record.observedOutcome,
        ...(event.record.observedResult
          ? { observedResult: event.record.observedResult }
          : {}),
        evidence: event.record.evidence,
        recordedAt: event.record.recordedAt,
      }],
      updatedAt: Math.max(projection.updatedAt, event.record.recordedAt),
    };
  }
  if (event.record.runId !== projection.runId || event.revision <= projection.runRevision) {
    return projection;
  }
  const terminal = projection.terminal ?? event.record.terminal;
  return {
    ...projection,
    state: terminal?.kind ?? event.record.state,
    runRevision: event.revision,
    ...(terminal ? { terminal } : {}),
    updatedAt: Math.max(projection.updatedAt, event.record.updatedAt),
  };
}
