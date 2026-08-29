import trace from '@test/fixtures/provider-traces/grok-execution.json';
import {
  GROK_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import {
  grokProviderModule,
  grokSettingsCodec,
  type GrokWorkspaceContext,
} from '@/providers/grok/GrokProviderModule';

/**
 * The fifth module, and the first that had nothing new to prove.
 *
 * OpenCode established the managed-ACP topology; Grok reaches production
 * through the same one, so what this file checks is not the contract but this
 * provider's own claims — and the two places where the module deliberately
 * says something the live capability record does not.
 */
describe('Grok provider module', () => {
  function createContext(): GrokWorkspaceContext {
    return {
      runtimeCommandLoader: () => null,
      commandsPort: () => ({
        listDropdownEntries: async () => [],
        listVaultEntries: async () => [],
        saveVaultEntry: async () => undefined,
        deleteVaultEntry: async () => undefined,
        setRuntimeCommands: () => undefined,
        refresh: async () => 'refreshed' as const,
      }),
      listSessionCommands: async () => [{ name: 'compact', source: 'session' as const }],
      listAgentMentions: async () => [{ id: 'build', label: 'Build' , source: 'vault' as const }],
      refreshAgentMentions: async () => undefined,
      listModels: async () => [{ id: 'grok-4.6', label: 'Grok 4.6' }],
      refreshModels: async () => [{ id: 'grok-4.6', label: 'Grok 4.6' }],
      cachedPlanUsage: () => null,
      refreshPlanUsage: async () => null,
      mcpPort: () => ({
        load: async () => [
          { name: 'vault', config: { command: 'x' }, contextSaving: false, enabled: true },
        ],
        save: async () => undefined,
      }),
      renderSettingsTab: () => undefined,
      hydrateConversation: async () => ({ outcome: 'complete' as const }),
      deleteConversationSession: async () => undefined,
      resolveSessionId: () => 'grok-session',
      isPendingFork: () => false,
      readSessionPaths: () => ({
        sessionDirPath: '/vault/.grimoire/grok/sessions/grok-session',
        workspacePath: '/vault',
      }),
      dispose: async () => undefined,
    };
  }

  function features(): ReturnType<typeof grokProviderModule.runtimePorts> {
    return grokProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof grokProviderModule.workspace.initialize> {
    return grokProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering', () => {
    expect(grokProviderModule.manifest).toEqual({
      id: 'grok',
      displayName: 'Grok Build',
      order: 40,
    });
  });

  it('agrees with the trace fixture it was proven against', () => {
    expect(grokProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(grokProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(grokProviderModule.capabilities.session.resume).toBe(trace.resume);
  });

  describe('capabilities', () => {
    const capabilities = grokProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(GROK_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(GROK_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(GROK_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(GROK_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.steering === 'native')
        .toBe(GROK_PROVIDER_CAPABILITIES.supportsTurnSteer);
      expect(capabilities.commands.discovery !== 'unsupported')
        .toBe(GROK_PROVIDER_CAPABILITIES.supportsProviderCommands);
      expect(capabilities.input.imageAttachments === 'native')
        .toBe(GROK_PROVIDER_CAPABILITIES.supportsImageAttachments);
    });

    it('drops the rewind the runtime it replaced never performed', () => {
      // The live record advertises rewind, which puts a button on every Grok
      // assistant message; the runtime behind it refused every input, and the
      // flip deleted it without ever implementing one. The module declares what
      // the provider does, and the dead affordance went with the runtime.
      expect(GROK_PROVIDER_CAPABILITIES.supportsRewind).toBe(true);
      expect(capabilities.conversation.rewind).toBe('unsupported');
    });

    it('never claims a rewind it contributes no port for', () => {
      // The invariant behind the row above, which outlives Grok's own answer:
      // the adapter reads the port, and the capability is what the UI reads.
      expect(capabilities.conversation.rewind === 'unsupported')
        .toBe(features().rewind === undefined);
    });

    it('splits MCP ownership from the per-run selector the boolean conflates', () => {
      // Grimoire owns `.grimoire/mcp/grok.json` and injects those servers into
      // the ACP session; `supportsMcpTools` gates the chat tab's per-run
      // selector alone, and reads as "no MCP" for a provider that has it.
      expect(GROK_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
      expect(capabilities.mcp).toEqual({
        ownership: 'grimoire',
        sessionConfiguration: 'grimoire',
        perRunSelection: 'unsupported',
      });
    });
  });

  describe('workspace slots', () => {
    it('fills every slot the provider registers, including Grimoire-owned MCP', async () => {
      const workspace = await workspaceSlots();

      expect(Object.keys(workspace).sort()).toEqual([
        'agentMentions',
        'commands',
        'mcp',
        'models',
          'runtimeCommands',
        'settingsPresentation',
        'transcripts',
        'usage',
      ]);
      expect(await workspace.mcp?.load()).toEqual([
        { name: 'vault', config: { command: 'x' }, contextSaving: false, enabled: true },
      ]);
    });
  });

  describe('session patch', () => {
    it('keeps where the transcript is when the session itself is invalidated', () => {
      const patch = features().history?.buildSessionPatch({
        conversationId: 'conversation-1',
        nativeSessionRef: 'grok-session',
        sessionInvalidated: true,
      });

      // The legacy runtime's own rule: a session that is gone must not be
      // resumed, but the directory it wrote is where the next one writes too,
      // and the transcript already there is still this conversation's.
      expect(patch).toEqual({
        sessionId: null,
        providerState: {
          sessionDirPath: '/vault/.grimoire/grok/sessions/grok-session',
          workspacePath: '/vault',
        },
      });
    });

    it('binds the conversation to the session the run observed', () => {
      const patch = features().history?.buildSessionPatch({
        conversationId: 'conversation-1',
        nativeSessionRef: 'grok-session-2',
        sessionInvalidated: false,
      });

      expect(patch?.sessionId).toBe('grok-session-2');
    });
  });

  describe('settings codec', () => {

    it('never writes discovery state into the settings file', () => {
      const encoded = grokSettingsCodec.encode({
        ...grokSettingsCodec.defaults(),
        availableModes: [{ id: 'safe', name: 'Safe' }],
        discoveredModels: [{ rawId: 'grok-4.6', label: 'Grok 4.6' }],
      });

      expect(encoded).not.toHaveProperty('availableModes');
      expect(encoded).not.toHaveProperty('discoveredModels');
    });

    it('rejects discovery state found in a stored settings record', () => {
      const decoded = grokSettingsCodec.decode({
        ...grokSettingsCodec.encode(grokSettingsCodec.defaults()),
        discoveredModels: [{ rawId: 'grok-3', label: 'Stale' }],
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('discovery state must not be stored in settings');
      expect(decoded.ok ? [] : decoded.fallback.discoveredModels).toEqual([]);
    });

  });

  describe('model presentation', () => {
    it('owns a model by Grimoire\'s own encoding rather than by the visible list', () => {
      // The app record, which is what these members take. Seven of the nine
      // module tests still fed the provider's own decoded settings after the
      // contract changed, and passed only because these providers' ownership is
      // prefix-based and ignores the argument — so the day one of them consults
      // `visibleModels`, the assertion would have kept passing against an
      // unreachable branch.
      const settings = {
        providerConfigs: {
          grok: {
            ...grokSettingsCodec.encode(grokSettingsCodec.defaults()),
                modelAliases: { 'grok-4.6': 'Fast' },
                visibleModels: ['grok-4.6'],
          },
        },
      };
      const presentation = grokProviderModule.declarations.chatUI.models;

      // Unlike OpenCode, a Grok selection carries its provider in the id, so a
      // model the vault has never discovered is still Grok's to label.
      expect(presentation.ownsModel('grok:grok-4.6', settings)).toBe(true);
      expect(presentation.ownsModel('grok:anthropic/claude-sonnet-4', settings)).toBe(true);
      expect(presentation.ownsModel('anthropic/claude-sonnet-4', settings)).toBe(false);
    });
  });
});
