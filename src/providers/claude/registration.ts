import type { ProviderRegistration } from '../../core/providers/types';
import { claudeSettingsReconciler } from './env/ClaudeSettingsReconciler';
import { ClaudeConversationHistoryService } from './history/ClaudeConversationHistoryService';
import { ClaudeTaskResultInterpreter } from './runtime/ClaudeTaskResultInterpreter';

export const claudeProviderRegistration: ProviderRegistration = {
  settingsReconciler: claudeSettingsReconciler,
  createRuntime: ({ plugin }) => plugin.getClaudeExecution().createRuntime(),
  historyService: new ClaudeConversationHistoryService(),
  // The one provider with a real interpreter: the async task protocol these
  // read is Claude's own.
  taskResultInterpreter: new ClaudeTaskResultInterpreter(),
};
