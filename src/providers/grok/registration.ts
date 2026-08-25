import { GRIMOIRE_STORAGE_PATH } from '../../core/bootstrap/StoragePaths';
import type { ProviderRegistration } from '../../core/providers/types';
import { GrokInlineEditService } from './auxiliary/GrokInlineEditService';
import { GrokInstructionRefineService } from './auxiliary/GrokInstructionRefineService';
import { GrokTaskResultInterpreter } from './auxiliary/GrokTaskResultInterpreter';
import { GrokTitleGenerationService } from './auxiliary/GrokTitleGenerationService';
import { GROK_PROVIDER_CAPABILITIES } from './capabilities';
import { grokSettingsReconciler } from './env/GrokSettingsReconciler';
import { GrokConversationHistoryService } from './history/GrokConversationHistoryService';
import { grokSubagentLifecycleAdapter } from './normalization/grokSubagentNormalization';
import { GROK_ARTIFACTS_SUBDIR } from './runtime/GrokPaths';
import { getGrokProviderSettings, updateGrokProviderSettings } from './settings';
import { grokChatUIConfig } from './ui/GrokChatUIConfig';

export const grokProviderRegistration: ProviderRegistration = {
  capabilities: GROK_PROVIDER_CAPABILITIES,
  chatUIConfig: grokChatUIConfig,
  createInlineEditService: (plugin) => new GrokInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new GrokInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => plugin.getGrokExecution().createRuntime(),
  createTitleGenerationService: (plugin) => new GrokTitleGenerationService(plugin),
  environmentKeyPatterns: [/^GROK_/i, /^XAI_/i],
  historyService: new GrokConversationHistoryService(),
  isEnabled: (settings) => getGrokProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => { updateGrokProviderSettings(settings, { enabled }); },
  getPreloadedContextFiles: () => [
    `${GRIMOIRE_STORAGE_PATH}/${GROK_ARTIFACTS_SUBDIR}/system.md`,
  ],
  settingsReconciler: grokSettingsReconciler,
  subagentLifecycleAdapter: grokSubagentLifecycleAdapter,
  taskResultInterpreter: new GrokTaskResultInterpreter(),
};
