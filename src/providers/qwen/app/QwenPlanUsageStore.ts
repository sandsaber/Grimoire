import { ProviderSpendUsageStore } from '../../../providers/shared/ProviderSpendUsageStore';
import { getQwenProviderSettings } from '../settings';

export const qwenPlanUsageStore = new ProviderSpendUsageStore({
  plan: 'Qwen',
  note: 'ACP cost reported by Qwen CLI · daily quota unavailable.',
  isAvailable: settings => getQwenProviderSettings(settings).enabled,
});
