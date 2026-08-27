import type { DurableStorage } from '../persistence/DurableStorage';
import {
  type TransactionCrashPoint,
  TransactionIntentCoordinator,
  type TransactionStepHandler,
} from '../persistence/TransactionIntentCoordinator';
import type { VersionedRecordReadResult } from '../persistence/VersionedRecord';
import { AGENT_TRANSACTIONS_PATH } from './AgentControlPaths';
import type { AgentRepositories, MutableAgentRepository } from './AgentRepositories';
import {
  agentDispatchIntentRecordSchema,
  agentInstanceRecordSchema,
  agentRunRecordSchema,
} from './AgentSchemas';

export type AgentControlRepositoryKind = 'instances' | 'runs' | 'dispatch-intents';

export interface AgentControlWrite {
  readonly repository: AgentControlRepositoryKind;
  readonly recordId: string;
  readonly expectedRevision: number | null;
  readonly record: Readonly<Record<string, unknown>>;
}

export interface AgentControlTransactionCoordinatorOptions {
  readonly now?: () => number;
  readonly crashInjector?: (point: TransactionCrashPoint) => void;
}

export class AgentControlTransactionCoordinator {
  private readonly transactions: TransactionIntentCoordinator;

  constructor(
    storage: DurableStorage,
    repositories: AgentRepositories,
    options: AgentControlTransactionCoordinatorOptions = {},
  ) {
    this.transactions = new TransactionIntentCoordinator(storage, {
      namespace: AGENT_TRANSACTIONS_PATH,
      kinds: ['agent-control-write'],
      handlers: [createWriteHandler(repositories)],
      now: options.now,
      crashInjector: options.crashInjector,
    });
  }

  execute(transactionId: string, writes: readonly AgentControlWrite[]): Promise<void> {
    return this.transactions.execute({
      transactionId,
      kind: 'agent-control-write',
      steps: writes.map((write, index) => ({
        id: `step-${index}`,
        handlerId: 'agent-record-put',
        input: { ...write },
      })),
    }).then(() => undefined);
  }

  recoverPending(): Promise<void> {
    return this.transactions.recoverPending().then(() => undefined);
  }
}

function createWriteHandler(repositories: AgentRepositories): TransactionStepHandler {
  return {
    handlerId: 'agent-record-put',
    validate(input) {
      const write = decodeWrite(input);
      return { ...write };
    },
    async apply(input) {
      const write = decodeWrite(input);
      if (write.repository === 'instances') {
        await applyWrite(
          repositories.instances,
          write,
          agentInstanceRecordSchema.decode(write.record),
        );
      } else if (write.repository === 'runs') {
        await applyWrite(repositories.runs, write, agentRunRecordSchema.decode(write.record));
      } else {
        await applyWrite(
          repositories.dispatchIntents,
          write,
          agentDispatchIntentRecordSchema.decode(write.record),
        );
      }
    },
  };
}

function decodeWrite(input: unknown): AgentControlWrite {
  const record = exactRecord(input, ['repository', 'recordId', 'expectedRevision', 'record'], 'agent control write');
  if (record.repository !== 'instances'
    && record.repository !== 'runs'
    && record.repository !== 'dispatch-intents') {
    throw new Error('Agent control repository kind is invalid.');
  }
  const recordId = requireIdentifier(record.recordId, 'agent record id');
  if (record.expectedRevision !== null
    && (!Number.isSafeInteger(record.expectedRevision) || (record.expectedRevision as number) < 1)) {
    throw new Error('Expected agent revision must be null or a positive safe integer.');
  }
  const payload = record.repository === 'instances'
    ? agentInstanceRecordSchema.decode(record.record)
    : record.repository === 'runs'
      ? agentRunRecordSchema.decode(record.record)
      : agentDispatchIntentRecordSchema.decode(record.record);
  return {
    repository: record.repository,
    recordId,
    expectedRevision: record.expectedRevision as number | null,
    record: payload as unknown as Readonly<Record<string, unknown>>,
  };
}

async function applyWrite<TRecord>(
  repository: MutableAgentRepository<TRecord>,
  write: AgentControlWrite,
  desired: TRecord,
): Promise<void> {
  const current = await repository.read(write.recordId);
  if (isIdempotentReplay(current, write.expectedRevision, desired)) return;
  if (write.expectedRevision === null) {
    await repository.create(write.recordId, desired);
  } else {
    await repository.update(write.recordId, write.expectedRevision, () => desired);
  }
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

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  const expected = new Set(keys);
  if (Object.keys(record).length !== expected.size
    || Object.keys(record).some(key => !expected.has(key))) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
  return record;
}

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a constrained identifier.`);
  }
  return value;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}
