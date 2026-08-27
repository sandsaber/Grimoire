import type { ProviderRegistration } from '../../core/providers/types';
import { GeminiTaskResultInterpreter } from './auxiliary/GeminiTaskResultInterpreter';
import { geminiSettingsReconciler } from './env/GeminiSettingsReconciler';
import { GeminiConversationHistoryService } from './history/GeminiConversationHistoryService';
import { geminiChatUIConfig } from './ui/GeminiChatUIConfig';

export const geminiProviderRegistration: ProviderRegistration = {
  chatUIConfig: geminiChatUIConfig,
  createRuntime: ({ plugin }) => plugin.getGeminiExecution().createRuntime(),
  historyService: new GeminiConversationHistoryService(),
  settingsReconciler: geminiSettingsReconciler,
  taskResultInterpreter: new GeminiTaskResultInterpreter(),
};
