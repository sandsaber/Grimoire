import trace from '@test/fixtures/provider-traces/claude-execution.json';
import {
  CLAUDE_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import {
  claudeProviderModule,
  claudeSettingsCodec,
  type ClaudeWorkspaceContext,
} from '@/providers/claude/ClaudeProviderModule';

/**
 * The third module, and the only one that fills every remaining slot.
 *
 * Claude is where the contract's last two gaps surfaced: a transcript rewind
 * with no port to land on, and feature ports that needed the workspace context
 * a static object could not give them. Both are fixed, so this suite asserts
 * the slots exist and carry real behavior rather than that they are declared.
 */
describe('Claude provider module', () => {
  function createContext(): ClaudeWorkspaceContext {
    return {
      listCommands: async () => [{ name: 'review', source: 'project' as const }],
      listSessionCommands: async () => [{ name: 'compact', source: 'session' as const }],
      listAgentMentions: async () => [{ id: 'planner', label: 'Planner' , source: 'vault' as const }],
      refreshAgentMentions: async () => undefined,
      resolveCliPath: async () => '/usr/local/bin/claude',
      listModels: async () => [{ id: 'opus', label: 'Opus 5' }],
      refreshModels: async () => [{ id: 'opus', label: 'Opus 5' }],
      cachedPlanUsage: () => ({ plan: 'Max', windows: [{ label: '5h', pct: 50, reset: '2h' }] }),
      refreshPlanUsage: async () => ({ plan: 'Max', windows: [{ label: '5h', pct: 50, reset: '2h' }] }),
      loadMcpServers: async () => [{ id: 'vault', label: 'Vault', enabled: true }],
      saveMcpServers: async () => undefined,
      renderSettingsTab: () => undefined,
      hydrateConversation: async () => ({ outcome: 'complete' as const }),
      deleteConversationSession: async () => undefined,
      resolveSessionId: () => 'claude-session',
      isPendingFork: () => false,
      rewind: async () => ({ outcome: 'rewound' as const, filesChanged: ['note.md'] }),
      dispose: async () => undefined,
    };
  }

  function features(): ReturnType<typeof claudeProviderModule.runtimePorts> {
    return claudeProviderModule.runtimePorts(createContext());
  }

  function workspaceSlots(): ReturnType<typeof claudeProviderModule.workspace.initialize> {
    return claudeProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }

  it('declares its identity and ordering', () => {
    expect(claudeProviderModule.manifest).toEqual({
      id: 'claude',
      displayName: 'Claude',
      order: 10,
    });
  });

  it('agrees with the trace fixture it was proven against', () => {
    expect(claudeProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(claudeProviderModule.capabilities.process).toEqual({
      topology: trace.topology,
      concurrency: trace.concurrency,
    });
    expect(claudeProviderModule.capabilities.session.resume).toBe(trace.resume);
    expect(claudeProviderModule.capabilities.agents.progressObservation)
      .toBe(trace.agentObservation);
  });

  describe('capabilities', () => {
    const capabilities = claudeProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      expect(capabilities.session.resume === 'native')
        .toBe(CLAUDE_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(CLAUDE_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(CLAUDE_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(CLAUDE_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(CLAUDE_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(CLAUDE_PROVIDER_CAPABILITIES.supportsTurnSteer);
      expect(capabilities.mcp.ownership === 'grimoire')
        .toBe(CLAUDE_PROVIDER_CAPABILITIES.supportsMcpTools);
      expect(capabilities.commands.discovery !== 'unsupported')
        .toBe(CLAUDE_PROVIDER_CAPABILITIES.supportsProviderCommands);
    });

    it('is the only provider so far that can stop a running subagent', () => {
      // Still three separate fields: being able to cancel does not imply being
      // able to ask for status or to reattach after a restart.
      expect(capabilities.agents.cancellation).toBe(true);
      expect(capabilities.agents.statusQuery).toBe(false);
      expect(capabilities.agents.reattachment).toBe(false);
    });

    it('declares the third distinct topology: persistent but serial', () => {
      expect(capabilities.process).toEqual({
        topology: 'persistent-sdk-stream',
        concurrency: 'serial-runs',
      });
    });
  });

  describe('the slots only Claude fills', () => {
    it('owns its MCP servers rather than reading a provider-native config', async () => {
      const mcp = (await workspaceSlots()).mcp;

      expect(await mcp?.loadServers()).toEqual([
        { id: 'vault', label: 'Vault', enabled: true },
      ]);
    });

    it('performs a rewind through a port, not only by declaring the capability', async () => {
      const outcome = await features().rewind?.rewind({
        executionSessionId: 'es-1',
        userMessageId: 'user-1',
        assistantMessageId: 'assistant-1',
        mode: 'code-and-conversation',
      });

      expect(outcome).toEqual({ outcome: 'rewound', filesChanged: ['note.md'] });
    });

    it('discovers commands both statically and from the live session', async () => {
      const workspace = await workspaceSlots();

      expect(await workspace.commands?.list()).toEqual([
        { name: 'review', source: 'project' },
      ]);
      expect(await workspace.runtimeCommands?.listForSession('claude-session')).toEqual([
        { name: 'compact', source: 'session' },
      ]);
    });

    it('interprets a subagent result only for the tools that launch one', () => {
      // Reads a real payload through the real interpreter, which is what the
      // M3 split made possible: this used to run against a stub the module
      // context supplied, so the assertion proved the stub rather than Claude.
      const taskResults = claudeProviderModule.declarations.taskResults;
      const payload = { agent_id: 'reviewer' };

      expect(taskResults?.interpret('Agent', payload)).toEqual({
        title: 'reviewer',
        isError: false,
      });
      expect(taskResults?.interpret('Task', payload)).not.toBeNull();
      // A payload naming no agent is still a task result, just an unnamed one.
      expect(taskResults?.interpret('Task', {})).toEqual({ title: 'Task', isError: false });
      expect(taskResults?.interpret('Read', payload)).toBeNull();
    });
  });

  describe('honest absences', () => {
    it('warms nothing before a turn, unlike Codex', async () => {
      // A declaration rather than a registered policy: every provider that had
      // one returned a constant and read none of the context it was given.
      expect(claudeProviderModule.declarations.warmup).toBe('none');
    });

    it('preloads no context files of its own', () => {
      expect(claudeProviderModule.declarations.context).toBeUndefined();
    });
  });

  describe('settings codec', () => {

    it('carries unknown keys through so a newer settings file survives', () => {
      const decoded = claudeSettingsCodec.decode({
        ...claudeSettingsCodec.encode(claudeSettingsCodec.defaults()),
        futureClaudeOption: { retained: true },
      });

      expect(decoded.preservedUnknown).toEqual({ futureClaudeOption: { retained: true } });
    });

    it('reports an invalid project settings snapshot instead of accepting it', () => {
      const decoded = claudeSettingsCodec.decode({
        projectSettingsSnapshot: { model: 'opus', hash: 7, env: {} },
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues)
        .toContain('projectSettingsSnapshot is not a valid snapshot');
    });

  });

  describe('model presentation', () => {
    it('uses the per-model context window Claude discovery reports', () => {
      // The app settings record, which is what these members take: the
      // contribution delegates to the config the chat surface already asks, and
      // that config scopes the record itself.
      const settings = {
        providerConfigs: {
          claude: {
            ...claudeSettingsCodec.encode(claudeSettingsCodec.defaults()),
            discoveredModels: [{
              id: 'claude-custom',
              displayName: 'Custom',
              maxInputTokens: 500_000,
            }],
          },
        },
      };
      const presentation = claudeProviderModule.declarations.chatUI.models;

      expect(presentation.ownsModel('claude-custom', settings)).toBe(true);
      expect(presentation.contextWindow('claude-custom', settings)).toBe(500_000);
      expect(presentation.ownsModel('gpt-5.5', settings)).toBe(false);
    });
  });
});
