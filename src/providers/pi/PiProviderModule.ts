import type { ProviderCapabilityDescriptor, ProviderModule, ProviderWorkspaceSlots } from '@/core/providers/ProviderModule';
import { chatUiContributionFor } from '@/providers/shared/chatUiContribution';
import { isRecord } from '@/utils/records';

import { PI_EXECUTION_DESCRIPTOR, PiExecutionBackend, type PiExecutionBackendContext } from './execution/PiExecutionBackend';
import { hydratePiHistory } from './runtime/PiHistory';
import { decodePiSettings, type PiSettings, resolvePiAdapter } from './settings';
import { piChatUIConfig } from './ui/PiChatUIConfig';

export const piCapabilities: ProviderCapabilityDescriptor = {
  providerId: 'pi',
  process: { topology: 'managed-acp-subprocess', concurrency: 'serial-runs' },
  session: { resume: 'native', transcriptHydration: 'native' },
  history: { ownership: 'grimoire-projection' },
  commands: { discovery: 'active-session', chatSurface: 'grimoire', sessionCommands: 'native' },
  mcp: { ownership: 'unsupported', sessionConfiguration: 'unsupported', perRunSelection: 'unsupported' },
  agents: { definitions: 'none', spawnOrigin: [], stableIdentity: false, progressObservation: 'none',
    resultExtraction: false, cancellation: false, statusQuery: false, reattachment: false },
  input: { imageAttachments: 'native', instructionMode: 'unsupported' },
  interactions: { approvals: 'native', questions: 'unsupported', planMode: 'unsupported' },
  conversation: { fork: 'unsupported', rewind: 'unsupported', steering: 'unsupported', compaction: 'native' },
  security: { enforcement: 'advisory' },
  reasoningControl: { kind: 'effort', tiers: [] },
  workspace: {
    skills: { inventory: 'none', manager: 'none' },
    commands: { inventory: 'none', manager: 'none', runtimeCommandDiscovery: 'active-session-only' },
    agents: { inventory: 'none', manager: 'none' }, mcp: { inventory: 'none', manager: 'none' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
};

interface PiModuleContext extends ProviderWorkspaceSlots {
  resolveSessionId?(conversationId: string): string | null;
  sessionDropped?(): boolean;
}

const fields = new Set(Object.keys(decodePiSettings({})));

export const piProviderModule: ProviderModule<PiModuleContext, PiExecutionBackendContext, PiSettings> = {
  manifest: { id: 'pi', displayName: 'Pi', order: 130 },
  settings: {
    providerId: 'pi', schemaVersion: 1, defaults: () => decodePiSettings({}),
    decode(input) {
      const record = isRecord(input) ? input : {};
      return { ok: true, value: decodePiSettings(record),
        preservedUnknown: Object.fromEntries(Object.entries(record).filter(([key]) => !fields.has(key))) };
    },
    encode(value, preserved = {}) {
      const { discoveredModels: _models, thinkingLevels: _levels, ...persisted } = decodePiSettings(value);
      return { ...preserved, ...persisted };
    },
    isEnabled: settings => settings.enabled,
    withEnabled: (settings, enabled) => ({ ...settings, enabled }),
    runtimeInputKeys: ['cliPath', 'cliPathsByHost', 'environmentVariables'],
    environmentKeyPrefixes: ['PI_'],
    reconcileEnvironment: () => ({ changed: false, invalidatesSessions: false }),
    normalizeModelVariants: () => false,
  },
  workspace: {
    providerId: 'pi', initialize: async context => ({ ...context,
      transcripts: { hydrate: hydratePiHistory, deleteSession: async () => undefined },
    }), dispose: async () => undefined,
  },
  execution: { descriptor: PI_EXECUTION_DESCRIPTOR, create: async context => new PiExecutionBackend(context) },
  capabilities: piCapabilities,
  declarations: {
    providerId: 'pi', warmup: 'runtime',
    chatUI: chatUiContributionFor(piChatUIConfig, piCapabilities.reasoningControl),
    commandDropdown: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
    cli: { resolve: resolvePiAdapter },
    conversationState: { forkState: () => ({}), isPendingFork: () => false,
      resolveSessionId: conversation => conversation?.sessionId ?? null },
  },
  runtimePorts: context => ({
    providerId: 'pi',
    history: {
      hydrate: async () => ({ outcome: 'absent' }),
      // Pi owns its transcripts; removing a Grimoire chat does not erase them.
      deleteSession: async () => undefined,
      resolveSessionId: id => context.resolveSessionId?.(id) ?? null,
      isPendingFork: () => false,
      buildSessionPatch: input => ({ sessionId: input.sessionInvalidated ? null : input.nativeSessionRef,
        providerState: { sessionDropped: context.sessionDropped?.() ?? false } }),
    },
  }),
};
