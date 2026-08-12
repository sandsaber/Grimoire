import { EXECUTION_PRESENTATIONS_PATH } from '../../core/bootstrap/StoragePaths';
import type { DurableStorage } from '../../core/persistence/DurableStorage';
import type { Sha256DigestPort } from '../../core/providers/ProviderSettingsFingerprint';

export type ExecutionInteractionPresentationKind =
  | 'approval'
  | 'question'
  | 'plan-decision';

export interface ExecutionInteractionPresentationOption {
  readonly responseId: string;
  readonly label: string;
  readonly description?: string;
}

export interface ExecutionInteractionPresentation {
  readonly presentationRef: string;
  readonly kind: ExecutionInteractionPresentationKind;
  readonly title: string;
  readonly description?: string;
  readonly options: readonly ExecutionInteractionPresentationOption[];
}

export interface StoreExecutionInteractionPresentationInput {
  readonly kind: ExecutionInteractionPresentationKind;
  readonly title: string;
  readonly description?: string;
  readonly options: readonly ExecutionInteractionPresentationOption[];
}

/** Narrow write port provider interaction bridges depend on. */
export interface ExecutionInteractionPresentationPort {
  store(input: StoreExecutionInteractionPresentationInput): Promise<{ readonly presentationRef: string }>;
}

export interface InteractionPresentationRecoveryResult {
  readonly retained: number;
  readonly removed: number;
  readonly totalBytes: number;
}

const SCHEMA_VERSION = 1;
const MAX_PRESENTATION_BYTES = 64 * 1024;
const MAX_PRESENTATION_RECORDS = 4_096;
const MAX_PRESENTATION_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_TITLE_LENGTH = 512;
const MAX_DESCRIPTION_LENGTH = 8 * 1024;
const MAX_OPTION_COUNT = 64;
const MAX_OPTION_LABEL_LENGTH = 512;
const MAX_OPTION_DESCRIPTION_LENGTH = 2 * 1024;
const MAX_RESPONSE_ID_LENGTH = 256;

const storageQueues = new WeakMap<object, Promise<void>>();

/** Durable, content-addressed, display-only interaction details. */
export class ExecutionInteractionPresentationStore {
  constructor(
    private readonly storage: DurableStorage,
    private readonly digest: Sha256DigestPort,
    private readonly maxRecordBytes = MAX_PRESENTATION_BYTES,
    private readonly maxRecords = MAX_PRESENTATION_RECORDS,
    private readonly maxTotalBytes = MAX_PRESENTATION_TOTAL_BYTES,
  ) {
    requirePositive(maxRecordBytes, 'Interaction presentation byte limit');
    requirePositive(maxRecords, 'Interaction presentation record limit');
    requirePositive(maxTotalBytes, 'Interaction presentation aggregate byte limit');
    if (maxRecordBytes > maxTotalBytes) {
      throw new Error('Interaction presentation record limit exceeds its aggregate limit.');
    }
  }

  store(
    input: StoreExecutionInteractionPresentationInput,
  ): Promise<ExecutionInteractionPresentation> {
    return this.enqueue(() => this.storeUnlocked(input));
  }

  read(presentationRef: string): Promise<ExecutionInteractionPresentation | null> {
    return this.enqueue(() => this.readUnlocked(presentationRef));
  }

  /** Removes crash/timeout orphans not referenced by durable interaction records. */
  recover(
    retainedPresentationRefs: readonly string[],
  ): Promise<InteractionPresentationRecoveryResult> {
    return this.enqueue(() => this.recoverUnlocked(retainedPresentationRefs));
  }

