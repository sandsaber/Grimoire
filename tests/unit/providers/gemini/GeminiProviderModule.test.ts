import trace from '@test/fixtures/provider-traces/gemini-execution.json';
import {
  GEMINI_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import { createGeminiModuleContext } from '@/providers/gemini/app/GeminiModuleContext';
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
      commandsPort: () => ({
        listDropdownEntries: async () => [],
        listVaultEntries: async () => [],
        saveVaultEntry: async () => undefined,
        deleteVaultEntry: async () => undefined,
        setRuntimeCommands: () => undefined,
        refresh: async () => 'refreshed' as const,
      }),
      listAgentMentions: async () => [{ id: 'planner', label: 'Planner' , source: 'vault' as const }],
      refreshAgentMentions: async () => undefined,
      listModels: async () => [{ id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }],
      refreshModels: async () => [{ id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }],
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

  function features(): ReturnType<typeof geminiProviderModule.runtimePorts> {
    return geminiProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof geminiProviderModule.workspace.initialize> {
    return geminiProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering', () => {
    expect(geminiProviderModule.manifest).toEqual({
      id: 'gemini',
      // Google replaced this CLI with Antigravity; the adapter is current.
      displayName: 'Gemini CLI (Legacy)',
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
      // The provider that made the descriptor grow a third command field. The
      // recording captures an `available_commands_update` carrying twenty
      // session commands and no surface asks for one, while
      // `.gemini/commands/**/*.toml` is a static vault catalogue that does
      // reach the input. Two answers, so two fields — one boolean could only
      // have been wrong about one of them.
      expect(GEMINI_PROVIDER_CAPABILITIES.supportsProviderCommands).toBe(false);
      expect(capabilities.commands).toEqual({
        discovery: 'static',
        chatSurface: 'grimoire',
        sessionCommands: 'unsupported',
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
      expect(geminiProviderModule.capabilities.reasoningControl).toEqual({ kind: 'none' });
    });
  });

  describe('workspace slots', () => {
    it('fills every slot the provider registers, and not the one it has no source for', async () => {
      const workspace = await workspaceSlots();

      // `runtimeCommands` is absent on purpose: it is answered from the open
      // session's announced commands, and this provider drops those.
      expect(Object.keys(workspace).sort()).toEqual([
        'agentMentions',
        'commands',
        'mcp',
        'models',
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

    it('saves the session id, and says nothing about a conversation it does not serve', () => {
      // Every sibling on this transport also saves where its session lives — a
      // database path, a managed home. Gemini writes no such state, so the id is
      // the whole binding. `readSessionDropped` answering `null` is a runtime
      // that is not on this conversation, and a patch carrying `providerState`
      // there would clear a marker it knows nothing about.
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

    it('writes the drop marker whole, both when it is set and when it is not', () => {
      // The surface replaces `providerState` rather than merging it: a resume
      // that worked has to write the empty object, or the marker an earlier
      // drop left standing would never come down.
      const dropped = geminiProviderModule.runtimePorts({
        ...createContext(),
        readSessionDropped: () => true,
      });
      expect(dropped.history?.buildSessionPatch({
        conversationId: 'conversation-1',
        sessionInvalidated: false,
        nativeSessionRef: 'acp-session',
      })).toEqual({ sessionId: 'acp-session', providerState: { sessionDropped: true } });

      const resumed = geminiProviderModule.runtimePorts({
        ...createContext(),
        readSessionDropped: () => false,
      });
      expect(resumed.history?.buildSessionPatch({
        conversationId: 'conversation-1',
        sessionInvalidated: false,
        nativeSessionRef: 'acp-session',
      })).toEqual({ sessionId: 'acp-session', providerState: {} });
    });
  });

  describe('settings codec', () => {

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

  });

  describe('model presentation', () => {
    it('owns a model by the prefix, which is what the live config does', () => {
      // Not the OpenCode family's rule, and copying theirs here was wrong in a
      // way nothing would have caught until M3: a chat model id is encoded and
      // the settings hold the CLI's raw one, so a list lookup on the encoded id
      // answers false for every model this provider has.
      // The app record, which is what these members take. Seven of the nine
      // module tests still fed the provider's own decoded settings after the
      // contract changed, and passed only because these providers' ownership is
      // prefix-based and ignores the argument — so the day one of them consults
      // `visibleModels`, the assertion would have kept passing against an
      // unreachable branch.
      const settings = {
        providerConfigs: {
          gemini: {
            ...geminiSettingsCodec.encode(geminiSettingsCodec.defaults()),
                visibleModels: ['gemini-2.5-pro'],
                modelAliases: { 'gemini-3.5-flash': 'Fast' },
          },
        },
      };
      const presentation = geminiProviderModule.declarations.chatUI.models;

      expect(presentation.ownsModel('gemini:gemini-2.5-pro', settings)).toBe(true);
      // The synthetic id a vault with no catalogue yet still selects.
      expect(presentation.ownsModel('gemini', settings)).toBe(true);
      // Another provider's, encoded the same way — this is what the prefix is
      // there to tell apart.
      expect(presentation.ownsModel('qwen:qwen3-coder', settings)).toBe(false);
      expect(presentation.ownsModel('gemini-2.5-pro', settings)).toBe(false);
    });

  });

  describe('module context', () => {
    const conversation = {
      id: 'conversation-1',
      sessionId: 'acp-session',
      providerId: 'gemini' as const,
    };

    it('answers only about the conversation its own tab is bound to', () => {
      const context = createGeminiModuleContext(testPlugin(), () => conversation,
        { sessionDropped: () => true });

      expect(context.resolveSessionId('conversation-1')).toBe('acp-session');
      expect(context.readSessionDropped('conversation-1')).toBe(true);
      // `null`, not `false`: the caller writes `providerState` whole, so "not
      // this tab's conversation" has to be distinguishable from "not dropped".
      expect(context.readSessionDropped('conversation-2')).toBeNull();
      // Another tab's conversation is not this runtime's to answer for: a
      // lookup across the workspace would report a session this tab is not on.
      expect(context.resolveSessionId('conversation-2')).toBeNull();
      expect(context.isPendingFork('conversation-2')).toBe(false);
    });

    it('reports that there is nothing to hydrate rather than that it hydrated', async () => {
      const context = createGeminiModuleContext(testPlugin(), () => conversation,
        { sessionDropped: () => false });

      // `supportsNativeHistory: false`. Answering `complete` would tell the
      // surface a transcript was read back when none exists.
      await expect(context.hydrateConversation('conversation-1'))
        .resolves.toEqual({ outcome: 'absent' });
    });

    it('answers a workspace slot with nothing when no workspace is registered', async () => {
      const context = createGeminiModuleContext(testPlugin(), () => null,
        { sessionDropped: () => false });

      // These threw by name until the context was wired. An unregistered
      // workspace is a provider with nothing to offer, not one that fails: the
      // settings surface renders empty rather than raising where nobody catches
      // it, and the slot that still refuses does so because its row has not
      // been reshaped yet.
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
