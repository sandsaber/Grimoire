import type { LegacyProviderContext } from '../core/providers/LegacyProviderContext';

/**
 * App-side composition boundary for provider-facing services.
 *
 * `GrimoirePlugin` already fulfills this structural contract, so this adapter
 * deliberately preserves its identity and runtime behavior.
 */
export function createApplicationServices(
  plugin: LegacyProviderContext,
): LegacyProviderContext {
  return plugin;
}
