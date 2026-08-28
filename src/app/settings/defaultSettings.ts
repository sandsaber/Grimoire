import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';

import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { type GrimoireSettings } from '../../core/types/settings';
import { builtInProviderCatalog } from '../../providers/BuiltInProviderCatalog';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

export const DEFAULT_GRIMOIRE_SETTINGS: GrimoireSettings = {
  userName: '',

  permissionMode: 'normal',

  // The default provider's own answer, not a constant this file imports from
  // inside it. Read off the catalog instance for the reason
  // `defaultProviderConfigs` gives: this is a module-level constant, evaluated
  // before the providers register and fill the installed accessor.
  model: builtInProviderCatalog.declarations(DEFAULT_CHAT_PROVIDER_ID).chatUI.models.primaryModel
    ?? '',
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
