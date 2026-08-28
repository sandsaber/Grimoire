import type {
  ProviderAgentMention,
  ProviderCapabilityDescriptor,
  ProviderChatUiContribution,
  ProviderCommandDescriptor,
  ProviderCommandsPort,
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
import { mimocodeSettingsReconciler } from './env/MimocodeSettingsReconciler';
import {
  MIMOCODE_EXECUTION_DESCRIPTOR,
  MimocodeExecutionBackend,
  type MimocodeExecutionBackendContext,
} from './execution/MimocodeExecutionBackend';
import {
  DEFAULT_MIMOCODE_PROVIDER_SETTINGS,
  type MimocodeProviderSettings,
  normalizeMimocodeModelAliases,
  normalizeMimocodePreferredThinkingByModel,
  normalizeMimocodeVisibleModels,
  type PersistedMimocodeProviderSettings,
} from './settings';
import { mimocodeChatUIConfig } from './ui/MimocodeChatUIConfig';

/**
 * MiMoCode's contribution to the provider catalog.
 *
 * The sixth module, and the first that argues nothing new. OpenCode established
 * the managed-ACP subprocess topology and Grok proved a second provider needs
 * nothing added to it; MiMoCode is the third on that transport, and its
 * capability record is byte-for-byte OpenCode's. That is the result the waves
 * were for, and it is why this module is derived rather than reasoned out — the
 * two providers mirror each other deliberately, and `AGENTS.md` says a change
 * to one is usually a change to both.
 *
 * **Flipped.** `registration.ts` points `createRuntime` at the composition
 * built from this, and `MimocodeChatRuntime` is gone.
 *
 * What this flip stood on is weaker than Grok's, and the difference is worth
 * knowing before reading anything below as settled: MiMoCode's wire recording
 * is **partial**. The account it was taken on does not generate, so the
 * handshake, the session's configuration options and the shape of a turn that
 * returns empty are evidence, and the answer traffic is not. Anything here that
 * describes what an answer looks like comes from OpenCode's recording, and the
 * live smoke harness is what will confirm it.
 *
 * The settings split the codec has to respect is OpenCode's too:
 * `MimocodeProviderSettings` extends the persisted shape with `availableModes`
 * and `discoveredModels`, which are **discovery state, not settings**. Encoding
 * them would write cached CLI output into the settings file and make a stale
 * cache survive a restart.
 *
 * The absences are claims, each checked against `capabilities.ts` rather than
 * inherited with the rest:
 *
 * - **no rewind.** MiMoCode has no transcript rewind, like every provider but
 *   Claude;
 * - **no fork.** Declared false, unlike Codex and Claude;
 * - **no per-run MCP selection.** Grimoire owns the server list and injects it
 *   into the ACP session, but the chat tab's per-run selector is off for this
 *   provider — which is what `supportsMcpTools: false` actually gates;
 * - **no task-result interpretation contributed.** The interpreter exists —
 *   `registration.ts` names it — but Grimoire's async task system does not
 *   apply to this provider, as with Codex and OpenCode.
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

export interface MimocodeWorkspaceContext {
  commandsPort(): ProviderCommandsPort | undefined;
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
   * The MiMoCode database this conversation's session lives in.
   *
   * Part of the binding rather than of the settings: a session id without the
   * database it was created in resolves to nothing, so both are saved together
   * or neither is worth saving.
   */
  readDatabasePath(conversationId: string): string | null;
  dispose(): Promise<void>;
}

export type MimocodeWorkspace = ProviderWorkspaceSlots;


const mimocodeCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'mimocode',
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
    // Grimoire owns `.grimoire/mcp/mimocode.json` and injects those servers
    // into the ACP session. The per-run selector is a separate question, and
    // for this provider it is off — which is the distinction the live
    // `supportsMcpTools` boolean cannot express.
    ownership: 'grimoire',
    sessionConfiguration: 'grimoire',
    perRunSelection: 'unsupported',
  },
  agents: {
    definitions: 'provider-files',
    // Empty on purpose. `.mimocode/agent/**` definitions exist, but no subagent
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
const mimocodeChatUi: ProviderChatUiContribution = chatUiContributionFor(
  mimocodeChatUIConfig,
  mimocodeCapabilities.reasoningControl,
);

export const mimocodeSettingsCodec: ProviderSettingsCodec<MimocodeProviderSettings> = {
  providerId: 'mimocode',
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
    const persisted: PersistedMimocodeProviderSettings = {
      cliPath: value.cliPath.trim(),
      cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: normalizeMimocodeModelAliases(value.modelAliases),
      preferredThinkingByModel: normalizeMimocodePreferredThinkingByModel(
        value.preferredThinkingByModel,
      ),
      selectedMode: value.selectedMode.trim(),
      thinkingOptionsByModel: { ...value.thinkingOptionsByModel },
      visibleModels: [...normalizeMimocodeVisibleModels(value.visibleModels)],
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

  environmentKeyPrefixes: ['MIMOCODE_'],

  ...settingsReconciliationFor(mimocodeSettingsReconciler),
};

export const mimocodeProviderModule: ProviderModule<
MimocodeWorkspaceContext,
MimocodeExecutionBackendContext,
MimocodeProviderSettings
> = {
  manifest: {
    id: 'mimocode',
    displayName: 'MiMoCode',
    order: 50,
  },

  settings: mimocodeSettingsCodec,

  workspace: {
    providerId: 'mimocode',
    async initialize(context): Promise<MimocodeWorkspace> {
      return {
        ...(context.commandsPort() ? { commands: context.commandsPort()! } : {}),
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
    descriptor: MIMOCODE_EXECUTION_DESCRIPTOR,
    create: async context => new MimocodeExecutionBackend(context),
  },


  capabilities: mimocodeCapabilities,

  declarations: {
    warmup: 'commands',
    providerId: 'mimocode',
    chatUI: mimocodeChatUi,
    commandDropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    },
  },

  runtimePorts: context => ({
    providerId: 'mimocode',
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
          // hydrate and `MIMOCODE_DB` still resolve through it.
          ...(databasePath ? { providerState: { databasePath } } : {}),
        };
      },
    },
  }),
};

function createDefaultSettings(): MimocodeProviderSettings {
  return {
    ...DEFAULT_MIMOCODE_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    modelAliases: {},
    preferredThinkingByModel: {},
    thinkingOptionsByModel: {},
    visibleModels: [],
    availableModes: [],
    discoveredModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): MimocodeProviderSettings {
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
    modelAliases: normalizeMimocodeModelAliases(record.modelAliases),
    preferredThinkingByModel: normalizeMimocodePreferredThinkingByModel(
      record.preferredThinkingByModel,
    ),
    selectedMode: typeof record.selectedMode === 'string'
      ? record.selectedMode.trim()
      : defaults.selectedMode,
    thinkingOptionsByModel: isRecord(record.thinkingOptionsByModel)
      ? { ...record.thinkingOptionsByModel } as MimocodeProviderSettings['thinkingOptionsByModel']
      : defaults.thinkingOptionsByModel,
    visibleModels: normalizeMimocodeVisibleModels(record.visibleModels),
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

