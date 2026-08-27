import type {
  ProviderAgentMention,
  ProviderAgentMentionSource,
  ProviderCommandDescriptor,
  ProviderMcpServer,
  ProviderModelDescriptor,
  ProviderUsageSnapshot,
} from '../../core/providers/ProviderModule';
import type {
  AppMcpStorage,
  ProviderChatUIConfig,
  ProviderModelCatalog,
  ProviderPlanUsage,
  ProviderPlanUsageContext,
  ProviderPlanUsageProvider,
} from '../../core/providers/types';
import type { ManagedMcpServer } from '../../core/types/mcp';
import type { ProviderId } from '../../core/types/provider';
import type GrimoirePlugin from '../../main';

/**
 * The workspace half of a provider's module context, written once.
 *
 * Eight of the nine providers left these members `notWired(...)`, and the ninth
 * — Codex — wrote them. Wiring the other eight by copying Codex would have made
 * nine near-identical implementations of nine questions, which is the shape
 * this migration has spent three checkpoints deleting: the auxiliary services,
 * the task-result interpreters, the warmup policies. So this is the
 * implementation, and a provider supplies only what differs.
 *
 * What differs is small and real: whether the command dropdown offers the CLI's
 * built-ins, which chat-UI config knows the model list, and which services the
 * workspace registered. Everything else is the same question asked nine times.
 */

/**
 * The services a workspace registration may hold, as this needs them.
 *
 * Structural rather than each provider's own `XWorkspaceServices`: the nine
 * interfaces differ in members this does not read, and naming any one of them
 * here would make the shared code provider-specific again. Every member is
 * optional because a provider may genuinely not have it — Qwen and Gemini
 * register no agent-mention provider, and answering `[]` is what "this provider
 * has none" looks like to a mention dropdown.
 */
export interface WorkspaceContextServices {
  readonly agentMentionProvider?: {
    searchAgents(query: string): ReadonlyArray<{
      id: string;
      name: string;
      description?: string;
      source: ProviderAgentMentionSource;
    }>;
  } | null;
  readonly commandCatalog?: {
    listDropdownEntries(context: { includeBuiltIns: boolean }): Promise<ReadonlyArray<{
      name: string;
      description?: string;
      /** Where the entry came from. See `commandSource` for why not `source`. */
      scope?: string;
    }>>;
  } | null;
  readonly mcpStorage?: AppMcpStorage | null;
  readonly modelCatalog?: ProviderModelCatalog | null;
  readonly refreshAgentMentions?: () => Promise<void>;
  readonly usageProvider?: ProviderPlanUsageProvider | null;
}

export interface WorkspaceContextSlotOptions {
  readonly chatUI: Pick<ProviderChatUIConfig, 'getModelOptions'>;
  readonly plugin: GrimoirePlugin;
  readonly providerId: ProviderId;
  /** Read when a slot is called, never captured: a workspace can be registered later. */
  readonly services: () => WorkspaceContextServices | null;
}

export interface WorkspaceContextSlots {
  listAgentMentions(): Promise<readonly ProviderAgentMention[]>;
  listCommands(): Promise<readonly ProviderCommandDescriptor[]>;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  loadMcpServers(): Promise<readonly ProviderMcpServer[]>;
  cachedPlanUsage(): ProviderUsageSnapshot | null;
  refreshPlanUsage(): Promise<ProviderUsageSnapshot | null>;
  refreshAgentMentions(): Promise<void>;
  refreshModels(): Promise<readonly ProviderModelDescriptor[]>;
  resolveCliPath(): Promise<string | null>;
  saveMcpServers(servers: readonly ProviderMcpServer[]): Promise<void>;
}

