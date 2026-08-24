import type { DurableStorage } from './DurableStorage';
import type {
  RecordSchema,
  VersionedRecord,
  VersionedRecordReadResult,
} from './VersionedRecord';

const storageMutationQueues = new WeakMap<DurableStorage, Map<string, Promise<void>>>();

/** How many times a removal re-reads a record that changed under it. */
const REMOVE_ATTEMPTS = 3;

/** What a record file is named after its id, unless the store says otherwise. */
const DEFAULT_FILE_SUFFIX = '.json';

export interface VersionedRepositoryOptions<TPayload> {
  readonly storage: DurableStorage;
  readonly namespace: string;
  readonly schema: RecordSchema<TPayload>;
  readonly now?: () => number;
  readonly validatePayload?: (payload: TPayload) => void;
  /**
   * What a record file is named, after the record id. `.json` by default.
   *
   * A parameter because a store may be adopting files that already exist under
   * a name the vault has been writing for releases — conversation metadata is
   * `<id>.meta.json` — and renaming every one of them in every vault to gain a
   * revision would be a migration with no benefit. Keeping the name lets the
   * upgrade be a compare-and-swap of that file's own contents.
   */
  readonly fileSuffix?: string;
  /**
   * Reads a record this store did not write, as its first revision.
   *
   * The explicit, idempotent adoption step D5 asks for, at the one boundary a
   * schema migration cannot reach: a file with **no envelope at all** has no
   * `schemaVersion` to migrate from. Without this such a file reads `corrupt`,
   * which under D5 opens the store read-only — so a store adopting existing
   * vault data must say how to read it, or every record in it becomes
   * unreadable at once.
   *
   * Given the parsed JSON, it returns the payload or `null` for "this is not
   * something I recognise", which stays `corrupt`. The adopted record reads as
   * `migrated` at revision 1, so the next legitimate write replaces the file
   * with an enveloped one — at read time nothing is rewritten, which is the
   * other half of what D5 requires.
   */
  readonly adoptLegacyRecord?: (raw: unknown, recordId: string) => TPayload | null;
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
  private readonly fileSuffix: string;
  private readonly adoptLegacyRecord?: (raw: unknown, recordId: string) => TPayload | null;
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
    this.fileSuffix = options.fileSuffix ?? DEFAULT_FILE_SUFFIX;
    validateFileSuffix(this.fileSuffix);
    if (options.adoptLegacyRecord) {
      this.adoptLegacyRecord = options.adoptLegacyRecord;
    }
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
      if (!path.startsWith(prefix) || !path.endsWith(this.fileSuffix)) {
        return [];
      }
      const encodedId = path.slice(prefix.length, -this.fileSuffix.length);
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
        getVersionedRecordPath(this.namespace, recordId, this.fileSuffix),
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

  /**
   * Removes a record if it is there, and answers quietly if it is not.
   *
   * The revision-checked `remove` above is for a caller that knows what it is
   * deleting. A deletion step has to be replayable — it may run again after a
   * crash, against a record it already removed — so this one is written against
   * whatever is currently on disk, retrying the compare-and-swap if something
   * changed under it.
   */
  async removeIfPresent(recordId: string): Promise<void> {
    await this.enqueue(recordId, async () => {
      for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt += 1) {
        const current = await this.readUnlocked(recordId);
        const raw = current.kind === 'absent' ? null : current.raw;
        if (raw === null) {
          return;
        }
        if (await this.storage.compareAndSwap(
          getVersionedRecordPath(this.namespace, recordId, this.fileSuffix),
          raw,
          null,
        )) {
          return;
        }
      }
      throw new RecordUnavailableError(
        recordId,
        `Record "${recordId}" kept changing while it was being removed.`,
      );
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
      getVersionedRecordPath(this.namespace, recordId, this.fileSuffix),
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
    const path = getVersionedRecordPath(this.namespace, recordId, this.fileSuffix);
    const raw = await this.storage.read(path);
    if (raw === null) {
      return { kind: 'absent' };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<VersionedRecord<unknown>>;
      const adopted = this.adopt(parsed, recordId, raw);
      if (adopted) {
        return adopted;
      }
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

  /**
   * A file this store did not write, read as its first revision.
   *
   * Only where there is no envelope: a record that carries one and fails
   * validation is a record this store wrote and cannot read, which is corrupt
   * and must stay corrupt. Adoption is for data that predates the store.
   */
  private adopt(
    parsed: unknown,
    recordId: string,
    raw: string,
  ): VersionedRecordReadResult<TPayload> | null {
    if (!this.adoptLegacyRecord || looksEnveloped(parsed)) {
      return null;
    }
    const payload = this.adoptLegacyRecord(parsed, recordId);
    if (payload === null) {
      return null;
    }
    return {
      kind: 'migrated',
      fromSchemaVersion: 0,
      record: {
        schemaVersion: this.schema.currentVersion,
        recordId,
        revision: 1,
        updatedAt: this.now(),
        payload: this.schema.decode(payload),
      },
      raw,
    };
  }

  private enqueue<TResult>(recordId: string, task: () => Promise<TResult>): Promise<TResult> {
    const queueKey = getVersionedRecordPath(this.namespace, recordId, this.fileSuffix);
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

/**
 * Whether this looks like something this store wrote.
 *
 * Deliberately weak: it asks only for the envelope's own marker fields, so a
 * malformed record written by this store is still validated — and rejected —
 * by `validateEnvelope` rather than being adopted as legacy data and silently
 * reset to revision 1.
 */
function looksEnveloped(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }
  const candidate = parsed as Record<string, unknown>;
  return 'schemaVersion' in candidate
    && 'revision' in candidate
    && Object.prototype.hasOwnProperty.call(candidate, 'payload');
}

export function getVersionedRecordPath(
  namespace: string,
  recordId: string,
  fileSuffix: string = DEFAULT_FILE_SUFFIX,
): string {
  validateNamespace(namespace);
  requireRecordId(recordId);
  validateFileSuffix(fileSuffix);
  return `${namespace}/${encodeURIComponent(recordId)}${fileSuffix}`;
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

function validateFileSuffix(fileSuffix: string): void {
  // A suffix a record id could contain would make one record's path readable as
  // another's id, which is how a listing invents records that do not exist.
  if (!/^\.[A-Za-z0-9.]{1,32}$/.test(fileSuffix)) {
    throw new Error(`Invalid versioned record file suffix: ${fileSuffix}`);
  }
}
