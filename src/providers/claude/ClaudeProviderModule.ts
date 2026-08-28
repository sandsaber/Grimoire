import type {
  ProviderAgentMention,
  ProviderCapabilityDescriptor,
  ProviderChatUiContribution,
  ProviderCommandDescriptor,
  ProviderCommandsPort,
  ProviderHistoryHydration,
  ProviderMcpServer,
  ProviderModelDescriptor,
  ProviderModule,
  ProviderRewindOutcome,
  ProviderRewindRequest,
  ProviderSettingsCodec,
  ProviderUsageSnapshot,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';
import { TOOL_SUBAGENT, TOOL_SUBAGENT_LEGACY } from '@/core/tools/toolNames';

import { isRecord } from '../../utils/records';
import { chatUiContributionFor } from '../shared/chatUiContribution';
import { settingsReconciliationFor } from '../shared/settingsReconciliation';
import { claudeSettingsReconciler } from './env/ClaudeSettingsReconciler';
import {
  CLAUDE_EXECUTION_DESCRIPTOR,
  ClaudeExecutionBackend,
  type ClaudeExecutionBackendContext,
} from './execution/ClaudeExecutionBackend';
import { ClaudeTaskResultInterpreter } from './runtime/ClaudeTaskResultInterpreter';
import {
  type ClaudeDiscoveredModel,
  type ClaudeProviderSettings,
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  normalizeClaudeCodeProjectSettingsSnapshot,
  normalizeClaudeDiscoveredModels,
} from './settings';
import { claudeChatUIConfig } from './ui/ClaudeChatUIConfig';

/**
 * Claude's contribution to the provider catalog.
 *
 * Proof three. Antigravity showed the contract's floor and Codex its width;
 * Claude is the only provider that fills every remaining slot — Grimoire-owned
 * MCP, transcript rewind, native agents that can be cancelled, and both static
 * and session command discovery. Two of the three contract defects this
 * milestone has fixed were found here and in Codex rather than in review.
 *
 * Live: `ClaudeExecutionComposition` builds every flipped tab's contributions
 * from here, alongside `registration.ts` and `ClaudeWorkspaceServices`.
 *
 * The absences are claims:
 *
 * - **no residency slot.** Claude registers no tab warmup policy, unlike Codex;
 * - **no context port.** Claude's own `CLAUDE.md` discovery belongs to the CLI,
 *   not to a Grimoire preload list.
 */

const KNOWN_SETTINGS_FIELDS = new Set([
  'cliPath',
  'cliPathsByHost',
  'customModels',
  'discoveredModels',
  'enableBangBash',
  'enableChrome',
  'enabled',
  'environmentHash',
  'environmentVariables',
  'lastModel',
  'loadUserSettings',
  'projectSettingsSnapshot',
  'respectProjectSettings',
]);


export interface ClaudeWorkspaceContext {
  commandsPort(): ProviderCommandsPort | undefined;
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
  rewind(input: ProviderRewindRequest): Promise<ProviderRewindOutcome>;
  dispose(): Promise<void>;
}

export type ClaudeWorkspace = ProviderWorkspaceSlots;


/**
 * Reads a Claude tool payload for the two rows that describe it.
 *
 * Module level, and stateless: it used to be constructed inside the module
 * context, which meant reaching a plugin for something that needs none — and
 * that indirection is what kept both rows on the legacy registration.
 */
const taskResultInterpreter = new ClaudeTaskResultInterpreter();

const claudeCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'claude',
  process: {
    // One SDK query stream per conversation runtime: persistent like Codex, but
    // serial rather than multiplexed, which is the third distinct topology.
    topology: 'persistent-sdk-stream',
    concurrency: 'serial-runs',
  },
  session: {
    resume: 'native',
    transcriptHydration: 'native',
  },
  history: { ownership: 'provider-native' },
  // Both kinds are real for Claude: `.claude/commands/**` is a static
  // inventory, and the SDK reports more once a session exists. The record names
  // the one the UI must wait for.
  commands: {
    discovery: 'active-session',
    chatSurface: 'grimoire',
    sessionCommands: 'native',
  },
  mcp: {
    // The only provider where Grimoire owns the server list, writes it, and
    // starts and stops the servers.
    ownership: 'grimoire',
    sessionConfiguration: 'grimoire',
    perRunSelection: 'grimoire',
  },
  agents: {
    // `native` rather than `provider-files`: Claude ships built-in agent types
    // the CLI knows without any file, and `.claude/agents/` only adds to that
    // inventory. Codex and OpenCode have files and nothing else, which is the
    // distinction the two values exist to draw.
    definitions: 'native',
    // Grimoire writes the definitions under `.claude/agents/`, but the CLI's
    // own tool is what launches one — writing a definition is not a spawn
    // origin, and claiming it would tell the UI it can start a subagent itself.
    spawnOrigin: ['provider-native'],
    stableIdentity: true,
    progressObservation: 'full',
    resultExtraction: true,
    // The one provider that can stop a running subagent. Status query and
    // reattachment are still absent, which is why the three are separate
    // fields rather than implied by the observation label.
    cancellation: true,
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
    // The only provider that writes plan files, and the only one whose plan
    // mode has a vault artifact the UI links to.
    planArtifactPrefix: '/.claude/plans/',
  },
  conversation: {
    fork: 'native',
    rewind: 'native',
    // The SDK takes one turn at a time; a mid-turn steer has no surface.
    steering: 'unsupported',
    compaction: 'native',
  },
  security: { enforcement: 'native' },
  reasoningControl: { kind: 'effort', tiers: ['low', 'medium', 'high'] },
  workspace: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'managed', manager: 'managed' },
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
const claudeChatUi: ProviderChatUiContribution = chatUiContributionFor(
  claudeChatUIConfig,
  claudeCapabilities.reasoningControl,
);

