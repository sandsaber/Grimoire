import type { ProviderModule } from '@/core/providers/ProviderModule';

import {
  CLAUDE_EXECUTION_DESCRIPTOR,
  ClaudeExecutionBackend,
  type ClaudeExecutionBackendContext,
  type ClaudeRewindMode,
  type ClaudeRewindResult,
} from './execution/ClaudeExecutionBackend';
import {
  type ClaudeDiscoveredModel,
  type ClaudeProviderSettings,
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  normalizeClaudeCodeProjectSettingsSnapshot,
  normalizeClaudeDiscoveredModels,
} from './settings';
import { DEFAULT_CLAUDE_MODELS } from './types/models';

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'customModels',
  'discoveredModels',
  'enableBangBash',
  'enableChrome',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'lastModel',
  'loadUserSettings',
  'projectSettingsSnapshot',
  'respectProjectSettings',
]);

export interface ClaudeModuleWorkspace {
  dispose(): Promise<void>;
}

export interface ClaudeWorkspaceModuleContext {
  initialize(signal: AbortSignal): Promise<ClaudeModuleWorkspace>;
}

export interface ClaudeConfiguredModelChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface ClaudeConfiguredModelsPort {
  list(settings: ClaudeProviderSettings): readonly ClaudeConfiguredModelChoice[];
}

export interface ClaudeRewindPort {
  rewind(
    backend: ClaudeExecutionBackend,
    input: {
      readonly executionSessionId: string;
      readonly userMessageId: string;
      readonly assistantMessageId: string;
      readonly mode: ClaudeRewindMode;
    },
  ): Promise<ClaudeRewindResult>;
}

export interface ClaudeNativeAgentControlPort {
  cancel(
    backend: ClaudeExecutionBackend,
    input: { readonly executionSessionId: string; readonly taskId: string },
  ): Promise<void>;
}

export const claudeConfiguredModelsPort: ClaudeConfiguredModelsPort = Object.freeze({
  list(settings: ClaudeProviderSettings) {
    const discovered = normalizeClaudeDiscoveredModels(settings.discoveredModels);
    const choices = discovered.length > 0
      ? discovered.map(toDiscoveredChoice)
      : DEFAULT_CLAUDE_MODELS.map(model => ({
        id: model.value,
        label: model.label,
        description: model.description,
      }));
    const seen = new Set(choices.map(choice => choice.id));
    for (const id of parseCustomModels(settings.customModels)) {
      if (!seen.has(id)) {
        choices.push({ id, label: id, description: 'Custom model' });
        seen.add(id);
      }
    }
    return choices;
  },
});

export const claudeRewindPort: ClaudeRewindPort = Object.freeze({
  rewind: (
    backend: ClaudeExecutionBackend,
    input: Parameters<ClaudeRewindPort['rewind']>[1],
  ) => backend.rewind(input),
});

export const claudeNativeAgentControlPort: ClaudeNativeAgentControlPort = Object.freeze({
  cancel: (
    backend: ClaudeExecutionBackend,
    input: { readonly executionSessionId: string; readonly taskId: string },
  ) => backend.cancelNativeTask(input),
});

