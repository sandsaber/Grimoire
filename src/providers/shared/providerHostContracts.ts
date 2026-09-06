import type { SharedAppStorage } from '../../core/bootstrap/storage';
import type { McpServerManager } from '../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCatalogRefreshOutcome } from '../../core/providers/ProviderModelCatalogRefreshCache';
import type {
  AgentMentionProvider,
  AppMcpStorage,
  ProviderIconSvg,
  ProviderModeSelectorConfig,
  ProviderPermissionModeToggleConfig,
  ProviderPlanUsageWindow,
  ProviderReasoningOption,
  ProviderRuntimeCommandLoader,
  ProviderServiceTierToggleConfig,
  ProviderUIOption,
  ProviderWorkspaceResourceKind,
} from '../../core/providers/types';
import type { HomeFileAdapter } from '../../core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import type { ProviderId } from '../../core/types/provider';
import type GrimoirePlugin from '../../main';

/**
 * The provider contracts that need the plugin type.
 *
 * **They are here because of a rule, not a preference.** `src/core/` is
 * provider-neutral, and a contract that names `GrimoirePlugin` is not — it is a
 * provider-facing shape that happens to be shared, which is exactly what
 * `src/providers/shared/` is for. They sat in `src/core/providers/types.ts`
 * because the registry that held them did, and that registry is deleted.
 *
 * What each of them wants a plugin *for* is worth knowing before adding a
 * twelfth: settings, the active environment variables, the vault adapter, and
 * the debug log. A contract that wants none of those does not belong here.
 */
export interface ProviderPlanUsage {
  plan: string;
  windows?: ProviderPlanUsageWindow[];
  spend?: string;
  note?: string;
  /** Unix epoch milliseconds for the last successfully received usage snapshot. */
  updatedAt?: number;
}

/** Static UI configuration owned by the provider (model list, reasoning, context window). */
export interface ProviderChatUIConfig {
  /** Model options for the selector dropdown. Provider extracts what it needs from the settings bag. */
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[];

  /** Whether this provider owns the given model id. */
  ownsModel(model: string, settings: Record<string, unknown>): boolean;

  /** Whether the model uses adaptive reasoning (effort levels vs token budgets). */
  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean;

  /** Reasoning options for the current model (effort levels if adaptive, budgets otherwise). */
  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[];

  /** Default reasoning value for the model. */
  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string;

  /** Context window size in tokens. */
  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
    settings?: Record<string, unknown>,
  ): number;

  /**
   * The model the app ships selected, when this provider is the default one.
   *
   * **Optional, and absent for eight of the nine — truthfully.** It is not "the
   * provider's favourite model": `isDefaultModel` is already set membership over
   * everything a provider ships, and the picker resolves what a provider offers
   * from its own options. This answers a narrower question that only
   * `DEFAULT_CHAT_PROVIDER_ID` is ever asked — what `GrimoireSettings.model`
   * holds in a vault nobody has opened yet — and it exists because
   * `src/app/settings` was answering it by importing a Codex constant directly.
   */
  readonly primaryModel?: string;

  /** Whether this is a built-in (default) model vs custom/env model. */
  isDefaultModel(model: string): boolean;

  /** Apply model change side effects to settings (defaults, tracking). */
  applyModelDefaults(model: string, settings: unknown): void;

  /** Optional provider hook to discover model-scoped metadata after a model is selected. */
  prepareModelMetadata?(
    model: string,
    settings: Record<string, unknown>,
    context: { plugin: GrimoirePlugin },
  ): Promise<void>;

  /** Optional hook when the toolbar changes a reasoning selection. */
  applyReasoningSelection?(model: string, value: string, settings: unknown): void;

  /** Normalize model variant based on visibility flags. Provider extracts what it needs from the settings bag. */
  normalizeModelVariant(model: string, settings: Record<string, unknown>): string;

  /** Extract custom model IDs from parsed environment variables. Used for per-model context limit UI. */
  getCustomModelIds(envVars: Record<string, string>): Set<string>;

  /** Optional permission-mode toggle descriptor. Return null when the provider exposes no permission toggle UI. */
  getPermissionModeToggle?(): ProviderPermissionModeToggleConfig | null;

  /** Optional provider-owned mapping back into the shared permission-mode contract. */
  resolvePermissionMode?(settings: Record<string, unknown>): string | null;

  /** Optional hook when the toolbar changes permission mode. */
  applyPermissionMode?(value: string, settings: unknown): void;

  /** Optional service-tier toggle descriptor. Return null when the provider exposes no fast/standard UI. */
  getServiceTierToggle?(settings: Record<string, unknown>): ProviderServiceTierToggleConfig | null;

  /** Optional provider-owned mode selector descriptor. */
  getModeSelector?(settings: Record<string, unknown>): ProviderModeSelectorConfig | null;

  /** Optional hook when the toolbar changes a provider-owned mode selection. */
  applyModeSelection?(value: string, settings: unknown): void;

  /** Whether the provider enables the shared bang-bash input mode. */
  isBangBashEnabled?(settings: Record<string, unknown>): boolean;

  /** SVG icon for the provider (shown next to model names in selectors). */
  getProviderIcon?(): ProviderIconSvg | null;
}

