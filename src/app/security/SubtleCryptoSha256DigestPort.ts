import type { Sha256DigestPort } from '../../core/providers/ProviderSettingsFingerprint';

export class SubtleCryptoSha256DigestPort implements Sha256DigestPort {
  constructor(private readonly subtle: SubtleCrypto) {}

  async digestUtf8(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await this.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }
}
