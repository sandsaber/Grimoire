import trace from '@test/fixtures/provider-traces/opencode-execution.json';
import {
  OPENCODE_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import {
  opencodeProviderModule,
  opencodeSettingsCodec,
  type OpencodeWorkspaceContext,
} from '@/providers/opencode/OpencodeProviderModule';

/**
 * The fourth module, and the one that generalizes.
 *
 * OpenCode is a managed ACP subprocess, the shape MiMoCode, Kimi Code, Grok,
 * Qwen, and Gemini also reach production through — so what holds here is the
 * argument that the contract covers the five providers that have no proof of
 * their own.
 */
describe('OpenCode provider module', () => {
  function createContext(): OpencodeWorkspaceContext {
    return {
      listCommands: async () => [{ name: 'init', source: 'project' as const }],
      listSessionCommands: async () => [{ name: 'undo', source: 'session' as const }],
      listAgentMentions: async () => [{ id: 'build', label: 'Build' , source: 'vault' as const }],
      refreshAgentMentions: async () => undefined,
      resolveCliPath: async () => '/usr/local/bin/opencode',
      listModels: async () => [{ id: 'anthropic/claude-sonnet', label: 'Sonnet' }],
      refreshModels: async () => [{ id: 'anthropic/claude-sonnet', label: 'Sonnet' }],
      cachedPlanUsage: () => null,
      refreshPlanUsage: async () => null,
      loadMcpServers: async () => [{ id: 'vault', label: 'Vault', enabled: true }],
      saveMcpServers: async () => undefined,
      renderSettingsTab: () => undefined,
      hydrateConversation: async () => ({ outcome: 'complete' as const }),
      deleteConversationSession: async () => undefined,
      resolveSessionId: () => 'acp-session',
      isPendingFork: () => false,
      readDatabasePath: () => '/vault/.opencode/opencode.db',
      dispose: async () => undefined,
    };
  }

  function features(): ReturnType<typeof opencodeProviderModule.runtimePorts> {
    return opencodeProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof opencodeProviderModule.workspace.initialize> {
    return opencodeProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering', () => {
    expect(opencodeProviderModule.manifest).toEqual({
      id: 'opencode',
      displayName: 'OpenCode',
      order: 30,
    });
  });

  it('agrees with the trace fixture it was proven against', () => {
    expect(opencodeProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(opencodeProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(opencodeProviderModule.capabilities.session.resume).toBe(trace.resume);
  });

  describe('capabilities', () => {
    const capabilities = opencodeProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(OPENCODE_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(OPENCODE_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(OPENCODE_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(OPENCODE_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(OPENCODE_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(OPENCODE_PROVIDER_CAPABILITIES.supportsTurnSteer);
      expect(capabilities.commands.discovery !== 'unsupported')
        .toBe(OPENCODE_PROVIDER_CAPABILITIES.supportsProviderCommands);
    });

    it('splits MCP ownership from the per-run selector the boolean conflates', () => {
      // `supportsMcpTools` gates the chat tab's per-run server selector and
      // nothing else. Grimoire still owns `.grimoire/mcp/opencode.json` and
      // still injects those servers into the ACP session, so the single boolean
      // reads as "no MCP" for a provider that has Grimoire-owned MCP.
      expect(OPENCODE_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
      expect(capabilities.mcp).toEqual({
        ownership: 'grimoire',
        sessionConfiguration: 'grimoire',
        perRunSelection: 'unsupported',
      });
    });

    it('declares the managed ACP topology the remaining providers share', () => {
      expect(capabilities.process.topology).toBe('managed-acp-subprocess');
    });
  });

  describe('workspace slots', () => {
    it('fills every slot the provider registers, including Grimoire-owned MCP', async () => {
      const workspace = await workspaceSlots();

      expect(Object.keys(workspace).sort()).toEqual([
        'agentMentions',
        'cliResolution',
        'commands',
        'mcp',
        'models',
          'runtimeCommands',
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
  });

  describe('settings codec', () => {
    it('round-trips defaults without reporting a change', () => {
      const defaults = opencodeSettingsCodec.defaults();

      expect(opencodeSettingsCodec.decode(opencodeSettingsCodec.encode(defaults)).ok).toBe(true);
      expect(opencodeSettingsCodec.reconcile(defaults, 'load').changed).toBe(false);
    });

    it('never writes discovery state into the settings file', () => {
      // The persisted interface excludes these two, and encoding them would
      // make a cached CLI catalogue survive the process that produced it.
      const encoded = opencodeSettingsCodec.encode({
        ...opencodeSettingsCodec.defaults(),
        availableModes: [{ id: 'build', name: 'Build', description: 'Build mode' }],
        discoveredModels: [{ rawId: 'anthropic/claude-sonnet', label: 'Sonnet' }],
      });

      expect(encoded).not.toHaveProperty('availableModes');
      expect(encoded).not.toHaveProperty('discoveredModels');
    });

    it('rejects discovery state found in a stored settings record', () => {
      const decoded = opencodeSettingsCodec.decode({
        ...opencodeSettingsCodec.encode(opencodeSettingsCodec.defaults()),
        discoveredModels: [{ rawId: 'stale/model', label: 'Stale' }],
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('discovery state must not be stored in settings');
      expect(decoded.ok ? [] : decoded.fallback.discoveredModels).toEqual([]);
    });

    it('keeps discovery state across a reconciliation that did not persist it', () => {
      const discovered = [{ rawId: 'anthropic/claude-sonnet', label: 'Sonnet' }];

      const result = opencodeSettingsCodec.reconcile({
        ...opencodeSettingsCodec.defaults(),
        discoveredModels: discovered,
      }, 'load');

      expect(result.settings.discoveredModels).toEqual(discovered);
      expect(result.changed).toBe(false);
    });

    it('invalidates sessions when a variable the CLI reads its state from changes', () => {
      const changed = opencodeSettingsCodec.reconcile({
        ...opencodeSettingsCodec.defaults(),
        environmentVariables: 'XDG_DATA_HOME=/tmp/opencode\n',
        environmentHash: '',
      }, 'environment-change');

      expect(changed.invalidatesSessions).toBe(true);
      expect(changed.settings.environmentHash).toBe('XDG_DATA_HOME=/tmp/opencode');
    });

    it('ignores the OPENCODE_ variable the default settings ship with', () => {
      // `OPENCODE_ENABLE_EXA` is in the shipped defaults and matches the
      // registration's `/^OPENCODE_/i` pattern, so the pattern would invalidate
      // every session on a fresh install. The four keys that decide a session's
      // usability do not.
      const result = opencodeSettingsCodec.reconcile(
        opencodeSettingsCodec.defaults(),
        'environment-change',
      );

      expect(opencodeSettingsCodec.defaults().environmentVariables)
        .toContain('OPENCODE_ENABLE_EXA');
      expect(result.invalidatesSessions).toBe(false);
    });
  });

  describe('model presentation', () => {
    it('owns a model by the prefix, which is what the live config does', () => {
      // This asserted the opposite until Gemini's module was checked against
      // its own chat UI config and three siblings turned out to carry the same
      // claim. A provider-qualified raw id does not make ownership a settings
      // question: the chat never sees a raw id, it sees `opencode:<raw id>`, so a
      // lookup in a list keyed by raw ids answers false for every model.
      const settings = {
        ...opencodeSettingsCodec.defaults(),
        visibleModels: ['anthropic/claude-sonnet'],
        modelAliases: { 'openai/gpt-5.5': 'Fast' },
      };
      const presentation = opencodeProviderModule.declarations.chatUI.modelPresentation;

      expect(presentation.ownsModel('opencode:anthropic/claude-sonnet', settings)).toBe(true);
      // The synthetic id a vault with no catalogue yet still selects.
      expect(presentation.ownsModel('opencode', settings)).toBe(true);
      expect(presentation.ownsModel('anthropic/claude-sonnet', settings)).toBe(false);
      // Another provider's, encoded the same way.
      expect(presentation.ownsModel('gemini:gemini-2.5-pro', settings)).toBe(false);
      // The label decodes first: the alias map is keyed by the raw id.
      expect(presentation.label('opencode:openai/gpt-5.5', settings)).toBe('Fast');
      expect(presentation.label('opencode:anthropic/claude-opus', settings)).toBe('anthropic/claude-opus');
    });
  });
});
