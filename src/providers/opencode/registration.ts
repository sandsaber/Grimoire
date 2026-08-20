import type { ProviderRegistration } from '../../core/providers/types';
import { OpencodeInlineEditService } from './auxiliary/OpencodeInlineEditService';
import { OpencodeInstructionRefineService } from './auxiliary/OpencodeInstructionRefineService';
import { OpencodeTaskResultInterpreter } from './auxiliary/OpencodeTaskResultInterpreter';
import { OpencodeTitleGenerationService } from './auxiliary/OpencodeTitleGenerationService';
import { OPENCODE_PROVIDER_CAPABILITIES } from './capabilities';
import { opencodeSettingsReconciler } from './env/OpencodeSettingsReconciler';
import { OpencodeConversationHistoryService } from './history/OpencodeConversationHistoryService';
import { getOpencodeProviderSettings, updateOpencodeProviderSettings } from './settings';
import { opencodeChatUIConfig } from './ui/OpencodeChatUIConfig';

export const opencodeProviderRegistration: ProviderRegistration = {
  blankTabOrder: 30,
  capabilities: OPENCODE_PROVIDER_CAPABILITIES,
  chatUIConfig: opencodeChatUIConfig,
  createInlineEditService: (plugin) => new OpencodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new OpencodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => plugin.getOpencodeExecution().createRuntime(),
  createTitleGenerationService: (plugin) => new OpencodeTitleGenerationService(plugin),
  displayName: 'OpenCode',
  environmentKeyPatterns: [/^OPENCODE_/i],
  historyService: new OpencodeConversationHistoryService(),
  isEnabled: (settings) => getOpencodeProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => { updateOpencodeProviderSettings(settings, { enabled }); },
  settingsReconciler: opencodeSettingsReconciler,
  taskResultInterpreter: new OpencodeTaskResultInterpreter(),
};
