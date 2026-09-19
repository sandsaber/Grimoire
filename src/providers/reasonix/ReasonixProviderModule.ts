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
import { reasonixSettingsReconciler } from './env/ReasonixSettingsReconciler';
import {
  REASONIX_EXECUTION_DESCRIPTOR,
  ReasonixExecutionBackend,
  type ReasonixExecutionBackendContext,
} from './execution/ReasonixExecutionBackend';
import { ReasonixConversationHistoryService } from './history/ReasonixConversationHistoryService';
import { reasonixCliResolver } from './runtime/ReasonixCliResolver';
import {
  DEFAULT_REASONIX_PROVIDER_SETTINGS,
  normalizeReasonixModelAliases,
  normalizeReasonixVisibleModels,
  type PersistedReasonixProviderSettings,
  REASONIX_AUTO_EFFORT,
  type ReasonixProviderSettings,
} from './settings';
import { reasonixChatUIConfig } from './ui/ReasonixChatUIConfig';

/**
 * Reasonix's contribution to the provider catalog.
 *
 * The eleventh module, and the eighth on the managed-ACP transport. Derived
 * from Devin's, which is the sibling it resembles: `reasonix acp` opens a
 * JSON-RPC server over stdio, there are no launch artifacts, and the binding is
 * a session id and nothing else. What was measured rather than assumed is in
 * `tests/fixtures/provider-traces/wire/reasonix-wire.json`, taken from
 * `reasonix v1.38.3` on 2026-09-09 with a turn that answered, and in the two
 * probes of the same day that drove a tool-using turn and a Plan turn.
 *
 * Where it differs from Devin, it differs because the CLI does:
 *
 * - **models and modes are ACP's own.** `session/new` answers with `models`
 *   and `modes` beside its `configOptions`, and both `session/set_model` and
 *   `session/set_mode` are answered;
 * - **a permission request describes itself.** Title, kind, `rawInput` and
 *   `locations` all arrive on it, so no tool-call memory is kept;
 * - **the tokens are Reasonix's own.** No `usage_update` is ever sent;
 *   `ReasonixSessionNotifications` reads them off
 *   `_reasonix.io/session/status_update`.
 *
 * What Reasonix has and this module does not claim yet, each a separate piece
 * of work rather than an oversight:
 *
 * - **nothing about reasoning effort.** It is driven: the levels come from
 *   the session and the choice is applied as a config option;
 * - **`_reasonix.io/session/steer`** would queue guidance mid-turn, and no
 *   provider drives the steering surface;
 * - **`.reasonix/commands/*.md`**, which the CLI reads as slash commands. The
 *   commands surface here is the session's own announcements plus the vault's
 *   skills, which is what Devin's is;
 * - **questions are drawn as approvals.** Reasonix's `ask` tool arrives on the
 *   permission channel, titled with its question (observed 2026-09-09, after a
 *   refused write). It is answerable that way, so nothing is broken; what is
 *   absent is the inline question surface Qwen's structured requests get.
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

export interface ReasonixWorkspaceContext {
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
   * Whether this conversation's saved session was replaced by a fresh one,
   * or `null` when this runtime is not bound to that conversation.
   */
  readSessionDropped(conversationId: string): boolean | null;
  dispose(): Promise<void>;
}

export type ReasonixWorkspace = ProviderWorkspaceSlots;

const reasonixCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'reasonix',
  process: {
    topology: 'managed-acp-subprocess',
    concurrency: 'serial-runs',
  },
  session: {
    // Recorded: `loadSession: true`, `sessionCapabilities: { list, resume,
    // close, delete }`,
    // and a `session/load` that replays the transcript as updates.
    resume: 'native',
    // Grimoire keeps its own projection; the replay is not read back.
    transcriptHydration: 'unsupported',
  },
  history: { ownership: 'grimoire-projection' },
  commands: {
    // The session announces its own — recorded as `available_commands_update`
    // on `session/new` — and the tab lists them.
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
    definitions: 'none',
    spawnOrigin: [],
    stableIdentity: false,
    progressObservation: 'none',
    resultExtraction: false,
    cancellation: false,
    statusQuery: false,
    reattachment: false,
  },
  input: {
    // Recorded: `promptCapabilities: { image: false, embeddedContext: true }`.
    // The CLI takes text and embedded context; an image block is not offered.
    imageAttachments: 'unsupported',
    instructionMode: 'native',
  },
  interactions: {
    approvals: 'native',
    questions: 'unsupported',
    planMode: 'native',
  },
  conversation: {
    fork: 'unsupported',
    rewind: 'unsupported',
    steering: 'unsupported',
    compaction: 'native',
  },
  security: { enforcement: 'native' },
  /**
   * **The tiers are the union, and the picker is the session's.**
   *
   * Which levels a model takes is decided by the provider block serving it: one
   * with `supported_efforts` offers `disabled`, `low`, `high`, `max`, one
   * without gets the built-in set for its kind, `auto`/`enabled`/`disabled`.
   * This list is every value either can produce, because the descriptor gates
   * whether a reasoning group is drawn at all; what the group *contains* comes
   * from `availableEfforts`, discovered per session like the model catalogue.
   * The CLI refuses a level the model does not take
   * (`UNSUPPORTED_REASONING_EFFORT`), so nothing unoffered is ever sent.
   */
  reasoningControl: {
    kind: 'effort',
    tiers: ['auto', 'disabled', 'enabled', 'low', 'high', 'max'],
  },
  workspace: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'managed', manager: 'none', runtimeCommandDiscovery: 'active-session-only' },
    agents: { inventory: 'none', manager: 'none' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
};

