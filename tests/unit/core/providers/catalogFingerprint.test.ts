import { hashCatalogFingerprint, seedFingerprintMatches } from '@/core/providers/catalogFingerprint';

describe('catalogFingerprint', () => {
  it('hashes a key to eight lowercase hex characters', () => {
    expect(hashCatalogFingerprint('{"cliPath":"/usr/local/bin/codex"}')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('keeps the digest Claude persisted before the helper moved to core', () => {
    // Standard FNV-1a 32-bit vectors. Persisted fingerprints are compared
    // against this output, so any drift here would silently re-probe every
    // existing install.
    expect(hashCatalogFingerprint('')).toBe('811c9dc5');
    expect(hashCatalogFingerprint('a')).toBe('e40c292c');
  });

  it('trusts a catalog recorded before the fingerprint existed', () => {
    expect(seedFingerprintMatches('', 'cli-a:env-a')).toBe(true);
    expect(seedFingerprintMatches(undefined, 'cli-a:env-a')).toBe(true);
  });

  it('matches only the key whose digest was recorded', () => {
    const recorded = hashCatalogFingerprint('cli-a:env-a');

    expect(seedFingerprintMatches(recorded, 'cli-a:env-a')).toBe(true);
    expect(seedFingerprintMatches(recorded, 'cli-b:env-a')).toBe(false);
  });
});
