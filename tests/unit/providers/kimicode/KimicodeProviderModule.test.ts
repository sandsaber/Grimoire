import trace from '@test/fixtures/provider-traces/kimicode-execution.json';
import {
  KIMICODE_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import {
  kimicodeProviderModule,
  kimicodeSettingsCodec,
  type KimicodeWorkspaceContext,
} from '@/providers/kimicode/KimicodeProviderModule';

/**
 * The fourth module, and the one that generalizes.
 *
 * Kimi Code is a managed ACP subprocess, the shape Kimi Code, Kimi Code, Grok,
 * Qwen, and Gemini also reach production through — so what holds here is the
 * argument that the contract covers the five providers that have no proof of
 * their own.
 */
describe('Kimi Code provider module', () => {
  function createContext(): KimicodeWorkspaceContext {
    return {
      runtimeCommandLoader: () => null,
      commandsPort: () => ({
        listDropdownEntries: async () => [],
        listVaultEntries: async () => [],
        saveVaultEntry: async () => undefined,
        deleteVaultEntry: async () => undefined,
        setRuntimeCommands: () => undefined,
        refresh: async () => undefined,
      }),
      listSessionCommands: async () => [{ name: 'undo', source: 'session' as const }],
      listAgentMentions: async () => [{ id: 'build', label: 'Build' , source: 'vault' as const }],
      refreshAgentMentions: async () => undefined,
      listModels: async () => [{ id: 'anthropic/claude-sonnet', label: 'Sonnet' }],
      refreshModels: async () => [{ id: 'anthropic/claude-sonnet', label: 'Sonnet' }],
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
      resolveSessionId: () => 'acp-session',
      isPendingFork: () => false,
      readDatabasePath: () => '/vault/.kimicode/kimicode.db',
      dispose: async () => undefined,
    };
  }

  function features(): ReturnType<typeof kimicodeProviderModule.runtimePorts> {
    return kimicodeProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof kimicodeProviderModule.workspace.initialize> {
    return kimicodeProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering', () => {
    expect(kimicodeProviderModule.manifest).toEqual({
      id: 'kimicode',
      displayName: 'Kimi Code',
      order: 60,
    });
  });

  // The trace is a design declaration, not recorded traffic: it says what
  // topology this module was built against. Kimi Code's is OpenCode's, which is
  // the result waves 4 and 5 were for — with two corrections taken from
  // Kimi Code's own wire recording rather than inherited: its session offers
  // `model` and `mode` and no `variant`, and it announces its commands and
  // usage when it opens. What the recording cannot confirm is the answer
  // traffic, because the account it was taken on does not generate; the live
  // smoke harness is what will.
  it('agrees with the trace fixture it was proven against', () => {
    expect(kimicodeProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(kimicodeProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(kimicodeProviderModule.capabilities.session.resume).toBe(trace.resume);
  });

  describe('capabilities', () => {
    const capabilities = kimicodeProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(KIMICODE_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(KIMICODE_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(KIMICODE_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(KIMICODE_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(KIMICODE_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(KIMICODE_PROVIDER_CAPABILITIES.supportsTurnSteer);
      expect(capabilities.commands.discovery !== 'unsupported')
        .toBe(KIMICODE_PROVIDER_CAPABILITIES.supportsProviderCommands);
    });

    it('splits MCP ownership from the per-run selector the boolean conflates', () => {
      // `supportsMcpTools` gates the chat tab's per-run server selector and
      // nothing else. Grimoire still owns `.grimoire/mcp/kimicode.json` and
      // still injects those servers into the ACP session, so the single boolean
      // reads as "no MCP" for a provider that has Grimoire-owned MCP.
      expect(KIMICODE_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
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

    it('contributes history but no rewind', () => {
      expect(features().history).toBeDefined();
      expect(features().rewind).toBeUndefined();
    });
  });

  describe('settings codec', () => {

    it('never writes discovery state into the settings file', () => {
      // The persisted interface excludes these two, and encoding them would
      // make a cached CLI catalogue survive the process that produced it.
      const encoded = kimicodeSettingsCodec.encode({
        ...kimicodeSettingsCodec.defaults(),
        availableModes: [{ id: 'build', name: 'Build', description: 'Build mode' }],
        discoveredModels: [{ rawId: 'anthropic/claude-sonnet', label: 'Sonnet' }],
      });

      expect(encoded).not.toHaveProperty('availableModes');
      expect(encoded).not.toHaveProperty('discoveredModels');
    });

    it('rejects discovery state found in a stored settings record', () => {
      const decoded = kimicodeSettingsCodec.decode({
        ...kimicodeSettingsCodec.encode(kimicodeSettingsCodec.defaults()),
        discoveredModels: [{ rawId: 'stale/model', label: 'Stale' }],
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('discovery state must not be stored in settings');
      expect(decoded.ok ? [] : decoded.fallback.discoveredModels).toEqual([]);
    });

  });

  describe('model presentation', () => {
    it('owns a model by the prefix, which is what the live config does', () => {
      // This asserted the opposite until Gemini's module was checked against
      // its own chat UI config and three siblings turned out to carry the same
      // claim. A provider-qualified raw id does not make ownership a settings
      // question: the chat never sees a raw id, it sees `kimicode:<raw id>`, so a
      // lookup in a list keyed by raw ids answers false for every model.
      // The app record, which is what these members take. Seven of the nine
      // module tests still fed the provider's own decoded settings after the
      // contract changed, and passed only because these providers' ownership is
      // prefix-based and ignores the argument — so the day one of them consults
      // `visibleModels`, the assertion would have kept passing against an
      // unreachable branch.
      const settings = {
        providerConfigs: {
          kimicode: {
            ...kimicodeSettingsCodec.encode(kimicodeSettingsCodec.defaults()),
                visibleModels: ['anthropic/claude-sonnet'],
                modelAliases: { 'openai/gpt-5.5': 'Fast' },
          },
        },
      };
      const presentation = kimicodeProviderModule.declarations.chatUI.models;

      expect(presentation.ownsModel('kimicode:anthropic/claude-sonnet', settings)).toBe(true);
      // The synthetic id a vault with no catalogue yet still selects.
      expect(presentation.ownsModel('kimicode', settings)).toBe(true);
      expect(presentation.ownsModel('anthropic/claude-sonnet', settings)).toBe(false);
      // Another provider's, encoded the same way.
      expect(presentation.ownsModel('gemini:gemini-2.5-pro', settings)).toBe(false);
      // The label decodes first: the alias map is keyed by the raw id.
    });
  });
});
