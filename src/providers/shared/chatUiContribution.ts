import type {
  ProviderChatIcon,
  ProviderChatUiContribution,
  ProviderReasoningControl,
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
/** The host handle `prepareModelMetadata` takes, named rather than invented. */
type MetadataHost = Parameters<NonNullable<ProviderChatUIConfig['prepareModelMetadata']>>[2];

export function chatUiContributionFor(
  config: ProviderChatUIConfig,
  /**
   * What the provider declares about reasoning, which decides whether the
   * group exists. Passed rather than read off the config: the config's
   * reasoning methods are required members and say nothing about whether the
   * provider has a control.
   */
  reasoningControl: ProviderReasoningControl,
): ProviderChatUiContribution {
  return {
    bangBashEnabled: settings => config.isBangBashEnabled?.(settings) ?? false,

    icon: () => toChatIcon(config),

    models: {
      contextWindow: (modelId, settings, customLimits) => (
        config.getContextWindowSize(modelId, customLimits, settings)
      ),
      customModelIds: environment => config.getCustomModelIds(environment),
      applyDefaults: (modelId, settings) => { config.applyModelDefaults(modelId, settings); },
      isBuiltIn: modelId => config.isDefaultModel(modelId),
      ...(config.primaryModel ? { primaryModel: config.primaryModel } : {}),
      normalizeVariant: (modelId, settings) => config.normalizeModelVariant(modelId, settings),
      options: settings => config.getModelOptions(settings),
      ownsModel: (modelId, settings) => config.ownsModel(modelId, settings),
      ...(config.prepareModelMetadata
        ? {
          // Cast to the config's own parameter type, not to a shape invented
          // here: `as { plugin: never }` is a type no value inhabits, so it
          // silenced the compiler at the one place that could have caught a
          // caller passing the plugin instead of `{ plugin }`.
          prepareMetadata: (modelId, settings, host) => (
            config.prepareModelMetadata?.(modelId, settings, host as MetadataHost)
              ?? Promise.resolve()
          ),
        }
        : {}),
    },

    // **From the capability, not from the method.** `getReasoningOptions` is a
    // required member of the config, so a presence check on it is always true
    // and every provider got a reasoning group — including the two that declare
    // they have no reasoning control at all.
    ...(reasoningControl.kind !== 'none'
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

    // The two hooks are offered only where the provider implements them: Claude
    // and Codex publish a toggle and implement neither, so a required `apply`
    // delegating to an absent hook would report success having written nothing.
    ...(config.getPermissionModeToggle
      ? {
        permissionMode: {
          toggle: () => config.getPermissionModeToggle?.() ?? null,
          ...(config.applyPermissionMode
            ? { apply: (value, settings) => { config.applyPermissionMode?.(value, settings); } }
            : {}),
          ...(config.resolvePermissionMode
            ? { resolve: settings => config.resolvePermissionMode?.(settings) ?? null }
            : {}),
        },
      }
      : {}),

    ...(config.getServiceTierToggle
      ? { serviceTier: { toggle: settings => config.getServiceTierToggle?.(settings) ?? null } }
      : {}),

    // **No provider has one.** All four implementations of `getModeSelector`
    // are typed `(): null` and no provider implements `applyModeSelection`, so
    // deriving the group from the method's presence declared a control that can
    // never render an option — for four providers, with an apply hook nobody
    // wrote. A slot with no filler is a provider saying it has none; a slot
    // filled with that is the lie this contract forbids.
  };
}

/**
 * The provider's icon, exactly as the provider returns it.
 *
 * Passed through, not rebuilt. The first version constructed a new object per
 * variant and added a `kind: 'path'` the row leaves off — which is a
 * conversion, and a conversion is where a composite icon's group children get
 * dropped without anything failing until the mark renders wrong.
 */
function toChatIcon(config: ProviderChatUIConfig): ProviderChatIcon | null {
  return config.getProviderIcon?.() ?? null;
}
