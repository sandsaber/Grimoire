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
import type { ManagedAcpExecutionBackendContext } from '@/providers/acp/execution/ManagedAcpExecutionBackend';

import { GRIMOIRE_STORAGE_PATH } from '../../core/bootstrap/StoragePaths';
import type { ProviderRuntimeCommandLoader } from '../../core/providers/types';
import { isRecord } from '../../utils/records';
import { chatUiContributionFor } from '../shared/chatUiContribution';
import { settingsReconciliationFor } from '../shared/settingsReconciliation';
import { grokSettingsReconciler } from './env/GrokSettingsReconciler';
import {
  GROK_EXECUTION_DESCRIPTOR,
  GrokExecutionBackend,
} from './execution/GrokExecutionBackend';
import { GrokConversationHistoryService } from './history/GrokConversationHistoryService';
import { normalizeGrokThinkingOptionsByModel } from './models';
import { grokSubagentLifecycleAdapter } from './normalization/grokSubagentNormalization';
import { grokCliResolver } from './runtime/GrokCliResolver';
import { GROK_ARTIFACTS_SUBDIR } from './runtime/GrokPaths';
import {
  DEFAULT_GROK_PROVIDER_SETTINGS,
  type GrokProviderSettings,
  normalizeGrokModelAliases,
  normalizeGrokPreferredThinkingByModel,
  normalizeGrokVisibleModels,
  type PersistedGrokProviderSettings,
} from './settings';
import { grokChatUIConfig } from './ui/GrokChatUIConfig';

/**
 * Grok Build's contribution to the provider catalog.
 *
 * The fifth module, and the first written for a provider whose topology was
 * already proven: OpenCode established the managed-ACP subprocess shape, and
 * this one adds no new argument about the contract — which is the result wave 5
 * was for. Its settings are field-for-field OpenCode's, because both are ACP
 * CLIs Grimoire launches with a curated model list and a per-model thinking
 * level, so the codec is the same shape with Grok's own environment keys.
 *
 * Two declarations differ from the live capability record, both deliberately:
 *
 * - **no rewind.** The legacy runtime answered `canRewind: false` for every
 *   input while `GROK_PROVIDER_CAPABILITIES.supportsRewind` said `true`, so
 *   every Grok assistant message carried a rewind button whose menu could only
 *   fail. Declared `unsupported` here, which is what removed it at the flip.
 *   Named rather than silent: it is the one product behaviour Grok's flip
 *   changed;
 * - **no per-run MCP selection.** As with OpenCode, Grimoire owns
 *   `.grimoire/mcp/grok.json` and injects those servers into the ACP session;
 *   the chat tab's per-run selector is what `supportsMcpTools: false` gates.
 *
 * Fork stays `native`: `resolveSessionIdForFork` answers with the live session,
 * which is what forking a Grok conversation actually resumes.
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

export interface GrokWorkspaceContext {
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
   * Where this conversation's transcript lives, and the workspace it was
   * recorded against.
   *
   * Part of the binding rather than of the settings, for the reason OpenCode's
   * database is: Grok writes its own session log under the managed home, and a
   * session id without the directory it was written in hydrates nothing.
   */
  readSessionPaths(conversationId: string): {
    readonly sessionDirPath?: string;
    readonly workspacePath?: string;
  };
  dispose(): Promise<void>;
}

export type GrokWorkspace = ProviderWorkspaceSlots;


const grokCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'grok',
  process: {
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
    ownership: 'grimoire',
    sessionConfiguration: 'grimoire',
    perRunSelection: 'unsupported',
  },
  agents: {
    definitions: 'provider-files',
    // Empty for the reason OpenCode's is: `.grok/agents/*.md` definitions
    // exist, but no subagent lifecycle reaches Grimoire over ACP, so naming a
    // spawn origin would promise the UI an agent it can never observe.
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
    fork: 'native',
    // The live record says `true`; the runtime it describes answers
    // `canRewind: false` unconditionally. See the module comment.
    rewind: 'unsupported',
    steering: 'unsupported',
    compaction: 'native',
  },
  security: { enforcement: 'native' },
  reasoningControl: { kind: 'effort', tiers: ['low', 'medium', 'high'] },
  workspace: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'readonly', manager: 'managed', runtimeCommandDiscovery: 'active-session-only' },
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
const grokChatUi: ProviderChatUiContribution = chatUiContributionFor(
  grokChatUIConfig,
  grokCapabilities.reasoningControl,
);

const grokHistory = new GrokConversationHistoryService();

