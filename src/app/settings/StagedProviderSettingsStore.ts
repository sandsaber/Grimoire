import {
  GRIMOIRE_SETTINGS_PATH,
  PROVIDER_SETTINGS_STAGING_PATH,
} from '../../core/bootstrap/StoragePaths';
import type { DurableStorage } from '../../core/persistence/DurableStorage';
import type {
  ProviderConfigMap,
} from '../../core/providers/ProviderControlPlane';
import {
  canonicalJson,
  PROVIDER_SETTINGS_FINGERPRINT_VERSION,
  type ProviderSettingsFingerprint,
} from '../../core/providers/ProviderSettingsFingerprint';
import type {
  ActiveProviderSettingsState,
  ExpectedProviderConfigMap,
  ProviderRuntimeFingerprintMap,
  StagedProviderSettingsPatch,
  StagedProviderSettingsStore,
} from '../../core/providers/ProviderSettingsTransactionCoordinator';
import type { ProviderId } from '../../core/types/provider';

const MAX_ACTIVATION_ATTEMPTS = 8;

interface StagedProviderSettings {
  readonly transactionId: string;
  readonly commandProviderIds: readonly ProviderId[];
  readonly expectedProviderConfigs: ExpectedProviderConfigMap;
  readonly providerConfigUpdates: ProviderConfigMap;
  readonly runtimeFingerprintUpdates: ProviderRuntimeFingerprintMap;
}

/** Stores provider settings in the settings domain, never in lifecycle control records. */
export class DurableStagedProviderSettingsStore implements StagedProviderSettingsStore {
  constructor(private readonly storage: DurableStorage) {}

  async readActive(): Promise<ActiveProviderSettingsState> {
    const raw = await this.storage.read(GRIMOIRE_SETTINGS_PATH);
    if (raw === null) {
      return Object.freeze({
        configs: Object.freeze({}),
        runtimeFingerprints: Object.freeze({}),
      });
    }
    const settings = parseRecord(raw, 'Grimoire settings');
    return Object.freeze({
      configs: freezeProviderConfigs(settings.providerConfigs),
      runtimeFingerprints: freezeRuntimeFingerprints(settings.providerRuntimeFingerprints),
    });
  }

  async listStagedTransactionIds(): Promise<readonly string[]> {
    const prefix = `${PROVIDER_SETTINGS_STAGING_PATH}/`;
    const paths = await this.storage.list(PROVIDER_SETTINGS_STAGING_PATH);
    return Object.freeze(paths.flatMap(path => {
      if (!path.startsWith(prefix) || !path.endsWith('.json')) return [];
      const encoded = path.slice(prefix.length, -'.json'.length);
      const transactionId = decodeURIComponent(encoded);
      requireTransactionId(transactionId);
      return [transactionId];
    }).sort());
  }

  async stage(
    transactionId: string,
    patch: StagedProviderSettingsPatch,
  ): Promise<void> {
    requireTransactionId(transactionId);
    const staged: StagedProviderSettings = {
      transactionId,
      commandProviderIds: freezeProviderIds(patch.commandProviderIds),
      expectedProviderConfigs: freezeExpectedProviderConfigs(patch.expectedProviderConfigs),
      providerConfigUpdates: freezeProviderConfigs(patch.providerConfigUpdates),
      runtimeFingerprintUpdates: freezeRuntimeFingerprints(patch.runtimeFingerprintUpdates),
    };
    const raw = JSON.stringify(staged);
    const path = stagingPath(transactionId);
    const existing = await this.storage.read(path);
    if (existing !== null && existing !== raw) {
      throw new Error(`Provider settings stage "${transactionId}" has conflicting contents.`);
    }
    if (existing === null
      && !(await this.storage.compareAndSwap(path, null, raw))) {
      const raced = await this.storage.read(path);
      if (raced !== raw) {
        throw new Error(`Provider settings stage "${transactionId}" has conflicting contents.`);
      }
    }
  }

  async activate(transactionId: string): Promise<void> {
    requireTransactionId(transactionId);
    const staged = await this.readStage(transactionId);
    for (let attempt = 0; attempt < MAX_ACTIVATION_ATTEMPTS; attempt += 1) {
      const currentRaw = await this.storage.read(GRIMOIRE_SETTINGS_PATH);
      const current = currentRaw === null
        ? {}
        : parseRecord(currentRaw, 'Grimoire settings');
      const currentConfigs = freezeProviderConfigs(current.providerConfigs);
      for (const [providerId, expected] of Object.entries(staged.expectedProviderConfigs)) {
        const actual = currentConfigs[providerId] ?? null;
        const target = staged.providerConfigUpdates[providerId] ?? null;
        if (canonicalJson(actual) !== canonicalJson(expected)
          && canonicalJson(actual) !== canonicalJson(target)) {
          throw new Error(
            `Provider "${providerId}" settings changed after transaction staging.`,
          );
        }
      }
      const currentFingerprints = freezeRuntimeFingerprints(
        current.providerRuntimeFingerprints,
      );
      const next = JSON.stringify({
        ...current,
        providerConfigs: {
          ...currentConfigs,
          ...staged.providerConfigUpdates,
        },
        providerRuntimeFingerprints: {
          ...currentFingerprints,
          ...staged.runtimeFingerprintUpdates,
        },
      }, null, 2);
      if (currentRaw === next) return;
      if (await this.storage.compareAndSwap(GRIMOIRE_SETTINGS_PATH, currentRaw, next)) return;
    }
    throw new Error('Provider settings activation exceeded the compare-and-swap retry bound.');
  }

