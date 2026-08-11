import type { ProviderId } from '../types/provider';
import type {
  CapabilitySupport,
  ProviderCapabilityDescriptor,
  ProviderModule,
  SecurityEnforcement,
} from './ProviderModule';

const CAPABILITY_SUPPORT_VALUES = new Set<CapabilitySupport>([
  'native',
  'grimoire',
  'unsupported',
]);
const SECURITY_ENFORCEMENT_VALUES = new Set<SecurityEnforcement>([
  'native',
  'grimoire',
  'advisory',
  'unsupported',
]);
const PROCESS_TOPOLOGY_VALUES = new Set([
  'per-run-process',
  'persistent-sdk',
  'persistent-app-server',
  'managed-subprocess',
]);
const PROCESS_CONCURRENCY_VALUES = new Set([
  'serial-runs',
  'parallel-runs',
  'multiplexed-sessions',
]);
const HISTORY_OWNERSHIP_VALUES = new Set([
  'provider-native',
  'grimoire-projection',
  'none',
]);
const COMMAND_DISCOVERY_VALUES = new Set([
  'static',
  'active-session',
  'ephemeral-process',
  'unsupported',
]);
const AGENT_DEFINITION_INVENTORY_VALUES = new Set([
  'native',
  'provider-files',
  'none',
]);
const AGENT_SPAWN_ORIGIN_VALUES = new Set([
  'grimoire',
  'provider-native',
]);
const AGENT_OBSERVATION_VALUES = new Set([
  'full',
  'aggregate',
  'terminal-only',
  'opaque',
  'none',
]);
const SECURITY_SURFACES = [
  'process',
  'filesystem',
  'network',
  'permissions',
] as const;

export class ProviderCatalog {
  private readonly modules: readonly ProviderModule[];
  private readonly modulesById: ReadonlyMap<ProviderId, ProviderModule>;

  constructor(modules: readonly ProviderModule[]) {
    const validated = validateModules(modules).map(snapshotModule);
    this.modules = Object.freeze([...validated].sort(
      (left, right) => left.manifest.order - right.manifest.order,
    ));
    this.modulesById = new Map(
      this.modules.map(module => [module.manifest.id, module]),
    );
  }

  list(): readonly ProviderModule[] {
    return this.modules;
  }

  get(providerId: ProviderId): ProviderModule | null {
    return this.modulesById.get(providerId) ?? null;
  }

  require(providerId: ProviderId): ProviderModule {
    const module = this.get(providerId);
    if (!module) {
      throw new Error(`Provider "${providerId}" is not present in the catalog.`);
    }
    return module;
  }
}

function validateModules(modules: readonly ProviderModule[]): ProviderModule[] {
  const providerIds = new Set<ProviderId>();
  const backendIds = new Set<string>();
  const orders = new Set<number>();

  return modules.map(module => {
    const manifest = requireContribution(module, 'manifest');
    const providerId = manifest.id;
    if (typeof providerId !== 'string' || !providerId.trim()) {
      throw new Error('Provider manifest id must not be empty.');
    }
    if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim()) {
      throw new Error(`Provider "${providerId}" has an empty display name.`);
    }
    if (!Number.isSafeInteger(manifest.order) || manifest.order < 0) {
      throw new Error(`Provider "${providerId}" has invalid order ${manifest.order}.`);
    }
    if (providerIds.has(providerId)) {
      throw new Error(`Duplicate provider id "${providerId}".`);
    }
    if (orders.has(manifest.order)) {
      throw new Error(`Duplicate provider order ${manifest.order}.`);
    }

    const settings = requireContribution(module, 'settings');
    const workspace = requireContribution(module, 'workspace');
    const execution = requireContribution(module, 'execution');
    const capabilities = requireContribution(module, 'capabilities');
    const features = requireContribution(module, 'features');
    requireIdentity(providerId, 'settings', settings.providerId);
    requireIdentity(providerId, 'workspace', workspace.providerId);
    requireIdentity(providerId, 'capabilities', capabilities.providerId);
    requireIdentity(providerId, 'features', features.providerId);

    if (!Number.isSafeInteger(settings.schemaVersion) || settings.schemaVersion < 1) {
      throw new Error(
        `Provider "${providerId}" has invalid settings schema version ${settings.schemaVersion}.`,
      );
    }
    requireMethod(providerId, 'settings', settings, 'defaults');
    requireMethod(providerId, 'settings', settings, 'decode');
    requireMethod(providerId, 'settings', settings, 'encode');
    requireMethod(providerId, 'workspace', workspace, 'initialize');
    requireMethod(providerId, 'workspace', workspace, 'dispose');
    requireMethod(providerId, 'execution', execution, 'create');
    requireRecord(providerId, 'features.ports', features.ports);

    const association = execution.descriptor?.association;
    if (association?.kind !== 'provider') {
      throw new Error(`Provider "${providerId}" execution must have a provider association.`);
    }
    requireIdentity(providerId, 'execution', association.providerId);
    const backendId = execution.descriptor.backendId;
    if (typeof backendId !== 'string' || !backendId.trim()) {
      throw new Error(`Provider "${providerId}" has an empty execution backend id.`);
    }
    if (backendIds.has(backendId)) {
      throw new Error(`Duplicate execution backend id "${backendId}".`);
    }

    validateCapabilities(providerId, capabilities);
    providerIds.add(providerId);
    backendIds.add(backendId);
    orders.add(manifest.order);
    return module;
  });
}