const reasonixChatUi: ProviderChatUiContribution = {
  ...chatUiContributionFor(reasonixChatUIConfig, reasonixCapabilities.reasoningControl),
  // Older records stored turn aggregates as occupancy. Only a real ACP context
  // update can make a Reasonix context reading trustworthy.
  normalizeContextUsage: usage => usage.contextWindowIsAuthoritative === true ? usage : null,
};

const reasonixHistory = new ReasonixConversationHistoryService();

export const reasonixSettingsCodec: ProviderSettingsCodec<ReasonixProviderSettings> = {
  providerId: 'reasonix',
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
    const persisted: PersistedReasonixProviderSettings = {
      discoveredModelsFingerprint: value.discoveredModelsFingerprint,
      cliPath: value.cliPath.trim(),
      cliPathsByHost: normalizeStringMap(value.cliPathsByHost),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      modelAliases: normalizeReasonixModelAliases(value.modelAliases),
      effortLevel: value.effortLevel.trim() || REASONIX_AUTO_EFFORT,
      selectedMode: value.selectedMode.trim(),
      visibleModels: [...normalizeReasonixVisibleModels(value.visibleModels)],
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

  // `REASONIX_HOME` and whatever else the CLI reads under its own name.
  environmentKeyPrefixes: ['REASONIX_'],

  ...settingsReconciliationFor(reasonixSettingsReconciler),
};

export const reasonixProviderModule: ProviderModule<
ReasonixWorkspaceContext,
ReasonixExecutionBackendContext,
ReasonixProviderSettings
> = {
  manifest: {
    id: 'reasonix',
    displayName: 'Reasonix',
    order: 110,
  },

  settings: reasonixSettingsCodec,

  workspace: {
    providerId: 'reasonix',
    async initialize(context): Promise<ReasonixWorkspace> {
      return {
        transcripts: {
          deleteSession: (conversation, vaultPath) => (
            reasonixHistory.deleteConversationSession(conversation, vaultPath)
          ),
          hydrate: (conversation, vaultPath) => (
            reasonixHistory.hydrateConversationHistory(conversation, vaultPath)
          ),
        },
        commands: context.commandsPort(),
        runtimeCommands: {
          listForSession: sessionId => context.listSessionCommands(sessionId),
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
    descriptor: REASONIX_EXECUTION_DESCRIPTOR,
    create: async context => new ReasonixExecutionBackend(context),
  },

  capabilities: reasonixCapabilities,

  declarations: {
    warmup: 'runtime',
    providerId: 'reasonix',
    chatUI: reasonixChatUi,
    commandDropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    },
    cli: { resolve: settings => reasonixCliResolver().resolveFromSettings(settings) },
    conversationState: {
      forkState: (sessionId, resumeAt, state) => (
        reasonixHistory.buildForkProviderState(sessionId, resumeAt, state)
      ),
      isPendingFork: conversation => reasonixHistory.isPendingForkConversation(conversation),
      resolveSessionId: conversation => reasonixHistory.resolveSessionIdForConversation(conversation),
      ...(reasonixHistory.buildPersistedProviderState
        ? { persistedState: conversation => reasonixHistory.buildPersistedProviderState?.(conversation) }
        : {}),
    },
  },

  runtimePorts: context => ({
    providerId: 'reasonix',
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      // The session id and nothing beside it: this provider writes no launch
      // state a second half of the binding could point at.
      buildSessionPatch: input => {
        const sessionDropped = context.readSessionDropped(input.conversationId);
        return {
          sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
          ...(sessionDropped === null
            ? {}
            : { providerState: sessionDropped ? { sessionDropped: true } : {} }),
        };
      },
    },
  }),
};

function createDefaultSettings(): ReasonixProviderSettings {
  return {
    ...DEFAULT_REASONIX_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    modelAliases: {},
    visibleModels: [],
    availableModes: [],
    availableEfforts: [],
    discoveredModels: [],
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): ReasonixProviderSettings {
  const defaults = createDefaultSettings();
  return {
    discoveredModelsFingerprint: typeof record.discoveredModelsFingerprint === 'string'
      ? record.discoveredModelsFingerprint
      : defaults.discoveredModelsFingerprint,
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : defaults.cliPath,
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    environmentHash: typeof record.environmentHash === 'string'
      ? record.environmentHash
      : defaults.environmentHash,
    environmentVariables: typeof record.environmentVariables === 'string'
      ? record.environmentVariables
      : defaults.environmentVariables,
    modelAliases: normalizeReasonixModelAliases(record.modelAliases),
    selectedMode: typeof record.selectedMode === 'string'
      ? record.selectedMode.trim()
      : defaults.selectedMode,
    effortLevel: typeof record.effortLevel === 'string' && record.effortLevel.trim()
      ? record.effortLevel.trim()
      : defaults.effortLevel,
    visibleModels: normalizeReasonixVisibleModels(record.visibleModels),
    availableModes: [],
    availableEfforts: [],
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
  if (isRecord(record.cliPathsByHost)
    && Object.values(record.cliPathsByHost).some(value => typeof value !== 'string')) {
    issues.push('cliPathsByHost contains an invalid path');
  }
  if (Array.isArray(record.visibleModels)
    && record.visibleModels.some(value => typeof value !== 'string')) {
    issues.push('visibleModels contains an invalid model');
  }
  if ('discoveredModels' in record || 'availableModes' in record
    || 'availableEfforts' in record) {
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
