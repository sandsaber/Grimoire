import type { ProviderId } from '../types/provider';
import type { ProviderModule } from './ProviderModule';

/**
 * A provider module with its three type parameters widened.
 *
 * The catalog holds nine modules whose workspace context, execution context,
 * and settings type all differ, so it can only name the widest type each
 * parameter admits. `object` rather than `Record<string, unknown>` for the
 * settings: every provider's settings type is an interface, and an interface
 * has no implicit index signature, so the record form would reject all nine.
 * A consumer that needs the real types imports the provider's own module
 * export, which is fully typed.
 */
export type CatalogProviderModule = ProviderModule<unknown, unknown, object>;

/**
 * The one validated inventory of provider modules.
 *
 * It replaces two registries that validated nothing and agreed with each other
 * only by convention. Keeping them apart is what let a provider's module and
 * its registration drift: three modules shipped with the same
 * `manifest.order`, copied from the provider they were forked from, while the
 * registrations they were meant to replace had distinct ones. Nothing failed,
 * because nothing compared them.
 *
 * Validation runs once, at construction, and rejects the whole catalog rather
 * than skipping a module. A provider that silently disappears from the
 * inventory is the failure this migration exists to prevent; a plugin that
 * refuses to load says so.
 *
 * What is checked here is what types cannot check: agreement between
 * contributions of the same module, uniqueness across modules, and a settings
 * codec that survives a round trip of its own defaults. Enum-valued capability
 * fields are deliberately not re-checked — they are compile-time unions on
 * compile-time constants, and a runtime guard over them is ceremony.
 */
export class ProviderCatalog {
  private readonly modules: readonly CatalogProviderModule[];
  private readonly byId: ReadonlyMap<ProviderId, CatalogProviderModule>;

  constructor(modules: readonly CatalogProviderModule[]) {
    validateModules(modules);
    this.modules = Object.freeze(
      [...modules]
        .sort((left, right) => left.manifest.order - right.manifest.order)
        .map(freezeModule),
    );
    this.byId = new Map(this.modules.map(module => [module.manifest.id, module]));
  }

  /** Every module, in the order the product presents providers in. */
  list(): readonly CatalogProviderModule[] {
    return this.modules;
  }

  /** Provider ids in presentation order. Inventory row 2. */
  ids(): readonly ProviderId[] {
    return Object.freeze(this.modules.map(module => module.manifest.id));
  }

  get(providerId: string): CatalogProviderModule | null {
    return this.byId.get(providerId) ?? null;
  }

  require(providerId: string): CatalogProviderModule {
    const module = this.get(providerId);
    if (!module) {
      throw new Error(`Provider "${providerId}" is not in the catalog.`);
    }
    return module;
  }

  has(value: unknown): value is ProviderId {
    return typeof value === 'string' && this.byId.has(value);
  }

  /** Inventory row 1. */
  displayName(providerId: string): string {
    return this.require(providerId).manifest.displayName;
  }

  /**
   * The display name, or the id itself when the catalog does not know it.
   *
   * For surfaces that render whatever a stored conversation says its provider
   * was, including one this build no longer ships.
   */
  displayNameOrId(value: string): string {
    return this.get(value)?.manifest.displayName ?? value;
  }
}

let installedCatalog: ProviderCatalog | null = null;

/**
 * Publishes the catalog the application runs on.
 *
 * The catalog instance is composed where the modules live, under
 * `src/providers/`, and core may not import that direction. Installing it is
 * how a neutral consumer reaches a concrete inventory without the dependency
 * pointing the wrong way.
 */
export function installProviderCatalog(catalog: ProviderCatalog): void {
  installedCatalog = catalog;
}

export function providerCatalog(): ProviderCatalog {
  if (!installedCatalog) {
    throw new Error('The provider catalog has not been installed.');
  }
  return installedCatalog;
}

