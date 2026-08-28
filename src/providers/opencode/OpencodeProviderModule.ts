import type {
  ProviderAgentMention,
  ProviderCapabilityDescriptor,
  ProviderChatUiContribution,
  ProviderCommandDescriptor,
  ProviderHistoryHydration,
  ProviderMcpServer,
  ProviderModelDescriptor,
  ProviderModule,
  ProviderSettingsCodec,
  ProviderUsageSnapshot,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';

import { isRecord } from '../../utils/records';
import { chatUiContributionFor } from '../shared/chatUiContribution';
import { settingsReconciliationFor } from '../shared/settingsReconciliation';
import { opencodeSettingsReconciler } from './env/OpencodeSettingsReconciler';
import {
  OPENCODE_EXECUTION_DESCRIPTOR,
  OpencodeExecutionBackend,
  type OpencodeExecutionBackendContext,
} from './execution/OpencodeExecutionBackend';
import {
  DEFAULT_OPENCODE_PROVIDER_SETTINGS,
  normalizeOpencodeModelAliases,
  normalizeOpencodePreferredThinkingByModel,
  normalizeOpencodeVisibleModels,
  type OpencodeProviderSettings,
  type PersistedOpencodeProviderSettings,
} from './settings';
import { opencodeChatUIConfig } from './ui/OpencodeChatUIConfig';

/**
 * OpenCode's contribution to the provider catalog.
 *
 * Proof four, and the last topology: a managed ACP subprocess Grimoire launches
 * and owns, speaking a protocol shared with five other providers. It is the
 * proof that matters most for the remaining providers, because MiMoCode, Kimi
 * Code, Grok, Qwen, and Gemini all reach production through the same shared
 * `src/providers/acp/` transport this backend uses.
 *
 * Live: `OpencodeExecutionComposition` builds every flipped tab's
 * contributions from here, alongside `registration.ts` and
 * `OpencodeWorkspaceServices`.
 *
 * The one structural difference from the first three modules is its settings
 * split, which the codec has to respect: `OpencodeProviderSettings` extends the
 * persisted shape with `availableModes` and `discoveredModels`, which are
 * **discovery state, not settings**. Encoding them would write cached CLI
 * output into the settings file and make a stale cache survive a restart.
 *
 * The absences are claims:
 *
 * - **no rewind.** OpenCode has no transcript rewind, like every provider but
 *   Claude;
 * - **no per-run MCP selection.** Grimoire owns the server list and injects it
 *   into the ACP session, but the chat tab's per-run selector is off for this
 *   provider — which is what the live `supportsMcpTools: false` actually gates;
 * - **no task-result interpretation contributed.** The interpreter exists but,
 *   as with Codex, Grimoire's async task system does not apply here.
 */

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'modelAliases',
  'preferredThinkingByModel',
  'selectedMode',
  'thinkingOptionsByModel',
  'visibleModels',
]);

export interface OpencodeWorkspaceContext {
  listCommands(): Promise<readonly ProviderCommandDescriptor[]>;
  listSessionCommands(sessionId: string): Promise<readonly ProviderCommandDescriptor[]>;
  listAgentMentions(): Promise<readonly ProviderAgentMention[]>;
  refreshAgentMentions(): Promise<void>;
  resolveCliPath(): Promise<string | null>;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  refreshModels(): Promise<readonly ProviderModelDescriptor[]>;
  cachedPlanUsage(): ProviderUsageSnapshot | null;
  refreshPlanUsage(): Promise<ProviderUsageSnapshot | null>;
  loadMcpServers(): Promise<readonly ProviderMcpServer[]>;
  saveMcpServers(servers: readonly ProviderMcpServer[]): Promise<void>;
  renderSettingsTab(host: unknown): void;
  hydrateConversation(conversationId: string): Promise<ProviderHistoryHydration>;
  deleteConversationSession(conversationId: string): Promise<void>;
  resolveSessionId(conversationId: string): string | null;
  isPendingFork(conversationId: string): boolean;
  /**
   * The OpenCode database this conversation's session lives in.
   *
   * Part of the binding rather than of the settings: a session id without the
   * database it was created in resolves to nothing, so both are saved together
   * or neither is worth saving.
   */
  readDatabasePath(conversationId: string): string | null;
  dispose(): Promise<void>;
}

export type OpencodeWorkspace = ProviderWorkspaceSlots;


const opencodeCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'opencode',
  process: {
    // The fourth and last topology: a subprocess Grimoire launches, owns, and
    // speaks ACP to. The remaining five providers share this shape.
    topology: 'managed-acp-subprocess',
    concurrency: 'serial-runs',
  },
  session: {
    resume: 'native',
    transcriptHydration: 'native',
  },
  history: { ownership: 'provider-native' },
  commands: {
    discovery: 'active-session',
    chatSurface: 'grimoire',
    sessionCommands: 'native',
  },
  mcp: {
    // Grimoire owns `.grimoire/mcp/opencode.json` and injects those servers
    // into the ACP session. The per-run selector is a separate question, and
    // for this provider it is off — which is the distinction the live
    // `supportsMcpTools` boolean cannot express.
    ownership: 'grimoire',
    sessionConfiguration: 'grimoire',
    perRunSelection: 'unsupported',
  },
  agents: {
    definitions: 'provider-files',
    // Empty on purpose. `.opencode/agent/**` definitions exist, but no subagent
    // lifecycle reaches Grimoire through ACP, so naming a spawn origin would
    // promise the UI an agent it can never observe — the recorded evidence has
    // no agent events at all.
    spawnOrigin: [],
    stableIdentity: false,
    progressObservation: 'none',
    resultExtraction: false,
    cancellation: false,
    statusQuery: false,
    reattachment: false,
  },
  input: {
    imageAttachments: 'native',
    instructionMode: 'native',
  },
  interactions: {
    approvals: 'native',
    questions: 'native',
    planMode: 'native',
  },
  conversation: {
    fork: 'unsupported',
    rewind: 'unsupported',
    steering: 'unsupported',
    compaction: 'native',
  },
  security: { enforcement: 'native' },
  reasoningControl: { kind: 'effort', tiers: ['low', 'medium', 'high'] },
  workspace: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'readonly', manager: 'managed', runtimeCommandDiscovery: 'ephemeral' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'managed', manager: 'managed' },
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
const opencodeChatUi: ProviderChatUiContribution = chatUiContributionFor(
  opencodeChatUIConfig,
  opencodeCapabilities.reasoningControl,
);

