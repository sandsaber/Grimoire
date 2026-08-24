import { SESSIONS_PATH } from '../bootstrap/StoragePaths';
import type { DurableStorage } from '../persistence/DurableStorage';
import {
  RecordUnavailableError,
  RevisionConflictError,
  VersionedRepository,
} from '../persistence/VersionedRepository';
import type { SessionMetadata } from '../types';
import {
  adoptLegacyConversationRecord,
  CONVERSATION_RECORD_SCHEMA,
} from './ConversationRecord';

/** What a conversation file is called, and has been called for every release. */
const CONVERSATION_FILE_SUFFIX = '.meta.json';

/**
 * One conversation, as this store can answer for it.
 *
 * `revision` is the whole point: a caller that saves has to say which revision
 * it read, and a save against a stale one is refused rather than applied. The
 * legacy path wrote whatever it held over whatever was there.
 */
export type ConversationRead =
  | { readonly kind: 'absent' }
  | {
    readonly kind: 'present';
    readonly metadata: SessionMetadata;
    readonly revision: number;
    /**
     * Whether this came out of a file written before the store existed.
     *
     * Read as revision 1 and **not rewritten here**: D5 says a migrated record
     * is rewritten at the next legitimate write, not eagerly on startup, so a
     * vault that is only ever read is never touched.
     */
    readonly adopted: boolean;
  }
  | {
    readonly kind: 'unreadable';
    readonly reason: 'future' | 'corrupt';
    readonly detail: string;
  };

/**
 * Conversation metadata, revisioned and serialized.
 *
 * The production path is still `SessionStorage`, which writes the whole
 * conversation over whatever the file held. What that cannot express is the
 * case M4 exists for: **two writers, one conversation**. A title generated in
 * the background, a message appended in one window and a rename in another all
 * read the conversation, change part of it, and write the whole of it back —
 * and the last one to finish wins, taking the others' changes with it.
 *
 * Here a save names the revision it was built from. A save against a revision
 * that is no longer current is refused, and the caller is told what it now is.
 * The compare-and-swap is what makes that true for a save; the per-conversation
 * queue underneath is what makes it true for the operations that read and then
 * write, where two of them could otherwise interleave.
 *
 * **The file keeps its name.** `<id>.meta.json` is what every vault in the
 * field holds, so the upgrade from a bare object to an enveloped record is a
 * compare-and-swap of that file's own contents rather than a rename of every
 * conversation a user has.
 */
export class ConversationRepository {
  private readonly records: VersionedRepository<SessionMetadata>;

  constructor(options: { readonly storage: DurableStorage; readonly now?: () => number }) {
    this.records = new VersionedRepository<SessionMetadata>({
      storage: options.storage,
      namespace: SESSIONS_PATH,
      schema: CONVERSATION_RECORD_SCHEMA,
      fileSuffix: CONVERSATION_FILE_SUFFIX,
      adoptLegacyRecord: adoptLegacyConversationRecord,
      ...(options.now ? { now: options.now } : {}),
    });
  }

  async read(conversationId: string): Promise<ConversationRead> {
    const result = await this.records.read(conversationId);
    if (result.kind === 'absent') {
      return { kind: 'absent' };
    }
    if (result.kind === 'future') {
      return {
        kind: 'unreadable',
        reason: 'future',
        detail: `Conversation "${conversationId}" was written by a newer release (schema version ${result.schemaVersion}).`,
      };
    }
    if (result.kind === 'corrupt') {
      return { kind: 'unreadable', reason: 'corrupt', detail: result.error };
    }
    return {
      kind: 'present',
      metadata: result.record.payload,
      revision: result.record.revision,
      adopted: result.kind === 'migrated',
    };
  }

  /**
   * Writes a conversation, and says what revision it now has.
   *
   * `expectedRevision` is `null` for a conversation being created — which is
   * also what refuses a create over a conversation that already exists, rather
   * than overwriting one whose id collided.
   */
  async save(
    metadata: SessionMetadata,
    expectedRevision: number | null,
  ): Promise<number> {
    const record = await this.records.save(metadata.id, metadata, expectedRevision);
    return record.revision;
  }

  /**
   * Applies the fields one writer changed onto whatever is on disk.
   *
   * **The operation every conversation save should have been.** A writer that
   * carries a title, a status or a model applies exactly that, so a message
   * appended in another window — or by the stream that is running right now —
   * is still there afterwards. The legacy path wrote the whole conversation the
   * writer happened to be holding, which is how a background title generator
   * reverted a message the user had just sent.
   *
   * `create` is what the caller supplies for a conversation the vault does not
   * have yet: a merge into nothing has nothing to merge into.
   */
  async merge(
    conversationId: string,
    fields: Partial<SessionMetadata>,
    create: () => SessionMetadata,
  ): Promise<number> {
    const record = await this.records.merge(conversationId, current => (
      current === null
        ? create()
        : { ...current, ...fields, id: conversationId }
    ));
    return record.revision;
  }

  /** Deletes a conversation the caller has read, refusing a stale revision. */
  async remove(conversationId: string, expectedRevision: number): Promise<void> {
    await this.records.remove(conversationId, expectedRevision);
  }

  /**
   * Deletes a conversation whatever revision it is at.
   *
   * What a user's "delete this conversation" means: they are not racing
   * themselves for a newer version of something they asked to be gone.
   */
  async removeIfPresent(conversationId: string): Promise<void> {
    await this.records.removeIfPresent(conversationId);
  }

  /** Every conversation id this store holds a file for. */
  listIds(): Promise<string[]> {
    return this.records.listRecordIds();
  }
}

export { RecordUnavailableError, RevisionConflictError };