function validateCapabilities(
  providerId: ProviderId,
  capabilities: ProviderCapabilityDescriptor,
): void {
  const process = requireRecord(providerId, 'capabilities.process', capabilities.process);
  requireEnum(providerId, 'capabilities.process.topology', process.topology, PROCESS_TOPOLOGY_VALUES);
  requireEnum(
    providerId,
    'capabilities.process.concurrency',
    process.concurrency,
    PROCESS_CONCURRENCY_VALUES,
  );

  const session = requireRecord(providerId, 'capabilities.session', capabilities.session);
  requireSupport(providerId, 'capabilities.session.resume', session.resume);
  requireSupport(
    providerId,
    'capabilities.session.transcriptHydration',
    session.transcriptHydration,
  );

  const history = requireRecord(providerId, 'capabilities.history', capabilities.history);
  requireEnum(
    providerId,
    'capabilities.history.ownership',
    history.ownership,
    HISTORY_OWNERSHIP_VALUES,
  );

  const commands = requireRecord(providerId, 'capabilities.commands', capabilities.commands);
  requireEnum(
    providerId,
    'capabilities.commands.discovery',
    commands.discovery,
    COMMAND_DISCOVERY_VALUES,
  );

  const mcp = requireRecord(providerId, 'capabilities.mcp', capabilities.mcp);
  requireSupport(providerId, 'capabilities.mcp.ownership', mcp.ownership);
  requireSupport(
    providerId,
    'capabilities.mcp.sessionConfiguration',
    mcp.sessionConfiguration,
  );
  requireSupport(providerId, 'capabilities.mcp.perRunSelection', mcp.perRunSelection);

  const agents = requireRecord(providerId, 'capabilities.agents', capabilities.agents);
  requireEnum(
    providerId,
    'capabilities.agents.definitionInventory',
    agents.definitionInventory,
    AGENT_DEFINITION_INVENTORY_VALUES,
  );
  requireEnumArray(
    providerId,
    'capabilities.agents.spawnOrigins',
    agents.spawnOrigins,
    AGENT_SPAWN_ORIGIN_VALUES,
  );
  if (typeof agents.stableIdentity !== 'boolean') {
    throw invalidCapability(providerId, 'capabilities.agents.stableIdentity', agents.stableIdentity);
  }
  requireEnum(
    providerId,
    'capabilities.agents.observation',
    agents.observation,
    AGENT_OBSERVATION_VALUES,
  );
  for (const field of [
    'resultExtraction',
    'cancellation',
    'statusQuery',
    'reattachment',
  ] as const) {
    requireSupport(providerId, `capabilities.agents.${field}`, agents[field]);
  }

  const controls = requireRecord(providerId, 'capabilities.controls', capabilities.controls);
  for (const field of ['fork', 'rewind', 'steering', 'compaction'] as const) {
    requireSupport(providerId, `capabilities.controls.${field}`, controls[field]);
  }

  const interactions = requireRecord(
    providerId,
    'capabilities.interactions',
    capabilities.interactions,
  );
  for (const field of ['approval', 'question', 'planExit'] as const) {
    requireSupport(providerId, `capabilities.interactions.${field}`, interactions[field]);
  }

  const security = requireRecord(providerId, 'capabilities.security', capabilities.security);
  for (const surface of SECURITY_SURFACES) {
    const enforcement = security[surface];
    if (!SECURITY_ENFORCEMENT_VALUES.has(enforcement as SecurityEnforcement)) {
      throw new Error(
        `Provider "${providerId}" has invalid security enforcement "${String(enforcement)}" for ${surface}.`,
      );
    }
  }
  for (const surface of Object.keys(security)) {
    if (!SECURITY_SURFACES.includes(surface as typeof SECURITY_SURFACES[number])) {
      throw new Error(`Provider "${providerId}" has unknown security surface "${surface}".`);
    }
  }
}

