import type { ProviderId } from '../types/provider';
import type { ProviderCatalog } from './ProviderCatalog';
import type {
  ProviderCapabilityDescriptor,
  ProviderFeatureKind,
  ProviderModule,
} from './ProviderModule';
import {
  fingerprintProviderSettings,
  type ProviderSettingsFingerprint,
  type Sha256DigestPort,
} from './ProviderSettingsFingerprint';

export type ProviderConfigMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface ProviderSettingsDefinition {
  readonly providerId: ProviderId;
  readonly displayName: string;
  readonly name: string;
  readonly tabName: string;
  readonly descriptionKey: string;
  readonly order: number;
}

export interface ProviderConfiguredModel {
  readonly providerId: ProviderId;
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface ProviderSettingsProjection {
  readonly providerId: ProviderId;
  readonly valid: boolean;
  readonly enabled: boolean;
  readonly settings: object;
  readonly encoded: Readonly<Record<string, unknown>>;
  readonly preservedUnknown: Readonly<Record<string, unknown>>;
  readonly issues: readonly string[];
  readonly fingerprint: ProviderSettingsFingerprint;
}

export interface ProviderProductProjection {
  readonly definition: ProviderSettingsDefinition;
  readonly settings: ProviderSettingsProjection;
  readonly capabilities: ProviderCapabilityDescriptor;
  readonly availableFeatures: readonly ProviderFeatureKind[];
}

export interface NormalizedProviderConfigs {
  readonly configs: ProviderConfigMap;
  readonly providers: readonly ProviderSettingsProjection[];
}

const FEATURE_ORDER: readonly ProviderFeatureKind[] = [
  'history',
  'models',
  'commands',
  'mcp',
  'usage',
  'agents',
  'fork',
  'rewind',
  'steering',
  'compaction',
];

/**
 * Provider-neutral product projection over the immutable module catalog.
 * Invalid persisted provider settings remain inspectable but are disabled.
 */
export class ProviderControlPlane {
  constructor(
    private readonly catalog: ProviderCatalog,
    private readonly digestPort: Sha256DigestPort,
  ) {}

  listDefinitions(): readonly ProviderSettingsDefinition[] {
    return Object.freeze(this.catalog.list().map(module => definitionFor(module)));
  }

  getDefinition(providerId: ProviderId): ProviderSettingsDefinition | null {
    const module = this.catalog.get(providerId);
    return module ? definitionFor(module) : null;
  }

  defaultConfigs(): ProviderConfigMap {
    return freezeConfigMap(Object.fromEntries(this.catalog.list().map(module => [
      module.manifest.id,
      module.settings.encode(module.settings.defaults()),
    ])));
  }

  async project(
    providerId: ProviderId,
    configs: ProviderConfigMap,
  ): Promise<ProviderProductProjection> {
    const module = this.catalog.require(providerId);
    const settings = await this.decodeModuleSettings(module, configs[providerId]);
    return Object.freeze({
      definition: definitionFor(module),
      settings,
      capabilities: module.capabilities,
      availableFeatures: availableFeatures(module),
    });
  }

  async listProducts(configs: ProviderConfigMap): Promise<readonly ProviderProductProjection[]> {
    return Object.freeze(await Promise.all(
      this.catalog.list().map(module => this.project(module.manifest.id, configs)),
    ));
  }

  async normalizeConfigs(configs: ProviderConfigMap): Promise<NormalizedProviderConfigs> {
    const providers = await Promise.all(this.catalog.list().map(module => (
      this.decodeModuleSettings(module, configs[module.manifest.id])
    )));
    const invalid = providers.filter(provider => !provider.valid);
    if (invalid.length > 0) {
      throw new Error(
        `Provider settings are invalid: ${invalid.map(provider => (
          `${provider.providerId} (${provider.issues.join('; ')})`
        )).join(', ')}.`,
      );
    }
    const knownIds = new Set(this.catalog.list().map(module => module.manifest.id));
    const normalized: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const [providerId, config] of Object.entries(configs)) {
      if (!knownIds.has(providerId)) {
        normalized[providerId] = Object.freeze({ ...config });
      }
    }
    for (const provider of providers) {
      normalized[provider.providerId] = provider.encoded;
    }
    return Object.freeze({
      configs: freezeConfigMap(normalized),
      providers: Object.freeze(providers),
    });
  }

  async affectedRuntimeProviders(
    current: ProviderConfigMap,
    next: ProviderConfigMap,
  ): Promise<readonly ProviderId[]> {
    const [currentProducts, nextNormalized] = await Promise.all([
      this.listProducts(current),
      this.normalizeConfigs(next),
    ]);
    const currentById = new Map(
      currentProducts.map(product => [product.settings.providerId, product.settings]),
    );
    return Object.freeze(nextNormalized.providers.flatMap(provider => (
      currentById.get(provider.providerId)?.fingerprint.digest === provider.fingerprint.digest
        ? []
        : [provider.providerId]
    )));
  }

