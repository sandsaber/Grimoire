import type { ProviderRegistration } from '../../core/providers/types';
import { geminiSettingsReconciler } from './env/GeminiSettingsReconciler';
import { GeminiConversationHistoryService } from './history/GeminiConversationHistoryService';

export const geminiProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getGeminiExecution().createRuntime(),
  historyService: new GeminiConversationHistoryService(),
  settingsReconciler: geminiSettingsReconciler,
};
