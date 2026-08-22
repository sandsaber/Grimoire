import type { ProviderRegistration } from '../../core/providers/types';
import { KimicodeInlineEditService } from './auxiliary/KimicodeInlineEditService';
import { KimicodeInstructionRefineService } from './auxiliary/KimicodeInstructionRefineService';
import { KimicodeTaskResultInterpreter } from './auxiliary/KimicodeTaskResultInterpreter';
import { KimicodeTitleGenerationService } from './auxiliary/KimicodeTitleGenerationService';
import { KIMICODE_PROVIDER_CAPABILITIES } from './capabilities';
import { kimicodeSettingsReconciler } from './env/KimicodeSettingsReconciler';
import { KimicodeConversationHistoryService } from './history/KimicodeConversationHistoryService';
import { getKimicodeProviderSettings, updateKimicodeProviderSettings } from './settings';
import { kimicodeChatUIConfig } from './ui/KimicodeChatUIConfig';

export const kimicodeProviderRegistration: ProviderRegistration = {
  blankTabOrder: 60,
  capabilities: KIMICODE_PROVIDER_CAPABILITIES,
  chatUIConfig: kimicodeChatUIConfig,
  createInlineEditService: (plugin) => new KimicodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new KimicodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => plugin.getKimicodeExecution().createRuntime(),
  createTitleGenerationService: (plugin) => new KimicodeTitleGenerationService(plugin),
  displayName: 'Kimi Code',
  environmentKeyPatterns: [/^KIMICODE_/i],
  historyService: new KimicodeConversationHistoryService(),
  isEnabled: (settings) => getKimicodeProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => { updateKimicodeProviderSettings(settings, { enabled }); },
  settingsReconciler: kimicodeSettingsReconciler,
  taskResultInterpreter: new KimicodeTaskResultInterpreter(),
};