export function createWorkspaceContextSlots(
  options: WorkspaceContextSlotOptions,
): WorkspaceContextSlots {
  const { chatUI, plugin, providerId, services } = options;

  const usageContext = (): ProviderPlanUsageContext => ({
    plugin,
    providerId,
    settings: plugin.settings,
  });

  /**
   * The usage provider, when this provider is one the user has switched on.
   *
   * Asked per read rather than once when the port was built: enablement changes
   * while a workspace stays initialized, and a provider switched off would
   * otherwise keep reporting the plan it had. All nine `isAvailable`
   * implementations answer exactly that question, which is why the module's
   * port does not have one.
   */
  const availableUsageProvider = (): ProviderPlanUsageProvider | null => {
    const provider = services()?.usageProvider;
    const settings = plugin.settings as unknown as Record<string, unknown>;
    return provider && provider.isAvailable?.(settings) !== false ? provider : null;
  };

  const models = (): readonly ProviderModelDescriptor[] => {
    // Nothing without a workspace: an unregistered workspace has discovered no
    // models, and listing the built-ins would offer a model the user has had no
    // chance to configure.
    if (!services()) {
      return [];
    }
    return chatUI.getModelOptions(plugin.settings as unknown as Record<string, unknown>)
      .map(option => ({ id: option.value, label: option.label }));
  };

  return {
    listAgentMentions: async () => {
      // An empty query is how the mention UI asks a provider for everything it
      // knows; what matching means is the provider's.
      const found = services()?.agentMentionProvider?.searchAgents('') ?? [];
      return found.map(agent => ({
        id: agent.id,
        label: agent.name,
        source: agent.source,
        ...(agent.description ? { description: agent.description } : {}),
      }));
    },

    listCommands: async () => {
      // `false`, like every caller in the product: `TabManager`, `tabSettings`,
      // `InlineEditModal` and the settings tab all ask for the dropdown without
      // built-ins, and this slot reports the list the dropdown shows. Only one
      // of the nine catalogs reads the flag at all — Codex's, which would
      // prepend its compact command — and Codex asks for `false` too. It was
      // briefly `true` for seven providers here: inert, because their catalogs
      // ignore it, and a statement about the product that was not true.
      const entries = await services()?.commandCatalog
        ?.listDropdownEntries({ includeBuiltIns: false }) ?? [];
      return entries.map((entry): ProviderCommandDescriptor => ({
        name: entry.name,
        ...(entry.description ? { description: entry.description } : {}),
        source: commandSource(entry.scope),
      }));
    },

    listModels: async () => models(),

    loadMcpServers: async () => {
      const stored = await services()?.mcpStorage?.load() ?? [];
      return stored.map(server => ({
        id: server.name,
        label: server.name,
        enabled: server.enabled,
      }));
    },

    cachedPlanUsage: () => {
      const provider = availableUsageProvider();
      return provider
        ? toSnapshot(provider.getCachedUsage(usageContext()))
        : null;
    },

    refreshPlanUsage: async () => {
      const provider = availableUsageProvider();
      return provider
        ? toSnapshot(await provider.refreshUsage(usageContext()))
        : null;
    },

    refreshAgentMentions: async () => {
      await services()?.refreshAgentMentions?.();
    },

    refreshModels: async () => {
      await services()?.modelCatalog?.refreshModels({
        plugin,
        settings: plugin.settings,
      });
      return models();
    },

    resolveCliPath: async () => plugin.getResolvedProviderCliPath(providerId),

    saveMcpServers: async servers => {
      const storage = services()?.mcpStorage;
      if (!storage) {
        return;
      }
      // The port carries identity and enablement; a server's command, its
      // transport, its context-saving mode and its disabled tools are the
      // stored record's. Rebuilding the record from three fields would erase
      // all of it on the first toggle of a checkbox, and a caller that saves a
      // subset has not deleted the rest.
      const stored: ManagedMcpServer[] = await storage.load();
      const enabled = new Map(servers.map(server => [server.id, server.enabled]));
      await storage.save(stored.map(server => (
        enabled.has(server.name)
          ? { ...server, enabled: enabled.get(server.name) as boolean }
          : server
      )));
    },
  };
}

/**
 * Where a command came from, in the slot's vocabulary.
 *
 * Read from the entry's `scope`, not its `source`. `source` is
 * `'builtin' | 'user' | 'plugin' | 'sdk'` — a *provenance* — while the slot asks
 * where the user would go to change it, which is what `scope` answers. The
 * first version of this mapped `source`, sent everything that was not
 * `'builtin'` to `'project'`, and collapsed two of the slot's four values: a
 * command the user wrote in their own directory and one the live session
 * announced both came back as a project command. Codex's hand-written version
 * had the same shape with `'project'` hard-coded.
 */
function commandSource(scope: string | undefined): ProviderCommandDescriptor['source'] {
  switch (scope) {
    case 'builtin':
    case 'system':
      return 'built-in';
    case 'user':
      return 'user';
    case 'runtime':
      return 'session';
    default:
      return 'project';
  }
}

/**
 * A provider's plan record, as the module's slot describes it.
 *
 * Every field carried, deliberately. The slot was one flattened window until
 * this checkpoint — `{ label, usedFraction?, resetsAt? }` — and the providers
 * that have quotas report several at once, while plans billed by amount report
 * `spend` and no window at all.
 */
function toSnapshot(usage: ProviderPlanUsage | null): ProviderUsageSnapshot | null {
  if (!usage) {
    return null;
  }
  return {
    plan: usage.plan,
    ...(usage.windows?.length
      ? {
        windows: usage.windows.map(window => ({
          label: window.label,
          pct: window.pct,
          ...(window.pctKnown === false ? { pctKnown: false } : {}),
          reset: window.reset,
        })),
      }
      : {}),
    ...(usage.spend ? { spend: usage.spend } : {}),
    ...(usage.note ? { note: usage.note } : {}),
    ...(usage.updatedAt !== undefined ? { updatedAt: usage.updatedAt } : {}),
  };
}
