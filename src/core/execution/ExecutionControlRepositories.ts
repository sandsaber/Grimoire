import { validateControlRecordPayload } from '../persistence/ControlRecordPayloadPolicy';
import type { DurableStorage } from '../persistence/DurableStorage';
import type {
  RecordSchema,
  VersionedRecord,
  VersionedRecordReadResult,
} from '../persistence/VersionedRecord';
import { VersionedRepository } from '../persistence/VersionedRepository';
import {
  EXECUTION_INTERACTIONS_PATH,
  EXECUTION_RECONCILIATIONS_PATH,
  EXECUTION_RUNS_PATH,
  EXECUTION_SESSIONS_PATH,
  SETTINGS_TRANSITIONS_PATH,
  SHUTDOWN_CHECKPOINTS_PATH,
} from './ExecutionControlPaths';
import type {
  ExecutionInteractionRecord,
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
  SettingsTransitionRecord,
  ShutdownCheckpointRecord,
} from './ExecutionControlRecords';
import {
  executionInteractionRecordSchema,
  executionReconciliationRecordSchema,
  executionRunRecordSchema,
  executionSessionRecordSchema,
  settingsTransitionRecordSchema,
  shutdownCheckpointRecordSchema,
} from './ExecutionControlSchemas';

interface ControlRepositoryOptions<TRecord> {
  readonly storage: DurableStorage;
  readonly namespace: string;
  readonly schema: RecordSchema<TRecord>;
  readonly now?: () => number;
}

export class RevisionedControlRepository<TRecord> {
  private readonly records: VersionedRepository<TRecord>;

  constructor(options: ControlRepositoryOptions<TRecord>) {
    this.records = new VersionedRepository({
      ...options,
      validatePayload: validateControlRecordPayload,
    });
  }

  read(recordId: string): Promise<VersionedRecordReadResult<TRecord>> {
    return this.records.read(recordId);
  }

  listRecordIds(): Promise<string[]> {
    return this.records.listRecordIds();
  }

  create(recordId: string, record: TRecord): Promise<VersionedRecord<TRecord>> {
    return this.records.save(recordId, record, null);
  }

  update(
    recordId: string,
    expectedRevision: number,
    mutation: (record: TRecord) => TRecord,
  ): Promise<VersionedRecord<TRecord>> {
    return this.records.mutate(recordId, expectedRevision, mutation);
  }
}

export class AppendOnlyControlRepository<TRecord> {
  private readonly records: VersionedRepository<TRecord>;

  constructor(options: ControlRepositoryOptions<TRecord>) {
    this.records = new VersionedRepository({
      ...options,
      validatePayload: validateControlRecordPayload,
    });
  }

  read(recordId: string): Promise<VersionedRecordReadResult<TRecord>> {
    return this.records.read(recordId);
  }

  listRecordIds(): Promise<string[]> {
    return this.records.listRecordIds();
  }

  append(recordId: string, record: TRecord): Promise<VersionedRecord<TRecord>> {
    return this.records.save(recordId, record, null);
  }
}

export class ExecutionControlRepositories {
  readonly sessions: RevisionedControlRepository<ExecutionSessionRecord>;
  readonly runs: RevisionedControlRepository<ExecutionRunRecord>;
  readonly interactions: RevisionedControlRepository<ExecutionInteractionRecord>;
  readonly reconciliations: AppendOnlyControlRepository<ExecutionReconciliationRecord>;
  readonly settingsTransitions: RevisionedControlRepository<SettingsTransitionRecord>;
  readonly shutdownCheckpoints: RevisionedControlRepository<ShutdownCheckpointRecord>;

  constructor(storage: DurableStorage, now?: () => number) {
    this.sessions = new RevisionedControlRepository({
      storage,
      namespace: EXECUTION_SESSIONS_PATH,
      schema: executionSessionRecordSchema,
      now,
    });
    this.runs = new RevisionedControlRepository({
      storage,
      namespace: EXECUTION_RUNS_PATH,
      schema: executionRunRecordSchema,
      now,
    });
    this.interactions = new RevisionedControlRepository({
      storage,
      namespace: EXECUTION_INTERACTIONS_PATH,
      schema: executionInteractionRecordSchema,
      now,
    });
    this.reconciliations = new AppendOnlyControlRepository({
      storage,
      namespace: EXECUTION_RECONCILIATIONS_PATH,
      schema: executionReconciliationRecordSchema,
      now,
    });
    this.settingsTransitions = new RevisionedControlRepository({
      storage,
      namespace: SETTINGS_TRANSITIONS_PATH,
      schema: settingsTransitionRecordSchema,
      now,
    });
    this.shutdownCheckpoints = new RevisionedControlRepository({
      storage,
      namespace: SHUTDOWN_CHECKPOINTS_PATH,
      schema: shutdownCheckpointRecordSchema,
      now,
    });
  }
}
