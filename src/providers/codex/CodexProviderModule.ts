import type {
  ProviderCapabilityDescriptor,
  ProviderChatUiContribution,
  ProviderCommandDescriptor,
  ProviderHistoryHydration,
  ProviderModelDescriptor,
  ProviderModule,
  ProviderNativeAgentDisplay,
  ProviderSettingsCodec,
  ProviderSettingsReconcileResult,
  ProviderUsageSnapshot,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';
import { parseEnvironmentVariables } from '@/utils/env';

import {
  CODEX_EXECUTION_DESCRIPTOR,
  CodexExecutionBackend,
  type CodexExecutionBackendContext,
} from './execution/CodexExecutionBackend';
import { normalizeCodexDiscoveredModels } from './modelDiscoveryState';
import {
  type CodexInstallationMethod,
  type CodexProviderSettings,
  type CodexReasoningSummary,
  DEFAULT_CODEX_PROVIDER_SETTINGS,
} from './settings';
import { DEFAULT_CODEX_MODEL_SET, formatCodexModelLabel } from './types/models';

/**
 * Codex's contribution to the provider catalog.
 *
 * Written against the M1 `ProviderModule` contract, with the v1 module used as
 * material rather than harvested: v1's version targets the contract harvest
 * ban 1 excludes, and it omitted enablement, runtime input keys, reconciliation,
 * auxiliary execution, chat UI, history, and native agents — nine of the
 * inventory's rows — while typing its feature ports as a bare `ports` bag.
 *
 * Dark: nothing constructs this. `registration.ts` and `CodexWorkspaceServices`
 * remain the only wiring until the Codex flip.
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

const CODEX_DEFAULT_CONTEXT_WINDOW = 200_000;

export interface CodexWorkspaceContext {
  listSkills(): Promise<readonly ProviderCommandDescriptor[]>;
  listAgentMentions(): Promise<readonly { id: string; label: string; description?: string }[]>;
  refreshAgentMentions(): Promise<void>;
  resolveCliPath(): Promise<string | null>;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  refreshModels(): Promise<readonly ProviderModelDescriptor[]>;
  readPlanUsage(): Promise<ProviderUsageSnapshot | null>;
  shouldKeepWarm(): boolean;
  renderSettingsTab(host: unknown): void;
  hydrateConversation(conversationId: string): Promise<ProviderHistoryHydration>;
  deleteConversationSession(conversationId: string): Promise<void>;
  resolveSessionId(conversationId: string): string | null;
  isPendingFork(conversationId: string): boolean;
  recognizesSubagentTool(toolName: string): boolean;
  parseSubagentDisplay(payload: unknown): ProviderNativeAgentDisplay | null;
  /** Releases the skill storage, agent mention provider, and usage store. */
  dispose(): Promise<void>;
}

export type CodexWorkspace = ProviderWorkspaceSlots;

const codexChatUi: ProviderChatUiContribution<CodexProviderSettings> = {
  modelPresentation: {
    ownsModel: (modelId, settings) => DEFAULT_CODEX_MODEL_SET.has(modelId)
      || normalizeCodexDiscoveredModels(settings.discoveredModels)
        .some(model => model.id === modelId)
      || parseCustomModelIds(settings.customModels).includes(modelId)
      || looksLikeCodexModel(modelId),
    label: modelId => formatCodexModelLabel(modelId),
    // The app-server reports no per-model context window, so one figure covers
    // every Codex model, as the chat UI already assumes. A model the provider
    // does not own gets `undefined` rather than a borrowed number.
    contextWindow: (modelId, settings) => (
      codexChatUi.modelPresentation.ownsModel(modelId, settings)
        ? CODEX_DEFAULT_CONTEXT_WINDOW
        : undefined
    ),
  },
  reasoningControl: { kind: 'effort', tiers: [...CODEX_EFFORT_TIERS] },
  permissionToggles: [
    { id: 'normal', label: 'Safe' },
    { id: 'plan', label: 'Plan' },
    { id: 'full_access', label: 'Auto-approve' },
  ],
  // Names the shared OpenAI mark rather than the provider id: Codex is one of
  // several surfaces that use it, and collapsing the two would silently rebrand
  // the tab.
  icon: 'openai',
};

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
  workspace: {
    skills: 'grimoire',
    agents: 'grimoire',
    cliResolution: 'native',
    models: 'native',
    usage: 'native',
    environment: 'grimoire',
  },
};

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

  reconcile(settings): ProviderSettingsReconcileResult<CodexProviderSettings> {
    // The saved hash and the environment text that produces it both live in the
    // settings, so the comparison the legacy reconciler makes is available here
    // without the conversation list it also takes.
    const environmentHash = computeEnvironmentHash(settings.environmentVariables);
    const normalized = decodeSettings(this.encode({ ...settings, environmentHash }));
    return {
      settings: normalized,
      // Order-insensitive: encode and decode rebuild the object, so comparing
      // serialized forms would report a change on every load.
      changed: !deepEqual(normalized, settings),
      // Codex resumes by native thread id, and those threads live in a daemon
      // launched with the old environment. A changed environment therefore
      // invalidates every Codex session, which is what the legacy reconciler
      // does when it clears `sessionId` and `providerState` on each of them.
      invalidatesSessions: environmentHash !== settings.environmentHash,
    };
  },
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
        commands: { list: () => context.listSkills() },
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
        residency: { shouldKeepWarm: () => context.shouldKeepWarm() },
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

  // Codex runs all three auxiliary workflows on their own app-server process
  // and thread, which is what the topology record calls isolated auxiliary
  // execution. The factories are supplied by the host at M5; the slots are
  // declared now so the contribution is not lost the way v1 lost it.
  auxiliary: { providerId: 'codex' },

  capabilities: codexCapabilities,

  features: context => ({
    providerId: 'codex',
    chatUI: codexChatUi,
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      buildSessionPatch: input => ({
        sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
      }),
    },
    nativeAgents: {
      recognizesToolName: toolName => context.recognizesSubagentTool(toolName),
      parseDisplay: payload => context.parseSubagentDisplay(payload),
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

/**
 * The three variables whose change makes an existing thread unusable.
 *
 * Mirrors `CodexSettingsReconciler`, which is the behavior a flip has to
 * preserve. Deliberately three named keys rather than the registration's
 * `/^OPENAI_/` and `/^CODEX_/` patterns: those invalidate a session when any
 * matching variable changes, including ones the daemon never reads.
 */
const ENVIRONMENT_HASH_KEYS = ['OPENAI_MODEL', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'];

function computeEnvironmentHash(environmentText: string): string {
  const variables = parseEnvironmentVariables(environmentText || '');
  return ENVIRONMENT_HASH_KEYS
    .filter(key => variables[key])
    .map(key => `${key}=${variables[key]}`)
    .sort()
    .join('|');
}

/** Newline or comma separated, as the settings tab accepts them. */
function parseCustomModelIds(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function looksLikeCodexModel(model: string): boolean {
  return /^gpt-/i.test(model) || /^o\d/i.test(model);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
