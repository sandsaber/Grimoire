import { CONVERSATION_RECORDS_PATH } from '../bootstrap/StoragePaths';
import type { Conversation, SessionMetadata } from '../types';
import type { ProviderId } from '../types/provider';
import type { DurableStorage } from './DurableStorage';
import type {
  RecordSchema,
  VersionedRecord,
  VersionedRecordReadResult,
} from './VersionedRecord';
import {
  RevisionConflictError,
  VersionedRepository,
} from './VersionedRepository';

export interface ConversationRepositoryOptions {
  readonly namespace?: string;
  readonly now?: () => number;
}

const conversationSchema: RecordSchema<Conversation> = {
  currentVersion: 1,
  decode(payload) {
    if (!isRecord(payload)
      || typeof payload.id !== 'string'
      || typeof payload.providerId !== 'string'
      || typeof payload.title !== 'string'
      || typeof payload.createdAt !== 'number'
      || typeof payload.updatedAt !== 'number'
      || (payload.sessionId !== null && typeof payload.sessionId !== 'string')
      || !Array.isArray(payload.messages)
      || (payload.providerState !== undefined && !isRecord(payload.providerState))
      || (payload.executionCompletions !== undefined
        && !isExecutionCompletions(payload.executionCompletions))) {
      throw new Error('Invalid conversation payload.');
    }
    return payload as unknown as Conversation;
  },
};

export class ConversationRepository {
  private readonly records: VersionedRepository<Conversation>;

  constructor(storage: DurableStorage, options: ConversationRepositoryOptions = {}) {
    this.records = new VersionedRepository({
      storage,
      namespace: options.namespace ?? CONVERSATION_RECORDS_PATH,
      schema: conversationSchema,
      now: options.now,
    });
  }

  read(conversationId: string): Promise<VersionedRecordReadResult<Conversation>> {
    return this.records.read(conversationId);
  }

  create(conversation: Conversation): Promise<VersionedRecord<Conversation>> {
    return this.records.save(conversation.id, conversation, null);
  }

  async importLegacyMetadata(
    metadata: SessionMetadata,
    fallbackProviderId: ProviderId,
  ): Promise<VersionedRecord<Conversation>> {
    const conversation = normalizePersistedConversation(
      conversationFromSessionMetadata(metadata, fallbackProviderId),
    );
    const existing = await this.read(conversation.id);
    if (existing.kind !== 'absent') {
      return resolveExistingImport(existing, conversation);
    }

    try {
      return await this.create(conversation);
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) {
        throw error;
      }
      return resolveExistingImport(await this.read(conversation.id), conversation);
    }
  }

  update(
    conversationId: string,
    expectedRevision: number,
    mutation: (conversation: Conversation) => Conversation,
  ): Promise<VersionedRecord<Conversation>> {
    return this.records.mutate(conversationId, expectedRevision, current => {
      const providerId = current.providerId;
      const next = mutation(current);
      if (next.id !== conversationId) {
        throw new Error('Conversation id is immutable.');
      }
      if (next.providerId !== providerId) {
        throw new Error('Conversation provider binding is immutable.');
      }
      return next;
    });
  }

  remove(conversationId: string, expectedRevision: number): Promise<void> {
    return this.records.remove(conversationId, expectedRevision);
  }
}

export function conversationFromSessionMetadata(
  metadata: SessionMetadata,
  fallbackProviderId: ProviderId,
): Conversation {
  const { providerId, ...legacy } = metadata;
  return {
    ...legacy,
    providerId: providerId ?? fallbackProviderId,
    sessionId: metadata.sessionId ?? null,
    messages: metadata.messages ?? [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExecutionCompletions(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const runIds = new Set<string>();
  return value.every(candidate => {
    if (!isRecord(candidate)
      || typeof candidate.runId !== 'string'
      || candidate.runId.length === 0
      || !isTerminalKind(candidate.terminalKind)
      || typeof candidate.completedAt !== 'number'
      || !Number.isFinite(candidate.completedAt)
      || (candidate.assistantMessageId !== undefined
        && typeof candidate.assistantMessageId !== 'string')
      || runIds.has(candidate.runId)) {
      return false;
    }
    runIds.add(candidate.runId);
    return true;
  });
}

function isTerminalKind(value: unknown): boolean {
  return value === 'succeeded'
    || value === 'failed'
    || value === 'cancelled'
    || value === 'interrupted'
    || value === 'invalidated'
    || value === 'indeterminate';
}

function resolveExistingImport(
  existing: VersionedRecordReadResult<Conversation>,
  conversation: Conversation,
): VersionedRecord<Conversation> {
  if (existing.kind === 'current' || existing.kind === 'migrated') {
    if (stableSerialize(existing.record.payload) === stableSerialize(conversation)) {
      return existing.record;
    }
    throw new Error(
      `Legacy conversation "${conversation.id}" conflicts with the durable record.`,
    );
  }
  if (existing.kind === 'future') {
    throw new Error(
      `Legacy conversation "${conversation.id}" uses future schema version ${existing.schemaVersion}.`,
    );
  }
  if (existing.kind === 'corrupt') {
    throw new Error(
      `Legacy conversation "${conversation.id}" is corrupt: ${existing.error}`,
    );
  }
  throw new RevisionConflictError(conversation.id, null, null);
}

function normalizePersistedConversation(conversation: Conversation): Conversation {
  return JSON.parse(JSON.stringify(conversation)) as Conversation;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}
