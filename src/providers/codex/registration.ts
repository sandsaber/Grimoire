import type { ProviderRegistration } from '../../core/providers/types';
import { CodexInlineEditService } from './auxiliary/CodexInlineEditService';
import { CodexInstructionRefineService } from './auxiliary/CodexInstructionRefineService';
import { CodexTaskResultInterpreter } from './auxiliary/CodexTaskResultInterpreter';
import { CodexTitleGenerationService } from './auxiliary/CodexTitleGenerationService';
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
  createTitleGenerationService: (plugin) => new CodexTitleGenerationService(plugin),
  createInstructionRefineService: (plugin) => new CodexInstructionRefineService(plugin),
  createInlineEditService: (plugin) => new CodexInlineEditService(plugin),
  historyService: new CodexConversationHistoryService(),
  taskResultInterpreter: new CodexTaskResultInterpreter(),
  subagentLifecycleAdapter: codexSubagentLifecycleAdapter,
};
