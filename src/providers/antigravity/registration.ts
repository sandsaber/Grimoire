import type { ProviderRegistration } from '../../core/providers/types';
import { antigravitySettingsReconciler } from './env/AntigravitySettingsReconciler';
import { AntigravityConversationHistoryService } from './history/AntigravityConversationHistoryService';
import { antigravityChatUIConfig } from './ui/AntigravityChatUIConfig';

export const antigravityProviderRegistration: ProviderRegistration = {
  chatUIConfig: antigravityChatUIConfig,
  // The first provider flip: chat execution runs through the kernel. Only this
  // row moves — workspace services, settings, auxiliary services, and every
  // other registration stay exactly as they were. Codex followed in wave 2.
  createRuntime: ({ plugin }) => plugin.getAntigravityExecution().createRuntime(),
  historyService: new AntigravityConversationHistoryService(),
  settingsReconciler: antigravitySettingsReconciler,
};