  async validateTarget(
    transactionId: string,
    providerConfigUpdates: ProviderConfigMap,
  ): Promise<void> {
    requireTransactionId(transactionId);
    const staged = await this.readStage(transactionId);
    const requestedProviderIds = Object.keys(providerConfigUpdates).sort();
    if (canonicalJson(staged.commandProviderIds) !== canonicalJson(requestedProviderIds)) {
      throw new Error(
        `Provider settings stage "${transactionId}" does not match the requested providers.`,
      );
    }
    for (const [providerId, requested] of Object.entries(providerConfigUpdates)) {
      if (canonicalJson(staged.providerConfigUpdates[providerId] ?? null)
        !== canonicalJson(requested)) {
        throw new Error(
          `Provider settings stage "${transactionId}" does not match the requested target.`,
        );
      }
    }
  }

  async clear(transactionId: string): Promise<void> {
    requireTransactionId(transactionId);
    await this.storage.remove(stagingPath(transactionId));
  }

  private async readStage(transactionId: string): Promise<StagedProviderSettings> {
    const raw = await this.storage.read(stagingPath(transactionId));
    if (raw === null) {
      throw new Error(`Provider settings stage "${transactionId}" is missing.`);
    }
    const record = parseRecord(raw, 'Provider settings stage');
    if (record.transactionId !== transactionId) {
      throw new Error('Provider settings stage identity does not match its path.');
    }
    return {
      transactionId,
      commandProviderIds: freezeProviderIds(record.commandProviderIds),
      expectedProviderConfigs: freezeExpectedProviderConfigs(record.expectedProviderConfigs),
      providerConfigUpdates: freezeProviderConfigs(record.providerConfigUpdates),
      runtimeFingerprintUpdates: freezeRuntimeFingerprints(record.runtimeFingerprintUpdates),
    };
  }
}

function freezeProviderIds(value: unknown): readonly ProviderId[] {
  if (!Array.isArray(value)) {
    throw new Error('Provider settings command provider ids are invalid.');
  }
  const entries: unknown[] = value;
  const providerIds: ProviderId[] = [];
  for (const providerId of entries) {
    if (typeof providerId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(providerId)) {
      throw new Error('Provider settings command provider ids are invalid.');
    }
    providerIds.push(providerId);
  }
  providerIds.sort();
  if (new Set(providerIds).size !== providerIds.length) {
    throw new Error('Provider settings command provider ids must be unique.');
  }
  return Object.freeze(providerIds);
}

function freezeExpectedProviderConfigs(value: unknown): ExpectedProviderConfigMap {
  if (!isRecord(value)) throw new Error('Expected provider settings must be an object.');
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([providerId, config]) => {
    if (config === null) return [providerId, null];
    if (!isRecord(config)) {
      throw new Error(`Expected provider "${providerId}" settings must be an object or null.`);
    }
    return [providerId, Object.freeze({ ...config })];
  })));
}

function stagingPath(transactionId: string): string {
  return `${PROVIDER_SETTINGS_STAGING_PATH}/${encodeURIComponent(transactionId)}.json`;
}

function freezeProviderConfigs(value: unknown): ProviderConfigMap {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value)) throw new Error('Provider settings configs must be an object.');
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([providerId, config]) => {
    if (!isRecord(config)) {
      throw new Error(`Provider "${providerId}" settings must be an object.`);
    }
    return [providerId, Object.freeze({ ...config })];
  })));
}

function freezeRuntimeFingerprints(value: unknown): ProviderRuntimeFingerprintMap {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value)) throw new Error('Provider runtime fingerprints must be an object.');
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([providerId, fingerprint]) => [
    providerId,
    decodeFingerprint(fingerprint, providerId),
  ])));
}

function decodeFingerprint(value: unknown, providerId: string): ProviderSettingsFingerprint {
  if (!isRecord(value)
    || Object.keys(value).sort().join(',') !== 'algorithm,digest,version'
    || value.algorithm !== 'sha256'
    || value.version !== PROVIDER_SETTINGS_FINGERPRINT_VERSION
    || typeof value.digest !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.digest)) {
    throw new Error(`Provider "${providerId}" runtime fingerprint is invalid.`);
  }
  return Object.freeze({
    algorithm: 'sha256',
    version: PROVIDER_SETTINGS_FINGERPRINT_VERSION,
    digest: value.digest,
  });
}

function parseRecord(raw: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireTransactionId(value: string): void {
  if (!/^tx-[0-9a-f]{32}$/.test(value)) {
    throw new Error('Provider settings transaction id is invalid.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
