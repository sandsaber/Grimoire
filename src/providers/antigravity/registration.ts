import type { ProviderRegistration } from '../../core/providers/types';
import {
  AntigravityInlineEditService,
  AntigravityInstructionRefineService,
  AntigravityTaskResultInterpreter,
  AntigravityTitleGenerationService,
} from './auxiliary/AntigravityNoopServices';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from './capabilities';
import { antigravitySettingsReconciler } from './env/AntigravitySettingsReconciler';
import { AntigravityConversationHistoryService } from './history/AntigravityConversationHistoryService';
import { antigravityChatUIConfig } from './ui/AntigravityChatUIConfig';

export const antigravityProviderRegistration: ProviderRegistration = {
  capabilities: ANTIGRAVITY_PROVIDER_CAPABILITIES,
  chatUIConfig: antigravityChatUIConfig,
  createInlineEditService: () => new AntigravityInlineEditService(),
  createInstructionRefineService: () => new AntigravityInstructionRefineService(),
  // The first provider flip: chat execution runs through the kernel. Only this
  // row moves — workspace services, settings, auxiliary services, and every
  // other registration stay exactly as they were. Codex followed in wave 2.
  createRuntime: ({ plugin }) => plugin.getAntigravityExecution().createRuntime(),
  createTitleGenerationService: () => new AntigravityTitleGenerationService(),
  environmentKeyPatterns: [/^ANTIGRAVITY_/i, /^GOOGLE_/i, /^GEMINI_/i, /^VERTEX_/i],
  historyService: new AntigravityConversationHistoryService(),
  settingsReconciler: antigravitySettingsReconciler,
  taskResultInterpreter: new AntigravityTaskResultInterpreter(),
};
