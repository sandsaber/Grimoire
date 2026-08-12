export interface EphemeralExecutionRequest<TPayload = unknown> {
  readonly kind: string;
  readonly payload: TPayload;
  readonly byteSize: number;
}

/**
 * Application-owned one-process request memory. Raw prompts, launch specs,
 * environments, and native interaction payloads never enter durable control records.
 */
export class EphemeralExecutionRequestStore {
  private readonly requests = new Map<string, EphemeralExecutionRequest>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries = 2_048,
    private readonly maxPayloadBytes = 4 * 1024 * 1024,
    private readonly maxTotalBytes = 16 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Ephemeral execution request limit must be a positive safe integer.');
    }
    requireByteLimit(maxPayloadBytes, 'payload');
    requireByteLimit(maxTotalBytes, 'aggregate');
    if (maxPayloadBytes > maxTotalBytes) {
      throw new Error('Ephemeral payload limit cannot exceed the aggregate byte limit.');
    }
  }

  register<TPayload>(
    requestRef: string,
    kind: string,
    payload: TPayload,
  ): void {
    requireRequestRef(requestRef);
    requireKind(kind);
    const snapshot = snapshotPayload(payload, this.maxPayloadBytes);
    const existing = this.requests.get(requestRef);
    if (existing) {
      if (existing.kind !== kind || !samePlainData(existing.payload, snapshot.payload)) {
        throw new Error(`Execution request "${requestRef}" is already registered.`);
      }
      return;
    }
    if (this.requests.size >= this.maxEntries) {
      throw new Error('Ephemeral execution request capacity is exhausted.');
    }
    if (this.totalBytes + snapshot.byteSize > this.maxTotalBytes) {
      throw new Error('Ephemeral execution request byte capacity is exhausted.');
    }
    this.requests.set(requestRef, Object.freeze({
      kind,
      payload: snapshot.payload,
      byteSize: snapshot.byteSize,
    }));
    this.totalBytes += snapshot.byteSize;
  }

  resolve<TPayload>(requestRef: string, kind: string): TPayload {
    requireRequestRef(requestRef);
    requireKind(kind);
    const request = this.requests.get(requestRef);
    if (!request || request.kind !== kind) {
      throw new Error(`Execution request "${requestRef}" is unavailable for ${kind}.`);
    }
    return request.payload as TPayload;
  }

  take<TPayload>(requestRef: string, kind: string): TPayload {
    const payload = this.resolve<TPayload>(requestRef, kind);
    this.remove(requestRef);
    return payload;
  }

  forget(requestRef: string): void {
    requireRequestRef(requestRef);
    this.remove(requestRef);
  }

  clear(): void {
    this.requests.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.requests.size;
  }

  get retainedBytes(): number {
    return this.totalBytes;
  }

  private remove(requestRef: string): void {
    const request = this.requests.get(requestRef);
    if (!request) return;
    this.requests.delete(requestRef);
    this.totalBytes -= request.byteSize;
  }
}

function snapshotPayload<T>(value: T, maxBytes: number): {
  readonly payload: T;
  readonly byteSize: number;
} {
  const active = new WeakSet<object>();
  let bytes = 0;
  const add = (amount: number): void => {
    bytes += amount;
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) {
      throw new Error('Ephemeral execution request payload exceeds the byte limit.');
    }
  };
  const visit = (entry: unknown): unknown => {
    if (entry === null || entry === undefined) {
      add(4);
      return entry;
    } else if (typeof entry === 'string') {
      add(new TextEncoder().encode(entry).byteLength);
      return entry;
    } else if (typeof entry === 'number' || typeof entry === 'bigint') {
      add(8);
      return entry;
    } else if (typeof entry === 'boolean') {
      add(4);
      return entry;
    } else if (typeof entry === 'function' || typeof entry === 'symbol') {
      throw new Error('Ephemeral execution request payload contains an unsupported value.');
    } else if (typeof entry === 'object') {
      if (active.has(entry)) {
        throw new Error('Ephemeral execution request payload cannot contain cycles.');
      }
      active.add(entry);
      if (Array.isArray(entry)) {
        if (Object.getPrototypeOf(entry) !== Array.prototype) {
          throw new Error('Ephemeral execution request payload must use built-in arrays.');
        }
        add(8 + entry.length);
        const copy: unknown[] = [];
        copy.length = entry.length;
        for (const key of Reflect.ownKeys(entry)) {
          if (typeof key !== 'string') {
            throw new Error('Ephemeral execution request arrays cannot have custom properties.');
          }
          if (key === 'length') continue;
          if (!isCanonicalArrayIndex(key, entry.length)) {
            throw new Error('Ephemeral execution request arrays cannot have custom properties.');
          }
          const descriptor = Object.getOwnPropertyDescriptor(entry, key);
          if (!descriptor) {
            throw new Error('Ephemeral execution request array descriptor is unavailable.');
          }
          if (descriptor.get || descriptor.set) {
            throw new Error('Ephemeral execution request payload cannot contain accessors.');
          }
          Object.defineProperty(copy, key, {
            configurable: true,
            enumerable: descriptor.enumerable,
            value: visit(descriptor.value),
            writable: true,
          });
        }
        active.delete(entry);
        return Object.freeze(copy);
      }
      const prototype = Object.getPrototypeOf(entry) as unknown;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('Ephemeral execution request payload must use plain data values.');
      }
      add(8);
      const copy: Record<string, unknown> = {};
      for (const key of Reflect.ownKeys(entry)) {
        if (typeof key !== 'string') {
          throw new Error('Ephemeral execution request payload cannot contain symbol keys.');
        }
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor) {
          throw new Error('Ephemeral execution request property descriptor is unavailable.');
        }
        if (descriptor.get || descriptor.set) {
          throw new Error('Ephemeral execution request payload cannot contain accessors.');
        }
        if (!descriptor.enumerable) continue;
        add(new TextEncoder().encode(key).byteLength);
        Object.defineProperty(copy, key, {
          configurable: true,
          enumerable: true,
          value: visit(descriptor.value),
          writable: true,
        });
      }
      active.delete(entry);
      return Object.freeze(copy);
    }
    throw new Error('Ephemeral execution request payload contains an unsupported value.');
  };
  return { payload: visit(value) as T, byteSize: bytes };
}

function samePlainData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((entry, index) => Object.hasOwn(right, index)
        && samePlainData(entry, right[index]))
      && right.every((_entry, index) => Object.hasOwn(left, index));
  }
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => Object.hasOwn(right, key)
        && samePlainData(left[key], right[key]));
  }
  return false;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index)
    && index >= 0
    && index < length
    && index < 4_294_967_295
    && String(index) === key;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function requireByteLimit(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Ephemeral ${label} byte limit must be a positive safe integer.`);
  }
}

function requireRequestRef(value: string): void {
  if (!/^req-[0-9a-f]{32}$/.test(value)) {
    throw new Error('Execution request ref must be an opaque req identifier.');
  }
}

function requireKind(value: string): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error('Execution request kind is invalid.');
  }
}
