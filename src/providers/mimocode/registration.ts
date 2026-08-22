import type { ProviderRegistration } from '../../core/providers/types';
import { MimocodeInlineEditService } from './auxiliary/MimocodeInlineEditService';
import { MimocodeInstructionRefineService } from './auxiliary/MimocodeInstructionRefineService';
import { MimocodeTaskResultInterpreter } from './auxiliary/MimocodeTaskResultInterpreter';
import { MimocodeTitleGenerationService } from './auxiliary/MimocodeTitleGenerationService';
import { MIMOCODE_PROVIDER_CAPABILITIES } from './capabilities';
import { mimocodeSettingsReconciler } from './env/MimocodeSettingsReconciler';
import { MimocodeConversationHistoryService } from './history/MimocodeConversationHistoryService';
import { getMimocodeProviderSettings, updateMimocodeProviderSettings } from './settings';
import { mimocodeChatUIConfig } from './ui/MimocodeChatUIConfig';

export const mimocodeProviderRegistration: ProviderRegistration = {
  blankTabOrder: 50,
  capabilities: MIMOCODE_PROVIDER_CAPABILITIES,
  chatUIConfig: mimocodeChatUIConfig,
  createInlineEditService: (plugin) => new MimocodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new MimocodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => plugin.getMimocodeExecution().createRuntime(),
  createTitleGenerationService: (plugin) => new MimocodeTitleGenerationService(plugin),
  displayName: 'MiMoCode',
  environmentKeyPatterns: [/^MIMOCODE_/i],
  historyService: new MimocodeConversationHistoryService(),
  isEnabled: (settings) => getMimocodeProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => { updateMimocodeProviderSettings(settings, { enabled }); },
  settingsReconciler: mimocodeSettingsReconciler,
  taskResultInterpreter: new MimocodeTaskResultInterpreter(),
};