export const claudeSettingsCodec: ProviderSettingsCodec<ClaudeProviderSettings> = {
  providerId: 'claude',
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
      ...preservedUnknown,
      cliPath: value.cliPath.trim(),
      cliPathsByHost: { ...normalizeStringMap(value.cliPathsByHost) },
      customModels: value.customModels,
      discoveredModels: normalizeClaudeDiscoveredModels(value.discoveredModels)
        .map(model => ({ ...model })),
      enableBangBash: value.enableBangBash,
      enableChrome: value.enableChrome,
      enabled: value.enabled,
      environmentHash: value.environmentHash,
      environmentVariables: value.environmentVariables,
      lastModel: value.lastModel,
      loadUserSettings: value.loadUserSettings,
      projectSettingsSnapshot: {
        ...normalizeClaudeCodeProjectSettingsSnapshot(value.projectSettingsSnapshot),
      },
      respectProjectSettings: value.respectProjectSettings,
    };
  },

  isEnabled: settings => settings.enabled,
  withEnabled: (settings, enabled) => ({ ...settings, enabled }),

  runtimeInputKeys: [
    'environmentVariables',
    'environmentHash',
    'cliPath',
    'cliPathsByHost',
    'respectProjectSettings',
    'projectSettingsSnapshot',
    'loadUserSettings',
  ],

  environmentKeyPrefixes: ['ANTHROPIC_', 'CLAUDE_'],

  ...settingsReconciliationFor(claudeSettingsReconciler, 'session'),
};

export const claudeProviderModule: ProviderModule<
ClaudeWorkspaceContext,
ClaudeExecutionBackendContext,
ClaudeProviderSettings
> = {
  manifest: {
    id: 'claude',
    displayName: 'Claude',
    order: 10,
  },

  settings: claudeSettingsCodec,

  workspace: {
    providerId: 'claude',
    async initialize(context): Promise<ClaudeWorkspace> {
      return {
        ...(context.commandsPort() ? { commands: context.commandsPort()! } : {}),
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
      // The MCP servers this workspace started are the one teardown that has to
      // happen: leaving them running would leave processes behind after the
      // workspace that owns them is gone.
    },
  },

  execution: {
    descriptor: CLAUDE_EXECUTION_DESCRIPTOR,
    create: async context => new ClaudeExecutionBackend(context),
  },


  capabilities: claudeCapabilities,

  declarations: {
    warmup: 'none',
    providerId: 'claude',
    chatUI: claudeChatUi,
    taskResults: {
      interpret: (toolName, payload) => {
        if (!CLAUDE_SUBAGENT_TOOL_NAMES.includes(toolName)) {
          return null;
        }
        const detail = taskResultInterpreter.extractStructuredResult(payload);
        return {
          title: taskResultInterpreter.extractAgentId(payload) ?? 'Task',
          ...(detail ? { detail } : {}),
          isError: taskResultInterpreter.resolveTerminalStatus(payload, 'completed') === 'error',
        };
      },
    },
    nativeAgents: {
      recognizesToolName: toolName => CLAUDE_SUBAGENT_TOOL_NAMES.includes(toolName),
      parseDisplay: payload => {
        const agentId = taskResultInterpreter.extractAgentId(payload);
        // No id is no agent to display, which is different from an agent with
        // no name: answering with a placeholder would put a card on screen for
        // something that never ran.
        return agentId ? { agentId, label: agentId } : null;
      },
    },
    commandDropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    },
  },

  runtimePorts: context => ({
    providerId: 'claude',
    history: {
      hydrate: conversationId => context.hydrateConversation(conversationId),
      deleteSession: conversationId => context.deleteConversationSession(conversationId),
      resolveSessionId: conversationId => context.resolveSessionId(conversationId),
      isPendingFork: conversationId => context.isPendingFork(conversationId),
      buildSessionPatch: input => ({
        sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
      }),
    },
    rewind: { rewind: input => context.rewind(input) },
  }),
};

