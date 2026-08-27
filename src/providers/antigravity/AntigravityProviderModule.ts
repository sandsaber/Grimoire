import type {
  ProviderCapabilityDescriptor,
  ProviderChatUiContribution,
  ProviderModelDescriptor,
  ProviderModule,
  ProviderSettingsCodec,
  ProviderSettingsReconcileResult,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';

import { isRecord } from '../../utils/records';
import {
  ANTIGRAVITY_EXECUTION_DESCRIPTOR,
  AntigravityExecutionBackend,
  type AntigravityExecutionBackendContext,
} from './execution/AntigravityExecutionBackend';
import {
  type AntigravityDiscoveredModel,
  type AntigravityProviderSettings,
  DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
  normalizeAntigravityModelAliases,
  normalizeAntigravityVisibleModels,
  normalizeHostnameCliPaths,
} from './settings';

/**
 * Antigravity's contribution to the provider catalog.
 *
 * Written against the M1 `ProviderModule` contract rather than harvested: the
 * v1 module targets the contract harvest ban 1 excludes, whose feature ports
 * were bare `object`. The settings decode and encode logic is reused as
 * material, because it is real validation with a real preserved-unknown path.
 *
 * In production: `AntigravityExecution` builds the backend from
 * `execution.create` and the chat runtime from `features`.
 *
 * Honest absences, per the contract's "absent means unsupported" rule:
 * Antigravity has no resume, no native history, no commands, no MCP, no
 * interactions, and no agents — and its auxiliary services are registered
 * today as no-ops, so this module contributes none rather than contributing
 * three that silently do nothing.
 */

/**
 * Normalizers this module needs that the provider's settings module does not
 * export.
 *
 * `normalizeHostnameCliPaths` used to be here too, with the note that it lived
 * here "until the Antigravity flip, when the module becomes the settings
 * authority". The flip shipped; it is imported from `settings.ts` now, which is
 * where one rule with two implementations belongs.
 */

function normalizeCustomModels(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeDiscoveredModels(value: unknown): AntigravityDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isDiscoveredModel).map(model => ({ ...model }));
}

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

export interface AntigravityWorkspaceContext {
  resolveCliPath(): Promise<string | null>;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  refreshModels(): Promise<readonly ProviderModelDescriptor[]>;
}

/**
 * Antigravity's workspace slots.
 *
 * Deliberately data only. Releasing whatever the workspace held belongs to the
 * contribution's `dispose`, which closes over what it created — a slots object
 * that carries its own teardown method would make every consumer of a slot
 * responsible for lifecycle it does not own.
 */
export type AntigravityWorkspace = ProviderWorkspaceSlots;

const antigravityChatUi: ProviderChatUiContribution<AntigravityProviderSettings> = {
  modelPresentation: {
    // Antigravity's own models are prefixed; a model the user added by hand or
    // discovered from `agy models` is owned too, which is why the settings are
    // consulted rather than the prefix alone.
    ownsModel: (modelId, settings) => modelId.startsWith('antigravity:')
      || normalizeAntigravityVisibleModels(settings.visibleModels).includes(modelId)
      || normalizeDiscoveredModels(settings.discoveredModels)
        .some(model => model.rawId === modelId),
    label: (modelId, settings) => normalizeAntigravityModelAliases(settings.modelAliases)[modelId]
      ?? modelId.replace(/^antigravity:/, ''),
    contextWindow: () => undefined,
  },
  permissionToggles: [],
  icon: 'antigravity',
};

const antigravityCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'antigravity',
  process: {
    // One print-mode process per run: the stateless topology the plan uses as
    // proof that the contract does not assume a persistent session.
    topology: 'process-per-run',
    concurrency: 'serial-runs',
  },
  session: {
    resume: 'unsupported',
    transcriptHydration: 'unsupported',
  },
  history: { ownership: 'grimoire-projection' },
  commands: {
    discovery: 'unsupported',
    chatSurface: 'unsupported',
    sessionCommands: 'unsupported',
  },
  mcp: {
    ownership: 'unsupported',
    sessionConfiguration: 'unsupported',
    perRunSelection: 'unsupported',
  },
  agents: {
    definitions: 'none',
    spawnOrigin: [],
    stableIdentity: false,
    progressObservation: 'none',
    resultExtraction: false,
    cancellation: false,
    statusQuery: false,
    reattachment: false,
  },
  input: {
    imageAttachments: 'unsupported',
    instructionMode: 'unsupported',
  },
  interactions: {
    approvals: 'unsupported',
    questions: 'unsupported',
    planMode: 'unsupported',
  },
  conversation: {
    fork: 'unsupported',
    rewind: 'unsupported',
    steering: 'unsupported',
    compaction: 'unsupported',
  },
  // Grimoire enforces the process boundary because the CLI exposes no approval
  // surface; that is why Safe mode stays fail-closed for this provider.
  security: { enforcement: 'grimoire' },
  reasoningControl: { kind: 'none' },
  workspace: {
    skills: { inventory: 'none', manager: 'none' },
    commands: { inventory: 'none', manager: 'none' },
    agents: { inventory: 'none', manager: 'none' },
    mcp: { inventory: 'none', manager: 'none' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
};

export const antigravitySettingsCodec: ProviderSettingsCodec<AntigravityProviderSettings> = {
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
      // Unknown keys are written back first so a settings file from a newer
      // build survives an older one. The current loader drops them; this is the
      // contract that stops it.
      ...preservedUnknown,
      cliPath: value.cliPath.trim(),
      cliPathsByHost: { ...normalizeHostnameCliPaths(value.cliPathsByHost) },
      customModels: normalizeCustomModels(value.customModels),
      discoveredModels: normalizeDiscoveredModels(value.discoveredModels),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: { ...normalizeAntigravityModelAliases(value.modelAliases) },
      visibleModels: [...normalizeAntigravityVisibleModels(value.visibleModels)],
    };
  },

  isEnabled: settings => settings.enabled,
  withEnabled: (settings, enabled) => ({ ...settings, enabled }),

  // Antigravity reads its environment at launch, so an environment change
  // invalidates the next run rather than a live session.
  runtimeInputKeys: ['environmentVariables', 'environmentHash', 'cliPath', 'cliPathsByHost'],

  environmentKeyPrefixes: ['ANTIGRAVITY_', 'GOOGLE_', 'GEMINI_', 'VERTEX_'],

  reconcile(settings): ProviderSettingsReconcileResult<AntigravityProviderSettings> {
    const normalized = decodeSettings(this.encode(settings));
    return {
      settings: normalized,
      // Order-insensitive: encode and decode rebuild the object, so a raw
      // `JSON.stringify` comparison reports every reconciliation as a change
      // purely from key ordering, and a settings write would follow every load.
      changed: !deepEqual(normalized, settings),
      // No resumable session exists, so there is nothing reconciliation could
      // invalidate: the next run simply starts a fresh process.
      invalidatesSessions: false,
    };
  },
};

export const antigravityProviderModule: ProviderModule<
AntigravityWorkspaceContext,
AntigravityExecutionBackendContext,
AntigravityProviderSettings
> = {
  manifest: {
    id: 'antigravity',
    displayName: 'Antigravity',
    order: 70,
  },

  settings: antigravitySettingsCodec,

  workspace: {
    providerId: 'antigravity',
    async initialize(context): Promise<AntigravityWorkspace> {
      return {
        cliResolution: {
          resolve: async () => {
            const executable = await context.resolveCliPath();
            return executable
              ? { executable, source: 'configured' as const }
              : { executable: null, source: 'unavailable' as const };
          },
        },
        models: {
          list: () => context.listModels(),
          refresh: () => context.refreshModels(),
        },
      };
    },
    dispose: async () => {
      // Nothing to release: model discovery is request-scoped and the CLI
      // resolver holds no handle. The half is declared anyway, because a
      // contribution that can initialize without disposing is app-level
      // inventory row 3 — the v1 defect repeating.
    },
  },

  execution: {
    descriptor: ANTIGRAVITY_EXECUTION_DESCRIPTOR,
    create: async context => new AntigravityExecutionBackend(context),
  },


  capabilities: antigravityCapabilities,

  // No task results or native agents: print mode spawns no subagents.
  declarations: {
    warmup: 'none',
    providerId: 'antigravity',
    chatUI: antigravityChatUi,
  },

  // No history and no rewind: print mode keeps no transcript Grimoire could
  // hydrate, and there is nothing to rewind to.
  runtimePorts: () => ({ providerId: 'antigravity' }),
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
    cliPathsByHost: normalizeHostnameCliPaths(record.cliPathsByHost),
    customModels: normalizeCustomModels(record.customModels),
    discoveredModels: normalizeDiscoveredModels(record.discoveredModels),
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

/** Structural equality that ignores key order and treats arrays as ordered. */
function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index])
    && leftKeys.every(key => deepEqual(left[key], right[key]));
}

function isDiscoveredModel(value: unknown): value is AntigravityDiscoveredModel {
  return isRecord(value)
    && typeof value.rawId === 'string'
    && typeof value.label === 'string'
    && (value.description === undefined
      || value.description === null
      || typeof value.description === 'string');
}
