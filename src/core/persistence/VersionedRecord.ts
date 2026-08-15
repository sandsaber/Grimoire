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
