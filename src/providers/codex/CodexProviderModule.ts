import type { ProviderCommandCatalog } from '@/core/providers/commands/ProviderCommandCatalog';
import type { ProviderModule } from '@/core/providers/ProviderModule';
import type { HostnameCliPaths } from '@/core/types/settings';
import { parseEnvironmentVariables } from '@/utils/env';

import { CodexSkillCatalog } from './commands/CodexSkillCatalog';
import {
  CODEX_EXECUTION_DESCRIPTOR,
  CodexExecutionBackend,
  type CodexExecutionBackendContext,
} from './execution/CodexExecutionBackend';
import {
  normalizeCodexDiscoveredModels,
} from './modelDiscoveryState';
import {
  type CodexInstallationMethod,
  type CodexProviderSettings,
  type CodexReasoningSummary,
  DEFAULT_CODEX_PROVIDER_SETTINGS,
  type HostnameInstallationMethods,
} from './settings';
import type { CodexSkillListProvider } from './skills/CodexSkillListingService';
import type { CodexSkillStorage } from './storage/CodexSkillStorage';
import {
  DEFAULT_CODEX_MODELS,
  formatCodexModelLabel,
} from './types/models';

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'customModels',
  'discoveredModels',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'installationMethod',
  'installationMethodsByHost',
  'reasoningSummary',
  'wslDistroOverride',
  'wslDistroOverridesByHost',
]);
const REASONING_SUMMARIES = new Set<CodexReasoningSummary>([
  'auto',
  'concise',
  'detailed',
  'none',
]);

export interface CodexModuleWorkspace {
  dispose(): Promise<void>;
}

export interface CodexWorkspaceModuleContext {
  initialize(signal: AbortSignal): Promise<CodexModuleWorkspace>;
}

export interface CodexConfiguredModelChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface CodexConfiguredModelsPort {
  list(settings: CodexProviderSettings): readonly CodexConfiguredModelChoice[];
}

export interface CodexCommandCatalogContext {
  readonly storage: CodexSkillStorage;
  readonly listProvider: CodexSkillListProvider;
  readonly vaultPath: string | null;
}

export interface CodexCommandsPort {
  createCatalog(context: CodexCommandCatalogContext): ProviderCommandCatalog;
}

export const codexCommandsPort: CodexCommandsPort = Object.freeze({
  createCatalog(context: CodexCommandCatalogContext) {
    return new CodexSkillCatalog(context.storage, context.listProvider, context.vaultPath);
  },
});

export const codexConfiguredModelsPort: CodexConfiguredModelsPort = Object.freeze({
  list(settings: CodexProviderSettings) {
    const discovered = normalizeCodexDiscoveredModels(settings.discoveredModels);
    const choices: CodexConfiguredModelChoice[] = discovered.length > 0
      ? discovered.map(model => ({
        id: model.id,
        label: model.label,
        description: model.description ?? '',
      }))
      : DEFAULT_CODEX_MODELS.map(model => ({
        id: model.value,
        label: model.label,
        description: model.description ?? '',
      }));
    const seen = new Set(choices.map(choice => choice.id));
    const environmentModel = parseEnvironmentVariables(settings.environmentVariables)
      .OPENAI_MODEL?.trim();
    if (environmentModel && !seen.has(environmentModel)) {
      choices.unshift({
        id: environmentModel,
        label: formatCodexModelLabel(environmentModel),
        description: 'Custom (env)',
      });
      seen.add(environmentModel);
    }
    for (const id of parseCustomModelIds(settings.customModels)) {
      if (seen.has(id)) {
        continue;
      }
      choices.push({
        id,
        label: formatCodexModelLabel(id),
        description: 'Custom model',
      });
      seen.add(id);
    }
    return choices;
  },
});

