import { ProviderSpendUsageStore } from '../../../providers/shared/ProviderSpendUsageStore';
import { getDevinProviderSettings } from '../settings';

export const devinPlanUsageStore = new ProviderSpendUsageStore({
  plan: 'Devin',
  note: 'Credits reported by Devin CLI · account quota unavailable.',
  isAvailable: settings => getDevinProviderSettings(settings).enabled,
});
