import type { ProviderRegistration } from '../../core/providers/types';
import { GrokTaskResultInterpreter } from './auxiliary/GrokTaskResultInterpreter';
import { grokSettingsReconciler } from './env/GrokSettingsReconciler';
import { GrokConversationHistoryService } from './history/GrokConversationHistoryService';
import { grokSubagentLifecycleAdapter } from './normalization/grokSubagentNormalization';
import { grokChatUIConfig } from './ui/GrokChatUIConfig';

export const grokProviderRegistration: ProviderRegistration = {
  chatUIConfig: grokChatUIConfig,
  createRuntime: ({ plugin }) => plugin.getGrokExecution().createRuntime(),
  historyService: new GrokConversationHistoryService(),
  settingsReconciler: grokSettingsReconciler,
  subagentLifecycleAdapter: grokSubagentLifecycleAdapter,
  taskResultInterpreter: new GrokTaskResultInterpreter(),
};
