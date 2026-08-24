import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import {
  type AtomicTextFileAdapter,
  VaultDurableStorage,
} from '@/app/storage/VaultDurableStorage';
import {
  ControlRecordPayloadError,
  validateControlRecordPayload,
} from '@/core/persistence/ControlRecordPayloadPolicy';
import type { RecordSchema } from '@/core/persistence/VersionedRecord';
import {
  getVersionedRecordPath,
  RevisionConflictError,
  VersionedRepository,
} from '@/core/persistence/VersionedRepository';

interface ExampleRecord {
  count: number;
  label?: string;
}

class SharedAtomicTextAdapter implements AtomicTextFileAdapter {
  constructor(
    private readonly files: Map<string, string>,
    readonly coordinationKey: object,
  ) {}

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`Missing ${path}`);
    }
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const value = await this.read(oldPath);
    this.files.set(newPath, value);
    this.files.delete(oldPath);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listFilesRecursive(path: string): Promise<string[]> {
    return [...this.files.keys()].filter(file => (
      file === path || file.startsWith(`${path}/`)
    ));
  }
}

const schema: RecordSchema<ExampleRecord> = {
  currentVersion: 2,
  decode(payload) {
    const record = payload as Partial<ExampleRecord>;
    if (!record || typeof record.count !== 'number') {
      throw new Error('count is required');
    }
    return {
      count: record.count,
      ...(typeof record.label === 'string' ? { label: record.label } : {}),
    };
  },
  migrate(fromVersion, payload) {
    if (fromVersion === 1) {
      return {
        schemaVersion: 2,
        payload: { count: Number(payload) },
      };
    }
    return null;
  },
};

