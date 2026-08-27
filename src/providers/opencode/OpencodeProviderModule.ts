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
  ProviderSettingsReconcileResult,
  ProviderUsageSnapshot,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';
import { parseEnvironmentVariables } from '@/utils/env';

import { isRecord } from '../../utils/records';
import {
  OPENCODE_EXECUTION_DESCRIPTOR,
  OpencodeExecutionBackend,
  type OpencodeExecutionBackendContext,
} from './execution/OpencodeExecutionBackend';
import {
  decodeOpencodeModelId,
  isOpencodeModelSelectionId,
} from './models';
import {
  DEFAULT_OPENCODE_PROVIDER_SETTINGS,
  normalizeOpencodeModelAliases,
  normalizeOpencodePreferredThinkingByModel,
  normalizeOpencodeVisibleModels,
  type OpencodeProviderSettings,
  type PersistedOpencodeProviderSettings,
} from './settings';

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

/**
 * The variables whose change makes an existing ACP session unusable.
 *
 * Mirrors `OpencodeSettingsReconciler`. All four change where the CLI reads its
 * configuration or writes its state, which is why they invalidate a session
 * while an unrelated `OPENCODE_*` variable does not.
 */
const ENVIRONMENT_HASH_KEYS = [
  'OPENCODE_CONFIG',
  'OPENCODE_DB',
  'OPENCODE_DISABLE_PROJECT_CONFIG',
  'XDG_DATA_HOME',
];

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

const opencodeChatUi: ProviderChatUiContribution<OpencodeProviderSettings> = {
  modelPresentation: {
    // **By the prefix, which is what `OpencodeChatUIConfig` actually does.** This
    // said the opposite until Gemini's module was checked against its own live
    // config and three siblings turned out to carry the same claim: that a
    // provider-qualified raw id (`anthropic/claude-...`) makes ownership a
    // settings question. It does not. The chat never sees a raw id — it sees
    // `opencode:anthropic/claude-...`, which `models.ts` encodes — so a lookup in a
    // list keyed by raw ids answers false for every model this provider has.
    ownsModel: modelId => isOpencodeModelSelectionId(modelId),
    // Decoded first, for the same reason: the alias map and the discovered
    // catalogue are both keyed by the raw id.
    label: (modelId, settings) => {
      const rawId = decodeOpencodeModelId(modelId) ?? modelId;
      return normalizeOpencodeModelAliases(settings.modelAliases)[rawId]
        ?? settings.discoveredModels.find(model => model.rawId === rawId)?.label
        ?? rawId;
    },
    contextWindow: () => undefined,
  },
  permissionToggles: [
    { id: 'normal', label: 'Safe' },
    { id: 'plan', label: 'Plan' },
    { id: 'full_access', label: 'Auto-approve' },
  ],
  icon: 'opencode',
};

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
    commands: 'grimoire',
    agents: 'grimoire',
    mcp: 'grimoire',
    cliResolution: 'native',
    models: 'native',
    usage: 'native',
    environment: 'grimoire',
  },
};

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

  reconcile(settings): ProviderSettingsReconcileResult<OpencodeProviderSettings> {
    const environmentHash = computeEnvironmentHash(settings.environmentVariables);
    const normalized = decodeSettings(this.encode({ ...settings, environmentHash }));
    return {
      // Discovery state survives reconciliation because the codec does not
      // persist it: it belongs to the caller that refreshed it.
      settings: {
        ...normalized,
        availableModes: settings.availableModes,
        discoveredModels: settings.discoveredModels,
      },
      changed: !deepEqual({ ...normalized, environmentHash }, stripDiscovery(settings)),
      invalidatesSessions: environmentHash !== settings.environmentHash,
    };
  },
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

function stripDiscovery(
  settings: OpencodeProviderSettings,
): Omit<OpencodeProviderSettings, 'availableModes' | 'discoveredModels'> & {
  availableModes: never[];
  discoveredModels: never[];
} {
  return { ...settings, availableModes: [], discoveredModels: [] };
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

function computeEnvironmentHash(environmentText: string): string {
  const variables = parseEnvironmentVariables(environmentText || '');
  return ENVIRONMENT_HASH_KEYS
    .filter(key => variables[key])
    .map(key => `${key}=${variables[key]}`)
    .sort()
    .join('|');
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