  private async storeUnlocked(
    input: StoreExecutionInteractionPresentationInput,
  ): Promise<ExecutionInteractionPresentation> {
    const content = normalizePresentationContent(input);
    const contentDigest = await this.digest.digestUtf8(JSON.stringify(content));
    requireDigest(contentDigest);
    const presentationRef = `pr-${contentDigest}`;
    const record = Object.freeze({ presentationRef, ...content });
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...record });
    const byteSize = requireBoundedRaw(raw, this.maxRecordBytes);
    const path = presentationPath(record.presentationRef);
    const existing = await this.storage.readBounded(path, this.maxRecordBytes);
    if (existing !== null) {
      if (existing !== raw) {
        throw new Error(`Interaction presentation "${record.presentationRef}" conflicts.`);
      }
      return record;
    }
    const inventory = await this.readInventory();
    if (inventory.paths.length >= this.maxRecords
      || inventory.totalBytes + byteSize > this.maxTotalBytes) {
      throw new Error('Interaction presentation storage capacity is exhausted.');
    }
    if (!(await this.storage.compareAndSwapBounded(
      path,
      null,
      raw,
      this.maxRecordBytes,
    ))) {
      const raced = await this.storage.readBounded(path, this.maxRecordBytes);
      if (raced !== raw) {
        throw new Error(`Interaction presentation "${record.presentationRef}" conflicts.`);
      }
    }
    return record;
  }

  private async readUnlocked(
    presentationRef: string,
  ): Promise<ExecutionInteractionPresentation | null> {
    const path = presentationPath(presentationRef);
    const raw = await this.storage.readBounded(path, this.maxRecordBytes);
    if (raw === null) return null;
    requireBoundedRaw(raw, this.maxRecordBytes);
    const record = decodePresentation(raw, presentationRef);
    const contentDigest = await this.digest.digestUtf8(JSON.stringify({
      kind: record.kind,
      title: record.title,
      ...(record.description ? { description: record.description } : {}),
      options: record.options,
    }));
    requireDigest(contentDigest);
    if (presentationRef !== `pr-${contentDigest}`) {
      throw new Error('Interaction presentation content digest is invalid.');
    }
    return record;
  }

  private async recoverUnlocked(
    retainedPresentationRefs: readonly string[],
  ): Promise<InteractionPresentationRecoveryResult> {
    const rawRetained: unknown = retainedPresentationRefs;
    if (!Array.isArray(rawRetained)
      || rawRetained.length > this.maxRecords) {
      throw new Error('Retained interaction presentation inventory is invalid.');
    }
    const retained = new Set<string>();
    for (const presentationRef of rawRetained as unknown[]) {
      if (typeof presentationRef !== 'string') {
        throw new Error('Retained interaction presentation inventory is invalid.');
      }
      requirePresentationRef(presentationRef);
      retained.add(presentationRef);
    }
    const paths = await this.listCanonicalPaths();
    let removed = 0;
    for (const path of paths) {
      const ref = presentationRefFromPath(path);
      if (ref && !retained.has(ref)) {
        await this.storage.remove(path);
        removed += 1;
      }
    }
    const inventory = await this.readInventory();
    if (inventory.paths.length > this.maxRecords || inventory.totalBytes > this.maxTotalBytes) {
      throw new Error('Retained interaction presentation storage exceeds its capacity.');
    }
    for (const presentationRef of retained) {
      if (!inventory.paths.includes(presentationPath(presentationRef))) {
        throw new Error(`Retained interaction presentation "${presentationRef}" is missing.`);
      }
      await this.readUnlocked(presentationRef);
    }
    return Object.freeze({
      retained: inventory.paths.length,
      removed,
      totalBytes: inventory.totalBytes,
    });
  }

  private async readInventory(): Promise<{ readonly paths: string[]; readonly totalBytes: number }> {
    const paths = await this.listCanonicalPaths();
    if (paths.length > this.maxRecords) {
      throw new Error('Interaction presentation storage record capacity is exceeded.');
    }
    let totalBytes = 0;
    for (const path of paths) {
      const raw = await this.storage.readBounded(path, this.maxRecordBytes);
      if (raw === null) continue;
      totalBytes += new TextEncoder().encode(raw).byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > this.maxTotalBytes) {
        throw new Error('Interaction presentation storage byte capacity is exceeded.');
      }
    }
    return { paths, totalBytes };
  }

  private async listCanonicalPaths(): Promise<string[]> {
    const paths = await this.storage.list(EXECUTION_PRESENTATIONS_PATH);
    return paths.filter(path => presentationRefFromPath(path) !== null).sort();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = storageQueues.get(this.storage) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(() => undefined, () => undefined);
    storageQueues.set(this.storage, tail);
    return current.finally(() => {
      if (storageQueues.get(this.storage) === tail) storageQueues.delete(this.storage);
    });
  }
}

