import type { ProviderModule } from '@/core/providers/ProviderModule';

import {
  GROK_EXECUTION_DESCRIPTOR,
  GrokExecutionBackend,
  type GrokExecutionBackendContext,
} from './execution/GrokExecutionBackend';
import { loadGrokSessionMessages } from './history/GrokHistoryStore';
import {
  encodeGrokModelId,
  normalizeGrokDiscoveredModels,
  normalizeGrokThinkingOptionsByModel,
} from './models';
import {
  normalizeGrokAvailableModes,
  normalizeGrokSelectedMode,
} from './modes';
import {
  DEFAULT_GROK_PROVIDER_SETTINGS,
  type GrokProviderSettings,
  normalizeGrokModelAliases,
  normalizeGrokPreferredThinkingByModel,
  normalizeGrokVisibleModels,
} from './settings';
import type { GrokProviderState } from './types';

const KNOWN_SETTINGS_FIELDS = new Set([
  'availableModes',
  'cliPath',
  'cliPathsByHost',
  'discoveredModels',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'modelAliases',
  'preferredThinkingByModel',
  'selectedMode',
  'thinkingOptionsByModel',
  'visibleModels',
]);

export interface GrokModuleWorkspace {
  dispose(): Promise<void>;
}

export interface GrokWorkspaceModuleContext {
  initialize(signal: AbortSignal): Promise<GrokModuleWorkspace>;
}

export interface GrokConfiguredModelChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface GrokConfiguredModelsPort {
  list(settings: GrokProviderSettings): readonly GrokConfiguredModelChoice[];
}

export interface GrokHistoryPort {
  load(sessionId: string, providerState?: GrokProviderState): ReturnType<
  typeof loadGrokSessionMessages
  >;
}

export const grokConfiguredModelsPort: GrokConfiguredModelsPort = Object.freeze({
  list(settings: GrokProviderSettings) {
    return normalizeGrokDiscoveredModels(settings.discoveredModels).map(model => ({
      id: encodeGrokModelId(model.rawId),
      label: settings.modelAliases[model.rawId] ?? model.label,
      description: model.description ?? '',
    }));
  },
});

export const grokHistoryPort: GrokHistoryPort = Object.freeze({
  load: (sessionId: string, providerState?: GrokProviderState) => (
    loadGrokSessionMessages(sessionId, providerState)
  ),
});

export const grokProviderModule: ProviderModule<
GrokProviderSettings,
GrokModuleWorkspace,
GrokExecutionBackend,
GrokWorkspaceModuleContext,
GrokExecutionBackendContext
> = {
  manifest: { id: 'grok', displayName: 'Grok Build', order: 40 },
  settings: {
    providerId: 'grok',
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
      const discoveredModels = normalizeGrokDiscoveredModels(value.discoveredModels);
      return {
        ...preservedUnknown,
        availableModes: normalizeGrokAvailableModes(value.availableModes).map(mode => ({ ...mode })),
        cliPath: value.cliPath.trim(),
        cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
        discoveredModels: discoveredModels.map(model => ({ ...model })),
        enabled: value.enabled,
        environmentHash: value.environmentHash,
        environmentVariables: value.environmentVariables,
        modelAliases: normalizeGrokModelAliases(value.modelAliases, discoveredModels),
        preferredThinkingByModel: normalizeGrokPreferredThinkingByModel(
          value.preferredThinkingByModel,
          discoveredModels,
        ),
        selectedMode: normalizeGrokSelectedMode(value.selectedMode),
        thinkingOptionsByModel: normalizeGrokThinkingOptionsByModel(
          value.thinkingOptionsByModel,
          discoveredModels,
        ),
        visibleModels: normalizeGrokVisibleModels(value.visibleModels, discoveredModels),
      };
    },
  },
  workspace: {
    providerId: 'grok',
    initialize: (context, signal) => context.initialize(signal),
    dispose: workspace => workspace.dispose(),
  },
  execution: {
    descriptor: GROK_EXECUTION_DESCRIPTOR,
    create: async context => new GrokExecutionBackend(context),
  },
  capabilities: {
    providerId: 'grok',
    process: { topology: 'managed-subprocess', concurrency: 'serial-runs' },
    session: { resume: 'native', transcriptHydration: 'native' },
    history: { ownership: 'provider-native' },
    commands: { discovery: 'active-session' },
    mcp: {
      ownership: 'grimoire',
      sessionConfiguration: 'native',
      perRunSelection: 'unsupported',
    },
    agents: {
      definitionInventory: 'provider-files',
      spawnOrigins: ['provider-native'],
      stableIdentity: true,
      observation: 'aggregate',
      resultExtraction: 'native',
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
    providerId: 'grok',
    ports: {
      history: grokHistoryPort,
      models: grokConfiguredModelsPort,
    },
  },
};

function createDefaultSettings(): GrokProviderSettings {
  return {
    ...DEFAULT_GROK_PROVIDER_SETTINGS,
    availableModes: [],
    cliPathsByHost: {},
    discoveredModels: [],
    modelAliases: {},
    preferredThinkingByModel: {},
    thinkingOptionsByModel: {},
    visibleModels: [],
  };
}

