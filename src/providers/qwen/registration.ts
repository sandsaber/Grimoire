import type { ProviderRegistration } from '../../core/providers/types';
import { QwenTaskResultInterpreter } from './auxiliary/QwenTaskResultInterpreter';
import { qwenSettingsReconciler } from './env/QwenSettingsReconciler';
import { QwenConversationHistoryService } from './history/QwenConversationHistoryService';
import { qwenChatUIConfig } from './ui/QwenChatUIConfig';

export const qwenProviderRegistration: ProviderRegistration = {
  chatUIConfig: qwenChatUIConfig,
  createRuntime: ({ plugin }) => plugin.getQwenExecution().createRuntime(),
  historyService: new QwenConversationHistoryService(),
  settingsReconciler: qwenSettingsReconciler,
  taskResultInterpreter: new QwenTaskResultInterpreter(),
};