function createDefaultSettings(): ClaudeProviderSettings {
  return {
    ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
    cliPathsByHost: {},
    discoveredModels: [],
    projectSettingsSnapshot: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS.projectSettingsSnapshot },
  };
}

function decodeSettings(record: Readonly<Record<string, unknown>>): ClaudeProviderSettings {
  const defaults = createDefaultSettings();
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : defaults.cliPath,
    cliPathsByHost: normalizeStringMap(record.cliPathsByHost),
    loadUserSettings: typeof record.loadUserSettings === 'boolean'
      ? record.loadUserSettings
      : defaults.loadUserSettings,
    enableChrome: typeof record.enableChrome === 'boolean'
      ? record.enableChrome
      : defaults.enableChrome,
    enableBangBash: typeof record.enableBangBash === 'boolean'
      ? record.enableBangBash
      : defaults.enableBangBash,
    customModels: typeof record.customModels === 'string'
      ? record.customModels
      : defaults.customModels,
    lastModel: typeof record.lastModel === 'string' ? record.lastModel : defaults.lastModel,
    environmentVariables: typeof record.environmentVariables === 'string'
      ? record.environmentVariables
      : defaults.environmentVariables,
    environmentHash: typeof record.environmentHash === 'string'
      ? record.environmentHash
      : defaults.environmentHash,
    respectProjectSettings: typeof record.respectProjectSettings === 'boolean'
      ? record.respectProjectSettings
      : defaults.respectProjectSettings,
    projectSettingsSnapshot: normalizeClaudeCodeProjectSettingsSnapshot(
      record.projectSettingsSnapshot,
    ),
    discoveredModels: normalizeClaudeDiscoveredModels(record.discoveredModels),
  };
}

function validateKnownSettings(record: Readonly<Record<string, unknown>>): string[] {
  const issues: string[] = [];
  for (const field of [
    'enabled',
    'enableBangBash',
    'enableChrome',
    'loadUserSettings',
    'respectProjectSettings',
  ]) {
    requireType(record, field, value => typeof value === 'boolean', issues);
  }
  for (const field of [
    'cliPath',
    'customModels',
    'environmentHash',
    'environmentVariables',
    'lastModel',
  ]) {
    requireType(record, field, value => typeof value === 'string', issues);
  }
  requireType(record, 'cliPathsByHost', isRecord, issues);
  requireType(record, 'projectSettingsSnapshot', isRecord, issues);
  requireType(record, 'discoveredModels', Array.isArray, issues);
  if (isRecord(record.cliPathsByHost)
    && Object.values(record.cliPathsByHost).some(value => typeof value !== 'string')) {
    issues.push('cliPathsByHost contains an invalid path');
  }
  if (isRecord(record.projectSettingsSnapshot)
    && !isProjectSettingsSnapshot(record.projectSettingsSnapshot)) {
    issues.push('projectSettingsSnapshot is not a valid snapshot');
  }
  return issues;
}

function isProjectSettingsSnapshot(value: Record<string, unknown>): boolean {
  return typeof value.model === 'string'
    && typeof value.hash === 'string'
    && isRecord(value.env)
    && Object.values(value.env).every(entry => typeof entry === 'string');
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

/** The tool names a Claude subagent launch arrives under, current and legacy. */
export const CLAUDE_SUBAGENT_TOOL_NAMES: readonly string[] = [
  TOOL_SUBAGENT,
  TOOL_SUBAGENT_LEGACY,
];

export type { ClaudeDiscoveredModel };