  featurePort(providerId: ProviderId, kind: ProviderFeatureKind): object | null {
    return this.catalog.require(providerId).features.ports[kind] ?? null;
  }

  async listConfiguredModels(
    providerId: ProviderId,
    configs: ProviderConfigMap,
  ): Promise<readonly ProviderConfiguredModel[]> {
    const module = this.catalog.require(providerId);
    const settings = await this.decodeModuleSettings(module, configs[providerId]);
    if (!settings.valid) {
      throw new Error(`Provider "${providerId}" settings are invalid.`);
    }
    const port = module.features.ports.models;
    if (!port) return Object.freeze([]);
    const result = port.list(settings.settings);
    return Object.freeze(result.map((choice, index) => normalizeModel(providerId, choice, index)));
  }

  async selectCurrentProvider(
    configs: ProviderConfigMap,
    preferredProviderId: ProviderId | null,
  ): Promise<ProviderProductProjection> {
    const products = await this.listProducts(configs);
    const preferred = preferredProviderId
      ? products.find(product => product.definition.providerId === preferredProviderId)
      : undefined;
    return preferred
      ?? products.find(product => product.settings.enabled)
      ?? requireFirst(products);
  }

  private async decodeModuleSettings(
    module: ProviderModule<object>,
    input: Readonly<Record<string, unknown>> | undefined,
  ): Promise<ProviderSettingsProjection> {
    const decoded = module.settings.decode(input ?? module.settings.encode(
      module.settings.defaults(),
    ));
    const settings = snapshotObject(decoded.ok ? decoded.value : decoded.fallback);
    const preservedUnknown = snapshotObject(decoded.preservedUnknown);
    const encoded = snapshotObject(module.settings.encode(settings, preservedUnknown));
    const enabled = requireEncodedEnabled(module.manifest.id, encoded);
    const fingerprint = await fingerprintProviderSettings(
      module.settings,
      settings,
      this.digestPort,
    );
    return Object.freeze({
      providerId: module.manifest.id,
      valid: decoded.ok,
      enabled: decoded.ok && enabled,
      settings,
      encoded,
      preservedUnknown,
      issues: Object.freeze(decoded.ok ? [] : [...decoded.issues]),
      fingerprint,
    });
  }
}

function definitionFor(module: ProviderModule<object>): ProviderSettingsDefinition {
  return Object.freeze({
    providerId: module.manifest.id,
    displayName: module.manifest.displayName,
    name: module.manifest.settingsPresentation.name,
    tabName: module.manifest.settingsPresentation.tabName,
    descriptionKey: module.manifest.settingsPresentation.descriptionKey,
    order: module.manifest.order,
  });
}

function availableFeatures(module: ProviderModule<object>): readonly ProviderFeatureKind[] {
  return Object.freeze(FEATURE_ORDER.filter(kind => Boolean(module.features.ports[kind])));
}

function requireEncodedEnabled(
  providerId: ProviderId,
  encoded: Readonly<Record<string, unknown>>,
): boolean {
  if (typeof encoded.enabled !== 'boolean') {
    throw new Error(`Provider "${providerId}" settings codec must encode enabled as boolean.`);
  }
  return encoded.enabled;
}

function normalizeModel(
  providerId: ProviderId,
  value: unknown,
  index: number,
): ProviderConfiguredModel {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.label !== 'string'
    || !value.label.trim()
    || typeof value.description !== 'string') {
    throw new Error(`Provider "${providerId}" returned an invalid model at index ${index}.`);
  }
  return Object.freeze({
    providerId,
    id: value.id,
    label: value.label,
    description: value.description,
  });
}

function freezeConfigMap(configs: ProviderConfigMap): ProviderConfigMap {
  return Object.freeze(Object.fromEntries(
    Object.entries(configs).map(([providerId, config]) => [
      providerId,
      snapshotObject(config),
    ]),
  ));
}

function snapshotObject(value: object): Readonly<Record<string, unknown>> {
  const snapshot = snapshotValue(value, new Set<object>());
  if (!isRecord(snapshot)) {
    throw new Error('Provider settings snapshot must be an object.');
  }
  return snapshot;
}

function snapshotValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || value === undefined) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Provider settings snapshot cannot contain a non-finite number.');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`Provider settings snapshot contains unsupported type "${typeof value}".`);
  }
  if (ancestors.has(value)) {
    throw new Error('Provider settings snapshot cannot contain cycles.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map(item => snapshotValue(item, ancestors)));
    }
    if (!isRecord(value)) {
      throw new Error('Provider settings snapshot must contain plain objects only.');
    }
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      snapshotValue(entry, ancestors),
    ])));
  } finally {
    ancestors.delete(value);
  }
}

function requireFirst<T>(values: readonly T[]): T {
  const first = values[0];
  if (!first) throw new Error('Provider catalog is empty.');
  return first;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
