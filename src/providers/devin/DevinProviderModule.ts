import type {
  ProviderAgentMention,
  ProviderCapabilityDescriptor,
  ProviderChatUiContribution,
  ProviderCommandDescriptor,
  ProviderCommandsPort,
  ProviderHistoryHydration,
  ProviderMcpPort,
  ProviderModelDescriptor,
  ProviderModelRefreshOptions,
  ProviderModule,
  ProviderSettingsCodec,
  ProviderUsageSnapshot,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';

import type { ProviderRuntimeCommandLoader } from '../../core/providers/types';
import { isRecord } from '../../utils/records';
import { chatUiContributionFor } from '../shared/chatUiContribution';
import { settingsReconciliationFor } from '../shared/settingsReconciliation';
import { devinSettingsReconciler } from './env/DevinSettingsReconciler';
import {
  DEVIN_EXECUTION_DESCRIPTOR,
  DevinExecutionBackend,
  type DevinExecutionBackendContext,
} from './execution/DevinExecutionBackend';
import { DevinConversationHistoryService } from './history/DevinConversationHistoryService';
import { devinCliResolver } from './runtime/DevinCliResolver';
import {
  DEFAULT_DEVIN_PROVIDER_SETTINGS,
  type DevinProviderSettings,
  normalizeDevinModelAliases,
  normalizeDevinVisibleModels,
  type PersistedDevinProviderSettings,
} from './settings';
import { devinChatUIConfig } from './ui/DevinChatUIConfig';

/**
 * Devin's contribution to the provider catalog.
 *
 * The tenth module, and the seventh on the managed-ACP transport. Derived from
 * Qwen's, which is the sibling it resembles: `devin acp` opens a JSON-RPC
 * server over stdio, models and modes come back in the reply to `session/new`,
 * there are no launch artifacts, and the binding is a session id and nothing
 * else. What was measured rather than assumed is in
 * `tests/fixtures/provider-traces/wire/devin-wire.json`, taken from
 * `devin 3000.6.14` on 2026-09-09 with a turn that answered.
 *
 * What Devin does not have, and this module therefore does not claim:
 *
 * - **no reasoning control.** The account's models carry their effort in the
 *   model id (`claude-opus-5-high`), and there is no `/effort` channel;
 * - **no question interaction.** Nothing has been seen on the permission
 *   channel but permissions;
 * - **no agent definitions Grimoire can list.** `devin doctor` speaks of
 *   "custom subagent profiles" and documents no file for them;
 * - **no command files.** A skill is Devin's slash command, so the commands
 *   surface is the session's own announcements plus the vault's skills.
 */

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'discoveredModelsFingerprint',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'modelAliases',
  'selectedMode',
  'visibleModels',
]);

export interface DevinWorkspaceContext {
  commandsPort(): ProviderCommandsPort;
  listSessionCommands(sessionId: string): Promise<readonly ProviderCommandDescriptor[]>;
  listAgentMentions(): Promise<readonly ProviderAgentMention[]>;
  refreshAgentMentions(): Promise<void>;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  refreshModels(
    options?: ProviderModelRefreshOptions,
  ): Promise<readonly ProviderModelDescriptor[]>;
  cachedPlanUsage(): ProviderUsageSnapshot | null;
  refreshPlanUsage(): Promise<ProviderUsageSnapshot | null>;
  mcpPort(): ProviderMcpPort;
  runtimeCommandLoader(): ProviderRuntimeCommandLoader | null;
  renderSettingsTab(host: unknown): void;
  hydrateConversation(conversationId: string): Promise<ProviderHistoryHydration>;
  deleteConversationSession(conversationId: string): Promise<void>;
  resolveSessionId(conversationId: string): string | null;
  isPendingFork(conversationId: string): boolean;
  /**
   * Whether this conversation's saved session was replaced by a fresh one,
   * or `null` when this runtime is not bound to that conversation.
   */
  readSessionDropped(conversationId: string): boolean | null;
  dispose(): Promise<void>;
}

export type DevinWorkspace = ProviderWorkspaceSlots;

const devinCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'devin',
  process: {
    topology: 'managed-acp-subprocess',
    concurrency: 'serial-runs',
  },
  session: {
    // Recorded: `loadSession: true`, `sessionCapabilities: { list, delete }`,
    // and a `session/load` that replays the transcript as updates.
    resume: 'native',
    // Grimoire keeps its own projection; the replay is not read back.
    transcriptHydration: 'unsupported',
  },
  history: { ownership: 'grimoire-projection' },
  commands: {
    // The session announces its own — recorded as `available_commands_update`
    // on `session/new` — and the tab lists them.
    discovery: 'active-session',
    chatSurface: 'grimoire',
    sessionCommands: 'native',
  },
  mcp: {
    ownership: 'grimoire',
    sessionConfiguration: 'grimoire',
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
    // Recorded: `promptCapabilities: { image: true, embeddedContext: true }`.
    imageAttachments: 'native',
    instructionMode: 'native',
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
    compaction: 'native',
  },
  security: { enforcement: 'native' },
  reasoningControl: { kind: 'none' },
  workspace: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'managed', manager: 'none', runtimeCommandDiscovery: 'active-session-only' },
    agents: { inventory: 'none', manager: 'none' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
};

const devinChatUi: ProviderChatUiContribution = chatUiContributionFor(
  devinChatUIConfig,
  devinCapabilities.reasoningControl,
);

const devinHistory = new DevinConversationHistoryService();

export const devinSettingsCodec: ProviderSettingsCodec<DevinProviderSettings> = {
  providerId: 'devin',
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
    // Deliberately omits `availableModes` and `discoveredModels`: they are
    // discovery state refreshed from the CLI, and writing them here would make
    // a stale catalogue outlive the process that produced it.
    const persisted: PersistedDevinProviderSettings = {
      discoveredModelsFingerprint: value.discoveredModelsFingerprint,
      cliPath: value.cliPath.trim(),
      cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: normalizeDevinModelAliases(value.modelAliases),
      selectedMode: value.selectedMode.trim(),
      visibleModels: [...normalizeDevinVisibleModels(value.visibleModels)],
    };
    return { ...preservedUnknown, ...persisted };
  },

  isEnabled: settings => settings.enabled,
  withEnabled: (settings, enabled) => ({ ...settings, enabled }),

  runtimeInputKeys: [
    'environmentVariables',
    'environmentHash',
    'cliPath',
    'cliPathsByHost',
  ],

  // `DEVIN_MODEL`, `DEVIN_PERMISSION_MODE`, `DEVIN_SANDBOX`: the CLI's own.
  environmentKeyPrefixes: ['DEVIN_'],

  ...settingsReconciliationFor(devinSettingsReconciler),
};

