import type {
  ProviderConfiguredModelsPort,
  ProviderModule,
} from '@/core/providers/ProviderModule';

import {
  type AntigravityModelChoice,
  resolveAntigravityModelChoices,
} from './AntigravityModelSelection';
import {
  ANTIGRAVITY_EXECUTION_DESCRIPTOR,
  AntigravityExecutionBackend,
  type AntigravityExecutionBackendContext,
} from './execution/AntigravityExecutionBackend';
import {
  type AntigravityProviderSettings,
  DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
  normalizeAntigravityCustomModels,
  normalizeAntigravityDiscoveredModels,
  normalizeAntigravityHostnameCliPaths,
  normalizeAntigravityModelAliases,
  normalizeAntigravityVisibleModels,
} from './settings';

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'customModels',
  'discoveredModels',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'modelAliases',
  'visibleModels',
]);

export interface AntigravityModuleWorkspace {
  dispose(): Promise<void>;
}

export interface AntigravityWorkspaceModuleContext {
  initialize(signal: AbortSignal): Promise<AntigravityModuleWorkspace>;
}

export interface AntigravityConfiguredModelsPort {
  list(settings: AntigravityProviderSettings): readonly AntigravityModelChoice[];
}

export const antigravityConfiguredModelsPort: AntigravityConfiguredModelsPort = Object.freeze({
  list(settings: AntigravityProviderSettings) {
    return resolveAntigravityModelChoices(settings);
  },
});

const antigravityCatalogModelsPort: ProviderConfiguredModelsPort<AntigravityProviderSettings> =
  Object.freeze({
    list(settings: AntigravityProviderSettings) {
      return antigravityConfiguredModelsPort.list(settings).map(choice => Object.freeze({
        id: choice.selectionId,
        label: choice.label,
        description: choice.description,
      }));
    },
  });

export const antigravityProviderModule: ProviderModule<
AntigravityProviderSettings,
AntigravityModuleWorkspace,
AntigravityExecutionBackend,
AntigravityWorkspaceModuleContext,
AntigravityExecutionBackendContext
> = {
  manifest: {
    id: 'antigravity',
    displayName: 'Antigravity',
    order: 70,
    settingsPresentation: {
      name: 'Antigravity',
      tabName: 'Antigravity',
      descriptionKey: 'settings.providers.antigravity.desc',
    },
  },
  settings: {
    providerId: 'antigravity',
    schemaVersion: 1,
    defaults: createDefaultSettings,
    decode(input) {
      const record = isRecord(input) ? input : {};
      const issues = isRecord(input) ? validateKnownSettings(record) : ['settings must be an object'];
      const preservedUnknown = Object.fromEntries(
        Object.entries(record).filter(([key]) => !KNOWN_SETTINGS_FIELDS.has(key)),
      );
      const value = decodeSettings(record);
      return issues.length === 0
        ? { ok: true, value, preservedUnknown }
        : { ok: false, fallback: value, issues, preservedUnknown };
    },
    encode(value, preservedUnknown = {}) {
      return {
        ...preservedUnknown,
        cliPath: value.cliPath.trim(),
        cliPathsByHost: { ...normalizeAntigravityHostnameCliPaths(value.cliPathsByHost) },
        customModels: normalizeAntigravityCustomModels(value.customModels),
        discoveredModels: normalizeAntigravityDiscoveredModels(value.discoveredModels)
          .map(model => ({ ...model })),
        enabled: value.enabled,
        environmentHash: value.environmentHash,
        environmentVariables: value.environmentVariables,
        modelAliases: { ...normalizeAntigravityModelAliases(value.modelAliases) },
        visibleModels: [...normalizeAntigravityVisibleModels(value.visibleModels)],
      };
    },
    runtimeFingerprintInput(value) {
      return {
        cliPath: value.cliPath.trim(),
        cliPathsByHost: normalizeAntigravityHostnameCliPaths(value.cliPathsByHost),
        enabled: value.enabled,
        environmentVariables: value.environmentVariables,
      };
    },
  },
  workspace: {
    providerId: 'antigravity',
    initialize: (context, signal) => context.initialize(signal),
    dispose: workspace => workspace.dispose(),
  },
  execution: {
    descriptor: ANTIGRAVITY_EXECUTION_DESCRIPTOR,
    create: async context => new AntigravityExecutionBackend(context),
  },
  capabilities: {
    providerId: 'antigravity',
    process: {
      topology: 'per-run-process',
      concurrency: 'serial-runs',
    },
    session: {
      resume: 'unsupported',
      transcriptHydration: 'unsupported',
    },
    history: { ownership: 'grimoire-projection' },
    commands: { discovery: 'unsupported' },
    mcp: {
      ownership: 'unsupported',
      sessionConfiguration: 'unsupported',
      perRunSelection: 'unsupported',
    },
    agents: {
      definitionInventory: 'none',
      spawnOrigins: [],
      stableIdentity: false,
      observation: 'none',
      resultExtraction: 'unsupported',
      cancellation: 'unsupported',
      statusQuery: 'unsupported',
      reattachment: 'unsupported',
    },
    controls: {
      fork: 'unsupported',
      rewind: 'unsupported',
      steering: 'unsupported',
      compaction: 'unsupported',
    },
    interactions: {
      approval: 'unsupported',
      question: 'unsupported',
      planExit: 'unsupported',
    },
    security: {
      process: 'grimoire',
      filesystem: 'unsupported',
      network: 'unsupported',
      permissions: 'unsupported',
    },
  },
  features: {
    providerId: 'antigravity',
    ports: {
      models: antigravityCatalogModelsPort,
    },
  },
};