export const opencodeSettingsCodec: ProviderSettingsCodec<OpencodeProviderSettings> = {
  providerId: 'opencode',
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
    // a stale catalogue outlive the process that produced it. The persisted
    // interface draws the same line.
    const persisted: PersistedOpencodeProviderSettings = {
      cliPath: value.cliPath.trim(),
      cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: normalizeOpencodeModelAliases(value.modelAliases),
      preferredThinkingByModel: normalizeOpencodePreferredThinkingByModel(
        value.preferredThinkingByModel,
      ),
      selectedMode: value.selectedMode.trim(),
      thinkingOptionsByModel: { ...value.thinkingOptionsByModel },
      visibleModels: [...normalizeOpencodeVisibleModels(value.visibleModels)],
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

  environmentKeyPrefixes: ['OPENCODE_'],

  ...settingsReconciliationFor(opencodeSettingsReconciler),
};

export const opencodeProviderModule: ProviderModule<
OpencodeWorkspaceContext,
OpencodeExecutionBackendContext,
OpencodeProviderSettings
> = {
  manifest: {
    id: 'opencode',
    displayName: 'OpenCode',
    order: 30,
  },

  settings: opencodeSettingsCodec,

  workspace: {
    providerId: 'opencode',
    async initialize(context): Promise<OpencodeWorkspace> {
      return {
        commands: { list: () => context.listCommands() },
        runtimeCommands: {
          listForSession: sessionId => context.listSessionCommands(sessionId),
        },
        agentMentions: {
          list: () => context.listAgentMentions(),
          refresh: () => context.refreshAgentMentions(),
        },
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
        usage: {
          cached: () => context.cachedPlanUsage(),
          refresh: () => context.refreshPlanUsage(),
        },
        mcp: {
          loadServers: () => context.loadMcpServers(),
          saveServers: servers => context.saveMcpServers(servers),
        },
        settingsPresentation: { render: host => context.renderSettingsTab(host) },
      };
    },
    dispose: async () => {
      // The managed subprocess is owned by the execution backend, not by the
      // workspace: a flip must not leave two owners for one process.
    },
  },

  execution: {
    descriptor: OPENCODE_EXECUTION_DESCRIPTOR,
    create: async context => new OpencodeExecutionBackend(context),
  },


  capabilities: opencodeCapabilities,

  declarations: {
    warmup: 'commands',
    providerId: 'opencode',
    chatUI: opencodeChatUi,
    commandDropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    },
  },

  runtimePorts: context => ({
    providerId: 'opencode',
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      buildSessionPatch: input => {
        const databasePath = context.readDatabasePath(input.conversationId);
        return {
          sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
          // Kept even when the session was invalidated, which is what the
          // legacy runtime did and for the reason it recorded: the SQLite
          // hydrate and `OPENCODE_DB` still resolve through it.
          ...(databasePath ? { providerState: { databasePath } } : {}),
        };
      },
    },
  }),
};

function createDefaultSettings(): OpencodeProviderSettings {
  return {
    ...DEFAULT_OPENCODE_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    modelAliases: {},
    preferredThinkingByModel: {},
    thinkingOptionsByModel: {},
    visibleModels: [],
    availableModes: [],
    discoveredModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): OpencodeProviderSettings {
  const defaults = createDefaultSettings();
  return {
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : defaults.cliPath,
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    environmentHash: typeof record.environmentHash === 'string'
      ? record.environmentHash
      : defaults.environmentHash,
    environmentVariables: typeof record.environmentVariables === 'string'
      ? record.environmentVariables
      : defaults.environmentVariables,
    modelAliases: normalizeOpencodeModelAliases(record.modelAliases),
    preferredThinkingByModel: normalizeOpencodePreferredThinkingByModel(
      record.preferredThinkingByModel,
    ),
    selectedMode: typeof record.selectedMode === 'string'
      ? record.selectedMode.trim()
      : defaults.selectedMode,
    thinkingOptionsByModel: isRecord(record.thinkingOptionsByModel)
      ? { ...record.thinkingOptionsByModel } as OpencodeProviderSettings['thinkingOptionsByModel']
      : defaults.thinkingOptionsByModel,
    visibleModels: normalizeOpencodeVisibleModels(record.visibleModels),
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
  for (const field of [
    'cliPathsByHost',
    'modelAliases',
    'preferredThinkingByModel',
    'thinkingOptionsByModel',
  ]) {
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
    // Not merely unknown: these are discovery state that an older build wrote
    // into the settings file, and reading them back would resurrect a stale
    // catalogue. Reported so the caller can drop them rather than preserve them.
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

