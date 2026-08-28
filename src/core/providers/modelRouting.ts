import { providerCatalog } from './ProviderCatalog';
import { DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from './types';

/**
 * Which provider owns a model, and which provider a settings record is on.
 *
 * **Routing, not presentation.** These were `ProviderRegistry` statics because
 * they read `getChatUIConfig` — but what they ask it is who owns a model id,
 * not how to draw one, and the registry was only ever the way to reach the
 * config. They read `providerCatalog().declarations(...).chatUI.models` now,
 * which is the same question asked of the module, and they are the last two
 * readers the chat-UI row had.
 */

/**
 * The provider a settings record is configured for.
 *
 * Reads no chat UI at all — it is here because `resolveProviderForModel` falls
 * back to it, and a fallback that lives in a different module than the function
 * it serves is a fallback nobody finds.
 */
export function resolveSettingsProviderId(settings: Record<string, unknown>): ProviderId {
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

export function resolveProviderForModel(
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
      ? resolveSettingsProviderId(settings)
      : DEFAULT_CHAT_PROVIDER_ID);

  const owners = providerIds.filter((providerId) => (
    catalog.declarations(providerId).chatUI.models.ownsModel(model, settings)
  ));
  if (owners.length === 0) {
    return fallbackProviderId;
  }

  // When several providers claim the same id (e.g. Claude env ANTHROPIC_MODEL
  // set to a Codex model), prefer a built-in/default owner over env-only claims.
  const defaultOwners = owners.filter((providerId) => (
    catalog.declarations(providerId).chatUI.models.isBuiltIn(model)
  ));
  return defaultOwners[0] ?? owners[0];
}

/** Which provider generates conversation titles, given the configured title model. */
export function resolveTitleGenerationProviderId(settings: Record<string, unknown>): ProviderId {
  const titleModel = typeof settings.titleGenerationModel === 'string'
    ? settings.titleGenerationModel.trim()
    : '';

  if (!titleModel) {
    return resolveSettingsProviderId(settings);
  }

  return resolveProviderForModel(titleModel, settings, {
    fallbackProviderId: DEFAULT_CHAT_PROVIDER_ID,
  });
}

/** Every model id the providers recognize in a set of environment variables. */
export function getCustomModelIds(envVars: Record<string, string>): Set<string> {
  const catalog = providerCatalog();
  const ids = new Set<string>();
  for (const providerId of catalog.ids()) {
    for (const modelId of catalog.declarations(providerId).chatUI.models.customModelIds(envVars)) {
      ids.add(modelId);
    }
  }
  return ids;
}

export function getProviderForModel(model: string, settings?: Record<string, unknown>): ProviderId {
  return resolveProviderForModel(model, settings);
}

export function getEnabledProviderForModel(
  model: string,
  settings: Record<string, unknown>,
  fallbackProviderId?: ProviderId,
): ProviderId {
  return resolveProviderForModel(model, settings, {
    onlyEnabledProviders: true,
    fallbackProviderId,
  });
}
