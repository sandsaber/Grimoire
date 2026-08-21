import type { DurableStorage } from '../persistence/DurableStorage';
import {
  type TransactionCrashPoint,
  TransactionIntentCoordinator,
  type TransactionStepHandler,
} from '../persistence/TransactionIntentCoordinator';
import type { VersionedRecordReadResult } from '../persistence/VersionedRecord';
import type {
  ExecutionInteractionRecord,
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
  SettingsTransitionRecord,
  ShutdownCheckpointRecord,
} from './ExecutionControlRecords';
import type {
  AppendOnlyControlRepository,
  ExecutionControlRepositories,
  RevisionedControlRepository,
} from './ExecutionControlRepositories';
import {
  executionInteractionRecordSchema,
  executionReconciliationRecordSchema,
  executionRunRecordSchema,
  executionSessionRecordSchema,
  settingsTransitionRecordSchema,
  shutdownCheckpointRecordSchema,
} from './ExecutionControlSchemas';

export type ExecutionControlRepositoryKind =
  | 'sessions'
  | 'runs'
  | 'interactions'
  | 'reconciliations'
  | 'settings-transitions'
  | 'shutdown-checkpoints';

export interface ExecutionControlRemoval {
  readonly repository: ExecutionControlRepositoryKind;
  readonly recordId: string;
}

export interface ExecutionControlWrite {
  readonly repository: ExecutionControlRepositoryKind;
  readonly recordId: string;
  readonly expectedRevision: number | null;
  readonly record: Readonly<Record<string, unknown>>;
}

export interface ExecutionControlTransactionCoordinatorOptions {
  readonly now?: () => number;
  readonly crashInjector?: (point: TransactionCrashPoint) => void;
}

export class ExecutionControlTransactionCoordinator {
  private readonly transactions: TransactionIntentCoordinator;

  constructor(
    storage: DurableStorage,
    repositories: ExecutionControlRepositories,
    options: ExecutionControlTransactionCoordinatorOptions = {},
  ) {
    this.transactions = new TransactionIntentCoordinator(storage, {
      kinds: ['execution-control-write', 'execution-control-delete'],
      handlers: [
        createControlWriteHandler(repositories),
        createControlRemoveHandler(repositories),
      ],
      now: options.now,
      crashInjector: options.crashInjector,
    });
  }

  execute(transactionId: string, writes: readonly ExecutionControlWrite[]): Promise<void> {
    return this.transactions.execute({
      transactionId,
      kind: 'execution-control-write',
      steps: writes.map((write, index) => ({
        id: `step-${index}`,
        handlerId: 'execution-record-put',
        input: { ...write },
      })),
    }).then(() => undefined);
  }

  /**
   * Removes records in one intent-backed operation (D4).
   *
   * The same machinery a write uses, for the same reason: a deletion that is
   * interrupted half-way must be finished at the next start rather than left
   * with a session gone and its runs still on disk. Each step is written to be
   * replayable, because recovery runs the ones it cannot prove were applied.
   */
  delete(transactionId: string, removals: readonly ExecutionControlRemoval[]): Promise<void> {
    return this.transactions.execute({
      transactionId,
      kind: 'execution-control-delete',
      steps: removals.map((removal, index) => ({
        id: `step-${index}`,
        handlerId: 'execution-record-remove',
        input: { ...removal },
      })),
    }).then(() => undefined);
  }

  recoverPending(): Promise<void> {
    return this.transactions.recoverPending().then(() => undefined);
  }
}

function createControlWriteHandler(
  repositories: ExecutionControlRepositories,
): TransactionStepHandler {
  return {
    handlerId: 'execution-record-put',
    validate(input) {
      const write = decodeWrite(input);
      return {
        repository: write.repository,
        recordId: write.recordId,
        expectedRevision: write.expectedRevision,
        record: write.record,
      };
    },
    async apply(input) {
      await applyWrite(repositories, decodeWrite(input));
    },
  };
}

function createControlRemoveHandler(
  repositories: ExecutionControlRepositories,
): TransactionStepHandler {
  return {
    handlerId: 'execution-record-remove',
    validate(input) {
      const removal = decodeRemoval(input);
      return { repository: removal.repository, recordId: removal.recordId };
    },
    async apply(input) {
      const removal = decodeRemoval(input);
      await repositoryFor(repositories, removal.repository).removeIfPresent(removal.recordId);
    },
  };
}

function decodeRemoval(input: unknown): ExecutionControlRemoval {
  const record = exactRecord(input, ['repository', 'recordId'], 'execution control removal');
  if (!isRepositoryKind(record.repository)) {
    throw new Error('Execution control repository kind is invalid.');
  }
  requireRecordId(record.recordId);
  return { repository: record.repository, recordId: record.recordId };
}

function repositoryFor(
  repositories: ExecutionControlRepositories,
  kind: ExecutionControlRepositoryKind,
): { removeIfPresent(recordId: string): Promise<void> } {
  switch (kind) {
    case 'sessions':
      return repositories.sessions;
    case 'runs':
      return repositories.runs;
    case 'interactions':
      return repositories.interactions;
    case 'reconciliations':
      return repositories.reconciliations;
    case 'settings-transitions':
      return repositories.settingsTransitions;
    case 'shutdown-checkpoints':
      return repositories.shutdownCheckpoints;
  }
}

