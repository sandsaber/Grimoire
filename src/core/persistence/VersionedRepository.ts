import type { DurableStorage } from './DurableStorage';
import type {
  RecordSchema,
  VersionedRecord,
  VersionedRecordReadResult,
} from './VersionedRecord';

const storageMutationQueues = new WeakMap<DurableStorage, Map<string, Promise<void>>>();

export interface VersionedRepositoryOptions<TPayload> {
  readonly storage: DurableStorage;
  readonly namespace: string;
  readonly schema: RecordSchema<TPayload>;
  readonly now?: () => number;
  readonly validatePayload?: (payload: TPayload) => void;
}

export class RevisionConflictError extends Error {
  constructor(
    readonly recordId: string,
    readonly expectedRevision: number | null,
    readonly actualRevision: number | null,
  ) {
    super(
      `Record "${recordId}" revision conflict: expected ${String(expectedRevision)}, actual ${String(actualRevision)}.`,
    );
    this.name = 'RevisionConflictError';
  }
}

export class RecordUnavailableError extends Error {
  constructor(readonly recordId: string, message: string) {
    super(message);
    this.name = 'RecordUnavailableError';
  }
}

export class VersionedRepository<TPayload> {
  private readonly storage: DurableStorage;
  private readonly namespace: string;
  private readonly schema: RecordSchema<TPayload>;
  private readonly now: () => number;
  private readonly validatePayload?: (payload: TPayload) => void;
  private readonly mutationQueues: Map<string, Promise<void>>;

  constructor(options: VersionedRepositoryOptions<TPayload>) {
    validateNamespace(options.namespace);
    if (!Number.isSafeInteger(options.schema.currentVersion)
      || options.schema.currentVersion < 1) {
      throw new Error('Current schema version must be a positive safe integer.');
    }
    this.storage = options.storage;
    this.namespace = options.namespace;
    this.schema = options.schema;
    this.now = options.now ?? Date.now;
    this.validatePayload = options.validatePayload;
    const existingQueues = storageMutationQueues.get(options.storage);
    if (existingQueues) {
      this.mutationQueues = existingQueues;
    } else {
      this.mutationQueues = new Map();
      storageMutationQueues.set(options.storage, this.mutationQueues);
    }
  }

  read(recordId: string): Promise<VersionedRecordReadResult<TPayload>> {
    return this.readUnlocked(recordId);
  }

  async listRecordIds(): Promise<string[]> {
    const prefix = `${this.namespace}/`;
    const paths = await this.storage.list(this.namespace);
    return paths.flatMap(path => {
      if (!path.startsWith(prefix) || !path.endsWith('.json')) {
        return [];
      }
      const encodedId = path.slice(prefix.length, -'.json'.length);
      if (!encodedId || encodedId.includes('/')) {
        return [];
      }
      const recordId = decodeURIComponent(encodedId);
      requireRecordId(recordId);
      return [recordId];
    }).sort();
  }

  save(
    recordId: string,
    payload: TPayload,
    expectedRevision: number | null,
  ): Promise<VersionedRecord<TPayload>> {
    return this.enqueue(recordId, () => (
      this.saveUnlocked(recordId, payload, expectedRevision)
    ));
  }

  mutate(
    recordId: string,
    expectedRevision: number,
    mutation: (current: TPayload) => TPayload,
  ): Promise<VersionedRecord<TPayload>> {
    return this.enqueue(recordId, async () => {
      const current = await this.readUnlocked(recordId);
      if (current.kind === 'absent') {
        throw new RevisionConflictError(recordId, expectedRevision, null);
      }
      if (current.kind === 'future') {
        throw new RecordUnavailableError(
          recordId,
          `Record "${recordId}" uses future schema version ${current.schemaVersion}.`,
        );
      }
      if (current.kind === 'corrupt') {
        throw new RecordUnavailableError(
          recordId,
          `Record "${recordId}" is corrupt: ${current.error}`,
        );
      }
      if (current.record.revision !== expectedRevision) {
        throw new RevisionConflictError(
          recordId,
          expectedRevision,
          current.record.revision,
        );
      }
      return this.writeRecord(
        recordId,
        mutation(current.record.payload),
        current.record.revision,
        current.record.revision + 1,
        current.raw,
      );
    });
  }

  async remove(recordId: string, expectedRevision: number): Promise<void> {
    await this.enqueue(recordId, async () => {
      const current = await this.readUnlocked(recordId);
      const actualRevision = current.kind === 'current' || current.kind === 'migrated'
        ? current.record.revision
        : null;
      if (actualRevision !== expectedRevision) {
        throw new RevisionConflictError(recordId, expectedRevision, actualRevision);
      }
      if (!await this.storage.compareAndSwap(
        getVersionedRecordPath(this.namespace, recordId),
        current.kind === 'current' || current.kind === 'migrated' ? current.raw : null,
        null,
      )) {
        throw new RevisionConflictError(
          recordId,
          expectedRevision,
          await this.readActualRevision(recordId),
        );
      }
    });
  }

  private async saveUnlocked(
    recordId: string,
    payload: TPayload,
    expectedRevision: number | null,
  ): Promise<VersionedRecord<TPayload>> {
    const current = await this.readUnlocked(recordId);
    if (current.kind === 'future') {
      throw new RecordUnavailableError(
        recordId,
        `Record "${recordId}" uses future schema version ${current.schemaVersion}.`,
      );
    }
    if (current.kind === 'corrupt') {
      throw new RecordUnavailableError(
        recordId,
        `Record "${recordId}" is corrupt: ${current.error}`,
      );
    }

    const actualRevision = current.kind === 'absent' ? null : current.record.revision;
    if (actualRevision !== expectedRevision) {
      throw new RevisionConflictError(recordId, expectedRevision, actualRevision);
    }
    return this.writeRecord(
      recordId,
      payload,
      expectedRevision,
      (actualRevision ?? 0) + 1,
      current.kind === 'absent' ? null : current.raw,
    );
  }

