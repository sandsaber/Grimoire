import type { ProviderRegistration } from '../../core/providers/types';
import {
  GeminiInlineEditService,
  GeminiInstructionRefineService,
  GeminiTaskResultInterpreter,
  GeminiTitleGenerationService,
} from './auxiliary/GeminiNoopServices';
import { geminiSettingsReconciler } from './env/GeminiSettingsReconciler';
import { GeminiConversationHistoryService } from './history/GeminiConversationHistoryService';
import { geminiChatUIConfig } from './ui/GeminiChatUIConfig';

export const geminiProviderRegistration: ProviderRegistration = {
  chatUIConfig: geminiChatUIConfig,
  createInlineEditService: () => new GeminiInlineEditService(),
  createInstructionRefineService: () => new GeminiInstructionRefineService(),
  createRuntime: ({ plugin }) => plugin.getGeminiExecution().createRuntime(),
  createTitleGenerationService: () => new GeminiTitleGenerationService(),
  historyService: new GeminiConversationHistoryService(),
  settingsReconciler: geminiSettingsReconciler,
  taskResultInterpreter: new GeminiTaskResultInterpreter(),
};
