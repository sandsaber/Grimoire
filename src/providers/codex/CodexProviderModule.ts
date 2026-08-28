import type {
  ProviderAgentMention,
  ProviderCapabilityDescriptor,
  ProviderChatUiContribution,
  ProviderCommandsPort,
  ProviderHistoryHydration,
  ProviderModelDescriptor,
  ProviderModule,
  ProviderSettingsCodec,
  ProviderUsageSnapshot,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';

import { isRecord } from '../../utils/records';
import { chatUiContributionFor } from '../shared/chatUiContribution';
import { settingsReconciliationFor } from '../shared/settingsReconciliation';
import { codexSettingsReconciler } from './env/CodexSettingsReconciler';
import {
  CODEX_EXECUTION_DESCRIPTOR,
  CodexExecutionBackend,
  type CodexExecutionBackendContext,
} from './execution/CodexExecutionBackend';
import { normalizeCodexDiscoveredModels } from './modelDiscoveryState';
import { codexSubagentLifecycleAdapter } from './normalization/codexSubagentNormalization';
import {
  type CodexInstallationMethod,
  type CodexProviderSettings,
  type CodexReasoningSummary,
  DEFAULT_CODEX_PROVIDER_SETTINGS,
} from './settings';
import { codexChatUIConfig } from './ui/CodexChatUIConfig';

/**
 * Codex's contribution to the provider catalog.
 *
 * Written against the M1 `ProviderModule` contract, with the v1 module used as
 * material rather than harvested: v1's version targets the contract harvest
 * ban 1 excludes, and it omitted enablement, runtime input keys, reconciliation,
 * auxiliary execution, chat UI, history, and native agents — nine of the
 * inventory's rows — while typing its feature ports as a bare `ports` bag.
 *
 * Live: `CodexExecutionComposition` builds every flipped tab's contributions
 * from here, alongside `registration.ts` and `CodexWorkspaceServices`.
 *
 * Codex is the widest module of the four proofs, which is the point of proving
 * it second: it exercises nearly every slot, where Antigravity exercised the
 * floor. The absences below are therefore claims, not gaps:
 *
 * - **no MCP slot.** Codex reads its own MCP configuration; Grimoire owns no
 *   `.grimoire/mcp/codex.json` and injects no servers, so contributing a
 *   storage-and-lifecycle port would be a port that cannot work;
 * - **no runtime commands.** Command discovery runs through a short-lived
 *   app-server process, not through the live session;
 * - **no task-result interpretation.** `CodexTaskResultInterpreter` exists and
 *   is deliberately a no-op, since Grimoire's async task system does not apply
 *   to Codex. Contributing it would be a present-but-empty slot, which the
 *   contract forbids precisely because the UI cannot tell the difference;
 * - **no rewind.** Codex forks and compacts through the execution backend, both
 *   of which are runs; it has no transcript rewind;
 * - **no context files.** Codex preloads none through Grimoire.
 */

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'customModels',
  'discoveredModels',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'installationMethod',
  'installationMethodsByHost',
  'reasoningSummary',
  'wslDistroOverride',
  'wslDistroOverridesByHost',
]);

const REASONING_SUMMARIES = new Set<CodexReasoningSummary>([
  'auto',
  'concise',
  'detailed',
  'none',
]);

const INSTALLATION_METHODS = new Set<CodexInstallationMethod>([
  'native-windows',
  'wsl',
]);

/** Effort tiers as the chat UI offers them today. */
const CODEX_EFFORT_TIERS = ['low', 'medium', 'high', 'xhigh'] as const;


export interface CodexWorkspaceContext {
  commandsPort(): ProviderCommandsPort | undefined;
  listAgentMentions(): Promise<readonly ProviderAgentMention[]>;
  refreshAgentMentions(): Promise<void>;
  resolveCliPath(): Promise<string | null>;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  refreshModels(): Promise<readonly ProviderModelDescriptor[]>;
  cachedPlanUsage(): ProviderUsageSnapshot | null;
  refreshPlanUsage(): Promise<ProviderUsageSnapshot | null>;
  renderSettingsTab(host: unknown): void;
  hydrateConversation(conversationId: string): Promise<ProviderHistoryHydration>;
  deleteConversationSession(conversationId: string): Promise<void>;
  resolveSessionId(conversationId: string): string | null;
  isPendingFork(conversationId: string): boolean;
  /** Releases the skill storage, agent mention provider, and usage store. */
  dispose(): Promise<void>;
}

export type CodexWorkspace = ProviderWorkspaceSlots;


const codexCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'codex',
  process: {
    // One app-server daemon multiplexing threads and turns — the opposite
    // extreme from Antigravity, which is why it is the second proof.
    topology: 'persistent-daemon',
    concurrency: 'multiplexed-sessions',
  },
  session: {
    resume: 'native',
    transcriptHydration: 'native',
  },
  history: { ownership: 'provider-native' },
  commands: {
    discovery: 'ephemeral-process',
    // Codex can list its skills; the chat input does not ask. Stated as a fact
    // rather than left as a contradiction between two records.
    chatSurface: 'unsupported',
    sessionCommands: 'unsupported',
  },
  mcp: {
    // Codex configures MCP itself. Grimoire neither stores nor injects servers
    // for this provider, and per-run selection has no provider surface at all.
    ownership: 'native',
    sessionConfiguration: 'unsupported',
    perRunSelection: 'unsupported',
  },
  agents: {
    definitions: 'provider-files',
    spawnOrigin: ['provider-native'],
    stableIdentity: true,
    // Aggregate is the summary label. Every action below is stated separately,
    // because observing a subagent's result does not imply being able to cancel
    // it, ask for its status, or reattach after a restart — and Codex can do
    // none of those three.
    progressObservation: 'aggregate',
    resultExtraction: true,
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
    rewind: 'unsupported',
    steering: 'native',
    compaction: 'native',
  },
  // The CLI enforces its own approval and sandbox policy; Grimoire owns the
  // process boundary around it.
  security: { enforcement: 'native' },
  reasoningControl: { kind: 'effort', tiers: [...CODEX_EFFORT_TIERS] },
  workspace: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'none', manager: 'none' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'none', manager: 'guidance' },
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
const codexChatUi: ProviderChatUiContribution = chatUiContributionFor(
  codexChatUIConfig,
  codexCapabilities.reasoningControl,
);

export const codexSettingsCodec: ProviderSettingsCodec<CodexProviderSettings> = {
  providerId: 'codex',
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
    return {
      // Unknown keys first, so a settings file written by a newer build
      // survives an older one reading and rewriting it.
      ...preservedUnknown,
      cliPath: value.cliPath.trim(),
      cliPathsByHost: { ...normalizeStringMap(value.cliPathsByHost) },
      customModels: value.customModels,
      discoveredModels: normalizeCodexDiscoveredModels(value.discoveredModels)
        .map(model => ({ ...model })),
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      installationMethod: normalizeInstallationMethod(value.installationMethod),
      installationMethodsByHost: { ...normalizeInstallationMethods(value.installationMethodsByHost) },
      reasoningSummary: normalizeReasoningSummary(value.reasoningSummary),
      wslDistroOverride: value.wslDistroOverride.trim(),
      wslDistroOverridesByHost: { ...normalizeStringMap(value.wslDistroOverridesByHost) },
    };
  },

  isEnabled: settings => settings.enabled,
  withEnabled: (settings, enabled) => ({ ...settings, enabled }),

  /**
   * What invalidates a Codex session.
   *
   * The live registration declares `[/^OPENAI_/i, /^CODEX_/i]` — patterns the
   * core applies to the whole environment. Stated here as the settings fields
   * that carry them, because a pattern lets an unrelated variable invalidate a
   * session and gives the user no way to see which one did.
   */
  runtimeInputKeys: [
    'environmentVariables',
    'environmentHash',
    'cliPath',
    'cliPathsByHost',
    'installationMethod',
    'installationMethodsByHost',
    'wslDistroOverride',
    'wslDistroOverridesByHost',
  ],

  environmentKeyPrefixes: ['OPENAI_', 'CODEX_'],

  ...settingsReconciliationFor(codexSettingsReconciler),
};

export const codexProviderModule: ProviderModule<
CodexWorkspaceContext,
CodexExecutionBackendContext,
CodexProviderSettings
> = {
  manifest: {
    id: 'codex',
    displayName: 'Codex',
    order: 20,
  },

  settings: codexSettingsCodec,

  workspace: {
    providerId: 'codex',
    async initialize(context): Promise<CodexWorkspace> {
      return {
        ...(context.commandsPort() ? { commands: context.commandsPort()! } : {}),
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
        settingsPresentation: { render: host => context.renderSettingsTab(host) },
      };
    },
    dispose: async () => {
      // The context owns what it created. Declaring the half that releases it
      // is mandatory even when a provider's teardown is trivial, because
      // shipping initialize without dispose is app-level inventory row 3.
    },
  },

  execution: {
    descriptor: CODEX_EXECUTION_DESCRIPTOR,
    create: async context => new CodexExecutionBackend(context),
  },


  capabilities: codexCapabilities,

  declarations: {
    warmup: 'runtime',
    providerId: 'codex',
    chatUI: codexChatUi,
    // Read straight off the normalization adapter. It used to arrive through
    // the module context, which needed a plugin for something that needs
    // nothing — and that indirection is what kept this row on the legacy
    // registration.
    nativeAgents: {
      recognizesToolName: toolName => (
        codexSubagentLifecycleAdapter.isSpawnTool(toolName)
        || codexSubagentLifecycleAdapter.isWaitTool(toolName)
        || codexSubagentLifecycleAdapter.isCloseTool(toolName)
      ),
      // Codex names no agent in its tool payloads, so there is no card to draw.
      parseDisplay: () => null,
    },
    commandDropdown: {
      triggerChars: ['/', '$'],
      builtInPrefix: '/',
      skillPrefix: '$',
      commandPrefix: '/',
    },
  },

  runtimePorts: context => ({
    providerId: 'codex',
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      buildSessionPatch: input => ({
        sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
      }),
    },
  }),
};

