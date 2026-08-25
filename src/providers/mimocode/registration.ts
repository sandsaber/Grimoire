import type { ProviderRegistration } from '../../core/providers/types';
import { MimocodeInlineEditService } from './auxiliary/MimocodeInlineEditService';
import { MimocodeInstructionRefineService } from './auxiliary/MimocodeInstructionRefineService';
import { MimocodeTaskResultInterpreter } from './auxiliary/MimocodeTaskResultInterpreter';
import { MimocodeTitleGenerationService } from './auxiliary/MimocodeTitleGenerationService';
import { MIMOCODE_PROVIDER_CAPABILITIES } from './capabilities';
import { mimocodeSettingsReconciler } from './env/MimocodeSettingsReconciler';
import { MimocodeConversationHistoryService } from './history/MimocodeConversationHistoryService';
import { mimocodeChatUIConfig } from './ui/MimocodeChatUIConfig';

export const mimocodeProviderRegistration: ProviderRegistration = {
  capabilities: MIMOCODE_PROVIDER_CAPABILITIES,
  chatUIConfig: mimocodeChatUIConfig,
  createInlineEditService: (plugin) => new MimocodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new MimocodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => plugin.getMimocodeExecution().createRuntime(),
  createTitleGenerationService: (plugin) => new MimocodeTitleGenerationService(plugin),
  environmentKeyPatterns: [/^MIMOCODE_/i],
  historyService: new MimocodeConversationHistoryService(),
  settingsReconciler: mimocodeSettingsReconciler,
  taskResultInterpreter: new MimocodeTaskResultInterpreter(),
};
