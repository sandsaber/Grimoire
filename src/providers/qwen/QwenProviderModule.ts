import type { ProviderModule } from '@/core/providers/ProviderModule';

import { qwenPlanUsageStore } from './app/QwenPlanUsageStore';
import { QwenActiveSessionCommands } from './commands/QwenActiveSessionCommands';
import {
  QWEN_EXECUTION_DESCRIPTOR,
  QwenExecutionBackend,
  type QwenExecutionBackendContext,
} from './execution/QwenExecutionBackend';
import { QwenConversationHistoryService } from './history/QwenConversationHistoryService';
import { encodeQwenModelId } from './models';
import {
  DEFAULT_QWEN_PROVIDER_SETTINGS,
  normalizeQwenDiscoveredModels,
  normalizeQwenEffortLevel,
  normalizeQwenHostnameCliPaths,
  normalizeQwenModelAliases,
  normalizeQwenModes,
  normalizeQwenVisibleModels,
  type QwenProviderSettings,
} from './settings';

const KNOWN_SETTINGS_FIELDS = new Set([
  'availableModes',
  'cliPath',
  'cliPathsByHost',
  'discoveredModels',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'effortLevel',
  'modelAliases',
  'selectedMode',
  'visibleModels',
]);

export interface QwenModuleWorkspace {
  dispose(): Promise<void>;
}

export interface QwenWorkspaceModuleContext {
  initialize(signal: AbortSignal): Promise<QwenModuleWorkspace>;
}

export interface QwenConfiguredModelChoice {
  readonly description: string;
  readonly id: string;
  readonly label: string;
}

export interface QwenConfiguredModelsPort {
  list(settings: QwenProviderSettings): readonly QwenConfiguredModelChoice[];
}

export const qwenConfiguredModelsPort: QwenConfiguredModelsPort = Object.freeze({
  list(settings: QwenProviderSettings) {
    return normalizeQwenDiscoveredModels(settings.discoveredModels).map(model => ({
      description: model.description ?? '',
      id: encodeQwenModelId(model.rawId),
      label: settings.modelAliases[model.rawId] ?? model.label,
    }));
  },
});

export const qwenActiveSessionCommands = new QwenActiveSessionCommands();
export const qwenHistoryPort = new QwenConversationHistoryService();

export const qwenProviderModule: ProviderModule<
QwenProviderSettings,
QwenModuleWorkspace,
QwenExecutionBackend,
QwenWorkspaceModuleContext,
QwenExecutionBackendContext
> = {
  manifest: { id: 'qwen', displayName: 'Qwen Code', order: 90 },
  settings: {
    providerId: 'qwen',
    schemaVersion: 1,
    defaults: createDefaultSettings,
    decode(input) {
      const record = isRecord(input) ? input : {};
      const issues = isRecord(input) ? validateSettings(record) : ['settings must be an object'];
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
        availableModes: normalizeQwenModes(value.availableModes).map(mode => ({ ...mode })),
        cliPath: value.cliPath.trim(),
        cliPathsByHost: normalizeQwenHostnameCliPaths(value.cliPathsByHost),
        discoveredModels: normalizeQwenDiscoveredModels(value.discoveredModels)
          .map(model => ({ ...model })),
        enabled: value.enabled,
        environmentHash: value.environmentHash,
        environmentVariables: value.environmentVariables,
        effortLevel: normalizeQwenEffortLevel(value.effortLevel),
        modelAliases: normalizeQwenModelAliases(value.modelAliases),
        selectedMode: value.selectedMode.trim(),
        visibleModels: normalizeQwenVisibleModels(value.visibleModels),
      };
    },
  },
  workspace: {
    providerId: 'qwen',
    initialize: (context, signal) => context.initialize(signal),
    dispose: workspace => workspace.dispose(),
  },
  execution: {
    descriptor: QWEN_EXECUTION_DESCRIPTOR,
    create: async context => new QwenExecutionBackend(context),
  },
  capabilities: {
    providerId: 'qwen',
    process: { topology: 'managed-subprocess', concurrency: 'serial-runs' },
    session: { resume: 'native', transcriptHydration: 'unsupported' },
    history: { ownership: 'grimoire-projection' },
    commands: { discovery: 'active-session' },
    mcp: {
      ownership: 'grimoire',
      sessionConfiguration: 'native',
      perRunSelection: 'unsupported',
    },
    agents: {
      definitionInventory: 'provider-files',
      spawnOrigins: ['provider-native'],
      stableIdentity: false,
      observation: 'opaque',
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
      approval: 'native',
      question: 'native',
      planExit: 'unsupported',
    },
    security: {
      process: 'grimoire',
      filesystem: 'grimoire',
      network: 'native',
      permissions: 'grimoire',
    },
  },
  features: {
    providerId: 'qwen',
    ports: {
      commands: qwenActiveSessionCommands,
      history: qwenHistoryPort,
      models: qwenConfiguredModelsPort,
      usage: qwenPlanUsageStore,
    },
  },
};

