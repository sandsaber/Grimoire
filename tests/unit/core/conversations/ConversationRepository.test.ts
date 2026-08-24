import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { SESSIONS_PATH } from '@/core/bootstrap/StoragePaths';
import {
  ConversationRepository,
  RecordUnavailableError,
  RevisionConflictError,
} from '@/core/conversations/ConversationRepository';
import type { SessionMetadata } from '@/core/types';

/**
 * Conversation metadata, revisioned and serialized.
 *
 * The case this store exists for is **two writers, one conversation**: a title
 * generated in the background, a message appended in one window and a rename in
 * another all read the conversation, change part of it, and write the whole of
 * it back. On the legacy path the last one to finish wins and takes the others'
 * changes with it. Here the stale one is refused.
 *
 * The other half is the vault that already exists. Every conversation in the
 * field is a bare object in a file this store did not write, and a store that
 * could not read those would open read-only for all of them under D5.
 */
describe('conversation repository', () => {
  const CONVERSATION_PATH = `${SESSIONS_PATH}/conv-1.meta.json`;

  function metadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
    return {
      id: 'conv-1',
      title: 'Tomatoes',
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    };
  }

  function createRepository(): {
    repository: ConversationRepository;
    storage: TestDurableStorage;
  } {
    const storage = new TestDurableStorage();
    return {
      storage,
      repository: new ConversationRepository({ storage, now: () => 1_000 }),
    };
  }

  it('writes a conversation nobody has, and reads it back at its revision', async () => {
    const { repository, storage } = createRepository();

    const revision = await repository.save(metadata(), null);

    expect(revision).toBe(1);
    // The file keeps the name every vault in the field already uses, so the
    // upgrade is a rewrite of its contents rather than a rename of every
    // conversation a user has.
    expect(storage.get(CONVERSATION_PATH)).not.toBeNull();
    await expect(repository.read('conv-1')).resolves.toEqual({
      kind: 'present',
      metadata: metadata(),
      revision: 1,
      adopted: false,
    });
  });

  it('refuses a save built from a revision that is no longer current', async () => {
    const { repository } = createRepository();
    await repository.save(metadata(), null);
    const read = await repository.read('conv-1');
    const stale = read.kind === 'present' ? read.revision : 0;

    // A rename lands while a message append was in flight.
    await repository.save(metadata({ title: 'Renamed' }), stale);

    // The append now holds a conversation that is missing the rename, and
    // writing it would take the rename away. **This is the whole milestone.**
    await expect(repository.save(metadata({ messages: [] }), stale))
      .rejects.toBeInstanceOf(RevisionConflictError);
    const after = await repository.read('conv-1');
    expect(after.kind === 'present' && after.metadata.title).toBe('Renamed');
  });

  it('refuses a create over a conversation that already exists', async () => {
    const { repository } = createRepository();
    await repository.save(metadata(), null);

    // `null` means "there is nothing here yet". A colliding id is a conversation
    // this save would silently replace.
    await expect(repository.save(metadata({ title: 'Other' }), null))
      .rejects.toBeInstanceOf(RevisionConflictError);
  });

  it('lands exactly one of two writers built from the same revision', async () => {
    const { repository } = createRepository();
    await repository.save(metadata(), null);

    const [first, second] = await Promise.allSettled([
      repository.save(metadata({ title: 'One' }), 1),
      repository.save(metadata({ title: 'Two' }), 1),
    ]);

    // Both were built from revision 1, so exactly one may land and the other has
    // to be told. Worth saying what this does *not* prove: the compare-and-swap
    // alone would produce this outcome, because a save names the revision it
    // expects. The per-conversation queue matters for the operations that read
    // and then write — a delete at a named revision — rather than for this one.
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    const read = await repository.read('conv-1');
    expect(read.kind === 'present' && read.revision).toBe(2);
  });

  describe('the vault that already exists', () => {
    it('reads a conversation written before this store existed', async () => {
      const { repository, storage } = createRepository();
      // Exactly what every vault in the field holds: the metadata object, with
      // no envelope around it.
      storage.seed(CONVERSATION_PATH, JSON.stringify(metadata({ title: 'From before' })));

      const read = await repository.read('conv-1');

      expect(read).toEqual({
        kind: 'present',
        metadata: metadata({ title: 'From before' }),
        revision: 1,
        adopted: true,
      });
    });

    it('leaves the file alone until something legitimately writes it', async () => {
      const { repository, storage } = createRepository();
      const legacy = JSON.stringify(metadata({ title: 'From before' }));
      storage.seed(CONVERSATION_PATH, legacy);

      await repository.read('conv-1');

      // D5: a migrated record is rewritten at the next legitimate write, not
      // eagerly on startup. A vault that is only ever read is never touched.
      expect(storage.get(CONVERSATION_PATH)).toBe(legacy);
    });

    it('upgrades the file in place on the next write, keeping what it held', async () => {
      const { repository, storage } = createRepository();
      storage.seed(CONVERSATION_PATH, JSON.stringify(
        metadata({ title: 'From before', providerState: { threadId: 't-1' } }),
      ));

      const read = await repository.read('conv-1');
      const revision = read.kind === 'present' ? read.revision : 0;
      await repository.save(metadata({ title: 'Renamed', providerState: { threadId: 't-1' } }), revision);

      const stored = JSON.parse(storage.get(CONVERSATION_PATH) as string);
      expect(stored.schemaVersion).toBe(1);
      expect(stored.revision).toBe(2);
      // **Nothing this build does not understand is dropped.** A provider's own
      // state bag survives the upgrade, which is what D5 requires and what a
      // decode that rebuilt the payload field by field would quietly lose.
      expect(stored.payload.providerState).toEqual({ threadId: 't-1' });
      await expect(repository.read('conv-1')).resolves.toMatchObject({
        kind: 'present',
        adopted: false,
        revision: 2,
      });
    });

    it('adopts each file once, however many times it is read', async () => {
      const { repository, storage } = createRepository();
      storage.seed(CONVERSATION_PATH, JSON.stringify(metadata()));

      const before = await repository.read('conv-1');
      const revision = before.kind === 'present' ? before.revision : 0;
      await repository.save(metadata({ title: 'Written' }), revision);
      const after = await repository.read('conv-1');

      // Idempotent by construction: adoption only ever looks at a file with no
      // envelope, so a record this store has written is never reset to
      // revision 1 by a second pass.
      expect(after.kind === 'present' && after.adopted).toBe(false);
      expect(after.kind === 'present' && after.revision).toBe(2);
    });

    it('refuses a file that names a different conversation than its own name', async () => {
      const { repository, storage } = createRepository();
      storage.seed(CONVERSATION_PATH, JSON.stringify(metadata({ id: 'somebody-else' })));

      // Adopting it would file another conversation's transcript under this id,
      // which is worse than saying the file cannot be read.
      await expect(repository.read('conv-1')).resolves.toMatchObject({
        kind: 'unreadable',
        reason: 'corrupt',
      });
    });
  });

  describe('records this build must not act on', () => {
    it('reports a record from a newer release rather than guessing at it', async () => {
      const { repository, storage } = createRepository();
      storage.seed(CONVERSATION_PATH, JSON.stringify({
        schemaVersion: 99,
        recordId: 'conv-1',
        revision: 4,
        updatedAt: 5,
        payload: metadata(),
      }));

      const read = await repository.read('conv-1');

      // D5: the plugin never guesses, never discards, and never downgrades a
      // record it does not understand.
      expect(read).toMatchObject({ kind: 'unreadable', reason: 'future' });
      await expect(repository.save(metadata(), 4)).rejects.toBeInstanceOf(RecordUnavailableError);
      expect(JSON.parse(storage.get(CONVERSATION_PATH) as string).schemaVersion).toBe(99);
    });

    it('reports a record this store wrote and cannot read, rather than adopting it', async () => {
      const { repository, storage } = createRepository();
      // An envelope with a broken revision: written by this store, and damaged.
      storage.seed(CONVERSATION_PATH, JSON.stringify({
        schemaVersion: 1,
        recordId: 'conv-1',
        revision: 'four',
        updatedAt: 5,
        payload: metadata(),
      }));

      const read = await repository.read('conv-1');

      // Adopting it would silently reset a conversation with history behind it
      // to revision 1, which is exactly the overwrite this store exists to stop.
      expect(read).toMatchObject({ kind: 'unreadable', reason: 'corrupt' });
    });

    it('reports a file that is not a conversation at all', async () => {
      const { repository, storage } = createRepository();
      storage.seed(CONVERSATION_PATH, '{ this is not json');

      await expect(repository.read('conv-1')).resolves.toMatchObject({
        kind: 'unreadable',
        reason: 'corrupt',
      });
    });
  });

  describe('deleting', () => {
    it('deletes what the user asked to be gone, whatever revision it reached', async () => {
      const { repository } = createRepository();
      await repository.save(metadata(), null);
      await repository.save(metadata({ title: 'Renamed' }), 1);

      await repository.removeIfPresent('conv-1');

      // A user deleting a conversation is not racing themselves for a newer
      // version of something they asked to be gone.
      await expect(repository.read('conv-1')).resolves.toEqual({ kind: 'absent' });
    });

    it('refuses a delete built from a stale revision', async () => {
      const { repository } = createRepository();
      await repository.save(metadata(), null);
      await repository.save(metadata({ title: 'Renamed' }), 1);

      await expect(repository.remove('conv-1', 1)).rejects.toBeInstanceOf(RevisionConflictError);
      await expect(repository.read('conv-1')).resolves.toMatchObject({ kind: 'present' });
    });

    it('is quiet about deleting a conversation that is not there', async () => {
      const { repository } = createRepository();

      await expect(repository.removeIfPresent('conv-1')).resolves.toBeUndefined();
    });
  });

  it('lists the conversations it holds files for, adopted or not', async () => {
    const { repository, storage } = createRepository();
    await repository.save(metadata({ id: 'conv-1' }), null);
    storage.seed(
      `${SESSIONS_PATH}/conv-2.meta.json`,
      JSON.stringify(metadata({ id: 'conv-2' })),
    );
    // Something else living in the same directory, which the listing must not
    // read back as a conversation.
    storage.seed(`${SESSIONS_PATH}/notes.txt`, 'not a conversation');

    await expect(repository.listIds()).resolves.toEqual(['conv-1', 'conv-2']);
  });
});
