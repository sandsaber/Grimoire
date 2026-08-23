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
  GEMINI_EXECUTION_DESCRIPTOR,
  GeminiExecutionBackend,
  type GeminiExecutionBackendContext,
} from './execution/GeminiExecutionBackend';
import {
  decodeGeminiModelId,
  isGeminiModelSelectionId,
} from './models';
import {
  DEFAULT_GEMINI_PROVIDER_SETTINGS,
  type GeminiProviderSettings,
  normalizeGeminiModelAliases,
  normalizeGeminiVisibleModels,
  type PersistedGeminiProviderSettings,
} from './settings';

/**
 * Gemini CLI's contribution to the provider catalog.
 *
 * The eighth module and the fifth on the managed-ACP transport, and the first
 * of them written for a provider that had none: Gemini reached the kernel
 * without ever having a `ProviderModule`, so this is the file the composition
 * needs before it can name a backend id, a capability record or a history
 * contribution.
 *
 * **Flipped.** `registration.ts` points `createRuntime` at the composition built
 * from this, and `GeminiChatRuntime` is gone.
 *
 * Derived from Grok's rather than from the OpenCode family's, which is the
 * measured answer and not a preference: this CLI configures a session through
 * `session/set_model` and `session/set_mode` where the family uses
 * `session/set_config_option`, and the recorded `session/new`
 * (`gemini 0.55.1`) answers with `models` and `modes` and **no** config
 * options at all.
 *
 * Four things separate it from every sibling on this transport, each read off
 * `capabilities.ts` or the recording rather than inherited:
 *
 * - **no native transcript.** `supportsNativeHistory: false`. There is no
 *   session log to hydrate a conversation from and none to read an answer back
 *   from, which is why the result sink has no recovery port and why history
 *   ownership below is Grimoire's projection rather than the provider's;
 * - **no reasoning control.** `reasoningControl: 'none'`, and the session
 *   carries no config option a thinking level could be set through;
 * - **its modes are the CLI's own** — `default`, `autoEdit`, `yolo`, `plan` —
 *   and none of them is one of Grimoire's three. `modes.ts` translates both
 *   ways; `autoEdit` maps to Safe, because it auto-approves an edit and still
 *   asks before a command;
 * - **a flag, not a subcommand.** `gemini --acp`, where the four before it take
 *   `acp` as a verb.
 *
 * The settings split the codec has to respect is the family's:
 * `GeminiProviderSettings` extends the persisted shape with `availableModes`
 * and `discoveredModels`, which are **discovery state, not settings**. Encoding
 * them would write cached CLI output into the settings file and make a stale
 * catalogue outlive the process that produced it.
 */

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'modelAliases',
  'selectedMode',
  'visibleModels',
]);

/**
 * The variables whose change means a different account is answering.
 *
 * Read off the recorded `initialize`, which lists this CLI's four auth methods:
 * personal OAuth, a Gemini API key, Vertex AI, and a gateway. The three that
 * can be carried in the environment are what this hashes. Unlike the OpenCode
 * family there is no config-path or database variable here — this provider
 * writes no launch artifacts, so nothing in the environment moves where its
 * state lives.
 */
const ENVIRONMENT_HASH_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_GENAI_USE_VERTEXAI',
];

export interface GeminiWorkspaceContext {
  listCommands(): Promise<readonly ProviderCommandDescriptor[]>;
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
  dispose(): Promise<void>;
}

export type GeminiWorkspace = ProviderWorkspaceSlots;

const geminiChatUi: ProviderChatUiContribution<GeminiProviderSettings> = {
  modelPresentation: {
    // **By the prefix, which is what `GeminiChatUIConfig` actually does.** The
    // OpenCode family owns a model by the user-curated list, and copying that
    // here was wrong in a way nothing would have caught until M3: a chat model
    // id is encoded (`gemini:gemini-2.5-pro`) while the settings hold the CLI's
    // raw one, so a list lookup on the encoded id answers false for every model
    // this provider has.
    ownsModel: modelId => isGeminiModelSelectionId(modelId),
    // Decoded first, for the same reason: the alias map and the discovered
    // catalogue are both keyed by the raw id.
    label: (modelId, settings) => {
      const rawId = decodeGeminiModelId(modelId) ?? modelId;
      return normalizeGeminiModelAliases(settings.modelAliases)[rawId]
        ?? settings.discoveredModels.find(model => model.rawId === rawId)?.label
        ?? rawId;
    },
    contextWindow: () => undefined,
  },
  // Not an omission and not an oversight: `capabilities.ts` declares
  // `reasoningControl: 'none'`, and the recorded session offers no config
  // option a level could be carried in.
  reasoningControl: { kind: 'none' },
  permissionToggles: [
    { id: 'normal', label: 'Safe' },
    { id: 'plan', label: 'Plan' },
    { id: 'full_access', label: 'Auto-approve' },
  ],
  icon: 'gemini',
};

const geminiCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'gemini',
  process: {
    topology: 'managed-acp-subprocess',
    concurrency: 'serial-runs',
  },
  session: {
    // `agentCapabilities.loadSession` is true in the recording, and the legacy
    // runtime resumes through `session/load`.
    resume: 'native',
    // And nothing more than the binding: this CLI hydrates no transcript for
    // Grimoire to read, which `capabilities.ts` states as
    // `supportsNativeHistory: false`.
    transcriptHydration: 'unsupported',
  },
  history: { ownership: 'grimoire-projection' },
  commands: {
    // The vault's own `.gemini/commands/**/*.toml`, read by
    // `GeminiCommandCatalog`. The session announces its own commands too — the
    // recording captures `available_commands_update` carrying twenty of them —
    // and Grimoire drops every one, because `supportsProviderCommands: false`
    // and the workspace registration declares `runtimeCommandDiscovery: 'none'`.
    discovery: 'static',
    chatSurface: 'grimoire',
  },
  mcp: {
    // Grimoire owns `.grimoire/mcp/gemini.json` and injects those servers into
    // the ACP session. The chat tab's per-run selector is a separate question,
    // and for this provider it is off — the distinction the live
    // `supportsMcpTools` boolean cannot express.
    ownership: 'grimoire',
    sessionConfiguration: 'grimoire',
    perRunSelection: 'unsupported',
  },
  agents: {
    definitions: 'provider-files',
    // Empty on purpose, and the same claim `gemini-execution.json` records:
    // `.gemini/agents/*.md` definitions exist, but no subagent lifecycle
    // reaches Grimoire through ACP, so naming a spawn origin would promise the
    // UI an agent it can never observe.
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
    // The CLI's own, and nothing Grimoire reaches: it compresses its context
    // when the window fills, and the twenty commands the recorded session
    // announces contain no compression command to invoke.
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

export const geminiSettingsCodec: ProviderSettingsCodec<GeminiProviderSettings> = {
  providerId: 'gemini',
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
    const persisted: PersistedGeminiProviderSettings = {
      cliPath: value.cliPath.trim(),
      cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: normalizeGeminiModelAliases(value.modelAliases),
      selectedMode: value.selectedMode.trim(),
      visibleModels: [...normalizeGeminiVisibleModels(value.visibleModels)],
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

  reconcile(settings): ProviderSettingsReconcileResult<GeminiProviderSettings> {
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

export const geminiProviderModule: ProviderModule<
GeminiWorkspaceContext,
GeminiExecutionBackendContext,
GeminiProviderSettings
> = {
  manifest: {
    id: 'gemini',
    // What is legacy here is the CLI, not this adapter: Google replaced Gemini
    // CLI with Antigravity, and `registration.ts` has said so since before the
    // migration. The name is product copy, so it is copied rather than tidied.
    displayName: 'Gemini CLI (Legacy)',
    order: 80,
  },

  settings: geminiSettingsCodec,

  workspace: {
    providerId: 'gemini',
    async initialize(context): Promise<GeminiWorkspace> {
      return {
        commands: { list: () => context.listCommands() },
        // No `runtimeCommands` slot, which is this provider's own absence: the
        // session's announced commands are dropped, so a tab asked for them
        // would be answered with a list nothing produced.
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
    descriptor: GEMINI_EXECUTION_DESCRIPTOR,
    create: async context => new GeminiExecutionBackend(context),
  },

  auxiliary: { providerId: 'gemini' },

  capabilities: geminiCapabilities,

  features: context => ({
    providerId: 'gemini',
    chatUI: geminiChatUi,
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      // The session id and nothing beside it. Every sibling on this transport
      // also saves where its session lives — a database path, a managed home —
      // because a session id alone resolves to nothing there. Gemini writes no
      // such state, so there is nothing to keep and no `providerState` to
      // build.
      buildSessionPatch: input => ({
        sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
      }),
    },
  }),
};

function createDefaultSettings(): GeminiProviderSettings {
  return {
    ...DEFAULT_GEMINI_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    modelAliases: {},
    visibleModels: [],
    availableModes: [],
    discoveredModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): GeminiProviderSettings {
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
    modelAliases: normalizeGeminiModelAliases(record.modelAliases),
    selectedMode: typeof record.selectedMode === 'string'
      ? record.selectedMode.trim()
      : defaults.selectedMode,
    visibleModels: normalizeGeminiVisibleModels(record.visibleModels),
    availableModes: [],
    discoveredModels: [],
  };
}

function stripDiscovery(
  settings: GeminiProviderSettings,
): Omit<GeminiProviderSettings, 'availableModes' | 'discoveredModels'> & {
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