  private async writeRecord(
    recordId: string,
    payload: TPayload,
    expectedRevision: number | null,
    revision: number,
    expectedRaw: string | null,
  ): Promise<VersionedRecord<TPayload>> {
    requireRecordId(recordId);
    const canonicalPayload = this.schema.decode(payload);
    this.validatePayload?.(canonicalPayload);
    const envelope: VersionedRecord<TPayload> = {
      schemaVersion: this.schema.currentVersion,
      recordId,
      revision,
      updatedAt: this.now(),
      payload: canonicalPayload,
    };
    assertJsonValue(envelope, '$', new Set<object>());
    const serialized = JSON.stringify(envelope);
    const written = await this.storage.compareAndSwap(
      getVersionedRecordPath(this.namespace, recordId),
      expectedRaw,
      serialized,
    );
    if (!written) {
      throw new RevisionConflictError(
        recordId,
        expectedRevision,
        await this.readActualRevision(recordId),
      );
    }
    const persisted = JSON.parse(serialized) as VersionedRecord<unknown>;
    return {
      ...persisted,
      payload: this.schema.decode(persisted.payload),
    };
  }

  private async readActualRevision(recordId: string): Promise<number | null> {
    const current = await this.readUnlocked(recordId);
    return current.kind === 'current' || current.kind === 'migrated'
      ? current.record.revision
      : null;
  }

  private async readUnlocked(recordId: string): Promise<VersionedRecordReadResult<TPayload>> {
    requireRecordId(recordId);
    const path = getVersionedRecordPath(this.namespace, recordId);
    const raw = await this.storage.read(path);
    if (raw === null) {
      return { kind: 'absent' };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<VersionedRecord<unknown>>;
      validateEnvelope(parsed, recordId);
      const schemaVersion = parsed.schemaVersion as number;
      if (schemaVersion > this.schema.currentVersion) {
        return { kind: 'future', recordId, schemaVersion, raw };
      }

      let migratedVersion = schemaVersion;
      let migratedPayload = parsed.payload;
      while (migratedVersion < this.schema.currentVersion) {
        const migration = this.schema.migrate?.(migratedVersion, migratedPayload);
        if (!migration
          || !Number.isSafeInteger(migration.schemaVersion)
          || migration.schemaVersion <= migratedVersion
          || migration.schemaVersion > this.schema.currentVersion) {
          throw new Error(`No valid migration from schema version ${migratedVersion}.`);
        }
        migratedVersion = migration.schemaVersion;
        migratedPayload = migration.payload;
      }

      const record: VersionedRecord<TPayload> = {
        schemaVersion: this.schema.currentVersion,
        recordId,
        revision: parsed.revision as number,
        updatedAt: parsed.updatedAt as number,
        payload: this.schema.decode(migratedPayload),
      };
      return schemaVersion === this.schema.currentVersion
        ? { kind: 'current', record, raw }
        : { kind: 'migrated', fromSchemaVersion: schemaVersion, record, raw };
    } catch (error) {
      return {
        kind: 'corrupt',
        recordId,
        error: error instanceof Error ? error.message : String(error),
        raw,
      };
    }
  }

  private enqueue<TResult>(recordId: string, task: () => Promise<TResult>): Promise<TResult> {
    const queueKey = getVersionedRecordPath(this.namespace, recordId);
    const previous = this.mutationQueues.get(queueKey) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    const tail = operation.then(() => undefined, () => undefined);
    this.mutationQueues.set(queueKey, tail);
    return operation.finally(() => {
      if (this.mutationQueues.get(queueKey) === tail) {
        this.mutationQueues.delete(queueKey);
      }
    });
  }
}

export function getVersionedRecordPath(namespace: string, recordId: string): string {
  validateNamespace(namespace);
  requireRecordId(recordId);
  return `${namespace}/${encodeURIComponent(recordId)}.json`;
}

function validateEnvelope(
  envelope: Partial<VersionedRecord<unknown>>,
  expectedRecordId: string,
): void {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Envelope must be an object.');
  }
  if (!Number.isSafeInteger(envelope.schemaVersion) || (envelope.schemaVersion ?? 0) < 1) {
    throw new Error('Envelope schemaVersion must be a positive safe integer.');
  }
  if (envelope.recordId !== expectedRecordId) {
    throw new Error(`Envelope recordId must be "${expectedRecordId}".`);
  }
  if (!Number.isSafeInteger(envelope.revision) || (envelope.revision ?? 0) < 1) {
    throw new Error('Envelope revision must be a positive safe integer.');
  }
  if (typeof envelope.updatedAt !== 'number' || !Number.isFinite(envelope.updatedAt)) {
    throw new Error('Envelope updatedAt must be finite.');
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, 'payload')) {
    throw new Error('Envelope payload is required.');
  }
}

function validateNamespace(namespace: string): void {
  if (!namespace
    || namespace.startsWith('/')
    || namespace.includes('\\')
    || namespace.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid repository namespace "${namespace}".`);
  }
}

function requireRecordId(recordId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(recordId)) {
    throw new Error('Record id must be a constrained identifier.');
  }
}

function assertJsonValue(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`Value at "${path}" is not JSON serializable.`);
  }
  if (ancestors.has(value)) {
    throw new Error(`Value at "${path}" contains a cycle.`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Value at "${path}" must be a plain object.`);
    }
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}
