import type { ProviderSettingsCodec } from './ProviderModule';

export const PROVIDER_SETTINGS_FINGERPRINT_VERSION = 1;

export interface Sha256DigestPort {
  digestUtf8(value: string): Promise<string>;
}

export interface ProviderSettingsFingerprint {
  readonly algorithm: 'sha256';
  readonly version: typeof PROVIDER_SETTINGS_FINGERPRINT_VERSION;
  readonly digest: string;
}

/**
 * Builds a data-minimized change detector. The canonical preimage is never
 * returned and must not be written to lifecycle records or diagnostics.
 */
export async function fingerprintProviderSettings(
  codec: ProviderSettingsCodec<object>,
  settings: object,
  digestPort: Sha256DigestPort,
): Promise<ProviderSettingsFingerprint> {
  const preimage = canonicalJson({
    providerId: codec.providerId,
    settingsSchemaVersion: codec.schemaVersion,
    fingerprintVersion: PROVIDER_SETTINGS_FINGERPRINT_VERSION,
    runtime: codec.runtimeFingerprintInput(settings),
  });
  const digest = (await digestPort.digestUtf8(preimage)).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('SHA-256 digest port returned a non-canonical digest.');
  }
  return Object.freeze({
    algorithm: 'sha256',
    version: PROVIDER_SETTINGS_FINGERPRINT_VERSION,
    digest,
  });
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, new Set<object>());
}

function serializeCanonical(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Canonical settings input cannot contain a non-finite number.');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return withAncestor(value, ancestors, () => (
      `[${value.map(item => serializeCanonical(item, ancestors)).join(',')}]`
    ));
  }
  if (isPlainRecord(value)) {
    return withAncestor(value, ancestors, () => {
      const entries = Object.keys(value).sort().map(key => {
        const entry = value[key];
        if (entry === undefined) {
          throw new Error('Canonical settings input cannot contain undefined values.');
        }
        return `${JSON.stringify(key)}:${serializeCanonical(entry, ancestors)}`;
      });
      return `{${entries.join(',')}}`;
    });
  }
  throw new Error(`Canonical settings input contains unsupported type "${typeof value}".`);
}

function withAncestor<TResult>(
  value: object,
  ancestors: Set<object>,
  task: () => TResult,
): TResult {
  if (ancestors.has(value)) {
    throw new Error('Canonical settings input cannot contain cycles.');
  }
  ancestors.add(value);
  try {
    return task();
  } finally {
    ancestors.delete(value);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
