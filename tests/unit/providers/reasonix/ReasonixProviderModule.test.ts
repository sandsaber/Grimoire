import trace from '@test/fixtures/provider-traces/reasonix-execution.json';
import wire from '@test/fixtures/provider-traces/wire/reasonix-wire.json';
import {
  REASONIX_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import { createReasonixModuleContext } from '@/providers/reasonix/app/ReasonixModuleContext';
import {
  reasonixProviderModule,
  reasonixSettingsCodec,
  type ReasonixWorkspaceContext,
} from '@/providers/reasonix/ReasonixProviderModule';

/**
 * The tenth module, for the first provider added after the migration.
 *
 * Derived from Qwen's, which is the sibling it resembles, and pinned here on
 * what the recording says rather than on what Qwen does: a `reasonix acp`
 * subcommand, models and modes as config options, no reasoning control, no
 * question interaction, and no agent definitions.
 */
describe('Reasonix provider module', () => {
  function createContext(): ReasonixWorkspaceContext {
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

  function features(): ReturnType<typeof reasonixProviderModule.runtimePorts> {
    return reasonixProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof reasonixProviderModule.workspace.initialize> {
    return reasonixProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('persists image opt-in through the settings codec and rejects non-booleans', () => {
    expect(reasonixSettingsCodec.defaults().imageAttachmentsAsFiles).toBe(false);
    const decoded = reasonixSettingsCodec.decode({ imageAttachmentsAsFiles: true });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('Expected valid settings');
    expect(reasonixSettingsCodec.encode(decoded.value).imageAttachmentsAsFiles).toBe(true);
    expect(decoded.preservedUnknown).not.toHaveProperty('imageAttachmentsAsFiles');
    expect(reasonixSettingsCodec.decode({ imageAttachmentsAsFiles: 'true' }).ok).toBe(false);
  });

  it('declares its identity and ordering', () => {
    expect(reasonixProviderModule.manifest).toEqual({
      id: 'reasonix',
      displayName: 'Reasonix',
      order: 110,
    });
  });

  it('agrees with the trace fixture it was proven against', () => {
    expect(reasonixProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(reasonixProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(reasonixProviderModule.capabilities.session.resume).toBe(trace.resume);
  });

  it('carries the turn its recording holds', () => {
    // Taken from `reasonix 3000.6.14` on 2026-09-09, with an account that
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
      'available_commands_update',
      'config_option_update',
    ]);
  });

  describe('capabilities', () => {
    const capabilities = reasonixProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(REASONIX_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(REASONIX_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(REASONIX_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(REASONIX_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(REASONIX_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(REASONIX_PROVIDER_CAPABILITIES.supportsTurnSteer);
      expect(capabilities.commands.discovery !== 'unsupported')
        .toBe(REASONIX_PROVIDER_CAPABILITIES.supportsProviderCommands);
    });

    it('resumes a session it does not read the replay of', () => {
      // Recorded: `loadSession: true`, and a `session/load` that replays the
      // transcript as updates. Grimoire keeps its own projection.
      expect(REASONIX_PROVIDER_CAPABILITIES.supportsNativeHistory).toBe(false);
      expect(capabilities.session).toEqual({
        resume: 'native',
        transcriptHydration: 'unsupported',
      });
      expect(capabilities.history.ownership).toBe('grimoire-projection');
    });

    it('drives reasoning effort, and offers no question and no agents', () => {
      // The tiers here are the union of what any provider block can produce;
      // what the picker shows is whichever of them the open session offered.
      // Nothing but permissions has been seen on the permission channel, and
      // the CLI documents no agent file.
      expect(capabilities.reasoningControl).toEqual({
        kind: 'effort',
        tiers: ['auto', 'disabled', 'enabled', 'low', 'high', 'max'],
      });
      expect(capabilities.interactions.questions).toBe('unsupported');
      expect(capabilities.agents.definitions).toBe('none');
      expect(capabilities.workspace.agents).toEqual({ inventory: 'none', manager: 'none' });
      expect(reasonixProviderModule.declarations.chatUI.reasoning).toBeDefined();
    });

    it('lists commands without a command file to manage', () => {
      // A skill is Reasonix's slash command, so the inventory is the session's
      // own announcements plus the vault's skills — and nothing to edit.
      expect(capabilities.workspace.commands).toEqual({
        inventory: 'managed',
        manager: 'none',
        runtimeCommandDiscovery: 'active-session-only',
      });
    });

    it('splits MCP ownership from the per-run selector the boolean conflates', () => {
      expect(REASONIX_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
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
      const encoded = reasonixSettingsCodec.encode({
        ...reasonixSettingsCodec.defaults(),
        availableModes: [{ id: 'plan', name: 'Plan' }],
        discoveredModels: [{ rawId: 'swe-1-6-slow', label: 'SWE-1.6 Slow' }],
      });

      expect(encoded).not.toHaveProperty('availableModes');
      expect(encoded).not.toHaveProperty('discoveredModels');
    });

    it('refuses discovery state an older build wrote', () => {
      const decoded = reasonixSettingsCodec.decode({
        ...reasonixSettingsCodec.encode(reasonixSettingsCodec.defaults()),
        discoveredModels: [{ rawId: 'stale', label: 'Stale' }],
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('discovery state must not be stored in settings');
    });

    it('owns the CLI environment and nothing wider', () => {
      expect(reasonixSettingsCodec.environmentKeyPrefixes).toEqual(['REASONIX_']);
    });
  });

  describe('model presentation', () => {
    it('owns a model by the prefix, which is what the live config does', () => {
      const settings = {
        providerConfigs: {
          reasonix: {
            ...reasonixSettingsCodec.encode(reasonixSettingsCodec.defaults()),
            visibleModels: ['swe-1-6-slow'],
          },
        },
      };
      const presentation = reasonixProviderModule.declarations.chatUI.models;

      expect(presentation.ownsModel('reasonix:swe-1-6-slow', settings)).toBe(true);
      expect(presentation.ownsModel('reasonix', settings)).toBe(true);
      expect(presentation.ownsModel('swe-1-6-slow', settings)).toBe(false);
      expect(presentation.ownsModel('qwen:qwen3-coder', settings)).toBe(false);
    });
  });

  describe('module context', () => {
    const conversation = {
      id: 'conversation-1',
      sessionId: 'acp-session',
      providerId: 'reasonix' as const,
    };

    it('answers only about the conversation its own tab is bound to', () => {
      const context = createReasonixModuleContext(testPlugin(), () => conversation, { sessionCommands: () => [], sessionDropped: () => false });

      expect(context.resolveSessionId('conversation-1')).toBe('acp-session');
      expect(context.resolveSessionId('conversation-2')).toBeNull();
      expect(context.isPendingFork('conversation-2')).toBe(false);
    });

    it('lists the commands the tab own session announced', async () => {
      const context = createReasonixModuleContext(testPlugin(), () => conversation, {
        sessionCommands: () => [{ name: 'status', source: 'session' as const }],
        sessionDropped: () => false,
      });

      await expect(context.listSessionCommands('acp-session'))
        .resolves.toEqual([{ name: 'status', source: 'session' }]);
    });

    it('reports that there is nothing to hydrate rather than that it hydrated', async () => {
      const context = createReasonixModuleContext(testPlugin(), () => conversation, { sessionCommands: () => [], sessionDropped: () => false });

      await expect(context.hydrateConversation('conversation-1'))
        .resolves.toEqual({ outcome: 'absent' });
    });

    it('answers a workspace slot with nothing when no workspace is registered', async () => {
      const context = createReasonixModuleContext(testPlugin(), () => null, { sessionCommands: () => [], sessionDropped: () => false });

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
