import { TRANSACTION_INTENTS_PATH } from '../execution/ExecutionControlPaths';
import { validateControlRecordPayload } from './ControlRecordPayloadPolicy';
import type { DurableStorage } from './DurableStorage';
import type { RecordSchema, VersionedRecord } from './VersionedRecord';
import { VersionedRepository } from './VersionedRepository';

export type TransactionCrashPoint =
  | 'before-intent'
  | 'after-intent'
  | `after-step-effect:${string}`
  | `before-step-checkpoint:${string}`
  | `after-step-checkpoint:${string}`
  | 'before-completion'
  | 'after-completion';

export interface TransactionStep {
  readonly id: string;
  readonly handlerId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface TransactionStepHandler {
  readonly handlerId: string;
  /** Validates an exact schema and returns the data-minimized canonical form. */
  validate(input: unknown): Readonly<Record<string, unknown>>;
  /** Must be idempotent because recovery may replay an uncheckpointed effect. */
  apply(input: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface TransactionOperation {
  readonly transactionId: string;
  readonly kind: string;
  readonly steps: readonly TransactionStep[];
}

export interface TransactionExecutionResult {
  readonly transactionId: string;
  readonly status: 'completed';
  readonly recovered: boolean;
}

interface PersistedTransactionStep {
  id: string;
  handlerId: string;
  input: Record<string, unknown>;
}

interface TransactionIntent {
  transactionId: string;
  kind: string;
  steps: PersistedTransactionStep[];
  completedStepIds: string[];
  status: 'pending' | 'completed';
  createdAt: number;
  updatedAt: number;
}

export interface TransactionIntentCoordinatorOptions {
  readonly namespace?: string;
  readonly now?: () => number;
  readonly kinds?: readonly string[];
  readonly handlers?: readonly TransactionStepHandler[];
  readonly crashInjector?: (point: TransactionCrashPoint) => void;
}

const transactionIntentSchema: RecordSchema<TransactionIntent> = {
  currentVersion: 1,
  decode(payload) {
    const record = requireExactRecord(payload, [
      'transactionId',
      'kind',
      'steps',
      'completedStepIds',
      'status',
      'createdAt',
      'updatedAt',
    ], 'transaction intent');
    requireTransactionId(record.transactionId);
    requireKind(record.kind);
    if (!Array.isArray(record.steps)) {
      throw new Error('Transaction intent steps must be an array.');
    }
    const steps = record.steps.map((step, index) => decodeStep(step, index));
    if (!isStringArray(record.completedStepIds)) {
      throw new Error('Transaction completedStepIds must be a string array.');
    }
    const stepIds = new Set(steps.map(step => step.id));
    const completedStepIds = [...record.completedStepIds];
    if (new Set(completedStepIds).size !== completedStepIds.length
      || completedStepIds.some(id => !stepIds.has(id))) {
      throw new Error('Transaction completedStepIds must be unique known step ids.');
    }
    if (record.status !== 'pending' && record.status !== 'completed') {
      throw new Error('Transaction intent status is invalid.');
    }
    if (record.status === 'completed' && completedStepIds.length !== steps.length) {
      throw new Error('Completed transaction must checkpoint every step.');
    }
    if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)
      || typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) {
      throw new Error('Transaction intent timestamps must be finite.');
    }
    return {
      transactionId: record.transactionId,
      kind: record.kind,
      steps,
      completedStepIds,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  },
};

export class TransactionIntentCoordinator {
  private readonly repository: VersionedRepository<TransactionIntent>;
  private readonly now: () => number;
  private readonly kinds = new Set<string>();
  private readonly handlers = new Map<string, TransactionStepHandler>();
  private readonly crashInjector?: (point: TransactionCrashPoint) => void;
  private readonly operationQueues = new Map<string, Promise<void>>();

  constructor(storage: DurableStorage, options: TransactionIntentCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.crashInjector = options.crashInjector;
    for (const kind of options.kinds ?? []) {
      requireKind(kind);
      if (this.kinds.has(kind)) {
        throw new Error(`Duplicate transaction kind "${kind}".`);
      }
      this.kinds.add(kind);
    }
    for (const handler of options.handlers ?? []) {
      requireSlug(handler.handlerId, 'Transaction handler id');
      if (this.handlers.has(handler.handlerId)) {
        throw new Error(`Duplicate transaction handler "${handler.handlerId}".`);
      }
      this.handlers.set(handler.handlerId, handler);
    }
    this.repository = new VersionedRepository({
      storage,
      namespace: options.namespace ?? TRANSACTION_INTENTS_PATH,
      schema: transactionIntentSchema,
      now: this.now,
      validatePayload: validateTransactionIntentForWrite,
    });
  }

  async execute(operation: TransactionOperation): Promise<TransactionExecutionResult> {
    const normalized = this.normalizeOperation(operation);
    return this.enqueue(normalized.transactionId, () => (
      this.executeUnlocked(normalized)
    ));
  }

  async recoverPending(): Promise<TransactionExecutionResult[]> {
    const results: TransactionExecutionResult[] = [];
    for (const transactionId of await this.repository.listRecordIds()) {
      const read = await this.repository.read(transactionId);
      if (read.kind === 'future') {
        throw new Error(
          `Transaction "${transactionId}" uses future schema version ${read.schemaVersion}.`,
        );
      }
      if (read.kind === 'corrupt') {
        throw new Error(`Transaction "${transactionId}" is corrupt: ${read.error}`);
      }
      if ((read.kind === 'current' || read.kind === 'migrated')
        && read.record.payload.status === 'pending') {
        this.requireRegisteredKind(read.record.payload.kind);
        results.push(await this.enqueue(transactionId, () => (
          this.resume(read.record, true)
        )));
      }
    }
    return results;
  }

  private async executeUnlocked(
    operation: TransactionOperation,
  ): Promise<TransactionExecutionResult> {
    const existing = await this.repository.read(operation.transactionId);
    let record: VersionedRecord<TransactionIntent>;
    const recovered = existing.kind !== 'absent';

    if (existing.kind === 'absent') {
      const timestamp = this.now();
      this.crashInjector?.('before-intent');
      record = await this.repository.save(operation.transactionId, {
        transactionId: operation.transactionId,
        kind: operation.kind,
        steps: operation.steps.map(step => ({
          id: step.id,
          handlerId: step.handlerId,
          input: { ...step.input },
        })),
        completedStepIds: [],
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      }, null);
      this.crashInjector?.('after-intent');
    } else if (existing.kind === 'current' || existing.kind === 'migrated') {
      record = existing.record;
      validateExistingIntent(record.payload, operation);
    } else if (existing.kind === 'future') {
      throw new Error(
        `Transaction "${operation.transactionId}" uses future schema version ${existing.schemaVersion}.`,
      );
    } else {
      throw new Error(`Transaction "${operation.transactionId}" is corrupt: ${existing.error}`);
    }

    return this.resume(record, recovered);
  }

  private async resume(
    initialRecord: VersionedRecord<TransactionIntent>,
    recovered: boolean,
  ): Promise<TransactionExecutionResult> {
    let record = initialRecord;
    if (record.payload.status === 'completed') {
      return { transactionId: record.recordId, status: 'completed', recovered: true };
    }

    const completed = new Set(record.payload.completedStepIds);
    for (const step of record.payload.steps) {
      if (completed.has(step.id)) {
        continue;
      }
      const handler = this.requireHandler(step.handlerId);
      const normalizedInput = handler.validate(step.input);
      validateControlRecordPayload(normalizedInput);
      if (stableSerialize(normalizedInput) !== stableSerialize(step.input)) {
        throw new Error(
          `Transaction "${record.recordId}" step "${step.id}" input is not canonical.`,
        );
      }
      await handler.apply(normalizedInput);
      this.crashInjector?.(`after-step-effect:${step.id}`);
      completed.add(step.id);
      this.crashInjector?.(`before-step-checkpoint:${step.id}`);
      record = await this.repository.save(record.recordId, {
        ...record.payload,
        completedStepIds: [...completed],
        updatedAt: this.now(),
      }, record.revision);
      this.crashInjector?.(`after-step-checkpoint:${step.id}`);
    }

    this.crashInjector?.('before-completion');
    record = await this.repository.save(record.recordId, {
      ...record.payload,
      status: 'completed',
      updatedAt: this.now(),
    }, record.revision);
    this.crashInjector?.('after-completion');
    return { transactionId: record.recordId, status: 'completed', recovered };
  }

  private normalizeOperation(operation: TransactionOperation): TransactionOperation {
    requireExactKeys(operation as unknown as Record<string, unknown>, [
      'transactionId',
      'kind',
      'steps',
    ], 'transaction operation');
    requireTransactionId(operation.transactionId);
    this.requireRegisteredKind(operation.kind);
    const stepIds = new Set<string>();
    const normalizedSteps = operation.steps.map((step, index) => {
      requireExactKeys(step as unknown as Record<string, unknown>, [
        'id',
        'handlerId',
        'input',
      ], `transaction step ${index}`);
      requireStepId(step.id);
      requireSlug(step.handlerId, 'Transaction handler id');
      if (stepIds.has(step.id)) {
        throw new Error(`Duplicate transaction step id "${step.id}".`);
      }
      stepIds.add(step.id);
      const input = this.requireHandler(step.handlerId).validate(step.input);
      validateControlRecordPayload(input);
      return { id: step.id, handlerId: step.handlerId, input };
    });
    return {
      transactionId: operation.transactionId,
      kind: operation.kind,
      steps: normalizedSteps,
    };
  }

  private requireHandler(handlerId: string): TransactionStepHandler {
    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`Transaction handler "${handlerId}" is not registered.`);
    }
    return handler;
  }

