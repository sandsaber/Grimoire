import { createHash } from 'node:crypto';

import type { ProviderSettingsCodec } from '@/core/providers/ProviderModule';
import {
  canonicalJson,
  fingerprintProviderSettings,
  type Sha256DigestPort,
} from '@/core/providers/ProviderSettingsFingerprint';

const digestPort: Sha256DigestPort = {
  digestUtf8: async value => createHash('sha256').update(value, 'utf8').digest('hex'),
};

function codec(): ProviderSettingsCodec<object> {
  return {
    providerId: 'fake',
    schemaVersion: 3,
    defaults: () => ({}),
    decode: () => ({ ok: true, value: {}, preservedUnknown: {} }),
    encode: value => ({ ...value }),
    runtimeFingerprintInput: value => ({
      nested: Reflect.get(value, 'nested'),
      runtime: Reflect.get(value, 'runtime'),
    }),
  };
}

describe('ProviderSettingsFingerprint', () => {
  it('is stable across object insertion order and ignores presentation-only settings', async () => {
    const first = await fingerprintProviderSettings(codec(), {
      runtime: 'same',
      nested: { z: 1, a: 2 },
      label: 'first',
    }, digestPort);
    const second = await fingerprintProviderSettings(codec(), {
      label: 'second',
      nested: { a: 2, z: 1 },
      runtime: 'same',
    }, digestPort);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ algorithm: 'sha256', version: 1 });
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the provider runtime input or schema changes', async () => {
    const first = await fingerprintProviderSettings(codec(), {
      runtime: 'first',
      nested: {},
    }, digestPort);
    const second = await fingerprintProviderSettings(codec(), {
      runtime: 'second',
      nested: {},
    }, digestPort);
    const nextCodec = { ...codec(), schemaVersion: 4 };
    const nextSchema = await fingerprintProviderSettings(nextCodec, {
      runtime: 'first',
      nested: {},
    }, digestPort);

    expect(second.digest).not.toBe(first.digest);
    expect(nextSchema.digest).not.toBe(first.digest);
  });

  it('rejects ambiguous, cyclic, and non-canonical inputs', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => canonicalJson({ value: undefined })).toThrow('undefined');
    expect(() => canonicalJson({ value: Number.NaN })).toThrow('non-finite');
    expect(() => canonicalJson(cyclic)).toThrow('cycles');
    await expect(fingerprintProviderSettings(codec(), { runtime: '', nested: {} }, {
      digestUtf8: async () => 'not-a-digest',
    })).rejects.toThrow('non-canonical digest');
  });
});
