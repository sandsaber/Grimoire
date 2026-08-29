/**
 * FNV-1a over a model or command catalog cache key.
 *
 * Catalog keys embed the raw environment variables the CLI runs with, which
 * can hold an API key, so only this digest is ever persisted next to a
 * discovered list. The output must stay byte-identical across releases:
 * catalogs persisted by earlier builds carry digests that later loads compare
 * against.
 */
export function hashCatalogFingerprint(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Whether a persisted catalog may be trusted under the current cache key.
 *
 * A catalog persisted before the fingerprint existed carries no record of the
 * key it came from, so it keeps the trust it always had rather than costing a
 * CLI probe to migrate. Once a digest is recorded, the catalog is trusted only
 * while the key still hashes to it.
 */
export function seedFingerprintMatches(recordedFingerprint: string | undefined, key: string): boolean {
  return !recordedFingerprint || recordedFingerprint === hashCatalogFingerprint(key);
}
