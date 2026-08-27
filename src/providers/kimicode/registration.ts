import type { ProviderRegistration } from '../../core/providers/types';
import { kimicodeSettingsReconciler } from './env/KimicodeSettingsReconciler';
import { KimicodeConversationHistoryService } from './history/KimicodeConversationHistoryService';
import { kimicodeChatUIConfig } from './ui/KimicodeChatUIConfig';

export const kimicodeProviderRegistration: ProviderRegistration = {
  chatUIConfig: kimicodeChatUIConfig,
  createRuntime: ({ plugin }) => plugin.getKimicodeExecution().createRuntime(),
  historyService: new KimicodeConversationHistoryService(),
  settingsReconciler: kimicodeSettingsReconciler,
};
