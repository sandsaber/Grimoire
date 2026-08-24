import type { RecordSchema } from '../persistence/VersionedRecord';
import type { SessionMetadata } from '../types';

/**
 * The schema version conversation metadata is written under.
 *
 * `1` is the shape the vault has been holding all along — this store does not
 * change what a conversation *is*, only how it is written. A later change to
 * the payload raises this and adds a step to `migrate`.
 */
export const CONVERSATION_SCHEMA_VERSION = 1;

/**
 * Conversation metadata, as a versioned record payload.
 *
 * **`decode` validates and does not rewrite.** A conversation carries fields
 * this build may not know — a provider's own state bag, and whatever a later
 * release adds — and D5 says a store never discards what it does not
 * understand. So the only things checked are the ones every reader depends on,
 * and everything else is passed through exactly as it was read.
 *
 * Notably absent: whether `providerId` names a provider this build has. The
 * legacy reader treats an unrecognised one as a conversation that does not
 * exist, which silently hides it; that is a question for the caller that knows
 * what to do about it, and answering it here would make the record *corrupt* —
 * which under D5 opens the whole store read-only.
 */
export const CONVERSATION_RECORD_SCHEMA: RecordSchema<SessionMetadata> = {
  currentVersion: CONVERSATION_SCHEMA_VERSION,
  decode(payload: unknown): SessionMetadata {
    return decodeConversationMetadata(payload);
  },
};

/**
 * Reads a conversation file written before this store existed.
 *
 * Every vault in the field holds `.grimoire/sessions/<id>.meta.json` as a bare
 * metadata object with no envelope around it. There is no `schemaVersion` to
 * migrate from, so this is the step that makes those files readable at all —
 * without it every conversation in every existing vault reads `corrupt`, and
 * D5 would open the store read-only for all of them.
 *
 * Idempotent by construction: it only ever looks at a file with no envelope, so
 * a record this store has already written is never adopted a second time.
 */
export function adoptLegacyConversationRecord(
  raw: unknown,
  recordId: string,
): SessionMetadata | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  // The id has to be the one the file is named for. A metadata file holding
  // some other conversation's id is not a conversation this store can adopt
  // under this name — it is a file it does not understand.
  const id = raw.id;
  if (typeof id !== 'string' || id !== recordId) {
    return null;
  }
  try {
    return decodeConversationMetadata(raw);
  } catch {
    return null;
  }
}

function decodeConversationMetadata(payload: unknown): SessionMetadata {
  if (!isPlainObject(payload)) {
    throw new Error('Conversation metadata must be an object.');
  }
  requireString(payload, 'id');
  requireString(payload, 'title');
  requireFiniteNumber(payload, 'createdAt');
  requireFiniteNumber(payload, 'updatedAt');
  // **Exactly what the legacy write put in the file, and nothing else.**
  // `toSessionMetadata` sets absent fields to `undefined` rather than omitting
  // them, and the legacy `JSON.stringify` dropped those keys on the way out —
  // so a payload that kept them is not what the vault has ever held, and the
  // record store refuses it outright as not serializable. Round-tripping
  // through JSON is that same drop, applied here rather than relied on later:
  // it discards nothing a reader could have seen and preserves every field this
  // build does not know about.
  return JSON.parse(JSON.stringify(payload)) as SessionMetadata;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(payload: Record<string, unknown>, key: string): void {
  if (typeof payload[key] !== 'string') {
    throw new Error(`Conversation metadata field "${key}" must be a string.`);
  }
}

function requireFiniteNumber(payload: Record<string, unknown>, key: string): void {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Conversation metadata field "${key}" must be a finite number.`);
  }
}
