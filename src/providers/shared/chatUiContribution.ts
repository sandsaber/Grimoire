import type {
  ProviderChatIcon,
  ProviderChatUiContribution,
} from '../../core/providers/ProviderModule';
import type { ProviderChatUIConfig } from '../../core/providers/types';

/**
 * A provider's chat-UI contribution, over the config it already has.
 *
 * **A delegation, not a second implementation.** The nine modules each carried a
 * hand-written `models` answering three of the row's twenty
 * questions, against decoded provider settings, while the live config answered
 * all twenty against the app's — a third inventory of the same facts, and the
 * one place where a module and its provider could quietly disagree about which
 * models a provider owns.
 *
 * So the module's contribution *is* the live config, grouped. Nothing here
 * decides anything: every answer comes from the object the chat surface already
 * asks, which is what makes moving this row a move rather than a rewrite.
 */
export function chatUiContributionFor(config: ProviderChatUIConfig): ProviderChatUiContribution {
  return {
    bangBashEnabled: settings => config.isBangBashEnabled?.(settings) ?? false,

    icon: () => toChatIcon(config),

    models: {
      contextWindow: (modelId, settings, customLimits) => (
        config.getContextWindowSize(modelId, customLimits, settings)
      ),
      customModelIds: environment => config.getCustomModelIds(environment),
      defaultsFor: (modelId, settings) => { config.applyModelDefaults(modelId, settings); },
      isBuiltIn: modelId => config.isDefaultModel(modelId),
      normalizeVariant: (modelId, settings) => config.normalizeModelVariant(modelId, settings),
      options: settings => config.getModelOptions(settings),
      ownsModel: (modelId, settings) => config.ownsModel(modelId, settings),
      ...(config.prepareModelMetadata
        ? {
          prepareMetadata: (modelId, settings, host) => (
            config.prepareModelMetadata?.(modelId, settings, host as { plugin: never })
              ?? Promise.resolve()
          ),
        }
        : {}),
    },

    // Absent means unsupported: a provider with no reasoning control is one
    // whose picker has no reasoning row, which is a different statement from
    // one that offers an empty list of tiers.
    ...(config.getReasoningOptions
      ? {
        reasoning: {
          apply: (modelId, value, settings) => {
            config.applyReasoningSelection?.(modelId, value, settings);
          },
          defaultValue: (modelId, settings) => config.getDefaultReasoningValue(modelId, settings),
          isTiered: (modelId, settings) => config.isAdaptiveReasoningModel(modelId, settings),
          options: (modelId, settings) => config.getReasoningOptions(modelId, settings),
        },
      }
      : {}),

    ...(config.getPermissionModeToggle
      ? {
        permissionMode: {
          apply: (value, settings) => { config.applyPermissionMode?.(value, settings); },
          resolve: settings => config.resolvePermissionMode?.(settings) ?? null,
          toggle: () => config.getPermissionModeToggle?.() ?? null,
        },
      }
      : {}),

    ...(config.getServiceTierToggle
      ? { serviceTier: { toggle: settings => config.getServiceTierToggle?.(settings) ?? null } }
      : {}),

    ...(config.getModeSelector
      ? {
        modeSelector: {
          apply: (value, settings) => { config.applyModeSelection?.(value, settings); },
          selector: settings => config.getModeSelector?.(settings) ?? null,
        },
      }
      : {}),
  };
}

/**
 * The provider's icon, as a structure rather than a name.
 *
 * The slot held a string — an icon *id* the host would have had to resolve
 * against a registry it does not own. What a provider actually returns is a
 * viewBox and one or more paths.
 */
function toChatIcon(config: ProviderChatUIConfig): ProviderChatIcon | null {
  const icon = config.getProviderIcon?.();
  if (!icon) {
    return null;
  }
  return icon.kind === 'composite'
    ? { kind: 'composite', children: icon.children, viewBox: icon.viewBox }
    : { kind: 'path', path: icon.path, viewBox: icon.viewBox };
}
