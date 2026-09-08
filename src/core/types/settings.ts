import type { ProjectWorkspace } from '../context/types';

export type HiddenProviderCommands = Record<string, string[]>;

export interface ApprovalSelectionDecision {
  type: 'select-option';
  value: string;
}

/** User decision from the approval modal. */
export type ApprovalDecision =
  | 'allow'
  | 'allow-always'
  | 'deny'
  | 'cancel'
  | ApprovalSelectionDecision;

/** Saved environment variable configuration. */
export interface EnvSnippet {
  id: string;
  name: string;
  description: string;
  envVars: string;
  scope?: EnvironmentScope;
  contextLimits?: Record<string, number>;  // Optional: context limits for custom models
  modelAliases?: Record<string, string>;   // Optional: display aliases for custom models
}

/** Source of a slash command. */
export type SlashCommandSource = 'builtin' | 'user' | 'plugin' | 'sdk';

/** Slash command configuration shared by the UI, storage, and runtime boundary. */
export interface SlashCommand {
  id: string;
  name: string;                // Command name used after / (e.g., "review-code")
  description?: string;        // Optional description shown in dropdown
  argumentHint?: string;       // Placeholder text for arguments (e.g., "[file] [focus]")
  allowedTools?: string[];     // Restrict tools when command is used
  model?: string;              // Optional provider-specific model override
  content: string;             // Prompt template with placeholders
  source?: SlashCommandSource; // Origin of the command (builtin, user, plugin, sdk)
  kind?: 'command' | 'skill';  // Explicit type — replaces id-prefix heuristic
  // Provider-owned command metadata that the UI preserves and round-trips.
  disableModelInvocation?: boolean;  // Disable model invocation for this skill
  userInvocable?: boolean;           // Whether user can invoke this skill directly
  context?: 'fork';                  // Subagent execution mode
  agent?: string;                    // Subagent type when context='fork'
  hooks?: Record<string, unknown>;   // Pass-through to SDK
}

/** Keyboard navigation settings for vim-style scrolling. */
export interface KeyboardNavigationSettings {
  scrollUpKey: string;         // Key to scroll up when focused on messages (default: 'w')
  scrollDownKey: string;       // Key to scroll down when focused on messages (default: 's')
  focusInputKey: string;       // Key to focus input (default: 'i', like vim insert mode)
}

/** Tab bar position setting. */
export type TabBarPosition = 'input' | 'header';

export const DEFAULT_MAX_TABS = 5;
export const MIN_TABS = 1;
export const MAX_TABS = 10;

export function normalizeMaxTabs(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : DEFAULT_MAX_TABS;

  return Math.max(MIN_TABS, Math.min(MAX_TABS, numeric));
}

export const CHAT_VIEW_PLACEMENTS = [
  'right-sidebar',
  'left-sidebar',
  'main-tab',
] as const;

/** Workspace location used when opening the Grimoire chat view. */
export type ChatViewPlacement = typeof CHAT_VIEW_PLACEMENTS[number];

/** Result from instruction refinement agent query. */
export interface InstructionRefineResult {
  success: boolean;
  refinedInstruction?: string;  // The refined instruction text
  clarification?: string;       // Agent's clarifying question (if any)
  error?: string;               // Error message (if failed)
}

export const PERMISSION_MODES = ['full_access', 'plan', 'normal'] as const;
export type PermissionMode = typeof PERMISSION_MODES[number];
export const LEGACY_YOLO_PERMISSION_MODE = 'yolo';

/** Permission mode for tool execution. */
export function coercePermissionMode(value: unknown): PermissionMode | undefined {
  if (value === LEGACY_YOLO_PERMISSION_MODE) {
    return 'full_access';
  }

  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
    ? value as PermissionMode
    : undefined;
}

export function normalizePermissionMode(
  value: unknown,
  fallback: PermissionMode = 'normal',
): PermissionMode {
  return coercePermissionMode(value) ?? fallback;
}

/** Scope for environment variable storage and snippets. */
export type EnvironmentScope = 'shared' | `provider:${string}`;

/** Opaque device-keyed CLI paths for per-device configuration. */
export type HostnameCliPaths = Record<string, string>;

/** Opaque provider-owned settings bags keyed by provider id. */
export type ProviderConfigMap = Partial<Record<string, Record<string, unknown>>>;

export type AdvancedSectionsOpen = Record<string, boolean>;

export interface ContextEngineSettings {
  vaultSearchEnabled: boolean;
  vaultSearchMaxResults: number;
  vaultSearchMaxSnippetChars: number;
  relevantNotesEnabled: boolean;
  relevantNotesMaxResults: number;
  projectWorkspaces: ProjectWorkspace[];
  activeProjectWorkspaceId: string;
}

/**
 * Application settings stored in .grimoire/grimoire-settings.json.
 *
 * Provider-specific fields (model, thinkingBudget, effortLevel, serviceTier, etc.) use
 * `string` here.  The active provider casts internally when it needs
 * narrower types.
 */
export interface GrimoireSettings {
  // User preferences
  userName: string;

  // Security
  permissionMode: PermissionMode;

  // Model & thinking (provider interprets values)
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  enableAutoTitleGeneration: boolean;
  titleGenerationModel: string;

  // Content settings
  excludedTags: string[];
  excludedFolders: string[];
  mediaFolder: string;
  systemPrompt: string;
  persistentExternalContextPaths: string[];
  contextEngine: ContextEngineSettings;

  // Environment
  sharedEnvironmentVariables: string;
  envSnippets: EnvSnippet[];
  customContextLimits: Record<string, number>;
  customModelAliases: Record<string, string>;

  // UI settings
  keyboardNavigation: KeyboardNavigationSettings;
  requireCommandOrControlEnterToSend: boolean;
  advancedSectionsOpen: AdvancedSectionsOpen;
  usageIndicatorsEnabled: boolean;
  debugLoggingEnabled: boolean;

  // Internationalization
  locale: string;

  // Provider-owned settings
  providerConfigs: ProviderConfigMap;

  // Provider selection
  settingsProvider: string;  // ProviderId — which provider's model/effort/budget is projected to top-level fields
  savedProviderModel: Partial<Record<string, string>>;
  savedProviderEffort: Partial<Record<string, string>>;
  savedProviderServiceTier: Partial<Record<string, string>>;
  savedProviderThinkingBudget: Partial<Record<string, string>>;
  savedProviderPermissionMode: Partial<Record<string, string>>;

  // State (provider-specific, round-tripped opaquely)
  lastCustomModel?: string;

  // Changelog state
  lastSeenChangelogVersion: string;

  // UI preferences
  maxTabs: number;
  tabBarPosition: TabBarPosition;
  /**
   * Whether every panel segment says its word, or only the active one.
   *
   * Off by default: the switch is dense repeating chrome that a reader learns
   * once, so it ships as a rail of glyphs with the active segment named. On is
   * for a reader who would rather not learn it.
   */
  showPanelLabels: boolean;
  enableAutoScroll: boolean;
  deferMathRenderingDuringStreaming: boolean;
  chatViewPlacement: ChatViewPlacement;

  // Provider command visibility
  hiddenProviderCommands: HiddenProviderCommands;

  // Allow provider-specific extension fields
  [key: string]: unknown;
}
