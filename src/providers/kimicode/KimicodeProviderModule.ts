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
  KIMICODE_EXECUTION_DESCRIPTOR,
  KimicodeExecutionBackend,
  type KimicodeExecutionBackendContext,
} from './execution/KimicodeExecutionBackend';
import {
  decodeKimicodeModelId,
  isKimicodeModelSelectionId,
} from './models';
import {
  DEFAULT_KIMICODE_PROVIDER_SETTINGS,
  type KimicodeProviderSettings,
  normalizeKimicodeModelAliases,
  normalizeKimicodePreferredThinkingByModel,
  normalizeKimicodeVisibleModels,
  type PersistedKimicodeProviderSettings,
} from './settings';

/**
 * Kimi Code's contribution to the provider catalog.
 *
 * The seventh module, and the fourth on one transport. OpenCode established the
 * managed-ACP subprocess topology, Grok proved a second provider needs nothing
 * added to it, and MiMoCode's flip added nothing either; Kimi Code's capability
 * record is byte-for-byte OpenCode's. That is the result the waves were for, and
 * it is why this module is derived rather than reasoned out.
 *
 * **Flipped.** `registration.ts` points `createRuntime` at the composition
 * built from this, and `KimicodeChatRuntime` is gone.
 *
 * What this flip stands on is the thinnest of the six, and the difference is
 * worth knowing before reading anything below as settled: Kimi Code's wire
 * recording never opened a session at all. `kimi acp` answered `session/new`
 * with **"Authentication required"** on the machine it was taken from, so what
 * is evidence here is the handshake and that refusal — a real shape a flip meets
 * — and nothing else. Its models, its modes, its config options and its answer
 * traffic are all unobserved. What stands in for them is `KimicodeChatRuntime`,
 * which has been driving this CLI on the legacy path, and the live smoke harness
 * is what will confirm it.
 *
 * One thing this provider does *not* inherit: its mode ids are the CLI's own —
 * `auto`, `default`, `plan` — where OpenCode and MiMoCode use Grimoire-minted
 * ones (`grimoire-full-access`, `grimoire-safe`). `modes.ts` also accepts
 * `build` and a legacy `grimoire-yolo`. A derivation that carried the sibling's
 * ids across would map every permission mode to nothing.
 *
 * The settings split the codec has to respect is OpenCode's too:
 * `KimicodeProviderSettings` extends the persisted shape with `availableModes`
 * and `discoveredModels`, which are **discovery state, not settings**. Encoding
 * them would write cached CLI output into the settings file and make a stale
 * cache survive a restart.
 *
 * The absences are claims, each checked against `capabilities.ts` rather than
 * inherited with the rest:
 *
 * - **no rewind.** Kimi Code has no transcript rewind, like every provider but
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
 * Mirrors `KimicodeSettingsReconciler`. All four change where the CLI reads its
 * configuration or writes its state, which is why they invalidate a session
 * while an unrelated `KIMICODE_*` variable does not.
 */
const ENVIRONMENT_HASH_KEYS = [
  'KIMICODE_CONFIG',
  'KIMICODE_DB',
  'KIMICODE_DISABLE_PROJECT_CONFIG',
  'XDG_DATA_HOME',
];

export interface KimicodeWorkspaceContext {
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
   * The Kimi Code database this conversation's session lives in.
   *
   * Part of the binding rather than of the settings: a session id without the
   * database it was created in resolves to nothing, so both are saved together
   * or neither is worth saving.
   */
  readDatabasePath(conversationId: string): string | null;
  dispose(): Promise<void>;
}

export type KimicodeWorkspace = ProviderWorkspaceSlots;

