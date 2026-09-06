export interface VersionedRecord<TPayload> {
  readonly schemaVersion: number;
  readonly recordId: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly payload: TPayload;
}

export interface RecordMigration {
  readonly schemaVersion: number;
  readonly payload: unknown;
}

export interface RecordSchema<TPayload> {
  readonly currentVersion: number;
  decode(payload: unknown): TPayload;
  migrate?(fromVersion: number, payload: unknown): RecordMigration | null;
}

export type VersionedRecordReadResult<TPayload> =
  | { readonly kind: 'absent' }
  | {
    readonly kind: 'current';
    readonly record: VersionedRecord<TPayload>;
    readonly raw: string;
  }
  | {
    readonly kind: 'migrated';
    readonly fromSchemaVersion: number;
    readonly record: VersionedRecord<TPayload>;
    readonly raw: string;
  }
  | {
    readonly kind: 'future';
    readonly recordId: string;
    readonly schemaVersion: number;
    readonly raw: string;
  }
  | {
    readonly kind: 'corrupt';
    readonly recordId: string;
    readonly error: string;
    readonly raw: string;
  };

/**
 * A record this build cannot read, and therefore must not act on.
 *
 * Persistence decision D5: a store holding a `future` or `corrupt` record opens
 * read-only and the host reports it, rather than guessing at a shape it does
 * not know. It lives here, beside the read result that produces those two
 * kinds, because every reader of a versioned record needs to raise the same
 * thing — a coordinator that raised a plain `Error` instead had its store read
 * as a defect, which fails startup opaquely and leaves the host with nothing to
 * tell the user.
 */
export class UnreadableControlRecordError extends Error {
  constructor(readonly recordKind: 'future' | 'corrupt', readonly detail: string) {
    super(`Control record is unreadable (${recordKind}): ${detail}`);
    this.name = 'UnreadableControlRecordError';
  }
}
