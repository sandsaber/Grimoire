import type { ProviderModule } from '@/core/providers/ProviderModule';

import { geminiPlanUsageStore } from './app/GeminiPlanUsageStore';
import {
  GEMINI_EXECUTION_DESCRIPTOR,
  GeminiExecutionBackend,
  type GeminiExecutionBackendContext,
} from './execution/GeminiExecutionBackend';
import { GeminiConversationHistoryService } from './history/GeminiConversationHistoryService';
import { encodeGeminiModelId } from './models';
import {
  DEFAULT_GEMINI_PROVIDER_SETTINGS,
  type GeminiProviderSettings,
  normalizeGeminiDiscoveredModels,
  normalizeGeminiHostnameCliPaths,
  normalizeGeminiModelAliases,
  normalizeGeminiModes,
  normalizeGeminiVisibleModels,
} from './settings';

const KNOWN_SETTINGS_FIELDS = new Set([
  'availableModes',
  'cliPath',
  'cliPathsByHost',
  'discoveredModels',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'modelAliases',
  'selectedMode',
  'visibleModels',
]);

export interface GeminiModuleWorkspace {
  dispose(): Promise<void>;
}

export interface GeminiWorkspaceModuleContext {
  initialize(signal: AbortSignal): Promise<GeminiModuleWorkspace>;
}

export interface GeminiConfiguredModelChoice {
  readonly description: string;
  readonly id: string;
  readonly label: string;
}

export interface GeminiConfiguredModelsPort {
  list(settings: GeminiProviderSettings): readonly GeminiConfiguredModelChoice[];
}

export const geminiConfiguredModelsPort: GeminiConfiguredModelsPort = Object.freeze({
  list(settings: GeminiProviderSettings) {
    return normalizeGeminiDiscoveredModels(settings.discoveredModels).map(model => ({
      description: model.description ?? '',
      id: encodeGeminiModelId(model.rawId),
      label: settings.modelAliases[model.rawId] ?? model.label,
    }));
  },
});

export const geminiHistoryPort = new GeminiConversationHistoryService();

export const geminiProviderModule: ProviderModule<
GeminiProviderSettings,
GeminiModuleWorkspace,
GeminiExecutionBackend,
GeminiWorkspaceModuleContext,
GeminiExecutionBackendContext
> = {
  manifest: { id: 'gemini', displayName: 'Gemini CLI (Legacy)', order: 80 },
  settings: {
    providerId: 'gemini',
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
        availableModes: normalizeGeminiModes(value.availableModes).map(mode => ({ ...mode })),
        cliPath: value.cliPath.trim(),
        cliPathsByHost: normalizeGeminiHostnameCliPaths(value.cliPathsByHost),
        discoveredModels: normalizeGeminiDiscoveredModels(value.discoveredModels)
          .map(model => ({ ...model })),
        enabled: value.enabled,
        environmentHash: value.environmentHash,
        environmentVariables: value.environmentVariables,
        modelAliases: normalizeGeminiModelAliases(value.modelAliases),
        selectedMode: value.selectedMode.trim(),
        visibleModels: normalizeGeminiVisibleModels(value.visibleModels),
      };
    },
  },
  workspace: {
    providerId: 'gemini',
    initialize: (context, signal) => context.initialize(signal),
    dispose: workspace => workspace.dispose(),
  },
  execution: {
    descriptor: GEMINI_EXECUTION_DESCRIPTOR,
    create: async context => new GeminiExecutionBackend(context),
  },
  capabilities: {
    providerId: 'gemini',
    process: { topology: 'managed-subprocess', concurrency: 'serial-runs' },
    session: { resume: 'native', transcriptHydration: 'unsupported' },
    history: { ownership: 'grimoire-projection' },
    commands: { discovery: 'static' },
    mcp: {
      ownership: 'grimoire',
      sessionConfiguration: 'native',
      perRunSelection: 'unsupported',
    },
    agents: {
      definitionInventory: 'provider-files',
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
      approval: 'native',
      question: 'unsupported',
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
    providerId: 'gemini',
    ports: {
      history: geminiHistoryPort,
      models: geminiConfiguredModelsPort,
      usage: geminiPlanUsageStore,
    },
  },
};

function createDefaultSettings(): GeminiProviderSettings {
  return {
    ...DEFAULT_GEMINI_PROVIDER_SETTINGS,
    availableModes: [],
    cliPathsByHost: {},
    discoveredModels: [],
    modelAliases: {},
    visibleModels: [],
  };
}

function decodeSettings(record: Record<string, unknown>): GeminiProviderSettings {
  const defaults = createDefaultSettings();
  return {
    availableModes: normalizeGeminiModes(record.availableModes),
    cliPath: readString(record.cliPath, defaults.cliPath).trim(),
    cliPathsByHost: normalizeGeminiHostnameCliPaths(record.cliPathsByHost),
    discoveredModels: normalizeGeminiDiscoveredModels(record.discoveredModels),
    enabled: readBoolean(record.enabled, defaults.enabled),
    environmentHash: readString(record.environmentHash, defaults.environmentHash),
    environmentVariables: readString(record.environmentVariables, defaults.environmentVariables),
    modelAliases: normalizeGeminiModelAliases(record.modelAliases),
    selectedMode: readString(record.selectedMode, defaults.selectedMode).trim(),
    visibleModels: normalizeGeminiVisibleModels(record.visibleModels),
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
