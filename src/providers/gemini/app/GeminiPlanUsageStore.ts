import { ProviderSpendUsageStore } from '../../../providers/shared/ProviderSpendUsageStore';
import { getGeminiProviderSettings } from '../settings';

export const geminiPlanUsageStore = new ProviderSpendUsageStore({
  plan: 'Gemini',
  note: 'ACP cost reported by Gemini CLI · daily quota unavailable.',
  isAvailable: settings => getGeminiProviderSettings(settings).enabled,
});
