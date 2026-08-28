import type { ProviderRegistration } from '../../core/providers/types';
import { KimicodeConversationHistoryService } from './history/KimicodeConversationHistoryService';

export const kimicodeProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getKimicodeExecution().createRuntime(),
  historyService: new KimicodeConversationHistoryService(),
};
