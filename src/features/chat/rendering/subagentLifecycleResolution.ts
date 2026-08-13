import type { ProviderId, ProviderSubagentLifecycleAdapter } from '../../../core/providers/types';

/**
 * Resolves the lifecycle adapter owned by the active provider.
 */
export function resolveSubagentLifecycleAdapter(
  _activeProviderId: ProviderId,
  _toolName?: string,
): ProviderSubagentLifecycleAdapter | null {
  // Phase 9 cutover — ProviderRegistry.getSubagentLifecycleAdapter removed.
  // Adapter resolution now happens through the application runtime.
  return null;
}
