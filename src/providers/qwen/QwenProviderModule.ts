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
import { qwenSettingsReconciler } from './env/QwenSettingsReconciler';
import {
  QWEN_EXECUTION_DESCRIPTOR,
  QwenExecutionBackend,
  type QwenExecutionBackendContext,
} from './execution/QwenExecutionBackend';
import { QwenConversationHistoryService } from './history/QwenConversationHistoryService';
import { qwenCliResolver } from './runtime/QwenCliResolver';
import {
  DEFAULT_QWEN_PROVIDER_SETTINGS,
  normalizeQwenEffortLevel,
  normalizeQwenModelAliases,
  normalizeQwenVisibleModels,
  type PersistedQwenProviderSettings,
  QWEN_EFFORT_LEVELS,
  type QwenProviderSettings,
} from './settings';
import { qwenChatUIConfig } from './ui/QwenChatUIConfig';

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
  'discoveredModelsFingerprint',
  'effortLevel',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'modelAliases',
  'selectedMode',
  'visibleModels',
]);

export interface QwenWorkspaceContext {
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
  dispose(): Promise<void>;
}

export type QwenWorkspace = ProviderWorkspaceSlots;


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
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'managed', manager: 'managed', runtimeCommandDiscovery: 'active-session-only' },
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
const qwenChatUi: ProviderChatUiContribution = chatUiContributionFor(
  qwenChatUIConfig,
  qwenCapabilities.reasoningControl,
);

const qwenHistory = new QwenConversationHistoryService();

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
      // Persisted with the rest: the fingerprint is what tells the next
      // load whether the catalogue it is holding was discovered under the
      // same key, and a fingerprint that does not outlive the process
      // makes every start rediscover.
      discoveredModelsFingerprint: value.discoveredModelsFingerprint,
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

  ...settingsReconciliationFor(qwenSettingsReconciler),
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
        transcripts: {
          deleteSession: (conversation, vaultPath) => (
            qwenHistory.deleteConversationSession(conversation, vaultPath)
          ),
          hydrate: (conversation, vaultPath) => (
            qwenHistory.hydrateConversationHistory(conversation, vaultPath)
          ),
        },
        commands: context.commandsPort(),
        // Present, unlike Gemini's: this provider surfaces the commands its
        // session announces.
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
      // The managed subprocess is owned by the execution backend, not by the
      // workspace: a flip must not leave two owners for one process.
    },
  },

  execution: {
    descriptor: QWEN_EXECUTION_DESCRIPTOR,
    create: async context => new QwenExecutionBackend(context),
  },


  capabilities: qwenCapabilities,

  declarations: {
    warmup: 'runtime',
    providerId: 'qwen',
    chatUI: qwenChatUi,
    commandDropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    },
    cli: { resolve: settings => qwenCliResolver().resolveFromSettings(settings) },
    conversationState: {
      forkState: (sessionId, resumeAt, state) => (
        qwenHistory.buildForkProviderState(sessionId, resumeAt, state)
      ),
      isPendingFork: conversation => qwenHistory.isPendingForkConversation(conversation),
      resolveSessionId: conversation => qwenHistory.resolveSessionIdForConversation(conversation),
      ...(qwenHistory.buildPersistedProviderState
        ? { persistedState: conversation => qwenHistory.buildPersistedProviderState?.(conversation) }
        : {}),
    },
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
    discoveredModelsFingerprint: typeof record.discoveredModelsFingerprint === 'string'
      ? record.discoveredModelsFingerprint
      : defaults.discoveredModelsFingerprint,
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
