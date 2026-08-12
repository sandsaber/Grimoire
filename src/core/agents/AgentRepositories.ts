import {
  AGENT_DISPATCH_INTENTS_PATH,
  AGENT_INSTANCES_PATH,
  AGENT_RESULTS_PATH,
  AGENT_RUNS_PATH,
} from '../bootstrap/StoragePaths';
import { validateControlRecordPayload } from '../persistence/ControlRecordPayloadPolicy';
import type { DurableStorage } from '../persistence/DurableStorage';
import type { VersionedRecord, VersionedRecordReadResult } from '../persistence/VersionedRecord';
import { VersionedRepository } from '../persistence/VersionedRepository';
import type {
  AgentDispatchIntentRecord,
  AgentInstanceRecord,
  AgentResultRecord,
  AgentRunRecord,
} from './AgentContracts';
import {
  agentDispatchIntentRecordSchema,
  agentInstanceRecordSchema,
  agentResultRecordSchema,
  agentRunRecordSchema,
} from './AgentSchemas';

export class MutableAgentRepository<TRecord> {
  constructor(private readonly records: VersionedRepository<TRecord>) {}

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

export class AppendOnlyAgentRepository<TRecord> {
  constructor(private readonly records: VersionedRepository<TRecord>) {}

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

export class AgentRepositories {
  readonly instances: MutableAgentRepository<AgentInstanceRecord>;
  readonly runs: MutableAgentRepository<AgentRunRecord>;
  readonly dispatchIntents: MutableAgentRepository<AgentDispatchIntentRecord>;
  readonly results: AppendOnlyAgentRepository<AgentResultRecord>;

  constructor(storage: DurableStorage, now?: () => number) {
    this.instances = new MutableAgentRepository(new VersionedRepository({
      storage,
      namespace: AGENT_INSTANCES_PATH,
      schema: agentInstanceRecordSchema,
      now,
      validatePayload: validateControlRecordPayload,
    }));
    this.runs = new MutableAgentRepository(new VersionedRepository({
      storage,
      namespace: AGENT_RUNS_PATH,
      schema: agentRunRecordSchema,
      now,
      validatePayload: validateControlRecordPayload,
    }));
    this.dispatchIntents = new MutableAgentRepository(new VersionedRepository({
      storage,
      namespace: AGENT_DISPATCH_INTENTS_PATH,
      schema: agentDispatchIntentRecordSchema,
      now,
      validatePayload: validateControlRecordPayload,
    }));
    this.results = new AppendOnlyAgentRepository(new VersionedRepository({
      storage,
      namespace: AGENT_RESULTS_PATH,
      schema: agentResultRecordSchema,
      now,
    }));
  }
}
