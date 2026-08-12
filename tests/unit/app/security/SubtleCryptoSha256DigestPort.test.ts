import { webcrypto } from 'node:crypto';

import { SubtleCryptoSha256DigestPort } from '@/app/security/SubtleCryptoSha256DigestPort';

describe('SubtleCryptoSha256DigestPort', () => {
  it('returns the canonical UTF-8 SHA-256 digest', async () => {
    const port = new SubtleCryptoSha256DigestPort(webcrypto.subtle as unknown as SubtleCrypto);

    await expect(port.digestUtf8('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
