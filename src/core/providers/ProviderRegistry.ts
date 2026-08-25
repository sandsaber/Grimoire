import type GrimoirePlugin from '../../main';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import { providerCatalog } from './ProviderCatalog';
import {
  type CreateChatRuntimeOptions,
  DEFAULT_CHAT_PROVIDER_ID,
  type InlineEditService,
  type InstructionRefineService,
  type ProviderCapabilities,
  type ProviderChatUIConfig,
  type ProviderConversationHistoryService,
  type ProviderId,
  type ProviderRegistration,
  type ProviderSettingsReconciler,
  type ProviderSubagentLifecycleAdapter,
  type ProviderTaskResultInterpreter,
  type TitleGenerationCallback,
  type TitleGenerationService,
} from './types';

/**
 * Registry for chat-facing provider services.
 *
 * Bootstrap concerns (default settings, shared storage, CLI resolution,
 * workspace command/agent services) are composed explicitly in `main.ts`
 * through `src/core/bootstrap/` and `src/providers/<id>/app/`.
 *
 * Which providers exist, what they are called, and what order they appear in
 * are no longer questions this class answers: the catalog owns them, and a
 * registration for a provider the catalog does not hold is refused rather than
 * kept as a second inventory.
 */
export class ProviderRegistry {
  private static registrations: Partial<Record<ProviderId, ProviderRegistration>> = {};

  static register(
    providerId: ProviderId,
    registration: ProviderRegistration,
  ): void {
    if (!providerCatalog().get(providerId)) {
      throw new Error(`Provider "${providerId}" is not in the catalog.`);
    }
    this.registrations[providerId] = registration;
  }

  private static getProviderRegistration(providerId: ProviderId): ProviderRegistration {
    const registration = this.registrations[providerId];
    if (!registration) {
      throw new Error(`Provider "${providerId}" is not registered.`);
    }
    return registration;
  }

  static createChatRuntime(options: CreateChatRuntimeOptions): ChatRuntime {
    const providerId = options.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    return this.getProviderRegistration(providerId).createRuntime(options);
  }

  static createTitleGenerationService(plugin: GrimoirePlugin, providerId?: ProviderId): TitleGenerationService {
    if (!providerId) {
      return new RoutedTitleGenerationService(plugin);
    }
    return this.getProviderRegistration(providerId).createTitleGenerationService(plugin);
  }

  static resolveTitleGenerationProviderId(settings: Record<string, unknown>): ProviderId {
    const titleModel = typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel.trim()
      : '';

    if (!titleModel) {
      return this.resolveSettingsProviderId(settings);
    }

    return this.resolveProviderForModel(titleModel, settings, {
      fallbackProviderId: DEFAULT_CHAT_PROVIDER_ID,
    });
  }

  static createInstructionRefineService(plugin: GrimoirePlugin, providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): InstructionRefineService {
    return this.getProviderRegistration(providerId).createInstructionRefineService(plugin);
  }

  static createInlineEditService(plugin: GrimoirePlugin, providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): InlineEditService {
    return this.getProviderRegistration(providerId).createInlineEditService(plugin);
  }