function normalizePresentationContent(
  input: StoreExecutionInteractionPresentationInput,
): Omit<ExecutionInteractionPresentation, 'presentationRef'> {
  if (!isPresentationKind(input.kind)) {
    throw new Error('Interaction presentation kind is invalid.');
  }
  const title = requireDisplayText(input.title, 'title', MAX_TITLE_LENGTH);
  const description = input.description === undefined
    ? undefined
    : requireDisplayText(input.description, 'description', MAX_DESCRIPTION_LENGTH);
  const rawOptions: unknown = input.options;
  if (!Array.isArray(rawOptions)
    || Object.getPrototypeOf(rawOptions) !== Array.prototype
    || rawOptions.length === 0
    || rawOptions.length > MAX_OPTION_COUNT) {
    throw new Error('Interaction presentation options are invalid.');
  }
  const responseIds = new Set<string>();
  const options: ExecutionInteractionPresentationOption[] = [];
  for (let index = 0; index < rawOptions.length; index += 1) {
    const option: unknown = rawOptions[index];
    if (!isRecord(option)) {
      throw new Error(`Interaction presentation option ${index} is invalid.`);
    }
    const responseId = requireIdentifier(
      option.responseId,
      `option ${index} response id`,
      MAX_RESPONSE_ID_LENGTH,
    );
    if (responseIds.has(responseId)) {
      throw new Error('Interaction presentation response ids must be unique.');
    }
    responseIds.add(responseId);
    const label = requireDisplayText(
      option.label,
      `option ${index} label`,
      MAX_OPTION_LABEL_LENGTH,
    );
    const optionDescription = option.description === undefined
      ? undefined
      : requireDisplayText(
        option.description,
        `option ${index} description`,
        MAX_OPTION_DESCRIPTION_LENGTH,
      );
    options.push(Object.freeze({
      responseId,
      label,
      ...(optionDescription ? { description: optionDescription } : {}),
    }));
  }
  return Object.freeze({
    kind: input.kind,
    title,
    ...(description ? { description } : {}),
    options: Object.freeze(options),
  });
}

function decodePresentation(
  raw: string,
  expectedPresentationRef: string,
): ExecutionInteractionPresentation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('Interaction presentation JSON is invalid.', { cause: error });
  }
  if (!isRecord(parsed)) throw new Error('Interaction presentation record is invalid.');
  const expectedKeys = new Set([
    'schemaVersion', 'presentationRef', 'kind', 'title', 'description', 'options',
  ]);
  if (Object.keys(parsed).some(key => !expectedKeys.has(key))
    || parsed.schemaVersion !== SCHEMA_VERSION
    || parsed.presentationRef !== expectedPresentationRef
    || !Array.isArray(parsed.options)) {
    throw new Error('Interaction presentation record identity is invalid.');
  }
  if (!isPresentationKind(parsed.kind)) {
    throw new Error('Interaction presentation record kind is invalid.');
  }
  const content = normalizePresentationContent({
    kind: parsed.kind,
    title: parsed.title as string,
    ...(parsed.description !== undefined ? { description: parsed.description as string } : {}),
    options: parsed.options as ExecutionInteractionPresentationOption[],
  });
  return Object.freeze({ presentationRef: expectedPresentationRef, ...content });
}

function presentationPath(presentationRef: string): string {
  requirePresentationRef(presentationRef);
  return `${EXECUTION_PRESENTATIONS_PATH}/${presentationRef}.json`;
}

function presentationRefFromPath(path: string): string | null {
  const prefix = `${EXECUTION_PRESENTATIONS_PATH}/`;
  if (!path.startsWith(prefix) || !path.endsWith('.json')) return null;
  const ref = path.slice(prefix.length, -'.json'.length);
  return /^pr-[0-9a-f]{64}$/.test(ref) ? ref : null;
}

function requirePresentationRef(value: string): void {
  if (!/^pr-[0-9a-f]{64}$/.test(value)) {
    throw new Error('Interaction presentation ref must be a content-addressed pr identifier.');
  }
}

function requireDisplayText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Interaction presentation ${label} must be text.`);
  }
  if (value.length < 1 || value.length > maxLength) {
    throw new Error(`Interaction presentation ${label} is invalid.`);
  }
  const normalized = value.trim();
  if (!normalized || containsUnsafeControl(normalized)) {
    throw new Error(`Interaction presentation ${label} is invalid.`);
  }
  return normalized;
}

function requireIdentifier(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maxLength
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) {
    throw new Error(`Interaction presentation ${label} is invalid.`);
  }
  return value;
}

function containsUnsafeControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code >= 0 && code <= 8)
      || code === 11
      || code === 12
      || (code >= 14 && code <= 31)
      || code === 127) return true;
  }
  return false;
}

function requireBoundedRaw(raw: string, maxBytes: number): number {
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes > maxBytes) throw new Error('Interaction presentation exceeds its byte limit.');
  return bytes;
}

function requirePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function requireDigest(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Interaction presentation digest is invalid.');
  }
}

function isPresentationKind(value: unknown): value is ExecutionInteractionPresentationKind {
  return value === 'approval' || value === 'question' || value === 'plan-decision';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
