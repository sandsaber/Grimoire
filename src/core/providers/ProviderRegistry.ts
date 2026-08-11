import type { ChatRuntime } from '../runtime/ChatRuntime';
import type { LegacyProviderContext } from './LegacyProviderContext';
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
 */
export class ProviderRegistry {
  private static registrations: Partial<Record<ProviderId, ProviderRegistration>> = {};

  static register(
    providerId: ProviderId,
    registration: ProviderRegistration,
  ): void {
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

  static createTitleGenerationService(plugin: LegacyProviderContext, providerId?: ProviderId): TitleGenerationService {
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

  static createInstructionRefineService(plugin: LegacyProviderContext, providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): InstructionRefineService {
    return this.getProviderRegistration(providerId).createInstructionRefineService(plugin);
  }

  static createInlineEditService(plugin: LegacyProviderContext, providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): InlineEditService {
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

  static getRegisteredProviderIds(): ProviderId[] {
    return Object.keys(this.registrations)
      .sort((left, right) => this.compareProviderTabOrder(left, right));
  }

  static isRegisteredProviderId(value: unknown): value is ProviderId {
    return typeof value === 'string' && this.registrations[value] !== undefined;
  }

  static getEnabledProviderIds(settings: Record<string, unknown>): ProviderId[] {
    return this.getRegisteredProviderIds()
      .filter(providerId => this.getProviderRegistration(providerId).isEnabled(settings));
  }

  private static compareProviderTabOrder(left: ProviderId, right: ProviderId): number {
    const orderDiff = this.getProviderRegistration(left).blankTabOrder
      - this.getProviderRegistration(right).blankTabOrder;
    if (orderDiff !== 0) {
      return orderDiff;
    }

    return left.localeCompare(right);
  }

  static getProviderDisplayName(providerId: ProviderId): string {
    return this.getProviderRegistration(providerId).displayName;
  }

  static getProviderDisplayNameOrId(providerId: string): string {
    return this.registrations[providerId]?.displayName ?? providerId;
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
    const current = settings.settingsProvider;
    if (typeof current === 'string') {
      const currentProvider = current;
      if (
        this.getRegisteredProviderIds().includes(currentProvider)
        && this.isEnabled(currentProvider, settings)
      ) {
        return currentProvider;
      }
    }

    const enabledProviderIds = this.getEnabledProviderIds(settings);
    if (enabledProviderIds.length === 0) {
      return (
        typeof current === 'string'
        && this.getRegisteredProviderIds().includes(current)
      )
        ? current
        : DEFAULT_CHAT_PROVIDER_ID;
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
      : this.getRegisteredProviderIds();
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
    for (const providerId of this.getRegisteredProviderIds()) {
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

  constructor(private readonly plugin: LegacyProviderContext) {}

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