  static getConversationHistoryService(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderConversationHistoryService {
    return this.getProviderRegistration(providerId).historyService;
  }

  static getTaskResultInterpreter(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderTaskResultInterpreter {
    return this.getProviderRegistration(providerId).taskResultInterpreter;
  }

  static getSubagentLifecycleAdapter(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderSubagentLifecycleAdapter | null {
    return this.getProviderRegistration(providerId).subagentLifecycleAdapter ?? null;
  }

  static getCapabilities(providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): ProviderCapabilities {
    return this.getProviderRegistration(providerId).capabilities;
  }

  static getEnvironmentKeyPatterns(providerId: ProviderId): RegExp[] {
    return this.getProviderRegistration(providerId).environmentKeyPatterns ?? [];
  }

  static getChatUIConfig(providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): ProviderChatUIConfig {
    return this.getProviderRegistration(providerId).chatUIConfig;
  }

  static getSettingsReconciler(providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): ProviderSettingsReconciler {
    return this.getProviderRegistration(providerId).settingsReconciler;
  }

  static getEnabledProviderIds(settings: Record<string, unknown>): ProviderId[] {
    return [...providerCatalog().ids()]
      .filter(providerId => this.getProviderRegistration(providerId).isEnabled(settings));
  }

  static getPreloadedContextFiles(providerId: ProviderId): string[] {
    return this.getProviderRegistration(providerId).getPreloadedContextFiles?.() ?? [];
  }

  static isEnabled(providerId: ProviderId, settings: Record<string, unknown>): boolean {
    return this.getProviderRegistration(providerId).isEnabled(settings);
  }

  static setEnabled(providerId: ProviderId, settings: Record<string, unknown>, enabled: boolean): void {
    this.getProviderRegistration(providerId).setEnabled(settings, enabled);
  }

  static resolveSettingsProviderId(settings: Record<string, unknown>): ProviderId {
    const catalog = providerCatalog();
    const current = settings.settingsProvider;
    if (typeof current === 'string') {
      const currentProvider = current;
      if (catalog.has(currentProvider) && this.isEnabled(currentProvider, settings)) {
        return currentProvider;
      }
    }

    const enabledProviderIds = this.getEnabledProviderIds(settings);
    if (enabledProviderIds.length === 0) {
      return catalog.has(current) ? current : DEFAULT_CHAT_PROVIDER_ID;
    }

    if (this.isEnabled(DEFAULT_CHAT_PROVIDER_ID, settings)) {
      return DEFAULT_CHAT_PROVIDER_ID;
    }

    return enabledProviderIds[0];
  }

  static resolveProviderForModel(
    model: string,
    settings: Record<string, unknown> = {},
    options: {
      onlyEnabledProviders?: boolean;
      fallbackProviderId?: ProviderId;
    } = {},
  ): ProviderId {
    const providerIds = options.onlyEnabledProviders
      ? this.getEnabledProviderIds(settings)
      : providerCatalog().ids();
    const fallbackProviderId = (
      options.fallbackProviderId
      && (!options.onlyEnabledProviders || this.isEnabled(options.fallbackProviderId, settings))
    )
      ? options.fallbackProviderId
      : (options.onlyEnabledProviders
        ? this.resolveSettingsProviderId(settings)
        : DEFAULT_CHAT_PROVIDER_ID);

    const owners = providerIds.filter((providerId) => (
      this.getChatUIConfig(providerId).ownsModel(model, settings)
    ));
    if (owners.length === 0) {
      return fallbackProviderId;
    }

    // When several providers claim the same id (e.g. Claude env ANTHROPIC_MODEL
    // set to a Codex model), prefer a built-in/default owner over env-only claims.
    const defaultOwners = owners.filter((providerId) => (
      this.getChatUIConfig(providerId).isDefaultModel(model)
    ));
    return defaultOwners[0] ?? owners[0];
  }

  static getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    for (const providerId of providerCatalog().ids()) {
      for (const modelId of this.getChatUIConfig(providerId).getCustomModelIds(envVars)) {
        ids.add(modelId);
      }
    }
    return ids;
  }
}

interface ActiveTitleGeneration {
  service: TitleGenerationService;
}

class RoutedTitleGenerationService implements TitleGenerationService {
  private readonly activeGenerations = new Map<string, ActiveTitleGeneration>();

  constructor(private readonly plugin: GrimoirePlugin) {}

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    const providerId = ProviderRegistry.resolveTitleGenerationProviderId(
      this.plugin.settings,
    );
    const service = ProviderRegistry.createTitleGenerationService(this.plugin, providerId);
    const generation = { service };
    const previous = this.activeGenerations.get(conversationId);

    this.activeGenerations.set(conversationId, generation);
    previous?.service.cancel();

    try {
      await service.generateTitle(conversationId, userMessage, async (convId, result) => {
        if (this.activeGenerations.get(conversationId) !== generation) {
          return;
        }
        await callback(convId, result);
      });
    } finally {
      if (this.activeGenerations.get(conversationId) === generation) {
        this.activeGenerations.delete(conversationId);
      }
    }
  }

  cancel(): void {
    const services = new Set<TitleGenerationService>(
      [...this.activeGenerations.values()].map(generation => generation.service),
    );
    this.activeGenerations.clear();
    for (const service of services) {
      service.cancel();
    }
  }
}
