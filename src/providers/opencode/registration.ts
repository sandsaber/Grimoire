import type { ProviderRegistration } from '../../core/providers/types';
import { OpencodeConversationHistoryService } from './history/OpencodeConversationHistoryService';

export const opencodeProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getOpencodeExecution().createRuntime(),
  historyService: new OpencodeConversationHistoryService(),
};
