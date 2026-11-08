import type {
  ProviderCapabilityDescriptor,
  ProviderChatUiContribution,
  ProviderCommandsPort,
  ProviderHistoryHydration,
  ProviderModelDescriptor,
  ProviderModelRefreshOptions,
  ProviderModule,
  ProviderSettingsCodec,
  ProviderUsageSnapshot,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';

import { isRecord } from '../../utils/records';
import { chatUiContributionFor } from '../shared/chatUiContribution';
import { settingsReconciliationFor } from '../shared/settingsReconciliation';
import { antigravitySettingsReconciler } from './env/AntigravitySettingsReconciler';
import {
  ANTIGRAVITY_EXECUTION_DESCRIPTOR,
  AntigravityExecutionBackend,
  type AntigravityExecutionBackendContext,
} from './execution/AntigravityExecutionBackend';
import { AntigravityConversationHistoryService } from './history/AntigravityConversationHistoryService';
import { antigravityCliResolver } from './runtime/AntigravityCliResolver';
import {
  type AntigravityDiscoveredModel,
  type AntigravityProviderSettings,
  DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
  normalizeAntigravityModelAliases,
  normalizeAntigravityVisibleModels,
  normalizeHostnameCliPaths,
} from './settings';
import { antigravityChatUIConfig } from './ui/AntigravityChatUIConfig';

/** Antigravity uses native ACP when available and keeps print mode for older CLIs. */

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
  hydrateConversation(conversationId: string): Promise<ProviderHistoryHydration>;
  deleteConversationSession(conversationId: string): Promise<void>;
  resolveSessionId(conversationId: string): string | null;
  isPendingFork(conversationId: string): boolean;
  readSessionDropped(conversationId: string): boolean | null;
  commandsPort(): ProviderCommandsPort;
  cachedPlanUsage(): ProviderUsageSnapshot | null;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  refreshPlanUsage(): Promise<ProviderUsageSnapshot | null>;
  refreshModels(
    options?: ProviderModelRefreshOptions,
  ): Promise<readonly ProviderModelDescriptor[]>;
  renderSettingsTab(host: unknown): void;
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


const antigravityCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'antigravity',
  process: {
    // Modern CLIs keep one managed ACP process per kernel session.
    topology: 'managed-acp-subprocess',
    concurrency: 'serial-runs',
  },
  session: {
    resume: 'native',
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
    // Legacy print mode retains its temporary-file attachment fallback.
    imageAttachments: 'native',
    instructionMode: 'unsupported',
  },
  interactions: {
    approvals: 'native',
    questions: 'unsupported',
    planMode: 'native',
  },
  conversation: {
    fork: 'unsupported',
    rewind: 'unsupported',
    steering: 'unsupported',
    compaction: 'unsupported',
  },
  // ACP enforces native approvals; print mode refuses every mode except full access.
  security: { enforcement: 'native' },
  reasoningControl: { kind: 'none' },
  workspace: {
    // `readonly`, since `main`'s vault-skills fix: the slash menu lists the
    // vault's own skills for this provider, which the CLI has no surface of its
    // own for — read, never written.
    skills: { inventory: 'readonly', manager: 'none' },
    commands: { inventory: 'none', manager: 'none' },
    agents: { inventory: 'none', manager: 'none' },
    mcp: { inventory: 'none', manager: 'none' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
};

/**
 * The live config, grouped — never a second implementation of it.
 *
 * What stood here was a hand-written model presentation answering three of
 * the row's twenty questions against decoded settings, while the config the
 * chat surface already asks answered all twenty against the app's. Two
 * inventories of which models this provider owns, and no test that could see
 * them disagree.
 */
const antigravityChatUi: ProviderChatUiContribution = chatUiContributionFor(
  antigravityChatUIConfig,
  antigravityCapabilities.reasoningControl,
);

const antigravityHistory = new AntigravityConversationHistoryService();

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

  // An environment change is part of the ACP restart fingerprint.
  runtimeInputKeys: ['environmentVariables', 'environmentHash', 'cliPath', 'cliPathsByHost'],

  environmentKeyPrefixes: ['ANTIGRAVITY_', 'GOOGLE_', 'GEMINI_', 'VERTEX_'],

  ...settingsReconciliationFor(antigravitySettingsReconciler),
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
        commands: context.commandsPort(),
        transcripts: {
          deleteSession: (conversation, vaultPath) => (
            antigravityHistory.deleteConversationSession(conversation, vaultPath)
          ),
          hydrate: (conversation, vaultPath) => (
            antigravityHistory.hydrateConversationHistory(conversation, vaultPath)
          ),
        },
        models: {
          list: () => context.listModels(),
          refresh: options => context.refreshModels(options),
        },
        usage: {
          cached: () => context.cachedPlanUsage(),
          refresh: () => context.refreshPlanUsage(),
        },
        settingsPresentation: { render: host => context.renderSettingsTab(host) },
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

  // AGY exposes no Grimoire-observable native agent lifecycle.
  declarations: {
    warmup: 'none',
    providerId: 'antigravity',
    chatUI: antigravityChatUi,
    commandDropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    },
    cli: { resolve: settings => antigravityCliResolver().resolveFromSettings(settings) },
    conversationState: {
      forkState: (sessionId, resumeAt, state) => (
        antigravityHistory.buildForkProviderState(sessionId, resumeAt, state)
      ),
      isPendingFork: conversation => antigravityHistory.isPendingForkConversation(conversation),
      resolveSessionId: conversation => antigravityHistory.resolveSessionIdForConversation(conversation),
      ...(antigravityHistory.buildPersistedProviderState
        ? { persistedState: conversation => antigravityHistory.buildPersistedProviderState?.(conversation) }
        : {}),
    },
  },

  // ACP resumes by native id; message history remains the Grimoire projection.
  runtimePorts: context => ({
    providerId: 'antigravity',
    history: {
      hydrate: id => context.hydrateConversation(id),
      deleteSession: id => context.deleteConversationSession(id),
      resolveSessionId: id => context.resolveSessionId(id),
      isPendingFork: id => context.isPendingFork(id),
      buildSessionPatch: input => {
        const dropped = context.readSessionDropped(input.conversationId);
        return {
          sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
          ...(dropped === null ? {} : { providerState: dropped ? { sessionDropped: true } : {} }),
        };
      },
    },
  }),
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

function isDiscoveredModel(value: unknown): value is AntigravityDiscoveredModel {
  return isRecord(value)
    && typeof value.rawId === 'string'
    && typeof value.label === 'string'
    && (value.description === undefined
      || value.description === null
      || typeof value.description === 'string');
}
