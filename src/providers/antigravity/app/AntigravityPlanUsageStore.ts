import type {
  ProviderPlanUsage,
  ProviderPlanUsageContext,
  ProviderPlanUsageProvider,
} from '../../../providers/shared/providerHostContracts';
import { getAntigravityProviderSettings } from '../settings';

export const antigravityPlanUsageStore: ProviderPlanUsageProvider = {
  isAvailable(settings) {
    return getAntigravityProviderSettings(settings).enabled;
  },

  getCachedUsage(_context: ProviderPlanUsageContext): ProviderPlanUsage | null {
    return null;
  },

  async refreshUsage(_context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null> {
    return null;
  },
};
