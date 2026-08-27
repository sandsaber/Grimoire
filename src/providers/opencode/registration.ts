import type { ProviderRegistration } from '../../core/providers/types';
import { opencodeSettingsReconciler } from './env/OpencodeSettingsReconciler';
import { OpencodeConversationHistoryService } from './history/OpencodeConversationHistoryService';
import { opencodeChatUIConfig } from './ui/OpencodeChatUIConfig';

export const opencodeProviderRegistration: ProviderRegistration = {
  chatUIConfig: opencodeChatUIConfig,
  createRuntime: ({ plugin }) => plugin.getOpencodeExecution().createRuntime(),
  historyService: new OpencodeConversationHistoryService(),
  settingsReconciler: opencodeSettingsReconciler,
};