export const claudeProviderModule: ProviderModule<
ClaudeProviderSettings,
ClaudeModuleWorkspace,
ClaudeExecutionBackend,
ClaudeWorkspaceModuleContext,
ClaudeExecutionBackendContext
> = {
  manifest: {
    id: 'claude',
    displayName: 'Claude',
    order: 10,
  },
  settings: {
    providerId: 'claude',
    schemaVersion: 1,
    defaults: createDefaultSettings,
    decode(input) {
      const record = isRecord(input) ? input : {};
      const issues = isRecord(input)
        ? validateKnownSettings(record)
        : ['settings must be an object'];
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
        enabled: value.enabled,
        cliPath: value.cliPath.trim(),
        cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
        loadUserSettings: value.loadUserSettings,
        enableChrome: value.enableChrome,
        enableBangBash: value.enableBangBash,
        customModels: value.customModels,
        lastModel: value.lastModel.trim(),
        environmentVariables: value.environmentVariables,
        environmentHash: value.environmentHash,
        respectProjectSettings: value.respectProjectSettings,
        projectSettingsSnapshot: normalizeClaudeCodeProjectSettingsSnapshot(
          value.projectSettingsSnapshot,
        ),
        discoveredModels: normalizeClaudeDiscoveredModels(value.discoveredModels)
          .map(model => ({ ...model })),
      };
    },
  },
  workspace: {
    providerId: 'claude',
    initialize: (context, signal) => context.initialize(signal),
    dispose: workspace => workspace.dispose(),
  },
  execution: {
    descriptor: CLAUDE_EXECUTION_DESCRIPTOR,
    create: async context => new ClaudeExecutionBackend(context),
  },
  capabilities: {
    providerId: 'claude',
    process: {
      topology: 'persistent-sdk',
      concurrency: 'serial-runs',
    },
    session: {
      resume: 'native',
      transcriptHydration: 'native',
    },
    history: { ownership: 'provider-native' },
    commands: { discovery: 'active-session' },
    mcp: {
      ownership: 'native',
      sessionConfiguration: 'native',
      perRunSelection: 'native',
    },
    agents: {
      definitionInventory: 'native',
      spawnOrigins: ['provider-native'],
      stableIdentity: true,
      observation: 'full',
      resultExtraction: 'native',
      cancellation: 'native',
      statusQuery: 'unsupported',
      reattachment: 'unsupported',
    },
    controls: {
      fork: 'native',
      rewind: 'native',
      steering: 'unsupported',
      compaction: 'unsupported',
    },
    interactions: {
      approval: 'native',
      question: 'native',
      planExit: 'native',
    },
    security: {
      process: 'native',
      filesystem: 'native',
      network: 'native',
      permissions: 'native',
    },
  },
  features: {
    providerId: 'claude',
    ports: {
      models: claudeConfiguredModelsPort,
      agents: claudeNativeAgentControlPort,
      rewind: claudeRewindPort,
    },
  },
};

function createDefaultSettings(): ClaudeProviderSettings {
  return {
    ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    projectSettingsSnapshot: {
      ...DEFAULT_CLAUDE_PROVIDER_SETTINGS.projectSettingsSnapshot,
      env: {},
    },
    discoveredModels: [],
  };
}

function decodeSettings(record: Record<string, unknown>): ClaudeProviderSettings {
  const defaults = createDefaultSettings();
  return {
    enabled: readBoolean(record.enabled, defaults.enabled),
    cliPath: readString(record.cliPath, defaults.cliPath),
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    loadUserSettings: readBoolean(record.loadUserSettings, defaults.loadUserSettings),
    enableChrome: readBoolean(record.enableChrome, defaults.enableChrome),
    enableBangBash: readBoolean(record.enableBangBash, defaults.enableBangBash),
    customModels: readString(record.customModels, defaults.customModels),
    lastModel: readString(record.lastModel, defaults.lastModel),
    environmentVariables: readString(record.environmentVariables, defaults.environmentVariables),
    environmentHash: readString(record.environmentHash, defaults.environmentHash),
    respectProjectSettings: readBoolean(
      record.respectProjectSettings,
      defaults.respectProjectSettings,
    ),
    projectSettingsSnapshot: normalizeClaudeCodeProjectSettingsSnapshot(
      record.projectSettingsSnapshot,
    ),
    discoveredModels: normalizeClaudeDiscoveredModels(record.discoveredModels),
  };
}