function createDefaultSettings(): AntigravityProviderSettings {
  return {
    ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    discoveredModels: [],
    modelAliases: {},
    visibleModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): AntigravityProviderSettings {
  const defaults = createDefaultSettings();
  return {
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : defaults.cliPath,
    cliPathsByHost: normalizeAntigravityHostnameCliPaths(record.cliPathsByHost),
    customModels: normalizeAntigravityCustomModels(record.customModels),
    discoveredModels: normalizeAntigravityDiscoveredModels(record.discoveredModels),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    environmentHash: typeof record.environmentHash === 'string'
      ? record.environmentHash
      : defaults.environmentHash,
    environmentVariables: typeof record.environmentVariables === 'string'
      ? record.environmentVariables
      : defaults.environmentVariables,
    modelAliases: normalizeAntigravityModelAliases(record.modelAliases),
    visibleModels: normalizeAntigravityVisibleModels(record.visibleModels),
  };
}

function validateKnownSettings(record: Readonly<Record<string, unknown>>): string[] {
  const issues: string[] = [];
  requireType(record, 'cliPath', value => typeof value === 'string', issues);
  requireType(record, 'cliPathsByHost', isRecord, issues);
  requireType(record, 'customModels', value => typeof value === 'string', issues);
  requireType(record, 'discoveredModels', Array.isArray, issues);
  requireType(record, 'enabled', value => typeof value === 'boolean', issues);
  requireType(record, 'environmentHash', value => typeof value === 'string', issues);
  requireType(record, 'environmentVariables', value => typeof value === 'string', issues);
  requireType(record, 'modelAliases', isRecord, issues);
  requireType(record, 'visibleModels', Array.isArray, issues);
  if (isRecord(record.cliPathsByHost)
    && Object.values(record.cliPathsByHost).some(value => typeof value !== 'string')) {
    issues.push('cliPathsByHost contains an invalid path');
  }
  if (isRecord(record.modelAliases)
    && Object.entries(record.modelAliases).some(([key, value]) => (
      !key.trim() || typeof value !== 'string'
    ))) {
    issues.push('modelAliases contains an invalid alias');
  }
  if (Array.isArray(record.visibleModels)
    && record.visibleModels.some(value => typeof value !== 'string')) {
    issues.push('visibleModels contains an invalid model');
  }
  if (Array.isArray(record.discoveredModels)
    && record.discoveredModels.some(value => !isDiscoveredModel(value))) {
    issues.push('discoveredModels contains an invalid model');
  }
  return issues;
}

function requireType(
  record: Readonly<Record<string, unknown>>,
  field: string,
  validate: (value: unknown) => boolean,
  issues: string[],
): void {
  if (field in record && !validate(record[field])) {
    issues.push(`${field} has an invalid type`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDiscoveredModel(value: unknown): boolean {
  return isRecord(value)
    && typeof value.rawId === 'string'
    && typeof value.label === 'string'
    && (value.description === undefined
      || value.description === null
      || typeof value.description === 'string');
}
