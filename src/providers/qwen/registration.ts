import type { ProviderRegistration } from '../../core/providers/types';
import {
  QwenInlineEditService,
  QwenInstructionRefineService,
  QwenTaskResultInterpreter,
  QwenTitleGenerationService,
} from './auxiliary/QwenNoopServices';
import { qwenSettingsReconciler } from './env/QwenSettingsReconciler';
import { QwenConversationHistoryService } from './history/QwenConversationHistoryService';
import { qwenChatUIConfig } from './ui/QwenChatUIConfig';

export const qwenProviderRegistration: ProviderRegistration = {
  chatUIConfig: qwenChatUIConfig,
  createInlineEditService: () => new QwenInlineEditService(),
  createInstructionRefineService: () => new QwenInstructionRefineService(),
  createRuntime: ({ plugin }) => plugin.getQwenExecution().createRuntime(),
  createTitleGenerationService: () => new QwenTitleGenerationService(),
  historyService: new QwenConversationHistoryService(),
  settingsReconciler: qwenSettingsReconciler,
  taskResultInterpreter: new QwenTaskResultInterpreter(),
};
