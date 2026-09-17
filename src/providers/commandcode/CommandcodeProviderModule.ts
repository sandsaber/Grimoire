import type { ProviderCapabilityDescriptor, ProviderModule, ProviderWorkspaceSlots } from '@/core/providers/ProviderModule';
import { chatUiContributionFor } from '@/providers/shared/chatUiContribution';

import { COMMANDCODE_EXECUTION_DESCRIPTOR, type CommandcodeBackendContext, CommandcodeExecutionBackend } from './execution/CommandcodeExecutionBackend';
import { isRecord } from './runtime/CommandcodeStream';
import { type CommandcodeSettings, decodeCommandcodeSettings, resolveCommandcodeCli } from './settings';
import { commandcodeChatUIConfig } from './ui/CommandcodeChatUIConfig';

export const commandcodeCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'commandcode',
  process: { topology: 'process-per-run', concurrency: 'serial-runs' },
  session: { resume: 'native', transcriptHydration: 'unsupported' },
  history: { ownership: 'grimoire-projection' },
  commands: { discovery: 'unsupported', chatSurface: 'unsupported', sessionCommands: 'unsupported' },
  mcp: { ownership: 'unsupported', sessionConfiguration: 'unsupported', perRunSelection: 'unsupported' },
  agents: { definitions: 'none', spawnOrigin: [], stableIdentity: false, progressObservation: 'none',
    resultExtraction: false, cancellation: false, statusQuery: false, reattachment: false },
  input: { imageAttachments: 'unsupported', instructionMode: 'unsupported' },
  interactions: { approvals: 'grimoire', questions: 'unsupported', planMode: 'unsupported' },
  conversation: { fork: 'unsupported', rewind: 'unsupported', steering: 'unsupported', compaction: 'unsupported' },
  security: { enforcement: 'grimoire' },
  reasoningControl: { kind: 'effort', tiers: [] },
  workspace: {
    skills: { inventory: 'none', manager: 'none' }, commands: { inventory: 'none', manager: 'none' },
    agents: { inventory: 'none', manager: 'none' }, mcp: { inventory: 'none', manager: 'none' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
};

const fields = new Set(['enabled', 'cliPath', 'cliPathsByHost', 'environmentVariables', 'discoveredModels', 'reasoningEffortsByModel']);

export interface CommandcodeModuleContext extends ProviderWorkspaceSlots {
  resolveSessionId?(conversationId: string): string | null;
}

export const commandcodeProviderModule: ProviderModule<CommandcodeModuleContext, CommandcodeBackendContext, CommandcodeSettings> = {
  manifest: { id: 'commandcode', displayName: 'Command Code', order: 120 },
  settings: {
    providerId: 'commandcode', schemaVersion: 1,
    defaults: () => decodeCommandcodeSettings({}),
    decode(input) {
      const record = isRecord(input) ? input : {};
      return { ok: true, value: decodeCommandcodeSettings(record),
        preservedUnknown: Object.fromEntries(Object.entries(record).filter(([key]) => !fields.has(key))) };
    },
    encode: (value, preserved = {}) => ({ ...preserved, ...decodeCommandcodeSettings(value) }),
    isEnabled: settings => settings.enabled,
    withEnabled: (settings, enabled) => ({ ...settings, enabled }),
    runtimeInputKeys: ['cliPath', 'cliPathsByHost', 'environmentVariables'],
    environmentKeyPrefixes: ['CMD_', 'COMMANDCODE_'],
    reconcileEnvironment: () => ({ changed: false, invalidatesSessions: false }),
    normalizeModelVariants: () => false,
  },
  workspace: {
    providerId: 'commandcode',
    initialize: async context => ({ ...context,
      transcripts: { hydrate: async () => ({ outcome: 'absent' }), deleteSession: async () => undefined },
    }),
    dispose: async () => undefined,
  },
  execution: { descriptor: COMMANDCODE_EXECUTION_DESCRIPTOR, create: async context => new CommandcodeExecutionBackend(context) },
  capabilities: commandcodeCapabilities,
  declarations: {
    providerId: 'commandcode', warmup: 'none',
    chatUI: chatUiContributionFor(commandcodeChatUIConfig, commandcodeCapabilities.reasoningControl),
    cli: { resolve: resolveCommandcodeCli },
    conversationState: {
      forkState: () => ({}), isPendingFork: () => false,
      resolveSessionId: conversation => conversation?.sessionId ?? null,
    },
  },
  runtimePorts: context => ({
    providerId: 'commandcode',
    history: {
      hydrate: async () => ({ outcome: 'absent' }),
      // Deleting a Grimoire conversation leaves CLI-owned transcripts intact.
      deleteSession: async () => undefined,
      resolveSessionId: id => context.resolveSessionId?.(id) ?? null,
      isPendingFork: () => false,
      buildSessionPatch: input => ({ sessionId: input.sessionInvalidated ? null : input.nativeSessionRef }),
    },
  }),
};
