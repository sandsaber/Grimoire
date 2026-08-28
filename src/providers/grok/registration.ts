import type { ProviderRegistration } from '../../core/providers/types';
import { grokSettingsReconciler } from './env/GrokSettingsReconciler';
import { GrokConversationHistoryService } from './history/GrokConversationHistoryService';
import { grokSubagentLifecycleAdapter } from './normalization/grokSubagentNormalization';

export const grokProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getGrokExecution().createRuntime(),
  historyService: new GrokConversationHistoryService(),
  settingsReconciler: grokSettingsReconciler,
  subagentLifecycleAdapter: grokSubagentLifecycleAdapter,
};