export const codexProviderModule: ProviderModule<
CodexProviderSettings,
CodexModuleWorkspace,
CodexExecutionBackend,
CodexWorkspaceModuleContext,
CodexExecutionBackendContext
> = {
  manifest: {
    id: 'codex',
    displayName: 'Codex',
    order: 20,
    settingsPresentation: {
      name: 'Codex',
      tabName: 'Codex',
      descriptionKey: 'settings.providers.codex.desc',
    },
  },
  settings: {
    providerId: 'codex',
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
        cliPath: value.cliPath.trim(),
        cliPathsByHost: { ...normalizeStringMap(value.cliPathsByHost) },
        customModels: value.customModels,
        discoveredModels: normalizeCodexDiscoveredModels(value.discoveredModels)
          .map(model => ({ ...model })),
        enabled: value.enabled,
        environmentHash: value.environmentHash,
        environmentVariables: value.environmentVariables,
        installationMethod: normalizeInstallationMethod(value.installationMethod),
        installationMethodsByHost: {
          ...normalizeInstallationMethods(value.installationMethodsByHost),
        },
        reasoningSummary: normalizeReasoningSummary(value.reasoningSummary),
        wslDistroOverride: value.wslDistroOverride.trim(),
        wslDistroOverridesByHost: { ...normalizeStringMap(value.wslDistroOverridesByHost) },
      };
    },
    runtimeFingerprintInput(value) {
      return {
        cliPath: value.cliPath.trim(),
        cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
        enabled: value.enabled,
        environmentVariables: value.environmentVariables,
        installationMethod: normalizeInstallationMethod(value.installationMethod),
        installationMethodsByHost: normalizeInstallationMethods(value.installationMethodsByHost),
        wslDistroOverride: value.wslDistroOverride.trim(),
        wslDistroOverridesByHost: normalizeStringMap(value.wslDistroOverridesByHost),
      };
    },
  },
  workspace: {
    providerId: 'codex',
    initialize: (context, signal) => context.initialize(signal),
    dispose: workspace => workspace.dispose(),
  },
  execution: {
    descriptor: CODEX_EXECUTION_DESCRIPTOR,
    create: async context => new CodexExecutionBackend(context),
  },
  capabilities: {
    providerId: 'codex',
    process: {
      topology: 'persistent-app-server',
      concurrency: 'multiplexed-sessions',
    },
    session: {
      resume: 'native',
      transcriptHydration: 'native',
    },
    history: { ownership: 'provider-native' },
    commands: { discovery: 'ephemeral-process' },
    mcp: {
      ownership: 'native',
      sessionConfiguration: 'unsupported',
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
      fork: 'native',
      rewind: 'unsupported',
      steering: 'native',
      compaction: 'native',
    },
    interactions: {
      approval: 'native',
      question: 'native',
      planExit: 'unsupported',
    },
    security: {
      process: 'grimoire',
      filesystem: 'native',
      network: 'native',
      permissions: 'native',
    },
  },
  features: {
    providerId: 'codex',
    ports: {
      commands: codexCommandsPort,
      models: codexConfiguredModelsPort,
    },
  },
};

function createDefaultSettings(): CodexProviderSettings {
  return {
    ...DEFAULT_CODEX_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    discoveredModels: [],
    installationMethodsByHost: {},
    wslDistroOverridesByHost: {},
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): CodexProviderSettings {
  const defaults = createDefaultSettings();
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : defaults.cliPath,
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    customModels: typeof record.customModels === 'string'
      ? record.customModels
      : defaults.customModels,
    discoveredModels: normalizeCodexDiscoveredModels(record.discoveredModels),
    reasoningSummary: normalizeReasoningSummary(record.reasoningSummary),
    environmentVariables: typeof record.environmentVariables === 'string'
      ? record.environmentVariables
      : defaults.environmentVariables,
    environmentHash: typeof record.environmentHash === 'string'
      ? record.environmentHash
      : defaults.environmentHash,
    installationMethod: normalizeInstallationMethod(record.installationMethod),
    installationMethodsByHost: normalizeInstallationMethods(record.installationMethodsByHost),
    wslDistroOverride: typeof record.wslDistroOverride === 'string'
      ? record.wslDistroOverride.trim()
      : defaults.wslDistroOverride,
    wslDistroOverridesByHost: normalizeStringMap(record.wslDistroOverridesByHost),
  };
}

