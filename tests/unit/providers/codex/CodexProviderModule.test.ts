import {
  CODEX_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

import {
  codexProviderModule,
  codexSettingsCodec,
  type CodexWorkspaceContext,
} from '@/providers/codex/CodexProviderModule';

/**
 * The second module written against the M1 contract, and the wide one.
 *
 * Antigravity proved a provider at the floor of the contract could be expressed
 * without bare slots or invented support. Codex proves the opposite end: nearly
 * every workspace slot filled, native resume, native interactions, and three
 * auxiliary workflows. Both defects the contract has needed so far were found
 * by writing this module, not by reviewing the contract.
 */
describe('Codex provider module', () => {
  function createContext(): CodexWorkspaceContext {
    return {
      listSkills: async () => [{ name: 'review', source: 'project' as const }],
      listAgentMentions: async () => [{ id: 'planner', label: 'Planner' , source: 'vault' as const }],
      refreshAgentMentions: async () => undefined,
      resolveCliPath: async () => '/usr/local/bin/codex',
      listModels: async () => [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
      refreshModels: async () => [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
      cachedPlanUsage: () => ({ plan: 'Pro' }),
      refreshPlanUsage: async () => ({ plan: 'Pro' }),
      renderSettingsTab: () => undefined,
      hydrateConversation: async () => ({ outcome: 'complete' as const }),
      deleteConversationSession: async () => undefined,
      resolveSessionId: () => 'thread-1',
      isPendingFork: () => false,
      dispose: async () => undefined,
    };
  }

  function runtimePorts(): ReturnType<typeof codexProviderModule.runtimePorts> {
    return codexProviderModule.runtimePorts(createContext());
  }

  it('recognizes the tools Codex drives its own agents with', () => {
    // Read off the normalization adapter rather than through a module context,
    // which is what the M3 split made possible: a question about a tool name
    // needs no plugin.
    const nativeAgents = codexProviderModule.declarations.nativeAgents;

    expect(nativeAgents?.recognizesToolName('spawn_agent')).toBe(true);
    expect(nativeAgents?.recognizesToolName('wait')).toBe(true);
    expect(nativeAgents?.recognizesToolName('Bash')).toBe(false);
    // Codex names no agent in its tool payloads.
    expect(nativeAgents?.parseDisplay({ agent_id: 'sub-1' })).toBeNull();
  });

  it('answers about a conversation only through the context it was bound to', () => {
    // The split at M3 left exactly two ports behind the factory, and this is
    // why they are behind one: they answer for the runtime's own conversation
    // and nothing else.
    const ports = runtimePorts();

    expect(ports.history?.resolveSessionId('any')).toBe('thread-1');
    expect(ports.rewind).toBeUndefined();
  });

  it('declares its identity and ordering', () => {
    expect(codexProviderModule.manifest).toEqual({
      id: 'codex',
      displayName: 'Codex',
      order: 20,
    });
  });

  it('associates its execution backend with the provider', () => {
    expect(codexProviderModule.execution.descriptor.association).toEqual({
      kind: 'provider',
      providerId: 'codex',
    });
  });

  describe('capabilities agree with the record the application already ships', () => {
    const capabilities = codexProviderModule.capabilities;

    it('matches the live capability record where the two overlap', () => {
      // Two records describing one provider is one record too many; until the
      // flip retires the legacy one, they have to agree.
      expect(capabilities.session.resume === 'native')
        .toBe(CODEX_PROVIDER_CAPABILITIES.supportsPersistentRuntime);
      expect(capabilities.history.ownership === 'provider-native')
        .toBe(CODEX_PROVIDER_CAPABILITIES.supportsNativeHistory);
      expect(capabilities.interactions.planMode === 'native')
        .toBe(CODEX_PROVIDER_CAPABILITIES.supportsPlanMode);
      expect(capabilities.conversation.fork === 'native')
        .toBe(CODEX_PROVIDER_CAPABILITIES.supportsFork);
      expect(capabilities.conversation.rewind === 'native')
        .toBe(CODEX_PROVIDER_CAPABILITIES.supportsRewind);
      expect(capabilities.conversation.steering === 'native')
        .toBe(CODEX_PROVIDER_CAPABILITIES.supportsTurnSteer);
      expect(capabilities.mcp.sessionConfiguration === 'native')
        .toBe(CODEX_PROVIDER_CAPABILITIES.supportsMcpTools);
    });

    it('records the one place the two records disagree', () => {
      // Codex registers a command catalog through `CodexWorkspaceServices` and
      // can list skills through a short-lived app-server, but the live
      // capability record says `supportsProviderCommands: false`, so
      // `TabManager` never asks for that catalog. Both statements are about
      // different things — what the provider can do, and what the UI currently
      // requests — and the flip has to settle which one the module means.
      // Asserted rather than reconciled, so the divergence cannot be forgotten.
      expect(CODEX_PROVIDER_CAPABILITIES.supportsProviderCommands).toBe(false);
      expect(capabilities.commands.discovery).toBe('ephemeral-process');
    });

    it('declares the persistent daemon topology', () => {
      expect(capabilities.process).toEqual({
        topology: 'persistent-daemon',
        concurrency: 'multiplexed-sessions',
      });
    });

    it('does not let an aggregate observation imply agent control', () => {
      // The summary label is not what UI actions read. Codex can extract a
      // subagent result and cannot cancel, query, or reattach to one.
      expect(capabilities.agents.progressObservation).toBe('aggregate');
      expect(capabilities.agents.resultExtraction).toBe(true);
      expect(capabilities.agents.cancellation).toBe(false);
      expect(capabilities.agents.statusQuery).toBe(false);
      expect(capabilities.agents.reattachment).toBe(false);
    });
  });

  describe('honest absences', () => {
    it('contributes no Grimoire-owned MCP port, because Codex owns its own', async () => {
      expect((await workspaceSlots()).mcp).toBeUndefined();
      expect(codexProviderModule.capabilities.mcp).toEqual({
        ownership: 'native',
        sessionConfiguration: 'unsupported',
        perRunSelection: 'unsupported',
      });
    });

    it('omits the deliberately no-op task result interpreter', () => {
      // Present-but-empty is the one shape the contract forbids: the UI cannot
      // tell it apart from a working port.
      expect(codexProviderModule.declarations.taskResults).toBeUndefined();
    });

    it('omits runtime command discovery, which Codex does through a separate process', async () => {
      expect((await workspaceSlots()).runtimeCommands).toBeUndefined();
      expect(codexProviderModule.capabilities.commands.discovery).toBe('ephemeral-process');
    });
  });

  describe('workspace slots', () => {
    it('fills every slot the provider actually registers today', async () => {
      const workspace = await workspaceSlots();

      expect(Object.keys(workspace).sort()).toEqual([
        'agentMentions',
        'cliResolution',
        'commands',
        'models',
          'settingsPresentation',
        'usage',
      ]);
    });

    it('reports an unresolved CLI as unavailable rather than as an empty path', async () => {
      const context = createContext();
      const workspace = await codexProviderModule.workspace.initialize(
        { ...context, resolveCliPath: async () => null },
        new AbortController().signal,
      );

      expect(await workspace.cliResolution?.resolve()).toEqual({
        executable: null,
        source: 'unavailable',
      });
    });

    it('declares a dispose half for the initialize half', async () => {
      await expect(
        codexProviderModule.workspace.dispose(await workspaceSlots()),
      ).resolves.toBeUndefined();
    });
  });

  describe('settings codec', () => {
    it('round-trips defaults without reporting a change', () => {
      const defaults = codexSettingsCodec.defaults();
      const decoded = codexSettingsCodec.decode(codexSettingsCodec.encode(defaults));

      expect(decoded.ok).toBe(true);
      expect(codexSettingsCodec.reconcile(defaults, 'load').changed).toBe(false);
    });

    it('carries unknown keys through so a newer settings file survives', () => {
      const decoded = codexSettingsCodec.decode({
        ...codexSettingsCodec.encode(codexSettingsCodec.defaults()),
        futureCodexOption: { retained: true },
      });

      expect(decoded.preservedUnknown).toEqual({ futureCodexOption: { retained: true } });
      expect(codexSettingsCodec.encode(
        decoded.ok ? decoded.value : decoded.fallback,
        decoded.preservedUnknown,
      )).toMatchObject({ futureCodexOption: { retained: true } });
    });

    it('reports invalid values as issues and still returns usable settings', () => {
      const decoded = codexSettingsCodec.decode({
        enabled: 'yes',
        reasoningSummary: 'verbose',
        installationMethod: 'homebrew',
        cliPathsByHost: { host: 7 },
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok ? [] : decoded.issues).toEqual([
        'enabled has an invalid type',
        'cliPathsByHost contains an invalid path',
        'installationMethod is not a known installation method',
        'reasoningSummary is not a known summary mode',
      ]);
      expect(decoded.ok ? null : decoded.fallback.reasoningSummary).toBe('detailed');
    });

    it('names the settings fields that invalidate a session, not an environment pattern', () => {
      // The live registration matches /^OPENAI_/ and /^CODEX_/ against the whole
      // environment, which lets an unrelated variable invalidate a session with
      // nothing to show the user.
      expect(codexSettingsCodec.runtimeInputKeys).toContain('environmentVariables');
      expect(codexSettingsCodec.runtimeInputKeys).toContain('installationMethod');
      expect(codexSettingsCodec.runtimeInputKeys.every(key => key in codexSettingsCodec.defaults()))
        .toBe(true);
    });

    it('invalidates sessions when the environment the daemon reads has changed', () => {
      const defaults = codexSettingsCodec.defaults();

      // Nothing set, nothing saved: no session can have gone stale.
      expect(codexSettingsCodec.reconcile(defaults, 'load').invalidatesSessions).toBe(false);

      const changed = codexSettingsCodec.reconcile({
        ...defaults,
        environmentVariables: 'OPENAI_BASE_URL=https://example.test\n',
        environmentHash: '',
      }, 'environment-change');
      expect(changed.invalidatesSessions).toBe(true);
      expect(changed.settings.environmentHash).toBe('OPENAI_BASE_URL=https://example.test');

      // Already reconciled: the same environment must not invalidate twice.
      expect(codexSettingsCodec.reconcile(changed.settings, 'load').invalidatesSessions)
        .toBe(false);
    });

    it('ignores an environment variable the daemon never reads', () => {
      // The registration's `/^OPENAI_/` pattern would invalidate every session
      // on this change; the three keys that decide a thread's usability do not.
      const result = codexSettingsCodec.reconcile({
        ...codexSettingsCodec.defaults(),
        environmentVariables: 'OPENAI_LOG_LEVEL=debug\n',
      }, 'environment-change');

      expect(result.invalidatesSessions).toBe(false);
    });

    it('toggles enablement without touching the rest of the settings', () => {
      const defaults = codexSettingsCodec.defaults();
      const disabled = codexSettingsCodec.withEnabled(defaults, false);

      expect(codexSettingsCodec.isEnabled(disabled)).toBe(false);
      expect({ ...disabled, enabled: true }).toEqual(defaults);
    });
  });

  describe('model presentation', () => {
    /**
     * The app settings record, which is what these members take.
     *
     * The contribution used to take Codex's own decoded settings and answer
     * from a hand-written presentation. It delegates to the config the chat
     * surface already asks now, and that config scopes the app record itself —
     * because what it reads is not only Codex's config: an environment model is
     * owned too, and the environment is the shared scope joined with Codex's.
     */
    function appSettings(config: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        providerConfigs: {
          codex: { ...codexSettingsCodec.encode(codexSettingsCodec.defaults()), ...config },
        },
      };
    }

    it('owns a model the user configured, which a settings-blind port would disown', () => {
      const settings = appSettings({ customModels: 'internal-review-model\nsecond-model' });
      const presentation = codexProviderModule.declarations.chatUI.models;

      expect(presentation.ownsModel('internal-review-model', settings)).toBe(true);
      expect(presentation.ownsModel('gpt-5.5', settings)).toBe(true);
      expect(presentation.ownsModel('claude-opus-5', settings)).toBe(false);
    });

    it('reports one width for every model, which is what Codex actually does', () => {
      const settings = appSettings();
      const presentation = codexProviderModule.declarations.chatUI.models;

      // **This assertion used to say `undefined` for a model Codex does not
      // own**, and it was asserting the module's own hand-written presentation
      // rather than the product: `codexChatUIConfig.getContextWindowSize()`
      // takes no model and answers a constant. Two implementations of one
      // question, disagreeing, with a test pinning the one nothing rendered.
      expect(presentation.contextWindow('gpt-5.5', settings)).toBe(200_000);
      expect(presentation.contextWindow('claude-opus-5', settings)).toBe(200_000);
    });
  });

  function workspaceSlots(): ReturnType<typeof codexProviderModule.workspace.initialize> {
    return codexProviderModule.workspace.initialize(
      createContext(),
      new AbortController().signal,
    );
  }
});
