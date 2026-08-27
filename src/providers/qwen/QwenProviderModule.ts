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
  QWEN_EXECUTION_DESCRIPTOR,
  QwenExecutionBackend,
  type QwenExecutionBackendContext,
} from './execution/QwenExecutionBackend';
import {
  decodeQwenModelId,
  isQwenModelSelectionId,
} from './models';
import {
  DEFAULT_QWEN_PROVIDER_SETTINGS,
  normalizeQwenEffortLevel,
  normalizeQwenModelAliases,
  normalizeQwenVisibleModels,
  type PersistedQwenProviderSettings,
  QWEN_EFFORT_LEVELS,
  type QwenProviderSettings,
} from './settings';

/**
 * Qwen Code's contribution to the provider catalog.
 *
 * The ninth module and the last provider of the migration. **Flipped**:
 * `registration.ts` points `createRuntime` at the composition built from it.
 *
 * Derived from Gemini's, which was measured rather than assumed. Both CLIs take
 * `--acp` as a flag where the OpenCode family takes `acp` as a subcommand, both
 * configure a session through dedicated methods, and both name their modes the
 * same way — `default`, `plan`, `yolo`. Normalized against each other the two
 * runtimes differ in 706 lines out of 833 and 1,236, and the difference is
 * almost entirely **addition**: Qwen's method surface is a strict superset of
 * Gemini's. Four things are in it that Gemini has nothing of:
 *
 * - **reasoning effort, applied as a prompt.** `reasoningControl: 'effort'`, and
 *   the runtime sets it by sending `/effort <level>` as a `session/prompt` of
 *   its own before the turn's. Not a config option and not a dedicated method —
 *   a slash command in the prompt channel, which is a mechanism no other
 *   provider on this transport uses. Five levels, not the family's three;
 * - **the session's own commands.** `supportsProviderCommands: true` and the
 *   workspace declares `runtimeCommandDiscovery: 'active-session-only'`, so
 *   unlike Gemini this provider surfaces what a session announces rather than
 *   dropping it — and the `runtimeCommands` slot below exists for that reason;
 * - **ask-user-question**, which the legacy runtime answers through its own
 *   permission handler;
 * - **`reloadWorkspaceResources`**, a `ChatRuntime` member Gemini leaves absent.
 *
 * What it shares with Gemini is the shape of every absence:
 * `supportsNativeHistory: false`, so history ownership is Grimoire's projection
 * and there is no transcript to hydrate; no launch artifacts, so nothing in the
 * environment moves where its state lives; and a session binding that is an id
 * and nothing else.
 *
 * **Nothing here has been observed answering.** `qwen 0.21.15` refused
 * `session/new` with *"Authentication required: Use Qwen Code CLI to
 * authenticate first."* on the machine its wire recording was taken from, so
 * what is evidence is the handshake and that refusal — a real shape a flip meets
 * — and nothing else. Its models, its modes and its answer traffic are all
 * unobserved. What stands in for them is the runtime this replaced, which had
 * been driving this CLI on the legacy path.
 */

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'effortLevel',
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
 * The recorded `initialize` lists exactly one auth method — *"Use OpenAI API
 * key: Requires setting the `OPENAI_API_KEY` environment variable"* — so that
 * one is evidence and the two beside it are the endpoints a key is used
 * against. `DASHSCOPE_API_KEY` is what `registration.ts` anticipates with its
 * `/^DASHSCOPE_/i` pattern; the recording has never seen it offered.
 *
 * As with Gemini there is no config-path or database variable here: this
 * provider writes no launch artifacts, so nothing in the environment moves where
 * its state lives.
 */
const ENVIRONMENT_HASH_KEYS = [
  'DASHSCOPE_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
];

export interface QwenWorkspaceContext {
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
  dispose(): Promise<void>;
}

export type QwenWorkspace = ProviderWorkspaceSlots;

const qwenChatUi: ProviderChatUiContribution<QwenProviderSettings> = {
  modelPresentation: {
    // By the prefix, which is what `QwenChatUIConfig` does: the chat's ids are
    // encoded (`qwen:<raw id>`) and the settings hold the CLI's raw ones.
    ownsModel: modelId => isQwenModelSelectionId(modelId),
    label: (modelId, settings) => {
      const rawId = decodeQwenModelId(modelId) ?? modelId;
      return normalizeQwenModelAliases(settings.modelAliases)[rawId]
        ?? settings.discoveredModels.find(model => model.rawId === rawId)?.label
        ?? rawId;
    },
    contextWindow: () => undefined,
  },
  // Five levels where the OpenCode family has three, and the mechanism behind
  // them is this provider's own: a `/effort <level>` prompt rather than a config
  // option or a dedicated method.
  permissionToggles: [
    { id: 'normal', label: 'Safe' },
    { id: 'plan', label: 'Plan' },
    { id: 'full_access', label: 'Auto-approve' },
  ],
  icon: 'qwen',
};

const qwenCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'qwen',
  process: {
    topology: 'managed-acp-subprocess',
    concurrency: 'serial-runs',
  },
  session: {
    // The recorded `initialize` answers `loadSession: true`, and beside it
    // `sessionCapabilities: { list, resume }` — which Gemini's does not carry.
    resume: 'native',
    // And nothing more than the binding: `supportsNativeHistory: false`, so
    // there is no transcript for Grimoire to read a conversation back out of.
    transcriptHydration: 'unsupported',
  },
  history: { ownership: 'grimoire-projection' },
  commands: {
    // Unlike Gemini, which drops what its session announces: this provider
    // surfaces them, and the workspace registration says so with
    // `runtimeCommandDiscovery: 'active-session-only'`.
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
    // Empty on purpose: `.qwen/agents/*.md` definitions exist, but no subagent
    // lifecycle reaches Grimoire through ACP, so naming a spawn origin would
    // promise the UI an agent it can never observe.
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
    // This one is its own: the legacy runtime answers an ACP ask-user-question
    // through its permission handler, which no sibling on this transport does.
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
  reasoningControl: { kind: 'effort', tiers: [...QWEN_EFFORT_LEVELS] },
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

export const qwenSettingsCodec: ProviderSettingsCodec<QwenProviderSettings> = {
  providerId: 'qwen',
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
    const persisted: PersistedQwenProviderSettings = {
      cliPath: value.cliPath.trim(),
      cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
      effortLevel: normalizeQwenEffortLevel(value.effortLevel),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: normalizeQwenModelAliases(value.modelAliases),
      selectedMode: value.selectedMode.trim(),
      visibleModels: [...normalizeQwenVisibleModels(value.visibleModels)],
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

  environmentKeyPrefixes: ['QWEN_', 'DASHSCOPE_', 'WEB_SEARCH_'],

  reconcile(settings): ProviderSettingsReconcileResult<QwenProviderSettings> {
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

export const qwenProviderModule: ProviderModule<
QwenWorkspaceContext,
QwenExecutionBackendContext,
QwenProviderSettings
> = {
  manifest: {
    id: 'qwen',
    displayName: 'Qwen Code',
    order: 90,
  },

  settings: qwenSettingsCodec,

  workspace: {
    providerId: 'qwen',
    async initialize(context): Promise<QwenWorkspace> {
      return {
        commands: { list: () => context.listCommands() },
        // Present, unlike Gemini's: this provider surfaces the commands its
        // session announces.
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
        settingsPresentation: { render: host => context.renderSettingsTab(host) },
      };
    },
    dispose: async () => {
      // The managed subprocess is owned by the execution backend, not by the
      // workspace: a flip must not leave two owners for one process.
    },
  },

  execution: {
    descriptor: QWEN_EXECUTION_DESCRIPTOR,
    create: async context => new QwenExecutionBackend(context),
  },

  auxiliary: { providerId: 'qwen' },

  capabilities: qwenCapabilities,

  declarations: {
    warmup: 'runtime',
    providerId: 'qwen',
    chatUI: qwenChatUi,
  },

  runtimePorts: context => ({
    providerId: 'qwen',
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      // The session id and nothing beside it, as Gemini's is: this provider
      // writes no launch state a second half of the binding could point at.
      buildSessionPatch: input => ({
        sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
      }),
    },
  }),
};

function createDefaultSettings(): QwenProviderSettings {
  return {
    ...DEFAULT_QWEN_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    modelAliases: {},
    visibleModels: [],
    availableModes: [],
    discoveredModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): QwenProviderSettings {
  const defaults = createDefaultSettings();
  return {
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : defaults.cliPath,
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    effortLevel: normalizeQwenEffortLevel(record.effortLevel),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    environmentHash: typeof record.environmentHash === 'string'
      ? record.environmentHash
      : defaults.environmentHash,
    environmentVariables: typeof record.environmentVariables === 'string'
      ? record.environmentVariables
      : defaults.environmentVariables,
    modelAliases: normalizeQwenModelAliases(record.modelAliases),
    selectedMode: typeof record.selectedMode === 'string'
      ? record.selectedMode.trim()
      : defaults.selectedMode,
    visibleModels: normalizeQwenVisibleModels(record.visibleModels),
    availableModes: [],
    discoveredModels: [],
  };
}

function stripDiscovery(
  settings: QwenProviderSettings,
): Omit<QwenProviderSettings, 'availableModes' | 'discoveredModels'> & {
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
    'effortLevel',
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
  if (typeof record.effortLevel === 'string'
    && !(QWEN_EFFORT_LEVELS as readonly string[]).includes(record.effortLevel)) {
    // Reported rather than silently defaulted: a level this CLI does not have
    // reaches it as a `/effort <level>` prompt, which is a turn spent on a
    // command the agent will not understand.
    issues.push('effortLevel is not a level this provider offers');
  }
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