const kimicodeChatUi: ProviderChatUiContribution<KimicodeProviderSettings> = {
  modelPresentation: {
    // **By the prefix, which is what `KimicodeChatUIConfig` actually does.** This
    // said the opposite until Gemini's module was checked against its own live
    // config and three siblings turned out to carry the same claim: that a
    // provider-qualified raw id (`anthropic/claude-...`) makes ownership a
    // settings question. It does not. The chat never sees a raw id — it sees
    // `kimicode:anthropic/claude-...`, which `models.ts` encodes — so a lookup in a
    // list keyed by raw ids answers false for every model this provider has.
    ownsModel: modelId => isKimicodeModelSelectionId(modelId),
    // Decoded first, for the same reason: the alias map and the discovered
    // catalogue are both keyed by the raw id.
    label: (modelId, settings) => {
      const rawId = decodeKimicodeModelId(modelId) ?? modelId;
      return normalizeKimicodeModelAliases(settings.modelAliases)[rawId]
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
  icon: 'kimicode',
};

const kimicodeCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'kimicode',
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
    // Grimoire owns `.grimoire/mcp/kimicode.json` and injects those servers
    // into the ACP session. The per-run selector is a separate question, and
    // for this provider it is off — which is the distinction the live
    // `supportsMcpTools` boolean cannot express.
    ownership: 'grimoire',
    sessionConfiguration: 'grimoire',
    perRunSelection: 'unsupported',
  },
  agents: {
    definitions: 'provider-files',
    // Empty on purpose. `.kimicode/agent/**` definitions exist, but no subagent
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

export const kimicodeSettingsCodec: ProviderSettingsCodec<KimicodeProviderSettings> = {
  providerId: 'kimicode',
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
    const persisted: PersistedKimicodeProviderSettings = {
      cliPath: value.cliPath.trim(),
      cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: normalizeKimicodeModelAliases(value.modelAliases),
      preferredThinkingByModel: normalizeKimicodePreferredThinkingByModel(
        value.preferredThinkingByModel,
      ),
      selectedMode: value.selectedMode.trim(),
      thinkingOptionsByModel: { ...value.thinkingOptionsByModel },
      visibleModels: [...normalizeKimicodeVisibleModels(value.visibleModels)],
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

  reconcile(settings): ProviderSettingsReconcileResult<KimicodeProviderSettings> {
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

export const kimicodeProviderModule: ProviderModule<
KimicodeWorkspaceContext,
KimicodeExecutionBackendContext,
KimicodeProviderSettings
> = {
  manifest: {
    id: 'kimicode',
    displayName: 'Kimi Code',
    order: 60,
  },

  settings: kimicodeSettingsCodec,

  workspace: {
    providerId: 'kimicode',
    async initialize(context): Promise<KimicodeWorkspace> {
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
    descriptor: KIMICODE_EXECUTION_DESCRIPTOR,
    create: async context => new KimicodeExecutionBackend(context),
  },

  auxiliary: { providerId: 'kimicode' },

  capabilities: kimicodeCapabilities,

  features: context => ({
    providerId: 'kimicode',
    chatUI: kimicodeChatUi,
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
          // hydrate and `KIMICODE_DB` still resolve through it.
          ...(databasePath ? { providerState: { databasePath } } : {}),
        };
      },
    },
  }),
};

function createDefaultSettings(): KimicodeProviderSettings {
  return {
    ...DEFAULT_KIMICODE_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    modelAliases: {},
    preferredThinkingByModel: {},
    thinkingOptionsByModel: {},
    visibleModels: [],
    availableModes: [],
    discoveredModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): KimicodeProviderSettings {
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
    modelAliases: normalizeKimicodeModelAliases(record.modelAliases),
    preferredThinkingByModel: normalizeKimicodePreferredThinkingByModel(
      record.preferredThinkingByModel,
    ),
    selectedMode: typeof record.selectedMode === 'string'
      ? record.selectedMode.trim()
      : defaults.selectedMode,
    thinkingOptionsByModel: isRecord(record.thinkingOptionsByModel)
      ? { ...record.thinkingOptionsByModel } as KimicodeProviderSettings['thinkingOptionsByModel']
      : defaults.thinkingOptionsByModel,
    visibleModels: normalizeKimicodeVisibleModels(record.visibleModels),
    availableModes: [],
    discoveredModels: [],
  };
}

function stripDiscovery(
  settings: KimicodeProviderSettings,
): Omit<KimicodeProviderSettings, 'availableModes' | 'discoveredModels'> & {
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

