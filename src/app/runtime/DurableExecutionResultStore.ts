import { EXECUTION_RESULTS_PATH } from '../../core/bootstrap/StoragePaths';
import type { ResultRef } from '../../core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '../../core/execution/ResultCommit';
import type { DurableStorage } from '../../core/persistence/DurableStorage';
import type { Sha256DigestPort } from '../../core/providers/ProviderSettingsFingerprint';
import { canonicalJson } from '../../core/providers/ProviderSettingsFingerprint';
import type { MaterializedChatResult } from '../../features/chat/projections/ChatProjection';

export interface StoreExecutionResultInput {
  readonly identity: Readonly<Record<string, string>>;
  readonly output: string;
  readonly source: string;
  readonly signal: AbortSignal;
}

interface StoredExecutionResult {
  readonly schemaVersion: 1;
  readonly resultId: string;
  readonly digest: string;
  readonly source: string;
  readonly finalText: string;
}

/** Durable application-domain result storage shared by every execution backend. */
export class DurableExecutionResultStore {
  private readonly maxStoredRecordBytes: number;

  constructor(
    private readonly storage: DurableStorage,
    private readonly digest: Sha256DigestPort,
    private readonly maxResultBytes = 4 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxResultBytes) || maxResultBytes < 1) {
      throw new Error('Execution result byte limit must be a positive safe integer.');
    }
    this.maxStoredRecordBytes = storedResultByteLimit(maxResultBytes);
  }

  async store(input: StoreExecutionResultInput): Promise<ResultCommitOutcome> {
    requireIdentity(input.identity);
    requireIdentifier(input.source, 'Result source');
    if (input.signal.aborted) return { kind: 'aborted' };
    const bytes = new TextEncoder().encode(input.output).byteLength;
    if (bytes > this.maxResultBytes) {
      throw new Error('Execution result exceeds the durable byte limit.');
    }
    const digest = await this.digest.digestUtf8(input.output);
    requireDigest(digest);
    const identityDigest = await this.digest.digestUtf8(canonicalJson({
      identity: input.identity,
      source: input.source,
      outputDigest: digest,
    }));
    requireDigest(identityDigest);
    if (input.signal.aborted) return { kind: 'aborted' };
    const resultId = `result-${identityDigest.slice(0, 32)}`;
    const record: StoredExecutionResult = {
      schemaVersion: 1,
      resultId,
      digest,
      source: input.source,
      finalText: input.output,
    };
    const raw = JSON.stringify(record);
    const path = resultPath(resultId);
    const existing = await this.storage.readBounded(path, this.maxStoredRecordBytes);
    if (existing !== null && existing !== raw) {
      throw new Error(`Execution result "${resultId}" conflicts with its durable value.`);
    }
    if (existing === null && !(await this.storage.compareAndSwapBounded(
      path,
      null,
      raw,
      this.maxStoredRecordBytes,
    ))) {
      const raced = await this.storage.readBounded(
        path,
        this.maxStoredRecordBytes,
      );
      if (raced !== raw) {
        throw new Error(`Execution result "${resultId}" conflicts with its durable value.`);
      }
    }
    return {
      kind: 'committed',
      result: { resultId, storage: 'projection', digest },
    };
  }

  async materialize(resultRef: ResultRef): Promise<MaterializedChatResult> {
    if (resultRef.storage !== 'projection') {
      return { resultRef };
    }
    if (resultRef.digest === undefined) {
      throw new Error('Projection result reference requires a canonical digest.');
    }
    const raw = await this.storage.readBounded(
      resultPath(resultRef.resultId),
      this.maxStoredRecordBytes,
    );
    if (raw === null) {
      throw new Error(`Execution result "${resultRef.resultId}" is missing.`);
    }
    const record = decodeRecord(raw);
    if (new TextEncoder().encode(record.finalText).byteLength > this.maxResultBytes) {
      throw new Error(`Execution result "${resultRef.resultId}" exceeds the durable byte limit.`);
    }
    if (record.resultId !== resultRef.resultId || record.digest !== resultRef.digest) {
      throw new Error(`Execution result "${resultRef.resultId}" failed identity validation.`);
    }
    const actualDigest = await this.digest.digestUtf8(record.finalText);
    requireDigest(actualDigest);
    if (actualDigest !== record.digest) {
      throw new Error(`Execution result "${resultRef.resultId}" failed content validation.`);
    }
    return { resultRef, finalAssistantText: record.finalText };
  }
}

function storedResultByteLimit(maxResultBytes: number): number {
  // JSON may expand one valid UTF-8 input byte into a six-byte escape (for
  // example U+0000 -> "\\u0000"). The fixed allowance covers every bounded
  // identifier plus the schema punctuation.
  const limit = (maxResultBytes * 6) + 4_096;
  if (!Number.isSafeInteger(limit)) {
    throw new Error('Execution result byte limit is too large to serialize safely.');
  }
  return limit;
}

function resultPath(resultId: string): string {
  requireIdentifier(resultId, 'Result id');
  return `${EXECUTION_RESULTS_PATH}/${encodeURIComponent(resultId)}.json`;
}

function decodeRecord(raw: string): StoredExecutionResult {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Stored execution result is not valid JSON.');
  }
  if (!isRecord(value)
    || Object.keys(value).sort().join(',') !== 'digest,finalText,resultId,schemaVersion,source'
    || value.schemaVersion !== 1
    || typeof value.resultId !== 'string'
    || typeof value.finalText !== 'string'
    || typeof value.source !== 'string'
    || typeof value.digest !== 'string') {
    throw new Error('Stored execution result has an invalid schema.');
  }
  requireIdentifier(value.resultId, 'Stored result id');
  requireIdentifier(value.source, 'Stored result source');
  requireDigest(value.digest);
  return {
    schemaVersion: 1,
    resultId: value.resultId,
    digest: value.digest,
    source: value.source,
    finalText: value.finalText,
  };
}

function requireIdentity(value: Readonly<Record<string, string>>): void {
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 16) {
    throw new Error('Execution result identity must contain between 1 and 16 fields.');
  }
  for (const [key, entry] of entries) {
    requireIdentifier(key, 'Result identity key');
    if (!entry || new TextEncoder().encode(entry).byteLength > 1_024) {
      throw new Error('Result identity value must contain between 1 and 1024 UTF-8 bytes.');
    }
  }
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function requireDigest(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Execution result digest is invalid.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
