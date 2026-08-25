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
  MIMOCODE_EXECUTION_DESCRIPTOR,
  MimocodeExecutionBackend,
  type MimocodeExecutionBackendContext,
} from './execution/MimocodeExecutionBackend';
import {
  decodeMimocodeModelId,
  isMimocodeModelSelectionId,
} from './models';
import {
  DEFAULT_MIMOCODE_PROVIDER_SETTINGS,
  type MimocodeProviderSettings,
  normalizeMimocodeModelAliases,
  normalizeMimocodePreferredThinkingByModel,
  normalizeMimocodeVisibleModels,
  type PersistedMimocodeProviderSettings,
} from './settings';

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

/**
 * The variables whose change makes an existing ACP session unusable.
 *
 * Mirrors `MimocodeSettingsReconciler`. All four change where the CLI reads its
 * configuration or writes its state, which is why they invalidate a session
 * while an unrelated `MIMOCODE_*` variable does not.
 */
const ENVIRONMENT_HASH_KEYS = [
  'MIMOCODE_CONFIG',
  'MIMOCODE_DB',
  'MIMOCODE_DISABLE_PROJECT_CONFIG',
  'XDG_DATA_HOME',
];

export interface MimocodeWorkspaceContext {
  listCommands(): Promise<readonly ProviderCommandDescriptor[]>;
  listSessionCommands(sessionId: string): Promise<readonly ProviderCommandDescriptor[]>;
  listAgentMentions(): Promise<readonly ProviderAgentMention[]>;
  refreshAgentMentions(): Promise<void>;
  resolveCliPath(): Promise<string | null>;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  refreshModels(): Promise<readonly ProviderModelDescriptor[]>;
  readPlanUsage(): Promise<ProviderUsageSnapshot | null>;
  loadMcpServers(): Promise<readonly ProviderMcpServer[]>;
  saveMcpServers(servers: readonly ProviderMcpServer[]): Promise<void>;
  startMcpServer(serverId: string): Promise<void>;
  stopMcpServer(serverId: string): Promise<void>;
  shouldKeepWarm(): boolean;
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

const mimocodeChatUi: ProviderChatUiContribution<MimocodeProviderSettings> = {
  modelPresentation: {
    // **By the prefix, which is what `MimocodeChatUIConfig` actually does.** This
    // said the opposite until Gemini's module was checked against its own live
    // config and three siblings turned out to carry the same claim: that a
    // provider-qualified raw id (`anthropic/claude-...`) makes ownership a
    // settings question. It does not. The chat never sees a raw id — it sees
    // `mimocode:anthropic/claude-...`, which `models.ts` encodes — so a lookup in a
    // list keyed by raw ids answers false for every model this provider has.
    ownsModel: modelId => isMimocodeModelSelectionId(modelId),
    // Decoded first, for the same reason: the alias map and the discovered
    // catalogue are both keyed by the raw id.
    label: (modelId, settings) => {
      const rawId = decodeMimocodeModelId(modelId) ?? modelId;
      return normalizeMimocodeModelAliases(settings.modelAliases)[rawId]
        ?? settings.discoveredModels.find(model => model.rawId === rawId)?.label
        ?? rawId;
    },
    contextWindow: () => undefined,
  },
  reasoningControl: { kind: 'effort', tiers: ['low', 'medium', 'high'] },
  permissionToggles: [
    { id: 'normal', label: 'Safe' },
    { id: 'plan', label: 'Plan' },
    { id: 'full_access', label: 'Auto-approve' },
  ],
  icon: 'mimocode',
};

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
  commands: { discovery: 'active-session', chatSurface: 'grimoire' },
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

  reconcile(settings): ProviderSettingsReconcileResult<MimocodeProviderSettings> {
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
        usage: { read: () => context.readPlanUsage() },
        mcp: {
          loadServers: () => context.loadMcpServers(),
          saveServers: servers => context.saveMcpServers(servers),
          start: serverId => context.startMcpServer(serverId),
          stop: serverId => context.stopMcpServer(serverId),
        },
        residency: { shouldKeepWarm: () => context.shouldKeepWarm() },
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

  auxiliary: { providerId: 'mimocode' },

  capabilities: mimocodeCapabilities,

  features: context => ({
    providerId: 'mimocode',
    chatUI: mimocodeChatUi,
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

function stripDiscovery(
  settings: MimocodeProviderSettings,
): Omit<MimocodeProviderSettings, 'availableModes' | 'discoveredModels'> & {
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