function createDefaultSettings(): QwenProviderSettings {
  return {
    ...DEFAULT_QWEN_PROVIDER_SETTINGS,
    availableModes: [],
    cliPathsByHost: {},
    discoveredModels: [],
    modelAliases: {},
    visibleModels: [],
  };
}

function decodeSettings(record: Record<string, unknown>): QwenProviderSettings {
  const defaults = createDefaultSettings();
  return {
    availableModes: normalizeQwenModes(record.availableModes),
    cliPath: readString(record.cliPath, defaults.cliPath).trim(),
    cliPathsByHost: normalizeQwenHostnameCliPaths(record.cliPathsByHost),
    discoveredModels: normalizeQwenDiscoveredModels(record.discoveredModels),
    enabled: readBoolean(record.enabled, defaults.enabled),
    environmentHash: readString(record.environmentHash, defaults.environmentHash),
    environmentVariables: readString(record.environmentVariables, defaults.environmentVariables),
    effortLevel: normalizeQwenEffortLevel(record.effortLevel),
    modelAliases: normalizeQwenModelAliases(record.modelAliases),
    selectedMode: readString(record.selectedMode, defaults.selectedMode).trim(),
    visibleModels: normalizeQwenVisibleModels(record.visibleModels),
  };
}

function validateSettings(record: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const key of ['cliPath', 'environmentHash', 'environmentVariables', 'selectedMode']) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      issues.push(`${key} must be a string`);
    }
  }
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    issues.push('enabled must be a boolean');
  }
  if (record.effortLevel !== undefined
    && normalizeQwenEffortLevel(record.effortLevel) !== record.effortLevel) {
    issues.push('effortLevel is invalid');
  }
  validateStringMap(record.cliPathsByHost, 'cliPathsByHost', issues);
  validateStringMap(record.modelAliases, 'modelAliases', issues);
  if (record.availableModes !== undefined && !Array.isArray(record.availableModes)) {
    issues.push('availableModes must be an array');
  }
  if (record.discoveredModels !== undefined && !Array.isArray(record.discoveredModels)) {
    issues.push('discoveredModels must be an array');
  }
  if (record.visibleModels !== undefined && !Array.isArray(record.visibleModels)) {
    issues.push('visibleModels must be an array');
  }
  if (Array.isArray(record.discoveredModels)) {
    for (const [index, model] of record.discoveredModels.entries()) {
      if (!isRecord(model)
        || typeof model.rawId !== 'string'
        || !model.rawId.trim()
        || typeof model.label !== 'string'
        || !model.label.trim()) {
        issues.push(`discoveredModels[${index}] is invalid`);
      }
    }
  }
  if (Array.isArray(record.availableModes)) {
    for (const [index, mode] of record.availableModes.entries()) {
      if (!isRecord(mode)
        || typeof mode.id !== 'string'
        || !mode.id.trim()
        || typeof mode.name !== 'string'
        || !mode.name.trim()) {
        issues.push(`availableModes[${index}] is invalid`);
      }
    }
  }
  if (Array.isArray(record.visibleModels)
    && record.visibleModels.some(value => typeof value !== 'string' || !value.trim())) {
    issues.push('visibleModels must contain non-empty strings');
  }
  return issues;
}

function validateStringMap(value: unknown, field: string, issues: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(`${field} must be an object`);
    return;
  }
  if (Object.entries(value).some(([key, entry]) => !key.trim()
    || typeof entry !== 'string'
    || !entry.trim())) {
    issues.push(`${field} must contain non-empty strings`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
