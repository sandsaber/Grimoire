import trace from '@test/fixtures/provider-traces/qwen-execution.json';
import wire from '@test/fixtures/provider-traces/wire/qwen-wire.json';
import {
  QWEN_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import { createQwenModuleContext } from '@/providers/qwen/app/QwenModuleContext';
import {
  qwenProviderModule,
  qwenSettingsCodec,
  type QwenWorkspaceContext,
} from '@/providers/qwen/QwenProviderModule';

/**
 * The ninth module, for the last provider on the legacy path.
 *
 * Derived from Gemini's, which was measured rather than assumed: both CLIs take
 * `--acp` as a flag, both configure a session through dedicated methods, and
 * both name their modes the same way. What this pins is the four places Qwen is
 * **more** than Gemini — an effort applied as a prompt, the session's own
 * commands, ask-user-question, and a workspace slot Gemini leaves out.
 */
describe('Qwen provider module', () => {
  function createContext(): QwenWorkspaceContext {
    return {
      listCommands: async () => [{ name: 'init', source: 'project' as const }],
      listSessionCommands: async () => [{ name: 'clear', source: 'session' as const }],
      listAgentMentions: async () => [{ id: 'planner', label: 'Planner' }],
      refreshAgentMentions: async () => undefined,
      resolveCliPath: async () => '/usr/local/bin/qwen',
      listModels: async () => [{ id: 'qwen3-coder-plus', label: 'qwen3-coder-plus' }],
      refreshModels: async () => [{ id: 'qwen3-coder-plus', label: 'qwen3-coder-plus' }],
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

  function features(): ReturnType<typeof qwenProviderModule.runtimePorts> {
    return qwenProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof qwenProviderModule.workspace.initialize> {
    return qwenProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering', () => {
    expect(qwenProviderModule.manifest).toEqual({
      id: 'qwen',
      displayName: 'Qwen Code',
      order: 90,
    });
  });

  it('agrees with the trace fixture it was proven against', () => {
    expect(qwenProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(qwenProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(qwenProviderModule.capabilities.session.resume).toBe(trace.resume);
  });

  it('says what its recording could not observe rather than implying it did', () => {
    // The handshake and a refusal are the whole of it: `qwen 0.21.15` answered
    // `session/new` with "Authentication required". Everything below about
    // models, modes and answers stands on `QwenChatRuntime` instead.
    expect(wire.coverage).toBe('partial');
    expect(wire.cases).toEqual(['initialize', 'session/new']);
    expect(wire.sessionUpdatesObserved).toEqual([]);
  });

  describe('capabilities', () => {
    const capabilities = qwenProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(QWEN_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(QWEN_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(QWEN_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(QWEN_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(QWEN_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(QWEN_PROVIDER_CAPABILITIES.supportsTurnSteer);
      // The one Gemini's module has to state as a disagreement and this one does
      // not: Qwen surfaces the commands its session announces.
      expect(capabilities.commands.discovery !== 'unsupported')
        .toBe(QWEN_PROVIDER_CAPABILITIES.supportsProviderCommands);
    });

    it('resumes a session it cannot read a transcript out of', () => {
      // Gemini's pair, and for the same reason — with one thing more: the
      // recorded `initialize` carries `sessionCapabilities` with `list` and
      // `resume`, which Gemini's does not.
      expect(QWEN_PROVIDER_CAPABILITIES.supportsNativeHistory).toBe(false);
      expect(capabilities.session).toEqual({
        resume: 'native',
        transcriptHydration: 'unsupported',
      });
      expect(capabilities.history.ownership).toBe('grimoire-projection');
    });

    it('offers five reasoning levels, not the three its cousins do', () => {
      expect(qwenProviderModule.capabilities.reasoningControl).toEqual({
        kind: 'effort',
        tiers: ['low', 'medium', 'high', 'xhigh', 'max'],
      });
    });

    it('splits MCP ownership from the per-run selector the boolean conflates', () => {
      expect(QWEN_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
      expect(capabilities.mcp).toEqual({
        ownership: 'grimoire',
        sessionConfiguration: 'grimoire',
        perRunSelection: 'unsupported',
      });
    });
  });

  describe('workspace slots', () => {
    it('fills the session-command slot Gemini has no source for', async () => {
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
      expect(await workspace.runtimeCommands?.listForSession('acp-session'))
        .toEqual([{ name: 'clear', source: 'session' }]);
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
    it('round-trips defaults without reporting a change', () => {
      const defaults = qwenSettingsCodec.defaults();

      expect(qwenSettingsCodec.decode(qwenSettingsCodec.encode(defaults)).ok).toBe(true);
      expect(qwenSettingsCodec.reconcile(defaults, 'load').changed).toBe(false);
    });

    it('never writes discovery state into the settings file', () => {
      const encoded = qwenSettingsCodec.encode({
        ...qwenSettingsCodec.defaults(),
        availableModes: [{ id: 'plan', name: 'Plan' }],
        discoveredModels: [{ rawId: 'qwen3-coder-plus', label: 'qwen3-coder-plus' }],
      });

      expect(encoded).not.toHaveProperty('availableModes');
      expect(encoded).not.toHaveProperty('discoveredModels');
    });

    it('refuses an effort level this CLI does not have', () => {
      // Not merely normalized away: an unknown level reaches the agent as a
      // `/effort <level>` prompt, which is a whole turn spent on a command it
      // will not understand. Reported so the caller can drop it.
      const decoded = qwenSettingsCodec.decode({
        ...qwenSettingsCodec.encode(qwenSettingsCodec.defaults()),
        effortLevel: 'ludicrous',
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('effortLevel is not a level this provider offers');
      expect(decoded.ok ? '' : decoded.fallback.effortLevel).toBe('high');
    });

    it('invalidates sessions when the account answering would change', () => {
      // `OPENAI_API_KEY` is the only auth method the recorded handshake offers.
      const changed = qwenSettingsCodec.reconcile({
        ...qwenSettingsCodec.defaults(),
        environmentVariables: 'OPENAI_API_KEY=abc\n',
        environmentHash: '',
      }, 'environment-change');

      expect(changed.invalidatesSessions).toBe(true);
      expect(changed.settings.environmentHash).toBe('OPENAI_API_KEY=abc');
    });

    it('ignores a QWEN_ variable that decides nothing about the account', () => {
      const result = qwenSettingsCodec.reconcile({
        ...qwenSettingsCodec.defaults(),
        environmentVariables: 'QWEN_CODE_TELEMETRY=0\n',
        environmentHash: '',
      }, 'environment-change');

      expect(result.invalidatesSessions).toBe(false);
      expect(result.settings.environmentHash).toBe('');
    });
  });

  describe('model presentation', () => {
    it('owns a model by the prefix, which is what the live config does', () => {
      const settings = {
        ...qwenSettingsCodec.defaults(),
        visibleModels: ['qwen3-coder-plus'],
        modelAliases: { 'qwen3-max': 'Max' },
      };
      const presentation = qwenProviderModule.declarations.chatUI.modelPresentation;

      expect(presentation.ownsModel('qwen:qwen3-coder-plus', settings)).toBe(true);
      expect(presentation.ownsModel('qwen', settings)).toBe(true);
      expect(presentation.ownsModel('qwen3-coder-plus', settings)).toBe(false);
      expect(presentation.ownsModel('gemini:gemini-2.5-pro', settings)).toBe(false);
      // The label decodes first: the alias map is keyed by the raw id.
      expect(presentation.label('qwen:qwen3-max', settings)).toBe('Max');
    });
  });

  describe('module context', () => {
    const conversation = {
      id: 'conversation-1',
      sessionId: 'acp-session',
      providerId: 'qwen' as const,
    };

    it('answers only about the conversation its own tab is bound to', () => {
      const context = createQwenModuleContext(() => conversation, { sessionCommands: () => [] });

      expect(context.resolveSessionId('conversation-1')).toBe('acp-session');
      expect(context.resolveSessionId('conversation-2')).toBeNull();
      expect(context.isPendingFork('conversation-2')).toBe(false);
    });

    it('lists the commands the tab own session announced', async () => {
      // The port Gemini's context has no equivalent of: only the tab holding
      // the session knows what it said.
      const context = createQwenModuleContext(() => conversation, {
        sessionCommands: () => [{ name: 'clear', source: 'session' as const }],
      });

      await expect(context.listSessionCommands('acp-session'))
        .resolves.toEqual([{ name: 'clear', source: 'session' }]);
    });

    it('reports that there is nothing to hydrate rather than that it hydrated', async () => {
      const context = createQwenModuleContext(() => conversation, { sessionCommands: () => [] });

      await expect(context.hydrateConversation('conversation-1'))
        .resolves.toEqual({ outcome: 'absent' });
    });

    it('refuses a workspace slot it does not serve, by name', async () => {
      const context = createQwenModuleContext(() => null, { sessionCommands: () => [] });

      await expect(context.listModels()).rejects.toThrow(/listModels/);
      await expect(context.loadMcpServers()).rejects.toThrow(/legacy workspace registration/);
    });
  });
});