function validateModules(modules: readonly CatalogProviderModule[]): void {
  const providerIds = new Set<ProviderId>();
  const backendIds = new Set<string>();
  const orders = new Map<number, ProviderId>();

  for (const module of modules) {
    const manifest = requirePresent(module, 'manifest');
    const providerId = manifest.id;
    if (typeof providerId !== 'string' || !providerId.trim()) {
      throw new Error('A provider module has an empty manifest id.');
    }
    if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim()) {
      throw new Error(`Provider "${providerId}" has an empty display name.`);
    }
    if (!Number.isSafeInteger(manifest.order) || manifest.order < 0) {
      throw new Error(`Provider "${providerId}" has an invalid order ${String(manifest.order)}.`);
    }
    if (providerIds.has(providerId)) {
      throw new Error(`Duplicate provider id "${providerId}" in the catalog.`);
    }
    const sharesOrder = orders.get(manifest.order);
    if (sharesOrder !== undefined) {
      // Ordering that falls back to an id comparison is ordering nobody
      // declared. This is the check the split registries never had.
      throw new Error(
        `Providers "${sharesOrder}" and "${providerId}" both claim order ${manifest.order}.`,
      );
    }

    const settings = requirePresent(module, 'settings');
    const workspace = requirePresent(module, 'workspace');
    const execution = requirePresent(module, 'execution');
    const auxiliary = requirePresent(module, 'auxiliary');
    const capabilities = requirePresent(module, 'capabilities');
    requireIdentity(providerId, 'settings', settings.providerId);
    requireIdentity(providerId, 'workspace', workspace.providerId);
    requireIdentity(providerId, 'auxiliary', auxiliary.providerId);
    requireIdentity(providerId, 'capabilities', capabilities.providerId);

    if (!Number.isSafeInteger(settings.schemaVersion) || settings.schemaVersion < 1) {
      throw new Error(
        `Provider "${providerId}" has an invalid settings schema version `
        + `${String(settings.schemaVersion)}.`,
      );
    }
    for (const method of ['defaults', 'decode', 'encode', 'isEnabled', 'withEnabled', 'reconcile']) {
      requireMethod(providerId, 'settings', settings, method);
    }
    if (!Array.isArray(settings.runtimeInputKeys)
      || settings.runtimeInputKeys.some(key => typeof key !== 'string')) {
      throw new Error(`Provider "${providerId}" has invalid settings runtime input keys.`);
    }
    requireMethod(providerId, 'workspace', workspace, 'initialize');
    requireMethod(providerId, 'workspace', workspace, 'dispose');
    requireMethod(providerId, 'execution', execution, 'create');
    requireMethod(providerId, 'module', module, 'features');
    validateSettingsCodec(providerId, settings);

    const association = execution.descriptor?.association;
    if (association?.kind !== 'provider') {
      throw new Error(`Provider "${providerId}" must associate its backend with a provider.`);
    }
    requireIdentity(providerId, 'execution', association.providerId);
    const backendId = execution.descriptor.backendId;
    if (typeof backendId !== 'string' || !backendId.trim()) {
      throw new Error(`Provider "${providerId}" has an empty execution backend id.`);
    }
    if (backendIds.has(backendId)) {
      throw new Error(`Duplicate execution backend id "${backendId}" in the catalog.`);
    }

    providerIds.add(providerId);
    backendIds.add(backendId);
    orders.set(manifest.order, providerId);
  }
}

/**
 * Exercises the codec against its own defaults.
 *
 * Defaults that do not decode are how a provider loses its settings on a vault
 * that has never been configured — the case with no user data to notice it.
 */
function validateSettingsCodec(
  providerId: ProviderId,
  settings: CatalogProviderModule['settings'],
): void {
  let defaults: object;
  let decoded: ReturnType<typeof settings.decode>;
  let enabled: boolean;
  try {
    defaults = requireRecord(providerId, 'settings.defaults()', settings.defaults());
    decoded = settings.decode(requireRecord(
      providerId,
      'settings.encode(defaults)',
      settings.encode(defaults),
    ));
    enabled = settings.isEnabled(defaults);
  } catch (error) {
    throw new Error(`Provider "${providerId}" settings codec rejected its own defaults.`, {
      cause: error,
    });
  }
  if (!decoded.ok) {
    throw new Error(
      `Provider "${providerId}" settings defaults do not round-trip: `
      + `${decoded.issues.join('; ')}.`,
    );
  }
  if (typeof enabled !== 'boolean') {
    throw new Error(`Provider "${providerId}" settings enablement is not a boolean.`);
  }
  if (settings.isEnabled(settings.withEnabled(defaults, !enabled)) !== !enabled) {
    throw new Error(`Provider "${providerId}" settings enablement does not round-trip.`);
  }
}

/**
 * Freezes what the catalog publishes as identity.
 *
 * In place rather than as a rebuilt copy: a codec calls its own methods
 * through `this`, and a copy assembled from unbound members breaks that at the
 * first reconcile.
 */
function freezeModule(module: CatalogProviderModule): CatalogProviderModule {
  deepFreeze(module.manifest);
  deepFreeze(module.capabilities);
  deepFreeze(module.execution.descriptor);
  return Object.freeze(module);
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const entry of Object.values(value)) {
    deepFreeze(entry);
  }
}

function requirePresent<TKey extends keyof CatalogProviderModule>(
  module: CatalogProviderModule,
  key: TKey,
): NonNullable<CatalogProviderModule[TKey]> {
  const value = module[key];
  if (value === null || value === undefined) {
    const providerId = module.manifest?.id ?? 'unknown';
    throw new Error(`Provider "${providerId}" is missing its ${String(key)} contribution.`);
  }
  return value;
}

function requireIdentity(
  providerId: ProviderId,
  contribution: string,
  declaredId: unknown,
): void {
  if (declaredId !== providerId) {
    throw new Error(
      `Provider "${providerId}" has a ${contribution} contribution claiming `
      + `"${String(declaredId)}".`,
    );
  }
}

function requireMethod(
  providerId: ProviderId,
  contribution: string,
  owner: object,
  method: string,
): void {
  if (typeof (owner as Record<string, unknown>)[method] !== 'function') {
    throw new Error(`Provider "${providerId}" ${contribution}.${method} must be a function.`);
  }
}

function requireRecord(
  providerId: ProviderId,
  field: string,
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Provider "${providerId}" ${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}
