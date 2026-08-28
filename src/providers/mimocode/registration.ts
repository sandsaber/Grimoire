import type { ProviderRegistration } from '../../core/providers/types';
import { mimocodeSettingsReconciler } from './env/MimocodeSettingsReconciler';
import { MimocodeConversationHistoryService } from './history/MimocodeConversationHistoryService';

export const mimocodeProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getMimocodeExecution().createRuntime(),
  historyService: new MimocodeConversationHistoryService(),
  settingsReconciler: mimocodeSettingsReconciler,
};
