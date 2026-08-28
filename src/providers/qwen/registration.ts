import type { ProviderRegistration } from '../../core/providers/types';
import { qwenSettingsReconciler } from './env/QwenSettingsReconciler';
import { QwenConversationHistoryService } from './history/QwenConversationHistoryService';

export const qwenProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getQwenExecution().createRuntime(),
  historyService: new QwenConversationHistoryService(),
  settingsReconciler: qwenSettingsReconciler,
};
