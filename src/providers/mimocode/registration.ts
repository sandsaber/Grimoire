import type { ProviderRegistration } from '../../core/providers/types';
import { MimocodeInlineEditService } from './auxiliary/MimocodeInlineEditService';
import { MimocodeInstructionRefineService } from './auxiliary/MimocodeInstructionRefineService';
import { MimocodeTaskResultInterpreter } from './auxiliary/MimocodeTaskResultInterpreter';
import { MimocodeTitleGenerationService } from './auxiliary/MimocodeTitleGenerationService';
import { mimocodeSettingsReconciler } from './env/MimocodeSettingsReconciler';
import { MimocodeConversationHistoryService } from './history/MimocodeConversationHistoryService';
import { mimocodeChatUIConfig } from './ui/MimocodeChatUIConfig';

export const mimocodeProviderRegistration: ProviderRegistration = {
  chatUIConfig: mimocodeChatUIConfig,
  createInlineEditService: (plugin) => new MimocodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new MimocodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => plugin.getMimocodeExecution().createRuntime(),
  createTitleGenerationService: (plugin) => new MimocodeTitleGenerationService(plugin),
  historyService: new MimocodeConversationHistoryService(),
  settingsReconciler: mimocodeSettingsReconciler,
  taskResultInterpreter: new MimocodeTaskResultInterpreter(),
};