describe('VersionedRepository', () => {
  it('creates and updates records with monotonic revisions', async () => {
    const storage = new TestDurableStorage();
    const repository = new VersionedRepository({
      storage,
      namespace: 'records',
      schema,
      now: () => 100,
    });

    const created = await repository.save('record-1', { count: 1 }, null);
    const updated = await repository.save('record-1', { count: 2 }, created.revision);
    const read = await repository.read('record-1');

    expect(created.revision).toBe(1);
    expect(updated.revision).toBe(2);
    expect(read).toMatchObject({
      kind: 'current',
      record: { revision: 2, payload: { count: 2 } },
    });
  });

  it('serializes mutations and rejects a stale expected revision', async () => {
    const repository = new VersionedRepository({
      storage: new TestDurableStorage(),
      namespace: 'records',
      schema,
      now: () => 100,
    });
    await repository.save('record-1', { count: 0 }, null);

    const first = repository.mutate('record-1', 1, record => ({
      ...record,
      count: record.count + 1,
    }));
    const stale = repository.mutate('record-1', 1, record => ({
      ...record,
      count: record.count + 10,
    }));

    await expect(first).resolves.toMatchObject({ revision: 2, payload: { count: 1 } });
    await expect(stale).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it('shares the write queue across repositories using the same storage', async () => {
    const storage = new TestDurableStorage();
    const firstRepository = new VersionedRepository({
      storage,
      namespace: 'records',
      schema,
    });
    const secondRepository = new VersionedRepository({
      storage,
      namespace: 'records',
      schema,
    });
    await firstRepository.save('record-1', { count: 0 }, null);

    const results = await Promise.allSettled([
      firstRepository.mutate('record-1', 1, record => ({ count: record.count + 1 })),
      secondRepository.mutate('record-1', 1, record => ({ count: record.count + 10 })),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(RevisionConflictError) });
  });

  it('uses storage-level CAS across distinct wrappers over one backing store', async () => {
    const files = new Map<string, string>();
    const coordinationKey = {};
    const firstRepository = new VersionedRepository({
      storage: new VaultDurableStorage(new SharedAtomicTextAdapter(files, coordinationKey)),
      namespace: 'records',
      schema,
    });
    const secondRepository = new VersionedRepository({
      storage: new VaultDurableStorage(new SharedAtomicTextAdapter(files, coordinationKey)),
      namespace: 'records',
      schema,
    });
    await firstRepository.save('record-1', { count: 0 }, null);

    const results = await Promise.allSettled([
      firstRepository.mutate('record-1', 1, record => ({ count: record.count + 1 })),
      secondRepository.mutate('record-1', 1, record => ({ count: record.count + 10 })),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const current = await firstRepository.read('record-1');
    expect(current).toMatchObject({
      kind: 'current',
      record: { revision: 2 },
    });
  });

  it('migrates known versions without rewriting on read', async () => {
    const storage = new TestDurableStorage();
    const path = getVersionedRecordPath('records', 'legacy');
    const raw = JSON.stringify({
      schemaVersion: 1,
      recordId: 'legacy',
      revision: 4,
      updatedAt: 50,
      payload: '7',
    });
    storage.seed(path, raw);
    const repository = new VersionedRepository({
      storage,
      namespace: 'records',
      schema,
      now: () => 100,
    });

    await expect(repository.read('legacy')).resolves.toMatchObject({
      kind: 'migrated',
      fromSchemaVersion: 1,
      record: {
        schemaVersion: 2,
        revision: 4,
        payload: { count: 7 },
      },
    });
    expect(storage.get(path)).toBe(raw);
  });

  it('byte-preserves unknown future versions and refuses to overwrite them', async () => {
    const storage = new TestDurableStorage();
    const path = getVersionedRecordPath('records', 'future');
    const raw = '{"schemaVersion":99,"recordId":"future","revision":8,"updatedAt":1,"payload":{"future":true}}\n';
    storage.seed(path, raw);
    const repository = new VersionedRepository({
      storage,
      namespace: 'records',
      schema,
      now: () => 100,
    });

    await expect(repository.read('future')).resolves.toEqual({
      kind: 'future',
      recordId: 'future',
      schemaVersion: 99,
      raw,
    });
    await expect(repository.save('future', { count: 1 }, 8)).rejects.toThrow(
      'Record "future" uses future schema version 99.',
    );
    expect(storage.get(path)).toBe(raw);
  });

  it('enforces a control-record data minimization policy before persistence', async () => {
    const repository = new VersionedRepository<Record<string, unknown>>({
      storage: new TestDurableStorage(),
      namespace: 'control',
      schema: {
        currentVersion: 1,
        decode: payload => payload as Record<string, unknown>,
      },
      validatePayload: validateControlRecordPayload,
    });

    await expect(repository.save('safe', {
      runId: 'run-1',
      state: 'recovering',
    }, null)).resolves.toMatchObject({ revision: 1 });
    await expect(repository.save('unsafe', {
      runId: 'run-2',
      rawProviderPayload: { content: 'not allowed' },
    }, null)).rejects.toBeInstanceOf(ControlRecordPayloadError);
    await expect(repository.save('unsafe-environment', {
      runId: 'run-3',
      nested: { environment: { PRIVATE_VALUE: 'not allowed' } },
    }, null)).rejects.toBeInstanceOf(ControlRecordPayloadError);
    await expect(repository.save('unsafe-output', {
      runId: 'run-4',
      stdout: 'not allowed',
    }, null)).rejects.toBeInstanceOf(ControlRecordPayloadError);
  });

  it('validates and canonicalizes the schema before durable replacement', async () => {
    const storage = new TestDurableStorage();
    const repository = new VersionedRepository({
      storage,
      namespace: 'records',
      schema,
    });

    await expect(repository.save('invalid', {
      count: 'not-a-number',
    } as unknown as ExampleRecord, null)).rejects.toThrow('count is required');
    expect(storage.get(getVersionedRecordPath('records', 'invalid'))).toBeNull();
    await expect(repository.save('canonical', {
      count: 1,
      ignored: 'not in decoded schema',
    } as ExampleRecord, null)).resolves.toMatchObject({
      payload: { count: 1 },
    });
    expect(storage.get(getVersionedRecordPath('records', 'canonical')))
      .not.toContain('ignored');
  });
  describe('adopting records this store did not write', () => {
    /**
     * The step D5's schema migration cannot reach: a file with **no envelope at
     * all** has no `schemaVersion` to migrate from. A store adopting data that
     * predates it has to say how to read that, or every record in it reads
     * `corrupt` at once — which under D5 opens the whole store read-only.
     */
    function createAdoptingRepository(
      storage: TestDurableStorage,
      adopt: (raw: unknown) => ExampleRecord | null = raw => (
        typeof (raw as { count?: unknown })?.count === 'number'
          ? { count: (raw as { count: number }).count }
          : null
      ),
    ): VersionedRepository<ExampleRecord> {
      return new VersionedRepository({
        storage,
        namespace: 'records',
        schema,
        now: () => 100,
        adoptLegacyRecord: raw => adopt(raw),
      });
    }

    it('reads a bare record as its first revision, without rewriting it', async () => {
      const storage = new TestDurableStorage();
      const bare = JSON.stringify({ count: 7 });
      storage.seed(getVersionedRecordPath('records', 'legacy-bare'), bare);
      const repository = createAdoptingRepository(storage);

      const read = await repository.read('legacy-bare');

      expect(read).toMatchObject({
        kind: 'migrated',
        fromSchemaVersion: 0,
        record: { revision: 1, payload: { count: 7 } },
      });
      // Rewritten at the next legitimate write, not eagerly on startup.
      expect(storage.get(getVersionedRecordPath('records', 'legacy-bare'))).toBe(bare);
    });

    it('upgrades the file in place at the next write', async () => {
      const storage = new TestDurableStorage();
      storage.seed(getVersionedRecordPath('records', 'legacy-bare'), JSON.stringify({ count: 7 }));
      const repository = createAdoptingRepository(storage);

      await repository.save('legacy-bare', { count: 8 }, 1);

      const stored = JSON.parse(
        storage.get(getVersionedRecordPath('records', 'legacy-bare')) as string,
      );
      expect(stored).toMatchObject({ schemaVersion: 2, revision: 2, payload: { count: 8 } });
    });

    it('never adopts a record this store wrote, however permissive the adopter', async () => {
      const storage = new TestDurableStorage();
      // Damaged: written by this store, and unreadable. A `revision` that is not
      // a number is exactly what `validateEnvelope` exists to catch.
      storage.seed(getVersionedRecordPath('records', 'damaged'), JSON.stringify({
        schemaVersion: 2,
        recordId: 'damaged',
        revision: 'four',
        updatedAt: 5,
        payload: { count: 3 },
      }));
      // An adopter that accepts anything, which is the case the envelope check
      // is there for: a permissive one would otherwise read a damaged record as
      // legacy data and **silently reset a record with history behind it to
      // revision 1**, which is the overwrite this whole store exists to stop.
      const repository = createAdoptingRepository(storage, () => ({ count: 0 }));

      await expect(repository.read('damaged')).resolves.toMatchObject({ kind: 'corrupt' });
    });

    it('leaves a file the adopter does not recognise corrupt', async () => {
      const storage = new TestDurableStorage();
      storage.seed(getVersionedRecordPath('records', 'foreign'), JSON.stringify({ other: true }));
      const repository = createAdoptingRepository(storage);

      await expect(repository.read('foreign')).resolves.toMatchObject({ kind: 'corrupt' });
    });

    it('does not adopt anything when the store did not ask to', async () => {
      const storage = new TestDurableStorage();
      storage.seed(getVersionedRecordPath('records', 'legacy-bare'), JSON.stringify({ count: 7 }));
      const repository = new VersionedRepository({
        storage,
        namespace: 'records',
        schema,
        now: () => 100,
      });

      // The control store did not ask, and must keep reading exactly as before.
      await expect(repository.read('legacy-bare')).resolves.toMatchObject({ kind: 'corrupt' });
    });
  });

  describe('the name a record file is given', () => {
    it('reads and lists under the suffix the store asked for', async () => {
      const storage = new TestDurableStorage();
      const repository = new VersionedRepository({
        storage,
        namespace: 'records',
        schema,
        now: () => 100,
        fileSuffix: '.meta.json',
      });

      await repository.save('record-1', { count: 1 }, null);

      // A store adopting files the vault already holds keeps their name, so the
      // upgrade is a rewrite of each file rather than a rename of all of them.
      expect(storage.get('records/record-1.meta.json')).not.toBeNull();
      expect(storage.get(getVersionedRecordPath('records', 'record-1'))).toBeNull();
      await expect(repository.listRecordIds()).resolves.toEqual(['record-1']);
    });

    it('does not read another store\'s files out of the same directory', async () => {
      const storage = new TestDurableStorage();
      storage.seed('records/other.json', JSON.stringify({ count: 1 }));
      const repository = new VersionedRepository({
        storage,
        namespace: 'records',
        schema,
        now: () => 100,
        fileSuffix: '.meta.json',
      });

      // A listing that matched on `.json` alone would invent a record named
      // `other.` out of a file belonging to something else.
      await expect(repository.listRecordIds()).resolves.toEqual([]);
    });

    it('refuses a suffix a record id could contain', () => {
      // Without this, one record's path is readable as another's id, which is
      // how a listing invents records that do not exist.
      expect(() => new VersionedRepository({
        storage: new TestDurableStorage(),
        namespace: 'records',
        schema,
        fileSuffix: 'json',
      })).toThrow(/file suffix/i);
    });
  });
});