function decodeSettings(record: Record<string, unknown>): GrokProviderSettings {
  const defaults = createDefaultSettings();
  const discoveredModels = normalizeGrokDiscoveredModels(record.discoveredModels);
  return {
    availableModes: normalizeGrokAvailableModes(record.availableModes),
    cliPath: readString(record.cliPath, defaults.cliPath).trim(),
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    discoveredModels,
    enabled: readBoolean(record.enabled, defaults.enabled),
    environmentHash: readString(record.environmentHash, defaults.environmentHash),
    environmentVariables: readString(record.environmentVariables, defaults.environmentVariables),
    modelAliases: normalizeGrokModelAliases(record.modelAliases, discoveredModels),
    preferredThinkingByModel: normalizeGrokPreferredThinkingByModel(
      record.preferredThinkingByModel,
      discoveredModels,
    ),
    selectedMode: normalizeGrokSelectedMode(record.selectedMode),
    thinkingOptionsByModel: normalizeGrokThinkingOptionsByModel(
      record.thinkingOptionsByModel,
      discoveredModels,
    ),
    visibleModels: normalizeGrokVisibleModels(record.visibleModels, discoveredModels),
  };
}

function validateSettings(record: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const key of [
    'cliPath',
    'environmentHash',
    'environmentVariables',
    'selectedMode',
  ]) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      issues.push(`${key} must be a string`);
    }
  }
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    issues.push('enabled must be a boolean');
  }
  for (const key of [
    'cliPathsByHost',
    'modelAliases',
    'preferredThinkingByModel',
  ]) {
    if (record[key] !== undefined && !isRecord(record[key])) {
      issues.push(`${key} must be an object`);
    } else if (isRecord(record[key])) {
      validateStringMap(record[key], key, issues);
    }
  }
  if (record.thinkingOptionsByModel !== undefined && !isRecord(record.thinkingOptionsByModel)) {
    issues.push('thinkingOptionsByModel must be an object');
  } else if (isRecord(record.thinkingOptionsByModel)) {
    for (const [modelId, variants] of Object.entries(record.thinkingOptionsByModel)) {
      if (!modelId.trim() || !Array.isArray(variants)) {
        issues.push('thinkingOptionsByModel contains an invalid model entry');
        continue;
      }
      for (const variant of variants) {
        if (!isRecord(variant)
          || typeof variant.value !== 'string'
          || !variant.value.trim()
          || (variant.label !== undefined && typeof variant.label !== 'string')
          || (variant.name !== undefined && typeof variant.name !== 'string')
          || (variant.description !== undefined && typeof variant.description !== 'string')) {
          issues.push(`thinkingOptionsByModel.${modelId} contains an invalid variant`);
          break;
        }
      }
    }
  }
  for (const key of ['availableModes', 'discoveredModels', 'visibleModels']) {
    if (record[key] !== undefined && !Array.isArray(record[key])) {
      issues.push(`${key} must be an array`);
    }
  }
  if (Array.isArray(record.discoveredModels)) {
    validateDiscoveredModels(record.discoveredModels, issues);
  }
  if (Array.isArray(record.availableModes)) {
    const seenModes = new Set<string>();
    for (const [index, mode] of record.availableModes.entries()) {
      const id = isRecord(mode) && typeof mode.id === 'string' ? mode.id.trim() : '';
      if (!isRecord(mode)
        || !id
        || typeof mode.name !== 'string'
        || !mode.name.trim()
        || (mode.description !== undefined && typeof mode.description !== 'string')) {
        issues.push(`availableModes[${index}] is invalid`);
      } else if (seenModes.has(id)) {
        issues.push(`availableModes contains duplicate id ${id}`);
      }
      if (id) seenModes.add(id);
    }
  }
  if (Array.isArray(record.visibleModels)
    && record.visibleModels.some(model => typeof model !== 'string' || !model.trim())) {
    issues.push('visibleModels must contain non-empty strings');
  }
  return issues;
}

function validateDiscoveredModels(models: readonly unknown[], issues: string[]): void {
  const seen = new Set<string>();
  for (const [index, model] of models.entries()) {
    if (!isRecord(model)) {
      issues.push(`discoveredModels[${index}] must be an object`);
      continue;
    }
    const rawId = typeof model.rawId === 'string' ? model.rawId.trim() : '';
    if (!rawId
      || typeof model.label !== 'string'
      || !model.label.trim()
      || (model.description !== undefined && typeof model.description !== 'string')) {
      issues.push(`discoveredModels[${index}] is invalid`);
    } else if (seen.has(rawId)) {
      issues.push(`discoveredModels contains duplicate id ${rawId}`);
    }
    if (rawId) seen.add(rawId);
  }
}

function validateStringMap(
  value: Record<string, unknown>,
  label: string,
  issues: string[],
): void {
  if (Object.entries(value).some(([key, entry]) => (
    !key.trim() || typeof entry !== 'string' || !entry.trim()
  ))) {
    issues.push(`${label} must contain non-empty string entries`);
  }
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const normalizedKey = key.trim();
    const normalizedValue = typeof entry === 'string' ? entry.trim() : '';
    return normalizedKey && normalizedValue ? [[normalizedKey, normalizedValue]] : [];
  }));
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
