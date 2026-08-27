import type { ProviderRegistration } from '../../core/providers/types';
import { CodexTaskResultInterpreter } from './auxiliary/CodexTaskResultInterpreter';
import { codexSettingsReconciler } from './env/CodexSettingsReconciler';
import { CodexConversationHistoryService } from './history/CodexConversationHistoryService';
import { codexSubagentLifecycleAdapter } from './normalization/codexSubagentNormalization';
import { codexChatUIConfig } from './ui/CodexChatUIConfig';

export const codexProviderRegistration: ProviderRegistration = {
  chatUIConfig: codexChatUIConfig,
  settingsReconciler: codexSettingsReconciler,
  // The second provider flip: chat execution runs through the kernel. Only this
  // row moves — workspace services, settings, auxiliary services, history and
  // UI config stay exactly as they were, per the mixed-authority rule that
  // holds until M5.
  createRuntime: ({ plugin }) => plugin.getCodexExecution().createRuntime(),
  historyService: new CodexConversationHistoryService(),
  taskResultInterpreter: new CodexTaskResultInterpreter(),
  subagentLifecycleAdapter: codexSubagentLifecycleAdapter,
};