function createDefaultSettings(): CodexProviderSettings {
  return {
    ...DEFAULT_CODEX_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    discoveredModels: [],
    installationMethodsByHost: {},
    wslDistroOverridesByHost: {},
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): CodexProviderSettings {
  const defaults = createDefaultSettings();
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : defaults.cliPath,
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    customModels: typeof record.customModels === 'string'
      ? record.customModels
      : defaults.customModels,
    discoveredModels: normalizeCodexDiscoveredModels(record.discoveredModels),
    reasoningSummary: normalizeReasoningSummary(record.reasoningSummary),
    environmentVariables: typeof record.environmentVariables === 'string'
      ? record.environmentVariables
      : defaults.environmentVariables,
    environmentHash: typeof record.environmentHash === 'string'
      ? record.environmentHash
      : defaults.environmentHash,
    installationMethod: normalizeInstallationMethod(record.installationMethod),
    installationMethodsByHost: normalizeInstallationMethods(record.installationMethodsByHost),
    wslDistroOverride: typeof record.wslDistroOverride === 'string'
      ? record.wslDistroOverride.trim()
      : defaults.wslDistroOverride,
    wslDistroOverridesByHost: normalizeStringMap(record.wslDistroOverridesByHost),
  };
}

function validateKnownSettings(record: Readonly<Record<string, unknown>>): string[] {
  const issues: string[] = [];
  requireType(record, 'enabled', value => typeof value === 'boolean', issues);
  for (const field of [
    'cliPath',
    'customModels',
    'environmentHash',
    'environmentVariables',
    'wslDistroOverride',
  ]) {
    requireType(record, field, value => typeof value === 'string', issues);
  }
  for (const field of ['cliPathsByHost', 'installationMethodsByHost', 'wslDistroOverridesByHost']) {
    requireType(record, field, isRecord, issues);
  }
  requireType(record, 'discoveredModels', Array.isArray, issues);
  for (const field of ['cliPathsByHost', 'wslDistroOverridesByHost']) {
    if (isRecord(record[field])
      && Object.values(record[field]).some(value => typeof value !== 'string')) {
      issues.push(`${field} contains an invalid path`);
    }
  }
  if (isRecord(record.installationMethodsByHost)
    && Object.values(record.installationMethodsByHost)
      .some(value => !INSTALLATION_METHODS.has(value as CodexInstallationMethod))) {
    issues.push('installationMethodsByHost contains an unknown installation method');
  }
  if (record.installationMethod !== undefined
    && !INSTALLATION_METHODS.has(record.installationMethod as CodexInstallationMethod)) {
    issues.push('installationMethod is not a known installation method');
  }
  if (record.reasoningSummary !== undefined
    && !REASONING_SUMMARIES.has(record.reasoningSummary as CodexReasoningSummary)) {
    issues.push('reasoningSummary is not a known summary mode');
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

function normalizeReasoningSummary(value: unknown): CodexReasoningSummary {
  return REASONING_SUMMARIES.has(value as CodexReasoningSummary)
    ? value as CodexReasoningSummary
    : DEFAULT_CODEX_PROVIDER_SETTINGS.reasoningSummary;
}

function normalizeInstallationMethod(value: unknown): CodexInstallationMethod {
  return INSTALLATION_METHODS.has(value as CodexInstallationMethod)
    ? value as CodexInstallationMethod
    : DEFAULT_CODEX_PROVIDER_SETTINGS.installationMethod;
}

function normalizeInstallationMethods(value: unknown): Record<string, CodexInstallationMethod> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([host, method]) => (
        host.trim() !== '' && INSTALLATION_METHODS.has(method as CodexInstallationMethod)
      ))
      .map(([host, method]) => [host, method as CodexInstallationMethod]),
  );
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