function snapshotModule(module: ProviderModule): ProviderModule {
  const association = module.execution.descriptor.association;
  const descriptor = Object.freeze({
    backendId: module.execution.descriptor.backendId,
    association: Object.freeze({ ...association }),
  });
  const capabilities = module.capabilities;

  return Object.freeze({
    manifest: Object.freeze({ ...module.manifest }),
    settings: Object.freeze({
      providerId: module.settings.providerId,
      schemaVersion: module.settings.schemaVersion,
      defaults: module.settings.defaults.bind(module.settings),
      decode: module.settings.decode.bind(module.settings),
      encode: module.settings.encode.bind(module.settings),
    }),
    workspace: Object.freeze({
      providerId: module.workspace.providerId,
      initialize: module.workspace.initialize.bind(module.workspace),
      dispose: module.workspace.dispose.bind(module.workspace),
    }),
    execution: Object.freeze({
      descriptor,
      create: module.execution.create.bind(module.execution),
    }),
    capabilities: Object.freeze({
      ...capabilities,
      process: Object.freeze({ ...capabilities.process }),
      session: Object.freeze({ ...capabilities.session }),
      history: Object.freeze({ ...capabilities.history }),
      commands: Object.freeze({ ...capabilities.commands }),
      mcp: Object.freeze({ ...capabilities.mcp }),
      agents: Object.freeze({
        ...capabilities.agents,
        spawnOrigins: Object.freeze([...capabilities.agents.spawnOrigins]),
      }),
      controls: Object.freeze({ ...capabilities.controls }),
      interactions: Object.freeze({ ...capabilities.interactions }),
      security: Object.freeze({ ...capabilities.security }),
    }),
    features: Object.freeze({
      ...module.features,
      ports: Object.freeze({ ...module.features.ports }),
    }),
  });
}

function requireContribution<
  TModule extends ProviderModule,
  TKey extends keyof TModule,
>(module: TModule, key: TKey): NonNullable<TModule[TKey]> {
  const value = module[key];
  if (value === null || value === undefined) {
    const providerId = module.manifest?.id ?? 'unknown';
    throw new Error(`Provider "${providerId}" is missing ${String(key)}.`);
  }
  return value;
}

function requireIdentity(
  providerId: ProviderId,
  contribution: string,
  actualId: unknown,
): void {
  if (actualId !== providerId) {
    throw new Error(
      `Provider "${providerId}" has mismatched ${contribution} identity "${String(actualId)}".`,
    );
  }
}

function requireMethod(
  providerId: ProviderId,
  contribution: string,
  owner: object,
  method: string,
): void {
  const value = (owner as Record<string, unknown>)[method];
  if (typeof value !== 'function') {
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

function requireSupport(providerId: ProviderId, field: string, value: unknown): void {
  requireEnum(providerId, field, value, CAPABILITY_SUPPORT_VALUES);
}

function requireEnum(
  providerId: ProviderId,
  field: string,
  value: unknown,
  allowed: ReadonlySet<string>,
): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw invalidCapability(providerId, field, value);
  }
}

function requireEnumArray(
  providerId: ProviderId,
  field: string,
  value: unknown,
  allowed: ReadonlySet<string>,
): void {
  if (!Array.isArray(value) || value.some(entry => (
    typeof entry !== 'string' || !allowed.has(entry)
  ))) {
    throw invalidCapability(providerId, field, value);
  }
}

function invalidCapability(providerId: ProviderId, field: string, value: unknown): Error {
  return new Error(
    `Provider "${providerId}" has invalid ${field} value "${String(value)}".`,
  );
}