export const devinProviderModule: ProviderModule<
DevinWorkspaceContext,
DevinExecutionBackendContext,
DevinProviderSettings
> = {
  manifest: {
    id: 'devin',
    displayName: 'Devin',
    order: 100,
  },

  settings: devinSettingsCodec,

  workspace: {
    providerId: 'devin',
    async initialize(context): Promise<DevinWorkspace> {
      return {
        transcripts: {
          deleteSession: (conversation, vaultPath) => (
            devinHistory.deleteConversationSession(conversation, vaultPath)
          ),
          hydrate: (conversation, vaultPath) => (
            devinHistory.hydrateConversationHistory(conversation, vaultPath)
          ),
        },
        commands: context.commandsPort(),
        runtimeCommands: {
          listForSession: sessionId => context.listSessionCommands(sessionId),
          isAvailable: settings => context.runtimeCommandLoader()?.isAvailable(settings) ?? false,
          loadCommands: async loaderContext => (
            await context.runtimeCommandLoader()?.loadCommands(loaderContext) ?? []
          ),
        },
        agentMentions: {
          list: () => context.listAgentMentions(),
          refresh: () => context.refreshAgentMentions(),
        },
        models: {
          list: () => context.listModels(),
          refresh: options => context.refreshModels(options),
        },
        usage: {
          cached: () => context.cachedPlanUsage(),
          refresh: () => context.refreshPlanUsage(),
        },
        mcp: context.mcpPort(),
        settingsPresentation: { render: host => context.renderSettingsTab(host) },
      };
    },
    dispose: async () => {
      // The managed subprocess is owned by the execution backend, not by the
      // workspace: a flip must not leave two owners for one process.
    },
  },

  execution: {
    descriptor: DEVIN_EXECUTION_DESCRIPTOR,
    create: async context => new DevinExecutionBackend(context),
  },

  capabilities: devinCapabilities,

  declarations: {
    warmup: 'runtime',
    providerId: 'devin',
    chatUI: devinChatUi,
    commandDropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    },
    cli: { resolve: settings => devinCliResolver().resolveFromSettings(settings) },
    conversationState: {
      forkState: (sessionId, resumeAt, state) => (
        devinHistory.buildForkProviderState(sessionId, resumeAt, state)
      ),
      isPendingFork: conversation => devinHistory.isPendingForkConversation(conversation),
      resolveSessionId: conversation => devinHistory.resolveSessionIdForConversation(conversation),
      ...(devinHistory.buildPersistedProviderState
        ? { persistedState: conversation => devinHistory.buildPersistedProviderState?.(conversation) }
        : {}),
    },
  },

  runtimePorts: context => ({
    providerId: 'devin',
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      // The session id and nothing beside it: this provider writes no launch
      // state a second half of the binding could point at.
      buildSessionPatch: input => {
        const sessionDropped = context.readSessionDropped(input.conversationId);
        return {
          sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
          ...(sessionDropped === null
            ? {}
            : { providerState: sessionDropped ? { sessionDropped: true } : {} }),
        };
      },
    },
  }),
};

function createDefaultSettings(): DevinProviderSettings {
  return {
    ...DEFAULT_DEVIN_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    modelAliases: {},
    visibleModels: [],
    availableModes: [],
    discoveredModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): DevinProviderSettings {
  const defaults = createDefaultSettings();
  return {
    discoveredModelsFingerprint: typeof record.discoveredModelsFingerprint === 'string'
      ? record.discoveredModelsFingerprint
      : defaults.discoveredModelsFingerprint,
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : defaults.cliPath,
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    environmentHash: typeof record.environmentHash === 'string'
      ? record.environmentHash
      : defaults.environmentHash,
    environmentVariables: typeof record.environmentVariables === 'string'
      ? record.environmentVariables
      : defaults.environmentVariables,
    modelAliases: normalizeDevinModelAliases(record.modelAliases),
    selectedMode: typeof record.selectedMode === 'string'
      ? record.selectedMode.trim()
      : defaults.selectedMode,
    visibleModels: normalizeDevinVisibleModels(record.visibleModels),
    availableModes: [],
    discoveredModels: [],
  };
}

function validateKnownSettings(record: Readonly<Record<string, unknown>>): string[] {
  const issues: string[] = [];
  requireType(record, 'enabled', value => typeof value === 'boolean', issues);
  for (const field of [
    'cliPath',
    'environmentHash',
    'environmentVariables',
    'selectedMode',
  ]) {
    requireType(record, field, value => typeof value === 'string', issues);
  }
  for (const field of ['cliPathsByHost', 'modelAliases']) {
    requireType(record, field, isRecord, issues);
  }
  requireType(record, 'visibleModels', Array.isArray, issues);
  if (isRecord(record.cliPathsByHost)
    && Object.values(record.cliPathsByHost).some(value => typeof value !== 'string')) {
    issues.push('cliPathsByHost contains an invalid path');
  }
  if (Array.isArray(record.visibleModels)
    && record.visibleModels.some(value => typeof value !== 'string')) {
    issues.push('visibleModels contains an invalid model');
  }
  if ('discoveredModels' in record || 'availableModes' in record) {
    issues.push('discovery state must not be stored in settings');
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

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([host, entry]) => host.trim() !== '' && typeof entry === 'string')
      .map(([host, entry]) => [host, (entry as string).trim()]),
  );
}
