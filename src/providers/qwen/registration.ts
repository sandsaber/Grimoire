import type { ProviderRegistration } from '../../core/providers/types';
import { QwenConversationHistoryService } from './history/QwenConversationHistoryService';

export const qwenProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getQwenExecution().createRuntime(),
  historyService: new QwenConversationHistoryService(),
};