  private requireRegisteredKind(kind: string): void {
    requireKind(kind);
    if (!this.kinds.has(kind)) {
      throw new Error(`Transaction kind "${kind}" is not registered.`);
    }
  }

  private enqueue<TResult>(
    transactionId: string,
    task: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.operationQueues.get(transactionId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    const tail = operation.then(() => undefined, () => undefined);
    this.operationQueues.set(transactionId, tail);
    return operation.finally(() => {
      if (this.operationQueues.get(transactionId) === tail) {
        this.operationQueues.delete(transactionId);
      }
    });
  }
}

function decodeStep(value: unknown, index: number): PersistedTransactionStep {
  const step = requireExactRecord(value, [
    'id',
    'handlerId',
    'input',
  ], `transaction step ${index}`);
  requireStepId(step.id);
  requireSlug(step.handlerId, 'Transaction handler id');
  if (!isRecord(step.input)) {
    throw new Error(`Transaction step ${index} input must be an object.`);
  }
  return {
    id: step.id,
    handlerId: step.handlerId,
    input: { ...step.input },
  };
}

function validateExistingIntent(
  intent: TransactionIntent,
  operation: TransactionOperation,
): void {
  if (intent.kind !== operation.kind
    || stableSerialize(intent.steps) !== stableSerialize(operation.steps)) {
    throw new Error(`Transaction "${operation.transactionId}" does not match its durable intent.`);
  }
}

function validateTransactionIntentForWrite(intent: TransactionIntent): void {
  transactionIntentSchema.decode(intent);
  validateControlRecordPayload(intent);
}

function requireTransactionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^tx-[0-9a-f]{32}$/.test(value)) {
    throw new Error('Transaction id must be an opaque tx identifier.');
  }
}

function requireStepId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^step-[0-9]{1,4}$/.test(value)) {
    throw new Error('Transaction step id must be an ordinal step identifier.');
  }
}

function requireSlug(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a registered slug.`);
  }
}

function requireKind(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(value)) {
    throw new Error('Transaction kind must be a constrained identifier.');
  }
}

function requireExactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  requireExactKeys(value, keys, label);
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = new Set(keys);
  if (Object.keys(value).length !== expected.size
    || Object.keys(value).some(key => !expected.has(key))) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}
