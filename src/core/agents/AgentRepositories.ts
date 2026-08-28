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
  AGENT_DISPATCH_INTENTS_PATH,
  AGENT_INSTANCES_PATH,
  AGENT_RESULTS_PATH,
  AGENT_RUNS_PATH,
} from './AgentControlPaths';
import {
  agentDispatchIntentRecordSchema,
  agentInstanceRecordSchema,
  agentResultRecordSchema,
  agentRunRecordSchema,
} from './AgentSchemas';

/** What a write says about itself: the record's id, and what it now holds. */
export type AgentRecordChangeListener<TRecord>
  = (recordId: string, record: TRecord | undefined) => void;

export class MutableAgentRepository<TRecord> {
  private readonly changeListeners = new Set<AgentRecordChangeListener<TRecord>>();

  constructor(private readonly records: VersionedRepository<TRecord>) {}

  /**
   * Says which record changed, after it has changed, **and what it changed to**.
   *
   * **The point is that it cannot be bypassed.** Agent records are written from
   * two directions — the coordinator writing one directly, and the transaction
   * coordinator applying a batch — and both reach the store through the three
   * mutating methods below. A reader that caches records can update from here
   * and be right by construction, rather than by every write path remembering
   * to say so.
   *
   * The new record is carried rather than left to be re-read, because a reader
   * that only learns *that* something changed has to go and look, and the window
   * between the write and that look is one where it can only answer "I do not
   * know yet". Carrying the record closes the window: the write itself brings
   * the reader up to date. `undefined` means the record is gone.
   */
  onChanged(listener: AgentRecordChangeListener<TRecord>): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  read(recordId: string): Promise<VersionedRecordReadResult<TRecord>> {
    return this.records.read(recordId);
  }

  listRecordIds(): Promise<string[]> {
    return this.records.listRecordIds();
  }

  async create(recordId: string, record: TRecord): Promise<VersionedRecord<TRecord>> {
    const saved = await this.records.save(recordId, record, null);
    this.announce(recordId, saved.payload);
    return saved;
  }

  /**
   * Removes a record if it is there, and says nothing if it is not.
   *
   * Written for deletion by owner, which is replayable by design: a deletion
   * interrupted half-way is finished at the next start, against records some of
   * which are already gone.
   */
  async removeIfPresent(recordId: string): Promise<void> {
    await this.records.removeIfPresent(recordId);
    this.announce(recordId, undefined);
  }

  async update(
    recordId: string,
    expectedRevision: number,
    mutation: (record: TRecord) => TRecord,
  ): Promise<VersionedRecord<TRecord>> {
    const updated = await this.records.mutate(recordId, expectedRevision, mutation);
    this.announce(recordId, updated.payload);
    return updated;
  }

  /**
   * Announced after the write, never before.
   *
   * A listener told early would evict a cache and refill it from the record the
   * write is about to replace, which is worse than not caching at all. A
   * throwing write announces nothing, because nothing changed.
   */
  private announce(recordId: string, record: TRecord | undefined): void {
    for (const listener of this.changeListeners) {
      listener(recordId, record);
    }
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

  /**
   * Removes a record if it is there.
   *
   * **Append-only is a rule about writing, not about a conversation's
   * lifetime.** D3 keeps a result until its owning conversation is deleted, and
   * D4 deletes every record that conversation owns; a store that could not be
   * emptied would make the second impossible to honour.
   */
  removeIfPresent(recordId: string): Promise<void> {
    return this.records.removeIfPresent(recordId);
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
      // **The one store that holds model text, and it was the one without the
      // guard.** A result's own text is whitelisted — that is what a result is
      // — but `.grimoire/control/**` still holds no prompt, no hidden
      // reasoning, no raw payload and no secret, and a result carrying one of
      // those is exactly how such a thing would arrive there.
      validatePayload: validateControlRecordPayload,
    }));
  }
}