export interface ProviderCliResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null;
  reset(): void;
}

export interface ProviderModelCatalogRefreshContext {
  /**
   * Re-run discovery even when the catalog is settled. Set by explicit user
   * actions (enabling a provider, a refresh button); background refreshes from
   * model pickers leave it unset so they never start a CLI on their own.
   */
  force?: boolean;
  plugin: GrimoirePlugin;
  settings: Record<string, unknown>;
}

export interface ProviderModelCatalog {
  isAvailable?(settings: Record<string, unknown>): boolean;
  /**
   * Rediscovers the provider's models, and says what became of the attempt.
   *
   * `refreshed` means the provider answered and the catalog now holds that
   * answer — including when the answer is the same list as before, which is a
   * successful refresh and not a failed one. `failed` means it was asked and did
   * not answer usably. `skipped` means it was never asked, because the catalog
   * was settled and the caller did not `force`.
   *
   * A surface that reports success must read this rather than count the
   * persisted list: that list still holds the previous values when a refresh
   * fails, which is how a refresh against a logged-out CLI came to report
   * "Model list refreshed: 12 models."
   */
  refreshModels(
    context: ProviderModelCatalogRefreshContext,
  ): Promise<ProviderCatalogRefreshOutcome>;
}

export interface ProviderPlanUsageContext {
  plugin: GrimoirePlugin;
  providerId: ProviderId;
  settings: Record<string, unknown>;
}

export interface ProviderPlanUsageProvider {
  isAvailable?(settings: Record<string, unknown>): boolean;
  getCachedUsage(context: ProviderPlanUsageContext): ProviderPlanUsage | null;
  refreshUsage(context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null>;
}

export interface ProviderWorkspaceServices {
  commandCatalog?: ProviderCommandCatalog | null;
  agentMentionProvider?: AgentMentionProvider | null;
  cliResolver?: ProviderCliResolver | null;
  modelCatalog?: ProviderModelCatalog | null;
  usageProvider?: ProviderPlanUsageProvider | null;
  runtimeCommandLoader?: ProviderRuntimeCommandLoader | null;
  mcpStorage?: AppMcpStorage | null;
  mcpServerManager?: McpServerManager | null;
  settingsTabRenderer?: ProviderSettingsTabRenderer | null;
  refreshAgentMentions?(): Promise<void>;
}

export interface ProviderSettingsTabRendererContext {
  plugin: GrimoirePlugin;
  suppressAutomaticDiscovery: boolean;
  createWorkspaceSection(
    container: HTMLElement,
    sections: ProviderWorkspaceResourceKind[],
  ): HTMLElement;
  renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string },
  ): void;
  refreshModelSelectors(): void;
  renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void;
  renderAdvancedSection(
    container: HTMLElement,
    opts: { count: number; summary: string },
  ): HTMLElement;
}

export interface ProviderSettingsTabRenderer {
  render(container: HTMLElement, context: ProviderSettingsTabRendererContext): void;
}

export interface ProviderWorkspaceInitContext {
  plugin: GrimoirePlugin;
  storage: SharedAppStorage;
  vaultAdapter: VaultFileAdapter;
  homeAdapter: HomeFileAdapter;
}

/**
 * How a provider hands its workspace services to the host.
 *
 * Nine implementations, one per provider, reached through
 * `builtInWorkspaceInitializers`. It lives beside the two types it names
 * because a registration is only meaningful to the side that has a plugin.
 */
export interface ProviderWorkspaceRegistration<
  TServices extends ProviderWorkspaceServices = ProviderWorkspaceServices,
> {
  initialize(context: ProviderWorkspaceInitContext): Promise<TServices>;
}
