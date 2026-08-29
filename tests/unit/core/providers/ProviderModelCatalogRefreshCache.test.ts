import { hashCatalogFingerprint } from '@/core/providers/catalogFingerprint';
import { ProviderModelCatalogRefreshCache } from '@/core/providers/ProviderModelCatalogRefreshCache';

describe('ProviderModelCatalogRefreshCache', () => {
  it('uses a seeded catalog while its fingerprint remains fresh', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    cache.seed('cli-a:env-a');

    await expect(cache.refresh({
      fingerprint: 'cli-a:env-a',
      hasCachedModels: true,
      load,
    })).resolves.toBe('skipped');
    expect(load).not.toHaveBeenCalled();
  });

  it('refreshes immediately when the CLI or environment fingerprint changes', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    cache.seed('cli-a:env-a');

    await expect(cache.refresh({
      fingerprint: 'cli-b:env-a',
      hasCachedModels: true,
      load,
    })).resolves.toBe('refreshed');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent refreshes for the same fingerprint', async () => {
    let resolveLoad!: (outcome: 'refreshed' | 'failed') => void;
    const load = jest.fn(() => new Promise<'refreshed' | 'failed'>((resolve) => {
      resolveLoad = resolve;
    }));
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    const request = { fingerprint: 'cli-a:env-a', hasCachedModels: false, load };

    const first = cache.refresh(request);
    const second = cache.refresh(request);
    resolveLoad('refreshed');

    await expect(Promise.all([first, second])).resolves.toEqual(['refreshed', 'refreshed']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not mark failed refreshes as fresh', async () => {
    const load = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('failed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    const request = { fingerprint: 'cli-a:env-a', hasCachedModels: true, load };

    await expect(cache.refresh(request)).rejects.toThrow('offline');
    await expect(cache.refresh(request)).resolves.toBe('failed');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let an older environment refresh overwrite newer freshness', async () => {
    let resolveOld!: (outcome: 'refreshed' | 'failed') => void;
    let resolveNew!: (outcome: 'refreshed' | 'failed') => void;
    const oldLoad = jest.fn(() => new Promise<'refreshed' | 'failed'>((resolve) => {
      resolveOld = resolve;
    }));
    const newLoad = jest.fn(() => new Promise<'refreshed' | 'failed'>((resolve) => {
      resolveNew = resolve;
    }));
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);

    const oldRefresh = cache.refresh({ fingerprint: 'old-env', hasCachedModels: false, load: oldLoad });
    const newRefresh = cache.refresh({ fingerprint: 'new-env', hasCachedModels: false, load: newLoad });
    resolveNew('failed');
    await newRefresh;
    resolveOld('failed');
    await oldRefresh;

    const reloadOld = jest.fn().mockResolvedValue('failed');
    await cache.refresh({ fingerprint: 'old-env', hasCachedModels: true, load: reloadOld });
    expect(reloadOld).toHaveBeenCalledTimes(1);
  });

  it('applies a deferred seed once the resolved CLI path is known', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    cache.seedOnFirstRefresh(() => 'cli-a:env-a');

    expect(cache.applyDeferredSeed('cli-a:env-a', true)).toBe(true);
    await expect(cache.refresh({
      fingerprint: 'cli-a:env-a',
      hasCachedModels: true,
      load,
    })).resolves.toBe('skipped');
    expect(load).not.toHaveBeenCalled();
  });

  it('drops a deferred seed when more than the CLI path changed since construction', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    cache.seedOnFirstRefresh(() => 'cli-a:env-a');

    expect(cache.applyDeferredSeed('cli-a:env-b', true)).toBe(false);
    await expect(cache.refresh({
      fingerprint: 'cli-a:env-b',
      hasCachedModels: true,
      load,
    })).resolves.toBe('refreshed');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('consumes a deferred seed even when the cached catalog is gone', () => {
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    cache.seedOnFirstRefresh(() => 'cli-a:env-a');

    expect(cache.applyDeferredSeed('cli-a:env-a', false)).toBe(false);
    expect(cache.applyDeferredSeed('cli-a:env-a', true)).toBe(false);
  });

  it('seeds while the recorded fingerprint still describes the current key', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);

    expect(cache.seed('cli-a:env-a', hashCatalogFingerprint('cli-a:env-a'))).toBe(true);
    await expect(cache.refresh({
      fingerprint: 'cli-a:env-a',
      hasCachedModels: true,
      load,
    })).resolves.toBe('skipped');
    expect(load).not.toHaveBeenCalled();
  });

  it('drops a seed whose recorded fingerprint belongs to a different key', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);

    expect(cache.seed('cli-b:env-a', hashCatalogFingerprint('cli-a:env-a'))).toBe(false);
    await expect(cache.refresh({
      fingerprint: 'cli-b:env-a',
      hasCachedModels: true,
      load,
    })).resolves.toBe('refreshed');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps trusting a seed recorded before the fingerprint existed', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);

    expect(cache.seed('cli-a:env-a', '')).toBe(true);
    await expect(cache.refresh({
      fingerprint: 'cli-a:env-a',
      hasCachedModels: true,
      load,
    })).resolves.toBe('skipped');
    expect(load).not.toHaveBeenCalled();
  });

  it('applies a deferred seed whose recorded fingerprint matches', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    cache.seedOnFirstRefresh(() => 'cli-a:env-a');

    expect(cache.applyDeferredSeed('cli-a:env-a', true, hashCatalogFingerprint('cli-a:env-a')))
      .toBe(true);
    await expect(cache.refresh({
      fingerprint: 'cli-a:env-a',
      hasCachedModels: true,
      load,
    })).resolves.toBe('skipped');
    expect(load).not.toHaveBeenCalled();
  });

  it('drops a deferred seed whose recorded fingerprint belongs to a different key', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    cache.seedOnFirstRefresh(() => 'cli-a:env-a');

    expect(cache.applyDeferredSeed('cli-a:env-a', true, hashCatalogFingerprint('cli-a:env-b')))
      .toBe(false);
    expect(cache.applyDeferredSeed('cli-a:env-a', true, hashCatalogFingerprint('cli-a:env-a')))
      .toBe(false);
    await expect(cache.refresh({
      fingerprint: 'cli-a:env-a',
      hasCachedModels: true,
      load,
    })).resolves.toBe('refreshed');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps a settled catalog fresh past the TTL until its fingerprint changes', async () => {
    let now = 100;
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => now);
    cache.seed('cli-a:env-a');

    now += 10_000;
    await expect(cache.refresh({ fingerprint: 'cli-a:env-a', hasCachedModels: true, load }))
      .resolves.toBe('skipped');
    expect(load).not.toHaveBeenCalled();

    await expect(cache.refresh({ fingerprint: 'cli-b:env-a', hasCachedModels: true, load }))
      .resolves.toBe('refreshed');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('paces retries of an empty attempt by the TTL instead of retrying on every open', async () => {
    let now = 100;
    const load = jest.fn().mockResolvedValue('failed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => now);
    const request = { fingerprint: 'cli-a:env-a', hasCachedModels: false, load };

    await cache.refresh(request);
    now += 500;
    await cache.refresh(request);
    expect(load).toHaveBeenCalledTimes(1);

    now += 600;
    await cache.refresh(request);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads a settled catalog when the caller forces it', async () => {
    const load = jest.fn().mockResolvedValue('refreshed');
    const cache = new ProviderModelCatalogRefreshCache(1_000, () => 100);
    cache.seed('cli-a:env-a');

    await expect(cache.refresh({ fingerprint: 'cli-a:env-a', force: true, hasCachedModels: true, load }))
      .resolves.toBe('refreshed');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
