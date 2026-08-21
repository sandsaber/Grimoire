import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';

import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { type GrimoireSettings } from '../../core/types/settings';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '../../providers/codex/types/models';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

export const DEFAULT_GRIMOIRE_SETTINGS: GrimoireSettings = {
  userName: '',

  permissionMode: 'normal',

  model: DEFAULT_CODEX_PRIMARY_MODEL,
  thinkingBudget: 'off',
  effortLevel: 'high',
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  excludedFolders: [],
  mediaFolder: '',
  systemPrompt: '',
  persistentExternalContextPaths: [],
  contextEngine: {
    vaultSearchEnabled: true,
    vaultSearchMaxResults: 8,
    vaultSearchMaxSnippetChars: 700,
    relevantNotesEnabled: true,
    relevantNotesMaxResults: 6,
    projectWorkspaces: [],
    activeProjectWorkspaceId: '',
  },

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,
  advancedSectionsOpen: {},
  usageIndicatorsEnabled: true,
  debugLoggingEnabled: false,

  locale: 'en',

  providerConfigs: getBuiltInProviderDefaultConfigs(),

  settingsProvider: DEFAULT_CHAT_PROVIDER_ID,
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},

  lastCustomModel: '',
  lastSeenChangelogVersion: '',

  maxTabs: 5,
  tabBarPosition: 'header',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  chatViewPlacement: 'right-sidebar',

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),
};
