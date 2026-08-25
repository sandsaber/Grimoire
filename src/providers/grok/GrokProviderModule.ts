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
import type { ManagedAcpExecutionBackendContext } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import { parseEnvironmentVariables } from '@/utils/env';

import { isRecord } from '../../utils/records';
import {
  GROK_EXECUTION_DESCRIPTOR,
  GrokExecutionBackend,
} from './execution/GrokExecutionBackend';
import {
  decodeGrokModelId,
  isGrokModelSelectionId,
  normalizeGrokThinkingOptionsByModel,
} from './models';
import {
  DEFAULT_GROK_PROVIDER_SETTINGS,
  type GrokProviderSettings,
  normalizeGrokModelAliases,
  normalizeGrokPreferredThinkingByModel,
  normalizeGrokVisibleModels,
  type PersistedGrokProviderSettings,
} from './settings';

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

/**
 * The variables whose change makes an existing Grok session unusable.
 *
 * Mirrors `GrokSettingsReconciler`. Three of them move where the CLI reads its
 * credentials and writes its session store; the fourth is the API key itself,
 * and a session created under one account is not resumable under another.
 */
const ENVIRONMENT_HASH_KEYS = [
  'GROK_AUTH',
  'GROK_AUTH_PATH',
  'GROK_HOME',
  'XAI_API_KEY',
];

/** What the chat tab shows for a model with no other stated width. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

export interface GrokWorkspaceContext {
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

const grokChatUi: ProviderChatUiContribution<GrokProviderSettings> = {
  modelPresentation: {
    // Grok model ids are Grimoire-encoded (`grok:<raw id>`), so ownership is a
    // question the encoding answers. It is the answer for every provider that
    // encodes one — this module had it right while three siblings claimed their
    // visible list was the only thing that could, which their own chat UI
    // configs contradicted.
    ownsModel: modelId => isGrokModelSelectionId(modelId),
    label: (modelId, settings) => {
      const rawId = decodeGrokModelId(modelId);
      if (!rawId) {
        return modelId;
      }
      return normalizeGrokModelAliases(settings.modelAliases)[rawId]
        ?? settings.discoveredModels.find(model => model.rawId === rawId)?.label
        ?? rawId;
    },
    contextWindow: () => DEFAULT_CONTEXT_WINDOW,
  },
  permissionToggles: [
    { id: 'normal', label: 'Safe' },
    { id: 'plan', label: 'Plan' },
    { id: 'full_access', label: 'Auto-approve' },
  ],
  icon: 'grok',
};

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
    commands: 'grimoire',
    agents: 'grimoire',
    mcp: 'grimoire',
    cliResolution: 'native',
    models: 'native',
    usage: 'native',
    environment: 'grimoire',
  },
};

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

  reconcile(settings): ProviderSettingsReconcileResult<GrokProviderSettings> {
    const environmentHash = computeEnvironmentHash(settings.environmentVariables);
    const normalized = decodeSettings(this.encode({ ...settings, environmentHash }));
    return {
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
      // The managed subprocess belongs to the execution backend. A flip that
      // left the workspace owning one too would have two owners for one process.
    },
  },

  execution: {
    descriptor: GROK_EXECUTION_DESCRIPTOR,
    create: async context => new GrokExecutionBackend(context),
  },

  auxiliary: { providerId: 'grok' },

  capabilities: grokCapabilities,

  features: context => ({
    providerId: 'grok',
    chatUI: grokChatUi,
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
          // legacy runtime's `buildSessionUpdates` does and for its reason: the
          // next session is written to the same directory, and the transcript
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

function stripDiscovery(
  settings: GrokProviderSettings,
): Omit<GrokProviderSettings, 'availableModes' | 'discoveredModels'> & {
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

