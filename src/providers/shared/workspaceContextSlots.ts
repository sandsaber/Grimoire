import type { McpServerManager } from '../../core/mcp/McpServerManager';
import type {
  ProviderAgentMention,
  ProviderAgentMentionSource,
  ProviderCommandsPort,
  ProviderMcpPort,
  ProviderModelDescriptor,
  ProviderModelRefreshOptions,
  ProviderUsageSnapshot,
} from '../../core/providers/ProviderModule';
import type {
  AppMcpStorage,
  ProviderRuntimeCommandLoader,
} from '../../core/providers/types';
import type { ProviderId } from '../../core/types/provider';
import type GrimoirePlugin from '../../main';
import type {
  ProviderChatUIConfig,
  ProviderModelCatalog,
  ProviderPlanUsage,
  ProviderPlanUsageContext,
  ProviderPlanUsageProvider,
} from '../../providers/shared/providerHostContracts';

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
  /**
   * The registered command catalog, whole.
   *
   * Structurally the module's own `ProviderCommandsPort`, which is what it is
   * handed through as. It was narrowed to `listDropdownEntries` here while the
   * slot answered one question; the row's other six — the writes, the runtime
   * hand-off, the refresh — reached the feature layer through
   * the workspace registry instead, which is what kept the row registered.
   * (Spelled out rather than named: the deletion gate counts files that mention
   * either registry, and a comment about one is not a consumer of it.)
   */
  readonly commandCatalog?: ProviderCommandsPort | null;
  readonly mcpStorage?: AppMcpStorage | null;
  readonly mcpServerManager?: McpServerManager | null;
  readonly runtimeCommandLoader?: ProviderRuntimeCommandLoader | null;
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
  /**
   * The provider's command catalog, read afresh on every call.
   *
   * **A forwarder, not the object.** A workspace is built once and its slots
   * are cached for the life of the process, while workspace services are
   * registered separately and may arrive later — so a slot that captured the
   * catalog when the workspace happened to be built would be permanently empty
   * for any provider that registered after the first question. Every member
   * resolves the *current* registration, which keeps the identity that matters:
   * the tab manager's `setRuntimeCommands` and the settings hub's
   * `listVaultEntries` reach one catalog, whichever forwarder asked.
   */
  commandsPort(): ProviderCommandsPort;
  listModels(): Promise<readonly ProviderModelDescriptor[]>;
  /** The provider's MCP storage, read afresh on every call. See `commandsPort`. */
  mcpPort(): ProviderMcpPort;
  /**
   * Listing commands for a tab that may have no session, or `null` where the
   * provider has no such discovery. Read afresh, for the reason `commandsPort`
   * gives.
   */
  runtimeCommandLoader(): ProviderRuntimeCommandLoader | null;
  cachedPlanUsage(): ProviderUsageSnapshot | null;
  refreshPlanUsage(): Promise<ProviderUsageSnapshot | null>;
  refreshAgentMentions(): Promise<void>;
  refreshModels(
    options?: ProviderModelRefreshOptions,
  ): Promise<readonly ProviderModelDescriptor[]>;
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

    commandsPort: () => ({
      deleteVaultEntry: async entry => {
        await services()?.commandCatalog?.deleteVaultEntry(entry);
      },
      listDropdownEntries: async options => (
        await services()?.commandCatalog?.listDropdownEntries(options) ?? []
      ),
      listVaultEntries: async () => await services()?.commandCatalog?.listVaultEntries() ?? [],
      refresh: async () => {
        await services()?.commandCatalog?.refresh();
      },
      saveVaultEntry: async entry => {
        await services()?.commandCatalog?.saveVaultEntry(entry);
      },
      setRuntimeCommands: commands => {
        services()?.commandCatalog?.setRuntimeCommands(commands);
      },
      // Bridged rather than assumed: the row's own name for this was
      // `getDefaultVaultStoragePath`, and a forwarder calling the port's name
      // on the registered catalog would have answered `null` for every
      // provider — a member that can never answer, which is the failure this
      // contract's own rules forbid. The row is renamed to match.
      defaultVaultStoragePath: () => (
        services()?.commandCatalog?.defaultVaultStoragePath?.() ?? null
      ),
    }),

    listModels: async () => models(),

    runtimeCommandLoader: () => services()?.runtimeCommandLoader ?? null,

    mcpPort: () => ({
      // Read through `services()` on every call, like every other slot here: a
      // workspace rebuilt behind a tab is the one the tab's widgets then ask.
      servers: () => services()?.mcpServerManager?.getServers() ?? [],
      contextSavingServers: () => services()?.mcpServerManager?.getContextSavingServers() ?? [],
      load: async () => await services()?.mcpStorage?.load() ?? [],
      save: async servers => {
        await services()?.mcpStorage?.save([...servers]);
      },
    }),

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

    refreshModels: async (options) => {
      await services()?.modelCatalog?.refreshModels({
        ...(options?.force ? { force: true } : {}),
        plugin,
        settings: plugin.settings,
      });
      return models();
    },
  };
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
