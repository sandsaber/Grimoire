import type { ProviderRegistration } from '../../core/providers/types';
import { MimocodeConversationHistoryService } from './history/MimocodeConversationHistoryService';

export const mimocodeProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getMimocodeExecution().createRuntime(),
  historyService: new MimocodeConversationHistoryService(),
};