function validateKnownSettings(record: Readonly<Record<string, unknown>>): string[] {
  const issues: string[] = [];
  validateType(record, 'enabled', 'boolean', issues);
  for (const field of [
    'cliPath',
    'customModels',
    'environmentHash',
    'environmentVariables',
    'wslDistroOverride',
  ]) {
    validateType(record, field, 'string', issues);
  }
  for (const field of ['cliPathsByHost', 'installationMethodsByHost', 'wslDistroOverridesByHost']) {
    if (field in record && !isRecord(record[field])) {
      issues.push(`${field} must be an object`);
    }
  }
  for (const field of ['cliPathsByHost', 'wslDistroOverridesByHost']) {
    if (isRecord(record[field]) && Object.entries(record[field]).some(([key, value]) => (
      !key.trim() || typeof value !== 'string' || !value.trim()
    ))) {
      issues.push(`${field} contains an invalid path`);
    }
  }
  if (isRecord(record.installationMethodsByHost)
    && Object.entries(record.installationMethodsByHost).some(([key, value]) => (
      !key.trim() || (value !== 'native-windows' && value !== 'wsl')
    ))) {
    issues.push('installationMethodsByHost contains an invalid method');
  }
  if ('discoveredModels' in record && !Array.isArray(record.discoveredModels)) {
    issues.push('discoveredModels must be an array');
  } else if (Array.isArray(record.discoveredModels)
    && record.discoveredModels.some(model => !isValidDiscoveredModel(model))) {
    issues.push('discoveredModels contains an invalid model');
  }
  if ('reasoningSummary' in record && !REASONING_SUMMARIES.has(record.reasoningSummary as CodexReasoningSummary)) {
    issues.push('reasoningSummary is invalid');
  }
  if ('installationMethod' in record
    && record.installationMethod !== 'native-windows'
    && record.installationMethod !== 'wsl') {
    issues.push('installationMethod is invalid');
  }
  return issues;
}

function isValidDiscoveredModel(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    return false;
  }
  return (!('label' in value) || typeof value.label === 'string')
    && (!('description' in value) || typeof value.description === 'string')
    && (!('isDefault' in value) || typeof value.isDefault === 'boolean');
}

function validateType(
  record: Readonly<Record<string, unknown>>,
  field: string,
  expected: 'boolean' | 'string',
  issues: string[],
): void {
  if (field in record && typeof record[field] !== expected) {
    issues.push(`${field} must be a ${expected}`);
  }
}

function normalizeReasoningSummary(value: unknown): CodexReasoningSummary {
  return REASONING_SUMMARIES.has(value as CodexReasoningSummary)
    ? value as CodexReasoningSummary
    : DEFAULT_CODEX_PROVIDER_SETTINGS.reasoningSummary;
}

function normalizeInstallationMethod(value: unknown): CodexInstallationMethod {
  return value === 'wsl' ? 'wsl' : 'native-windows';
}

function normalizeInstallationMethods(value: unknown): HostnameInstallationMethods {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, CodexInstallationMethod] => (
        entry[0].trim().length > 0
        && (entry[1] === 'native-windows' || entry[1] === 'wsl')
      )),
  );
}

function normalizeStringMap(value: unknown): HostnameCliPaths {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => (
        entry[0].trim().length > 0
        && typeof entry[1] === 'string'
        && entry[1].trim().length > 0
      ))
      .map(([key, entry]) => [key, entry.trim()]),
  );
}

function parseCustomModelIds(value: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of value.split(/\r?\n/u)) {
    const id = line.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
