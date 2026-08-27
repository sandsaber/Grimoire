import trace from '@test/fixtures/provider-traces/mimocode-execution.json';
import {
  MIMOCODE_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import {
  mimocodeProviderModule,
  mimocodeSettingsCodec,
  type MimocodeWorkspaceContext,
} from '@/providers/mimocode/MimocodeProviderModule';

/**
 * The fourth module, and the one that generalizes.
 *
 * MiMoCode is a managed ACP subprocess, the shape MiMoCode, Kimi Code, Grok,
 * Qwen, and Gemini also reach production through — so what holds here is the
 * argument that the contract covers the five providers that have no proof of
 * their own.
 */
describe('MiMoCode provider module', () => {
  function createContext(): MimocodeWorkspaceContext {
    return {
      listCommands: async () => [{ name: 'init', source: 'project' as const }],
      listSessionCommands: async () => [{ name: 'undo', source: 'session' as const }],
      listAgentMentions: async () => [{ id: 'build', label: 'Build' }],
      refreshAgentMentions: async () => undefined,
      resolveCliPath: async () => '/usr/local/bin/mimocode',
      listModels: async () => [{ id: 'anthropic/claude-sonnet', label: 'Sonnet' }],
      refreshModels: async () => [{ id: 'anthropic/claude-sonnet', label: 'Sonnet' }],
      readPlanUsage: async () => null,
      loadMcpServers: async () => [{ id: 'vault', label: 'Vault', enabled: true }],
      saveMcpServers: async () => undefined,
      renderSettingsTab: () => undefined,
      hydrateConversation: async () => ({ outcome: 'complete' as const }),
      deleteConversationSession: async () => undefined,
      resolveSessionId: () => 'acp-session',
      isPendingFork: () => false,
      readDatabasePath: () => '/vault/.mimocode/mimocode.db',
      dispose: async () => undefined,
    };
  }

  function features(): ReturnType<typeof mimocodeProviderModule.runtimePorts> {
    return mimocodeProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof mimocodeProviderModule.workspace.initialize> {
    return mimocodeProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering', () => {
    expect(mimocodeProviderModule.manifest).toEqual({
      id: 'mimocode',
      displayName: 'MiMoCode',
      order: 50,
    });
  });

  // The trace is a design declaration, not recorded traffic: it says what
  // topology this module was built against. MiMoCode's is OpenCode's, which is
  // the result waves 4 and 5 were for — with two corrections taken from
  // MiMoCode's own wire recording rather than inherited: its session offers
  // `model` and `mode` and no `variant`, and it announces its commands and
  // usage when it opens. What the recording cannot confirm is the answer
  // traffic, because the account it was taken on does not generate; the live
  // smoke harness is what will.
  it('agrees with the trace fixture it was proven against', () => {
    expect(mimocodeProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(mimocodeProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(mimocodeProviderModule.capabilities.session.resume).toBe(trace.resume);
  });

  describe('capabilities', () => {
    const capabilities = mimocodeProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(MIMOCODE_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(MIMOCODE_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(MIMOCODE_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(MIMOCODE_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(MIMOCODE_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(MIMOCODE_PROVIDER_CAPABILITIES.supportsTurnSteer);
      expect(capabilities.commands.discovery !== 'unsupported')
        .toBe(MIMOCODE_PROVIDER_CAPABILITIES.supportsProviderCommands);
    });

    it('splits MCP ownership from the per-run selector the boolean conflates', () => {
      // `supportsMcpTools` gates the chat tab's per-run server selector and
      // nothing else. Grimoire still owns `.grimoire/mcp/mimocode.json` and
      // still injects those servers into the ACP session, so the single boolean
      // reads as "no MCP" for a provider that has Grimoire-owned MCP.
      expect(MIMOCODE_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
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
      const defaults = mimocodeSettingsCodec.defaults();

      expect(mimocodeSettingsCodec.decode(mimocodeSettingsCodec.encode(defaults)).ok).toBe(true);
      expect(mimocodeSettingsCodec.reconcile(defaults, 'load').changed).toBe(false);
    });

    it('never writes discovery state into the settings file', () => {
      // The persisted interface excludes these two, and encoding them would
      // make a cached CLI catalogue survive the process that produced it.
      const encoded = mimocodeSettingsCodec.encode({
        ...mimocodeSettingsCodec.defaults(),
        availableModes: [{ id: 'build', name: 'Build', description: 'Build mode' }],
        discoveredModels: [{ rawId: 'anthropic/claude-sonnet', label: 'Sonnet' }],
      });

      expect(encoded).not.toHaveProperty('availableModes');
      expect(encoded).not.toHaveProperty('discoveredModels');
    });

    it('rejects discovery state found in a stored settings record', () => {
      const decoded = mimocodeSettingsCodec.decode({
        ...mimocodeSettingsCodec.encode(mimocodeSettingsCodec.defaults()),
        discoveredModels: [{ rawId: 'stale/model', label: 'Stale' }],
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('discovery state must not be stored in settings');
      expect(decoded.ok ? [] : decoded.fallback.discoveredModels).toEqual([]);
    });

    it('keeps discovery state across a reconciliation that did not persist it', () => {
      const discovered = [{ rawId: 'anthropic/claude-sonnet', label: 'Sonnet' }];

      const result = mimocodeSettingsCodec.reconcile({
        ...mimocodeSettingsCodec.defaults(),
        discoveredModels: discovered,
      }, 'load');

      expect(result.settings.discoveredModels).toEqual(discovered);
      expect(result.changed).toBe(false);
    });

    it('invalidates sessions when a variable the CLI reads its state from changes', () => {
      const changed = mimocodeSettingsCodec.reconcile({
        ...mimocodeSettingsCodec.defaults(),
        environmentVariables: 'XDG_DATA_HOME=/tmp/mimocode\n',
        environmentHash: '',
      }, 'environment-change');

      expect(changed.invalidatesSessions).toBe(true);
      expect(changed.settings.environmentHash).toBe('XDG_DATA_HOME=/tmp/mimocode');
    });

    it('ignores the MIMOCODE_ variable the default settings ship with', () => {
      // `MIMOCODE_ENABLE_EXA` is in the shipped defaults and matches the
      // registration's `/^MIMOCODE_/i` pattern, so the pattern would invalidate
      // every session on a fresh install. The four keys that decide a session's
      // usability do not.
      const result = mimocodeSettingsCodec.reconcile(
        mimocodeSettingsCodec.defaults(),
        'environment-change',
      );

      expect(mimocodeSettingsCodec.defaults().environmentVariables)
        .toContain('MIMOCODE_ENABLE_EXA');
      expect(result.invalidatesSessions).toBe(false);
    });
  });

  describe('model presentation', () => {
    it('owns a model by the prefix, which is what the live config does', () => {
      // This asserted the opposite until Gemini's module was checked against
      // its own chat UI config and three siblings turned out to carry the same
      // claim. A provider-qualified raw id does not make ownership a settings
      // question: the chat never sees a raw id, it sees `mimocode:<raw id>`, so a
      // lookup in a list keyed by raw ids answers false for every model.
      const settings = {
        ...mimocodeSettingsCodec.defaults(),
        visibleModels: ['anthropic/claude-sonnet'],
        modelAliases: { 'openai/gpt-5.5': 'Fast' },
      };
      const presentation = mimocodeProviderModule.declarations.chatUI.modelPresentation;

      expect(presentation.ownsModel('mimocode:anthropic/claude-sonnet', settings)).toBe(true);
      // The synthetic id a vault with no catalogue yet still selects.
      expect(presentation.ownsModel('mimocode', settings)).toBe(true);
      expect(presentation.ownsModel('anthropic/claude-sonnet', settings)).toBe(false);
      // Another provider's, encoded the same way.
      expect(presentation.ownsModel('gemini:gemini-2.5-pro', settings)).toBe(false);
      // The label decodes first: the alias map is keyed by the raw id.
      expect(presentation.label('mimocode:openai/gpt-5.5', settings)).toBe('Fast');
      expect(presentation.label('mimocode:anthropic/claude-opus', settings)).toBe('anthropic/claude-opus');
    });
  });
});