function validateKnownSettings(record: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const key of [
    'enabled',
    'loadUserSettings',
    'enableChrome',
    'enableBangBash',
    'respectProjectSettings',
  ]) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') {
      issues.push(`${key} must be a boolean`);
    }
  }
  for (const key of [
    'cliPath',
    'customModels',
    'lastModel',
    'environmentVariables',
    'environmentHash',
  ]) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      issues.push(`${key} must be a string`);
    }
  }
  if (record.cliPathsByHost !== undefined && !isRecord(record.cliPathsByHost)) {
    issues.push('cliPathsByHost must be an object');
  } else if (isRecord(record.cliPathsByHost)) {
    for (const [host, cliPath] of Object.entries(record.cliPathsByHost)) {
      if (!host.trim() || typeof cliPath !== 'string' || !cliPath.trim()) {
        issues.push('cliPathsByHost entries must have non-empty host and path strings');
        break;
      }
    }
  }
  if (record.discoveredModels !== undefined && !Array.isArray(record.discoveredModels)) {
    issues.push('discoveredModels must be an array');
  } else if (Array.isArray(record.discoveredModels)) {
    validateDiscoveredModels(record.discoveredModels, issues);
  }
  if (record.projectSettingsSnapshot !== undefined
    && !isRecord(record.projectSettingsSnapshot)) {
    issues.push('projectSettingsSnapshot must be an object');
  } else if (isRecord(record.projectSettingsSnapshot)) {
    validateProjectSettingsSnapshot(record.projectSettingsSnapshot, issues);
  }
  return issues;
}

function validateDiscoveredModels(models: readonly unknown[], issues: string[]): void {
  const seen = new Set<string>();
  for (const [index, entry] of models.entries()) {
    if (!isRecord(entry)) {
      issues.push(`discoveredModels[${index}] must be an object`);
      continue;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const displayName = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
    if (!id || !displayName) {
      issues.push(`discoveredModels[${index}] must have non-empty id and displayName strings`);
    } else if (seen.has(id)) {
      issues.push(`discoveredModels contains duplicate id ${id}`);
    }
    if (id) seen.add(id);
    if (entry.description !== undefined && typeof entry.description !== 'string') {
      issues.push(`discoveredModels[${index}].description must be a string`);
    }
    if (entry.resolvedModel !== undefined && typeof entry.resolvedModel !== 'string') {
      issues.push(`discoveredModels[${index}].resolvedModel must be a string`);
    }
    if (entry.maxInputTokens !== undefined
      && (typeof entry.maxInputTokens !== 'number'
        || !Number.isFinite(entry.maxInputTokens)
        || entry.maxInputTokens <= 0)) {
      issues.push(`discoveredModels[${index}].maxInputTokens must be positive`);
    }
    if (entry.source !== undefined && entry.source !== 'api' && entry.source !== 'sdk') {
      issues.push(`discoveredModels[${index}].source is invalid`);
    }
    if (entry.supportedEffortLevels !== undefined
      && (!Array.isArray(entry.supportedEffortLevels)
        || entry.supportedEffortLevels.some(level => !isEffortLevel(level)))) {
      issues.push(`discoveredModels[${index}].supportedEffortLevels is invalid`);
    }
  }
}

function validateProjectSettingsSnapshot(
  snapshot: Record<string, unknown>,
  issues: string[],
): void {
  if (snapshot.model !== undefined && typeof snapshot.model !== 'string') {
    issues.push('projectSettingsSnapshot.model must be a string');
  }
  if (snapshot.hash !== undefined && typeof snapshot.hash !== 'string') {
    issues.push('projectSettingsSnapshot.hash must be a string');
  }
  if (snapshot.env !== undefined && !isRecord(snapshot.env)) {
    issues.push('projectSettingsSnapshot.env must be an object');
  } else if (isRecord(snapshot.env)) {
    for (const [key, value] of Object.entries(snapshot.env)) {
      if (!key.trim() || typeof value !== 'string') {
        issues.push('projectSettingsSnapshot.env entries must have a key and string value');
        break;
      }
    }
  }
}

function isEffortLevel(value: unknown): boolean {
  return value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    || value === 'max';
}

function toDiscoveredChoice(model: ClaudeDiscoveredModel): ClaudeConfiguredModelChoice {
  return {
    id: model.id,
    label: model.displayName,
    description: model.description ?? '',
  };
}

function parseCustomModels(value: string): string[] {
  return [...new Set(value
    .split(/[\n,]/)
    .map(entry => entry.trim())
    .filter(Boolean))];
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .flatMap(([key, entry]) => {
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
