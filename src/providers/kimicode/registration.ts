import type { ProviderRegistration } from '../../core/providers/types';
import { KimicodeInlineEditService } from './auxiliary/KimicodeInlineEditService';
import { KimicodeInstructionRefineService } from './auxiliary/KimicodeInstructionRefineService';
import { KimicodeTaskResultInterpreter } from './auxiliary/KimicodeTaskResultInterpreter';
import { KimicodeTitleGenerationService } from './auxiliary/KimicodeTitleGenerationService';
import { kimicodeSettingsReconciler } from './env/KimicodeSettingsReconciler';
import { KimicodeConversationHistoryService } from './history/KimicodeConversationHistoryService';
import { kimicodeChatUIConfig } from './ui/KimicodeChatUIConfig';

export const kimicodeProviderRegistration: ProviderRegistration = {
  chatUIConfig: kimicodeChatUIConfig,
  createInlineEditService: (plugin) => new KimicodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new KimicodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => plugin.getKimicodeExecution().createRuntime(),
  createTitleGenerationService: (plugin) => new KimicodeTitleGenerationService(plugin),
  environmentKeyPatterns: [/^KIMICODE_/i],
  historyService: new KimicodeConversationHistoryService(),
  settingsReconciler: kimicodeSettingsReconciler,
  taskResultInterpreter: new KimicodeTaskResultInterpreter(),
};
