import type { ProviderRegistration } from '../../core/providers/types';
import { ClaudeConversationHistoryService } from './history/ClaudeConversationHistoryService';
import { ClaudeTaskResultInterpreter } from './runtime/ClaudeTaskResultInterpreter';

export const claudeProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getClaudeExecution().createRuntime(),
  historyService: new ClaudeConversationHistoryService(),
  // The one provider with a real interpreter: the async task protocol these
  // read is Claude's own.
  taskResultInterpreter: new ClaudeTaskResultInterpreter(),
};