export const grokSettingsCodec: ProviderSettingsCodec<GrokProviderSettings> = {
  providerId: 'grok',
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
    // Omits `availableModes` and `discoveredModels` for the reason the legacy
    // settings module keeps them in a separate discovery bag: they are what a
    // running Grok reported, and writing them here would let a catalogue
    // outlive the CLI that produced it.
    const persisted: PersistedGrokProviderSettings = {
      cliPath: value.cliPath.trim(),
      cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: normalizeGrokModelAliases(value.modelAliases),
      preferredThinkingByModel: normalizeGrokPreferredThinkingByModel(
        value.preferredThinkingByModel,
      ),
      selectedMode: value.selectedMode.trim(),
      thinkingOptionsByModel: normalizeGrokThinkingOptionsByModel(value.thinkingOptionsByModel),
      visibleModels: [...normalizeGrokVisibleModels(value.visibleModels)],
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

  environmentKeyPrefixes: ['GROK_', 'XAI_'],

  ...settingsReconciliationFor(grokSettingsReconciler, 'session-and-state'),
};

export const grokProviderModule: ProviderModule<
GrokWorkspaceContext,
Omit<ManagedAcpExecutionBackendContext, 'descriptor'>,
GrokProviderSettings
> = {
  manifest: {
    id: 'grok',
    displayName: 'Grok Build',
    order: 40,
  },

  settings: grokSettingsCodec,

  workspace: {
    providerId: 'grok',
    async initialize(context): Promise<GrokWorkspace> {
      return {
        transcripts: {
          deleteSession: (conversation, vaultPath) => (
            grokHistory.deleteConversationSession(conversation, vaultPath)
          ),
          hydrate: (conversation, vaultPath) => (
            grokHistory.hydrateConversationHistory(conversation, vaultPath)
          ),
        },
        commands: context.commandsPort(),
        runtimeCommands: {
          listForSession: sessionId => context.listSessionCommands(sessionId),
          // Read afresh, so a workspace rebuilt behind the tab is the one asked.
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
      // The managed subprocess belongs to the execution backend. A flip that
      // left the workspace owning one too would have two owners for one process.
    },
  },

  execution: {
    descriptor: GROK_EXECUTION_DESCRIPTOR,
    create: async context => new GrokExecutionBackend(context),
  },


  capabilities: grokCapabilities,

  declarations: {
    warmup: 'commands',
    providerId: 'grok',
    chatUI: grokChatUi,
    subagentLifecycle: grokSubagentLifecycleAdapter,
    // The only provider that preloads a file of its own: Grok has no agent
    // definition, so its system prompt is written to the vault and passed on
    // the command line, and the chat context surface shows what went in.
    context: {
      preloadedFileNames: () => [
        `${GRIMOIRE_STORAGE_PATH}/${GROK_ARTIFACTS_SUBDIR}/system.md`,
      ],
    },
    commandDropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    },
    cli: { resolve: settings => grokCliResolver().resolveFromSettings(settings) },
    conversationState: {
      forkState: (sessionId, resumeAt, state) => (
        grokHistory.buildForkProviderState(sessionId, resumeAt, state)
      ),
      isPendingFork: conversation => grokHistory.isPendingForkConversation(conversation),
      resolveSessionId: conversation => grokHistory.resolveSessionIdForConversation(conversation),
      ...(grokHistory.buildPersistedProviderState
        ? { persistedState: conversation => grokHistory.buildPersistedProviderState?.(conversation) }
        : {}),
    },
  },

  runtimePorts: context => ({
    providerId: 'grok',
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      buildSessionPatch: input => {
        const paths = context.readSessionPaths(input.conversationId);
        const providerState = {
          ...(paths.sessionDirPath ? { sessionDirPath: paths.sessionDirPath } : {}),
          ...(paths.workspacePath ? { workspacePath: paths.workspacePath } : {}),
        };
        return {
          sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
          // Kept even when the session was invalidated, which is what the
          // host's session-update builder does and for its reason: the next
          // session is written to the same directory, and the transcript
          // already there is still this conversation's.
          ...(Object.keys(providerState).length > 0 ? { providerState } : {}),
        };
      },
    },
  }),
};

function createDefaultSettings(): GrokProviderSettings {
  return {
    ...DEFAULT_GROK_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    modelAliases: {},
    preferredThinkingByModel: {},
    thinkingOptionsByModel: {},
    visibleModels: [],
    availableModes: [],
    discoveredModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): GrokProviderSettings {
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
    modelAliases: normalizeGrokModelAliases(record.modelAliases),
    preferredThinkingByModel: normalizeGrokPreferredThinkingByModel(
      record.preferredThinkingByModel,
    ),
    selectedMode: typeof record.selectedMode === 'string'
      ? record.selectedMode.trim()
      : defaults.selectedMode,
    thinkingOptionsByModel: normalizeGrokThinkingOptionsByModel(record.thinkingOptionsByModel),
    visibleModels: normalizeGrokVisibleModels(record.visibleModels),
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
    // Not merely unknown: older builds wrote this discovery state into the
    // settings file, and `hasLegacyGrokDiscoveryFields` exists because reading
    // it back resurrects a catalogue the CLI no longer offers.
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

