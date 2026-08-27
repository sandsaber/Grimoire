import type { ChatRuntime } from '../runtime/ChatRuntime';
import { NO_TASK_RESULT_INTERPRETATION } from './noTaskResultInterpretation';
import { providerCatalog } from './ProviderCatalog';
import {
  type CreateChatRuntimeOptions,
  DEFAULT_CHAT_PROVIDER_ID,
  type ProviderChatUIConfig,
  type ProviderConversationHistoryService,
  type ProviderId,
  type ProviderRegistration,
  type ProviderSettingsReconciler,
  type ProviderSubagentLifecycleAdapter,
  type ProviderTaskResultInterpreter,
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

  static getConversationHistoryService(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderConversationHistoryService {
    return this.getProviderRegistration(providerId).historyService;
  }

  static getTaskResultInterpreter(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderTaskResultInterpreter {
    return this.getProviderRegistration(providerId).taskResultInterpreter
      ?? NO_TASK_RESULT_INTERPRETATION;
  }

  static getSubagentLifecycleAdapter(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderSubagentLifecycleAdapter | null {
    return this.getProviderRegistration(providerId).subagentLifecycleAdapter ?? null;
  }

  static getChatUIConfig(providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): ProviderChatUIConfig {
    return this.getProviderRegistration(providerId).chatUIConfig;
  }

  static getSettingsReconciler(providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID): ProviderSettingsReconciler {
    return this.getProviderRegistration(providerId).settingsReconciler;
  }

  static resolveSettingsProviderId(settings: Record<string, unknown>): ProviderId {
    const catalog = providerCatalog();
    const current = settings.settingsProvider;
    if (typeof current === 'string') {
      const currentProvider = current;
      if (catalog.has(currentProvider) && catalog.isEnabled(settings, currentProvider)) {
        return currentProvider;
      }
    }

    const enabledProviderIds = catalog.enabledIds(settings);
    if (enabledProviderIds.length === 0) {
      return catalog.has(current) ? current : DEFAULT_CHAT_PROVIDER_ID;
    }

    if (catalog.isEnabled(settings, DEFAULT_CHAT_PROVIDER_ID)) {
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
    const catalog = providerCatalog();
    const providerIds = options.onlyEnabledProviders
      ? catalog.enabledIds(settings)
      : catalog.ids();
    const fallbackProviderId = (
      options.fallbackProviderId
      && (
        !options.onlyEnabledProviders
        || catalog.isEnabled(settings, options.fallbackProviderId)
      )
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