function decodeWrite(input: unknown): ExecutionControlWrite {
  const record = exactRecord(input, [
    'repository',
    'recordId',
    'expectedRevision',
    'record',
  ], 'execution control write');
  if (!isRepositoryKind(record.repository)) {
    throw new Error('Execution control repository kind is invalid.');
  }
  requireRecordId(record.recordId);
  if (record.expectedRevision !== null
    && (!Number.isSafeInteger(record.expectedRevision) || (record.expectedRevision as number) < 1)) {
    throw new Error('Expected control revision must be null or a positive safe integer.');
  }
  return {
    repository: record.repository,
    recordId: record.recordId,
    expectedRevision: record.expectedRevision as number | null,
    record: decodeRecord(record.repository, record.record),
  };
}

function decodeRecord(
  repository: ExecutionControlRepositoryKind,
  record: unknown,
): Record<string, unknown> {
  switch (repository) {
    case 'sessions':
      return executionSessionRecordSchema.decode(record) as unknown as Record<string, unknown>;
    case 'runs':
      return executionRunRecordSchema.decode(record) as unknown as Record<string, unknown>;
    case 'interactions':
      return executionInteractionRecordSchema.decode(record) as unknown as Record<string, unknown>;
    case 'reconciliations':
      return executionReconciliationRecordSchema.decode(record) as unknown as Record<string, unknown>;
    case 'settings-transitions':
      return settingsTransitionRecordSchema.decode(record) as unknown as Record<string, unknown>;
    case 'shutdown-checkpoints':
      return shutdownCheckpointRecordSchema.decode(record) as unknown as Record<string, unknown>;
  }
}

async function applyWrite(
  repositories: ExecutionControlRepositories,
  write: ExecutionControlWrite,
): Promise<void> {
  switch (write.repository) {
    case 'sessions':
      return applyMutableWrite(
        repositories.sessions,
        write,
        executionSessionRecordSchema.decode(write.record),
      );
    case 'runs':
      return applyMutableWrite(
        repositories.runs,
        write,
        executionRunRecordSchema.decode(write.record),
      );
    case 'interactions':
      return applyMutableWrite(
        repositories.interactions,
        write,
        executionInteractionRecordSchema.decode(write.record),
      );
    case 'reconciliations':
      return applyAppendOnlyWrite(
        repositories.reconciliations,
        write,
        executionReconciliationRecordSchema.decode(write.record),
      );
    case 'settings-transitions':
      return applyMutableWrite(
        repositories.settingsTransitions,
        write,
        settingsTransitionRecordSchema.decode(write.record),
      );
    case 'shutdown-checkpoints':
      return applyMutableWrite(
        repositories.shutdownCheckpoints,
        write,
        shutdownCheckpointRecordSchema.decode(write.record),
      );
  }
}

async function applyMutableWrite<TRecord>(
  repository: RevisionedControlRepository<TRecord>,
  write: ExecutionControlWrite,
  desired: TRecord,
): Promise<void> {
  const current = await repository.read(write.recordId);
  if (isIdempotentReplay(current, write.expectedRevision, desired)) {
    return;
  }
  if (write.expectedRevision === null) {
    await repository.create(write.recordId, desired);
    return;
  }
  await repository.update(write.recordId, write.expectedRevision, () => desired);
}

async function applyAppendOnlyWrite<TRecord>(
  repository: AppendOnlyControlRepository<TRecord>,
  write: ExecutionControlWrite,
  desired: TRecord,
): Promise<void> {
  if (write.expectedRevision !== null) {
    throw new Error('Append-only control writes require a null expected revision.');
  }
  const current = await repository.read(write.recordId);
  if (isIdempotentReplay(current, null, desired)) {
    return;
  }
  await repository.append(write.recordId, desired);
}

function isIdempotentReplay<TRecord>(
  current: VersionedRecordReadResult<TRecord>,
  expectedRevision: number | null,
  desired: TRecord,
): boolean {
  return (current.kind === 'current' || current.kind === 'migrated')
    && current.record.revision === (expectedRevision ?? 0) + 1
    && stableSerialize(current.record.payload) === stableSerialize(desired);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  if (Object.keys(record).length !== allowed.size
    || Object.keys(record).some(key => !allowed.has(key))) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
  return record;
}

function requireRecordId(value: unknown): asserts value is string {
  if (typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('Control record id must be a constrained identifier.');
  }
}

function isRepositoryKind(value: unknown): value is ExecutionControlRepositoryKind {
  return value === 'sessions'
    || value === 'runs'
    || value === 'interactions'
    || value === 'reconciliations'
    || value === 'settings-transitions'
    || value === 'shutdown-checkpoints';
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

export type ExecutionControlRecord =
  | ExecutionSessionRecord
  | ExecutionRunRecord
  | ExecutionInteractionRecord
  | ExecutionReconciliationRecord
  | SettingsTransitionRecord
  | ShutdownCheckpointRecord;
