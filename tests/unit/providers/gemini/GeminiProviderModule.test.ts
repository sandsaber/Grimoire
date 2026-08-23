import trace from '@test/fixtures/provider-traces/gemini-execution.json';

import { createGeminiModuleContext } from '@/providers/gemini/app/GeminiModuleContext';
import { GEMINI_PROVIDER_CAPABILITIES } from '@/providers/gemini/capabilities';
import {
  geminiProviderModule,
  geminiSettingsCodec,
  type GeminiWorkspaceContext,
} from '@/providers/gemini/GeminiProviderModule';

/**
 * The eighth module, and the first written for a provider that had none.
 *
 * Gemini reached the kernel without a `ProviderModule`, so what this pins is
 * mostly a derivation: the managed-ACP topology four providers already run on,
 * plus the four places this CLI is not one of them — no native transcript, no
 * reasoning control, its own mode ids, and a flag instead of a subcommand.
 */
describe('Gemini provider module', () => {
  function createContext(): GeminiWorkspaceContext {
    return {
      listCommands: async () => [{ name: 'init', source: 'project' as const }],
      listAgentMentions: async () => [{ id: 'planner', label: 'Planner' }],
      refreshAgentMentions: async () => undefined,
      resolveCliPath: async () => '/usr/local/bin/gemini',
      listModels: async () => [{ id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }],
      refreshModels: async () => [{ id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }],
      readPlanUsage: async () => null,
      loadMcpServers: async () => [{ id: 'vault', label: 'Vault', enabled: true }],
      saveMcpServers: async () => undefined,
      startMcpServer: async () => undefined,
      stopMcpServer: async () => undefined,
      shouldKeepWarm: () => true,
      renderSettingsTab: () => undefined,
      hydrateConversation: async () => ({ outcome: 'absent' as const }),
      deleteConversationSession: async () => undefined,
      resolveSessionId: () => 'acp-session',
      isPendingFork: () => false,
      dispose: async () => undefined,
    };
  }

  function features(): ReturnType<typeof geminiProviderModule.features> {
    return geminiProviderModule.features(createContext());
  }

  function workspaceSlots(): ReturnType<typeof geminiProviderModule.workspace.initialize> {
    return geminiProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering from the registration it replaces', () => {
    expect(geminiProviderModule.manifest).toEqual({
      id: 'gemini',
      displayName: 'Gemini CLI',
      order: 80,
    });
  });

  it('agrees with the trace fixture it was proven against', () => {
    expect(geminiProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(geminiProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(geminiProviderModule.capabilities.session.resume).toBe(trace.resume);
  });

  describe('capabilities', () => {
    const capabilities = geminiProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(GEMINI_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(GEMINI_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(GEMINI_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(GEMINI_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(GEMINI_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(GEMINI_PROVIDER_CAPABILITIES.supportsTurnSteer);
    });

    it('resumes a session it cannot read a transcript out of', () => {
      // The pair no sibling on this transport has. `session/load` works — the
      // recorded `initialize` answers `loadSession: true` — and there is still
      // no provider-native history behind it, which is why the result sink has
      // no recovery port and why history ownership is Grimoire's projection.
      expect(GEMINI_PROVIDER_CAPABILITIES.supportsNativeHistory).toBe(false);
      expect(capabilities.session).toEqual({
        resume: 'native',
        transcriptHydration: 'unsupported',
      });
      expect(capabilities.history.ownership).toBe('grimoire-projection');
    });

    it('finds commands in the vault while refusing the ones the session announces', () => {
      // The one place the descriptor and the live boolean deliberately
      // disagree, and the family's assertion — `discovery !== 'unsupported'`
      // equals `supportsProviderCommands` — is what would hide it.
      // `supportsProviderCommands` gates the *session's* commands, which this
      // provider drops: the recording captures an `available_commands_update`
      // carrying twenty and no surface asks for one. What Grimoire does list is
      // `.gemini/commands/**/*.toml`, which is a static vault catalogue.
      expect(GEMINI_PROVIDER_CAPABILITIES.supportsProviderCommands).toBe(false);
      expect(capabilities.commands).toEqual({
        discovery: 'static',
        chatSurface: 'grimoire',
      });
    });

    it('splits MCP ownership from the per-run selector the boolean conflates', () => {
      // `supportsMcpTools` gates the chat tab's per-run server selector and
      // nothing else. Grimoire still owns `.grimoire/mcp/gemini.json` and still
      // injects those servers into the ACP session, so the single boolean reads
      // as "no MCP" for a provider that has Grimoire-owned MCP.
      expect(GEMINI_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
      expect(capabilities.mcp).toEqual({
        ownership: 'grimoire',
        sessionConfiguration: 'grimoire',
        perRunSelection: 'unsupported',
      });
    });

    it('offers no reasoning control, because the session carries nowhere to put one', () => {
      expect(GEMINI_PROVIDER_CAPABILITIES.reasoningControl).toBe('none');
      expect(features().chatUI.reasoningControl).toEqual({ kind: 'none' });
    });
  });

  describe('workspace slots', () => {
    it('fills every slot the provider registers, and not the one it has no source for', async () => {
      const workspace = await workspaceSlots();

      // `runtimeCommands` is absent on purpose: it is answered from the open
      // session's announced commands, and this provider drops those.
      expect(Object.keys(workspace).sort()).toEqual([
        'agentMentions',
        'cliResolution',
        'commands',
        'mcp',
        'models',
        'residency',
        'settingsPresentation',
        'usage',
      ]);
      expect(await workspace.mcp?.loadServers()).toEqual([
        { id: 'vault', label: 'Vault', enabled: true },
      ]);
    });

    it('contributes history but no rewind', () => {
      expect(features().history).toBeDefined();
      expect(features().rewind).toBeUndefined();
    });

    it('saves the session id and nothing beside it', () => {
      // Every sibling on this transport also saves where its session lives — a
      // database path, a managed home. Gemini writes no such state, so a patch
      // carrying `providerState` would be inventing one.
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
    it('round-trips defaults without reporting a change', () => {
      const defaults = geminiSettingsCodec.defaults();

      expect(geminiSettingsCodec.decode(geminiSettingsCodec.encode(defaults)).ok).toBe(true);
      expect(geminiSettingsCodec.reconcile(defaults, 'load').changed).toBe(false);
    });

    it('never writes discovery state into the settings file', () => {
      // The persisted interface excludes these two, and encoding them would
      // make a cached CLI catalogue survive the process that produced it.
      const encoded = geminiSettingsCodec.encode({
        ...geminiSettingsCodec.defaults(),
        availableModes: [{ id: 'plan', name: 'Plan', description: 'Read-only mode' }],
        discoveredModels: [{ rawId: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }],
      });

      expect(encoded).not.toHaveProperty('availableModes');
      expect(encoded).not.toHaveProperty('discoveredModels');
    });

    it('rejects discovery state found in a stored settings record', () => {
      const decoded = geminiSettingsCodec.decode({
        ...geminiSettingsCodec.encode(geminiSettingsCodec.defaults()),
        discoveredModels: [{ rawId: 'stale/model', label: 'Stale' }],
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('discovery state must not be stored in settings');
      expect(decoded.ok ? [] : decoded.fallback.discoveredModels).toEqual([]);
    });

    it('keeps discovery state across a reconciliation that did not persist it', () => {
      const discovered = [{ rawId: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }];

      const result = geminiSettingsCodec.reconcile({
        ...geminiSettingsCodec.defaults(),
        discoveredModels: discovered,
      }, 'load');

      expect(result.settings.discoveredModels).toEqual(discovered);
      expect(result.changed).toBe(false);
    });

    it('invalidates sessions when the account answering would change', () => {
      const changed = geminiSettingsCodec.reconcile({
        ...geminiSettingsCodec.defaults(),
        environmentVariables: 'GEMINI_API_KEY=abc\n',
        environmentHash: '',
      }, 'environment-change');

      expect(changed.invalidatesSessions).toBe(true);
      expect(changed.settings.environmentHash).toBe('GEMINI_API_KEY=abc');
    });

    it('ignores a GEMINI_ variable that decides nothing about the account', () => {
      // The registration's `/^GEMINI_/i` pattern matches every variable this
      // CLI reads, and most of them say nothing about who is answering.
      // Hashing the pattern would invalidate every conversation over a system
      // prompt path.
      const result = geminiSettingsCodec.reconcile({
        ...geminiSettingsCodec.defaults(),
        environmentVariables: 'GEMINI_SYSTEM_MD=/vault/system.md\n',
        environmentHash: '',
      }, 'environment-change');

      expect(result.invalidatesSessions).toBe(false);
      expect(result.settings.environmentHash).toBe('');
    });
  });

  describe('model presentation', () => {
    it('owns a model by the user-curated list rather than by a prefix', () => {
      const settings = {
        ...geminiSettingsCodec.defaults(),
        visibleModels: ['gemini-2.5-pro'],
        modelAliases: { 'gemini-3.5-flash': 'Fast' },
      };
      const presentation = features().chatUI.modelPresentation;

      expect(presentation.ownsModel('gemini-2.5-pro', settings)).toBe(true);
      expect(presentation.ownsModel('gemini-3.5-flash', settings)).toBe(true);
      expect(presentation.label('gemini-3.5-flash', settings)).toBe('Fast');
      expect(presentation.ownsModel('gemini-1.0-ultra', settings)).toBe(false);
    });
  });

  describe('module context', () => {
    const conversation = {
      id: 'conversation-1',
      sessionId: 'acp-session',
      providerId: 'gemini' as const,
    };

    it('answers only about the conversation its own tab is bound to', () => {
      const context = createGeminiModuleContext(() => conversation);

      expect(context.resolveSessionId('conversation-1')).toBe('acp-session');
      // Another tab's conversation is not this runtime's to answer for: a
      // lookup across the workspace would report a session this tab is not on.
      expect(context.resolveSessionId('conversation-2')).toBeNull();
      expect(context.isPendingFork('conversation-2')).toBe(false);
    });

    it('reports that there is nothing to hydrate rather than that it hydrated', async () => {
      const context = createGeminiModuleContext(() => conversation);

      // `supportsNativeHistory: false`. Answering `complete` would tell the
      // surface a transcript was read back when none exists.
      await expect(context.hydrateConversation('conversation-1'))
        .resolves.toEqual({ outcome: 'absent' });
    });

    it('refuses a workspace slot it does not serve, by name', async () => {
      const context = createGeminiModuleContext(() => null);

      await expect(context.listModels()).rejects.toThrow(/listModels/);
      await expect(context.loadMcpServers()).rejects.toThrow(/legacy workspace registration/);
    });
  });
});
