import type { ProviderRegistration } from '../../core/providers/types';
import { MimocodeTaskResultInterpreter } from './auxiliary/MimocodeTaskResultInterpreter';
import { mimocodeSettingsReconciler } from './env/MimocodeSettingsReconciler';
import { MimocodeConversationHistoryService } from './history/MimocodeConversationHistoryService';
import { mimocodeChatUIConfig } from './ui/MimocodeChatUIConfig';

export const mimocodeProviderRegistration: ProviderRegistration = {
  chatUIConfig: mimocodeChatUIConfig,
  createRuntime: ({ plugin }) => plugin.getMimocodeExecution().createRuntime(),
  historyService: new MimocodeConversationHistoryService(),
  settingsReconciler: mimocodeSettingsReconciler,
  taskResultInterpreter: new MimocodeTaskResultInterpreter(),
};
