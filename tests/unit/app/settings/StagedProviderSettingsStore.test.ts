import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { DurableStagedProviderSettingsStore } from '@/app/settings/StagedProviderSettingsStore';
import {
  GRIMOIRE_SETTINGS_PATH,
  PROVIDER_SETTINGS_STAGING_PATH,
} from '@/core/bootstrap/StoragePaths';

const TRANSACTION_ID = `tx-${'1'.repeat(32)}`;
const RUNTIME_FINGERPRINTS = {
  first: { algorithm: 'sha256' as const, version: 1 as const, digest: 'a'.repeat(64) },
};

describe('DurableStagedProviderSettingsStore', () => {
  it('atomically activates provider configs without replacing unrelated settings', async () => {
    const storage = new TestDurableStorage();
    storage.seed(GRIMOIRE_SETTINGS_PATH, JSON.stringify({
      locale: 'ru',
      futureTopLevel: { retained: true },
      providerConfigs: { first: { enabled: true, old: true } },
    }));
    const store = new DurableStagedProviderSettingsStore(storage);
    const configs = {
      first: { enabled: false, futureProviderField: 'retained' },
      unknown: { opaque: true },
    };

    await store.stage(TRANSACTION_ID, patch(
      { first: { enabled: true, old: true }, unknown: null },
      configs,
      RUNTIME_FINGERPRINTS,
    ));
    await expect(store.listStagedTransactionIds()).resolves.toEqual([TRANSACTION_ID]);
    await store.activate(TRANSACTION_ID);
    await store.activate(TRANSACTION_ID);

    expect(JSON.parse(storage.get(GRIMOIRE_SETTINGS_PATH) ?? '')).toEqual({
      locale: 'ru',
      futureTopLevel: { retained: true },
      providerConfigs: configs,
      providerRuntimeFingerprints: RUNTIME_FINGERPRINTS,
    });
    expect(await store.readActive()).toEqual({
      configs,
      runtimeFingerprints: RUNTIME_FINGERPRINTS,
    });
    expect(storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .not.toBeNull();
    await store.clear(TRANSACTION_ID);
    expect(storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`)).toBeNull();
    await expect(store.listStagedTransactionIds()).resolves.toEqual([]);
  });

  it('allows identical restaging but rejects conflicting contents', async () => {
    const storage = new TestDurableStorage();
    const store = new DurableStagedProviderSettingsStore(storage);

    await store.stage(TRANSACTION_ID, patch(
      { first: null },
      { first: { enabled: true } },
      RUNTIME_FINGERPRINTS,
    ));
    await expect(store.stage(
      TRANSACTION_ID,
      patch({ first: null }, { first: { enabled: true } }, RUNTIME_FINGERPRINTS),
    ))
      .resolves.toBeUndefined();
    await expect(store.stage(
      TRANSACTION_ID,
      patch({ first: null }, { first: { enabled: false } }, RUNTIME_FINGERPRINTS),
    ))
      .rejects.toThrow('conflicting contents');
  });

  it('atomically rejects concurrent conflicting stages from distinct owners', async () => {
    const storage = new TestDurableStorage();
    const first = new DurableStagedProviderSettingsStore(storage);
    const second = new DurableStagedProviderSettingsStore(storage);
    const results = await Promise.allSettled([
      first.stage(
        TRANSACTION_ID,
        patch({ first: null }, { first: { enabled: true } }, RUNTIME_FINGERPRINTS),
      ),
      second.stage(
        TRANSACTION_ID,
        patch({ first: null }, { first: { enabled: false } }, RUNTIME_FINGERPRINTS),
      ),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('merges disjoint staged patches from distinct owners', async () => {
    const storage = new TestDurableStorage();
    storage.seed(GRIMOIRE_SETTINGS_PATH, JSON.stringify({
      providerConfigs: {
        first: { enabled: true },
        second: { enabled: true },
      },
    }));
    const first = new DurableStagedProviderSettingsStore(storage);
    const second = new DurableStagedProviderSettingsStore(storage);
    const secondTransactionId = `tx-${'2'.repeat(32)}`;

    await first.stage(TRANSACTION_ID, patch(
      { first: { enabled: true } },
      { first: { enabled: false } },
      { first: RUNTIME_FINGERPRINTS.first },
    ));
    await second.stage(secondTransactionId, patch(
      { second: { enabled: true } },
      { second: { enabled: false } },
      { second: { ...RUNTIME_FINGERPRINTS.first, digest: 'b'.repeat(64) } },
    ));
    await Promise.all([first.activate(TRANSACTION_ID), second.activate(secondTransactionId)]);

    await expect(first.readActive()).resolves.toMatchObject({
      configs: {
        first: { enabled: false },
        second: { enabled: false },
      },
      runtimeFingerprints: {
        first: RUNTIME_FINGERPRINTS.first,
        second: { digest: 'b'.repeat(64) },
      },
    });
  });

  it('rejects same-provider drift after staging without overwriting it', async () => {
    const storage = new TestDurableStorage();
    storage.seed(GRIMOIRE_SETTINGS_PATH, JSON.stringify({
      providerConfigs: { first: { enabled: true, endpoint: 'initial' } },
    }));
    const store = new DurableStagedProviderSettingsStore(storage);
    await store.stage(TRANSACTION_ID, patch(
      { first: { enabled: true, endpoint: 'initial' } },
      { first: { enabled: false, endpoint: 'transaction' } },
      RUNTIME_FINGERPRINTS,
    ));
    storage.seed(GRIMOIRE_SETTINGS_PATH, JSON.stringify({
      providerConfigs: { first: { enabled: true, endpoint: 'external' } },
    }));

    await expect(store.activate(TRANSACTION_ID)).rejects.toThrow(
      'changed after transaction staging',
    );
    expect(JSON.parse(storage.get(GRIMOIRE_SETTINGS_PATH) ?? '{}'))
      .toMatchObject({ providerConfigs: { first: { endpoint: 'external' } } });
  });

  it('fails closed on a corrupt active document or missing stage', async () => {
    const storage = new TestDurableStorage();
    storage.seed(GRIMOIRE_SETTINGS_PATH, '{broken');
    const store = new DurableStagedProviderSettingsStore(storage);

    await expect(store.readActive()).rejects.toThrow('not valid JSON');
    await expect(store.activate(TRANSACTION_ID)).rejects.toThrow('is missing');
  });
});

function patch(
  expectedProviderConfigs: Record<string, Record<string, unknown> | null>,
  providerConfigUpdates: Record<string, Record<string, unknown>>,
  runtimeFingerprintUpdates: Record<string, {
    algorithm: 'sha256';
    version: 1;
    digest: string;
  }>,
) {
  return {
    commandProviderIds: Object.keys(providerConfigUpdates),
    expectedProviderConfigs,
    providerConfigUpdates,
    runtimeFingerprintUpdates,
  };
}
