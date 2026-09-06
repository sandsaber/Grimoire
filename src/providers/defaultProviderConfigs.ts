import type { ProviderConfigMap } from '../core/types/settings';
import { builtInProviderCatalog } from './BuiltInProviderCatalog';

/**
 * The provider half of the shipped default settings.
 *
 * No longer a source: it was a hand-maintained map of nine
 * `DEFAULT_<PROVIDER>_PROVIDER_SETTINGS` constants standing beside the two
 * registries — app-level inventory row 2, and a third place for a provider's
 * defaults to be declared and to drift. Each provider's settings codec is the
 * one declaration now, and this derives from it.
 *
 * Read at import time by `DEFAULT_GRIMOIRE_SETTINGS`, which is why it reaches
 * the catalog instance directly rather than through the installed accessor:
 * the accessor is filled when the providers register, and a module-level
 * constant is evaluated before that.
 */
export function getBuiltInProviderDefaultConfigs(): ProviderConfigMap {
  return builtInProviderCatalog.defaultConfigs();
}
