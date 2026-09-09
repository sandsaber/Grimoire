import trace from '@test/fixtures/provider-traces/devin-execution.json';
import wire from '@test/fixtures/provider-traces/wire/devin-wire.json';
import {
  DEVIN_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import { createDevinModuleContext } from '@/providers/devin/app/DevinModuleContext';
import {
  devinProviderModule,
  devinSettingsCodec,
  type DevinWorkspaceContext,
} from '@/providers/devin/DevinProviderModule';

/**
 * The tenth module, for the first provider added after the migration.
 *
 * Derived from Qwen's, which is the sibling it resembles, and pinned here on
 * what the recording says rather than on what Qwen does: a `devin acp`
 * subcommand, models and modes as config options, no reasoning control, no
 * question interaction, and no agent definitions.
 */
describe('Devin provider module', () => {
  function createContext(): DevinWorkspaceContext {
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
      listSessionCommands: async () => [{ name: 'status', source: 'session' as const }],
      listAgentMentions: async () => [],
      refreshAgentMentions: async () => undefined,
      listModels: async () => [{ id: 'swe-1-6-slow', label: 'SWE-1.6 Slow' }],
      refreshModels: async () => [{ id: 'swe-1-6-slow', label: 'SWE-1.6 Slow' }],
      cachedPlanUsage: () => null,
      refreshPlanUsage: async () => null,
      mcpPort: () => ({
        load: async () => [
          { name: 'vault', config: { command: 'x' }, contextSaving: false, enabled: true },
        ],
        save: async () => undefined,
      }),
      renderSettingsTab: () => undefined,
      hydrateConversation: async () => ({ outcome: 'absent' as const }),
      deleteConversationSession: async () => undefined,
      resolveSessionId: () => 'acp-session',
      isPendingFork: () => false,
      readSessionDropped: () => null,
      dispose: async () => undefined,
    };
  }

  function features(): ReturnType<typeof devinProviderModule.runtimePorts> {
    return devinProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof devinProviderModule.workspace.initialize> {
    return devinProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering', () => {
    expect(devinProviderModule.manifest).toEqual({
      id: 'devin',
      displayName: 'Devin',
      order: 100,
    });
  });

  it('agrees with the trace fixture it was proven against', () => {
    expect(devinProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(devinProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(devinProviderModule.capabilities.session.resume).toBe(trace.resume);
  });

  it('carries the turn its recording holds', () => {
    // Taken from `devin 3000.6.14` on 2026-09-09, with an account that
    // answers: the handshake, a session, a config round trip and a turn.
    expect(wire.coverage).toBe('complete');
    expect(wire.cases).toEqual([
      'initialize',
      'session/new',
      'session/set_config_option',
      'session/prompt',
    ]);
    expect(wire.sessionUpdatesObserved).toEqual([
      'agent_message_chunk',
      'agent_thought_chunk',
      'available_commands_update',
      'config_option_update',
      'current_mode_update',
      'session_info_update',
      'usage_update',
    ]);
  });

  describe('capabilities', () => {
    const capabilities = devinProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(DEVIN_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(DEVIN_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(DEVIN_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(DEVIN_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(DEVIN_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(DEVIN_PROVIDER_CAPABILITIES.supportsTurnSteer);
      expect(capabilities.commands.discovery !== 'unsupported')
        .toBe(DEVIN_PROVIDER_CAPABILITIES.supportsProviderCommands);
    });

    it('resumes a session it does not read the replay of', () => {
      // Recorded: `loadSession: true`, and a `session/load` that replays the
      // transcript as updates. Grimoire keeps its own projection.
      expect(DEVIN_PROVIDER_CAPABILITIES.supportsNativeHistory).toBe(false);
      expect(capabilities.session).toEqual({
        resume: 'native',
        transcriptHydration: 'unsupported',
      });
      expect(capabilities.history.ownership).toBe('grimoire-projection');
    });

    it('offers no reasoning control, and no question, and no agents', () => {
      // The effort lives in the model id; nothing but permissions has been seen
      // on the permission channel; and the CLI documents no agent file.
      expect(capabilities.reasoningControl).toEqual({ kind: 'none' });
      expect(capabilities.interactions.questions).toBe('unsupported');
      expect(capabilities.agents.definitions).toBe('none');
      expect(capabilities.workspace.agents).toEqual({ inventory: 'none', manager: 'none' });
      expect(devinProviderModule.declarations.chatUI.reasoning).toBeUndefined();
    });

    it('lists commands without a command file to manage', () => {
      // A skill is Devin's slash command, so the inventory is the session's
      // own announcements plus the vault's skills — and nothing to edit.
      expect(capabilities.workspace.commands).toEqual({
        inventory: 'managed',
        manager: 'none',
        runtimeCommandDiscovery: 'active-session-only',
      });
    });

    it('splits MCP ownership from the per-run selector the boolean conflates', () => {
      expect(DEVIN_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
      expect(capabilities.mcp).toEqual({
        ownership: 'grimoire',
        sessionConfiguration: 'grimoire',
        perRunSelection: 'unsupported',
      });
    });
  });

  describe('workspace slots', () => {
    it('fills the session-command slot', async () => {
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
      expect(await workspace.runtimeCommands?.listForSession('acp-session'))
        .toEqual([{ name: 'status', source: 'session' }]);
    });

    it('contributes history but no rewind', () => {
      expect(features().history).toBeDefined();
      expect(features().rewind).toBeUndefined();
    });

    it('saves the session id and nothing beside it', () => {
      expect(features().history?.buildSessionPatch({
        conversationId: 'conversation-1',
        sessionInvalidated: false,
        nativeSessionRef: 'acp-session',
      })).toEqual({ sessionId: 'acp-session' });
      expect(features().history?.buildSessionPatch({
        conversationId: 'conversation-1',
        sessionInvalidated: true,
        nativeSessionRef: 'acp-session',
      })).toEqual({ sessionId: null });
    });
  });

  describe('settings codec', () => {
    it('never writes discovery state into the settings file', () => {
      const encoded = devinSettingsCodec.encode({
        ...devinSettingsCodec.defaults(),
        availableModes: [{ id: 'plan', name: 'Plan' }],
        discoveredModels: [{ rawId: 'swe-1-6-slow', label: 'SWE-1.6 Slow' }],
      });

      expect(encoded).not.toHaveProperty('availableModes');
      expect(encoded).not.toHaveProperty('discoveredModels');
    });

    it('refuses discovery state an older build wrote', () => {
      const decoded = devinSettingsCodec.decode({
        ...devinSettingsCodec.encode(devinSettingsCodec.defaults()),
        discoveredModels: [{ rawId: 'stale', label: 'Stale' }],
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('discovery state must not be stored in settings');
    });

    it('owns the CLI environment and nothing wider', () => {
      expect(devinSettingsCodec.environmentKeyPrefixes).toEqual(['DEVIN_']);
    });
  });

  describe('model presentation', () => {
    it('owns a model by the prefix, which is what the live config does', () => {
      const settings = {
        providerConfigs: {
          devin: {
            ...devinSettingsCodec.encode(devinSettingsCodec.defaults()),
            visibleModels: ['swe-1-6-slow'],
          },
        },
      };
      const presentation = devinProviderModule.declarations.chatUI.models;

      expect(presentation.ownsModel('devin:swe-1-6-slow', settings)).toBe(true);
      expect(presentation.ownsModel('devin', settings)).toBe(true);
      expect(presentation.ownsModel('swe-1-6-slow', settings)).toBe(false);
      expect(presentation.ownsModel('qwen:qwen3-coder', settings)).toBe(false);
    });
  });

  describe('module context', () => {
    const conversation = {
      id: 'conversation-1',
      sessionId: 'acp-session',
      providerId: 'devin' as const,
    };

    it('answers only about the conversation its own tab is bound to', () => {
      const context = createDevinModuleContext(testPlugin(), () => conversation, { sessionCommands: () => [], sessionDropped: () => false });

      expect(context.resolveSessionId('conversation-1')).toBe('acp-session');
      expect(context.resolveSessionId('conversation-2')).toBeNull();
      expect(context.isPendingFork('conversation-2')).toBe(false);
    });

    it('lists the commands the tab own session announced', async () => {
      const context = createDevinModuleContext(testPlugin(), () => conversation, {
        sessionCommands: () => [{ name: 'status', source: 'session' as const }],
        sessionDropped: () => false,
      });

      await expect(context.listSessionCommands('acp-session'))
        .resolves.toEqual([{ name: 'status', source: 'session' }]);
    });

    it('reports that there is nothing to hydrate rather than that it hydrated', async () => {
      const context = createDevinModuleContext(testPlugin(), () => conversation, { sessionCommands: () => [], sessionDropped: () => false });

      await expect(context.hydrateConversation('conversation-1'))
        .resolves.toEqual({ outcome: 'absent' });
    });

    it('answers a workspace slot with nothing when no workspace is registered', async () => {
      const context = createDevinModuleContext(testPlugin(), () => null, { sessionCommands: () => [], sessionDropped: () => false });

      await expect(context.listModels()).resolves.toEqual([]);
      await expect(context.mcpPort().load()).resolves.toEqual([]);
      await expect(context.commandsPort().listDropdownEntries({ includeBuiltIns: false }))
        .resolves.toEqual([]);
      expect(context.cachedPlanUsage()).toBeNull();
    });
  });
});

/** Enough plugin for the workspace slots, which read settings and a CLI path. */
function testPlugin(): never {
  return {
    getResolvedProviderCliPath: () => null,
    settings: {},
  } as never;
}
