import '@/providers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
import type { ProviderChatUIConfig } from '@/core/providers/types';
import { antigravityChatUIConfig } from '@/providers/antigravity/ui/AntigravityChatUIConfig';
import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';
import { geminiChatUIConfig } from '@/providers/gemini/ui/GeminiChatUIConfig';
import { grokChatUIConfig } from '@/providers/grok/ui/GrokChatUIConfig';
import { kimicodeChatUIConfig } from '@/providers/kimicode/ui/KimicodeChatUIConfig';
import { mimocodeChatUIConfig } from '@/providers/mimocode/ui/MimocodeChatUIConfig';
import { opencodeChatUIConfig } from '@/providers/opencode/ui/OpencodeChatUIConfig';
import { qwenChatUIConfig } from '@/providers/qwen/ui/QwenChatUIConfig';

/**
 * The module's chat-UI contribution against the config the product renders from.
 *
 * The nine modules each carried a hand-written model presentation answering
 * three of the row's twenty questions, while the live config answered all
 * twenty — two inventories of which models a provider owns, how wide their
 * context is, and which are built in. **They disagreed.** Codex's module said a
 * model it does not own has no context window; its live config takes no model at
 * all and answers a constant, which is what the meter draws. Nothing could see
 * it, because no test asked both.
 *
 * The contribution delegates now, so the two cannot differ — and this is what
 * says so, for every provider and every member, rather than trusting that a
 * delegation stays one.
 */

const CONFIGS: ReadonlyArray<readonly [string, ProviderChatUIConfig]> = [
  ['antigravity', antigravityChatUIConfig],
  ['claude', claudeChatUIConfig],
  ['codex', codexChatUIConfig],
  ['gemini', geminiChatUIConfig],
  ['grok', grokChatUIConfig],
  ['kimicode', kimicodeChatUIConfig],
  ['mimocode', mimocodeChatUIConfig],
  ['opencode', opencodeChatUIConfig],
  ['qwen', qwenChatUIConfig],
];

/** A handful of ids spanning every provider, so each is asked about foreign ones too. */
const MODEL_IDS = [
  'claude-opus-5',
  'gpt-5.5',
  'grok:grok-4.6',
  'opencode:openai/gpt-5.4',
  'qwen:qwen3-coder',
  'antigravity:gemini-3-pro',
  'a-model-nobody-declares',
];

describe('chat UI contribution parity', () => {
  function settings(): Record<string, unknown> {
    return { providerConfigs: {} };
  }

  it.each(CONFIGS)('%s answers ownership exactly as its config does', (providerId, config) => {
    const models = providerCatalog().declarations(providerId).chatUI.models;

    for (const modelId of MODEL_IDS) {
      expect(models.ownsModel(modelId, settings())).toBe(config.ownsModel(modelId, settings()));
    }
  });

  it.each(CONFIGS)('%s answers context width exactly as its config does', (providerId, config) => {
    const models = providerCatalog().declarations(providerId).chatUI.models;

    for (const modelId of MODEL_IDS) {
      // The disagreement that started this file: one implementation answered
      // `undefined` for a foreign model and the other a constant.
      expect(models.contextWindow(modelId, settings()))
        .toBe(config.getContextWindowSize(modelId, undefined, settings()));
    }
  });

  it.each(CONFIGS)('%s answers which models are built in exactly as its config does', (providerId, config) => {
    const models = providerCatalog().declarations(providerId).chatUI.models;

    for (const modelId of MODEL_IDS) {
      expect(models.isBuiltIn(modelId)).toBe(config.isDefaultModel(modelId));
    }
  });

  it.each(CONFIGS)('%s offers the same options its config does', (providerId, config) => {
    const models = providerCatalog().declarations(providerId).chatUI.models;

    expect(models.options(settings())).toEqual(config.getModelOptions(settings()));
  });

  it.each(CONFIGS)('%s normalizes a variant exactly as its config does', (providerId, config) => {
    const models = providerCatalog().declarations(providerId).chatUI.models;

    for (const modelId of MODEL_IDS) {
      expect(models.normalizeVariant(modelId, settings()))
        .toBe(config.normalizeModelVariant(modelId, settings()));
    }
  });

  it.each(CONFIGS)('%s declares a group only where the provider has that control', (providerId, config) => {
    const chatUI = providerCatalog().declarations(providerId).chatUI;
    // The descriptor, not the legacy projection beside it: what decides the
    // group is what the provider declares about itself.
    const capabilities = providerCatalog().require(providerId).capabilities;

    // **Not `config.getReasoningOptions !== undefined`.** That is a required
    // member of the config, so comparing the group against it was
    // `true === true` for all nine — a gate that could not fail, in the test
    // named for the thing it was supposed to catch. What decides the group is
    // the provider's declared control.
    expect(chatUI.reasoning !== undefined)
      .toBe(capabilities.reasoningControl.kind !== 'none');
    expect(chatUI.permissionMode !== undefined).toBe(config.getPermissionModeToggle !== undefined);
    // A hook the provider does not implement is not offered: Claude and Codex
    // publish a toggle and implement neither, and a required `apply` delegating
    // to an absent hook reports success having written nothing.
    expect(chatUI.permissionMode?.apply !== undefined)
      .toBe(config.applyPermissionMode !== undefined);
    expect(chatUI.permissionMode?.resolve !== undefined)
      .toBe(config.resolvePermissionMode !== undefined);
    expect(chatUI.serviceTier !== undefined).toBe(config.getServiceTierToggle !== undefined);
  });

  it.each(CONFIGS)('%s offers no mode selector, because no provider has one', providerId => {
    // All four implementations of `getModeSelector` are typed `(): null` and no
    // provider implements `applyModeSelection`. Deriving the group from the
    // method's presence declared a control that can never render an option.
    expect(providerCatalog().declarations(providerId).chatUI.modeSelector).toBeUndefined();
  });

  it.each(CONFIGS)('%s answers every reasoning question as its config does', (providerId, config) => {
    const reasoning = providerCatalog().declarations(providerId).chatUI.reasoning;
    if (!reasoning) {
      return;
    }
    for (const modelId of MODEL_IDS) {
      expect(reasoning.isTiered(modelId, settings()))
        .toBe(config.isAdaptiveReasoningModel(modelId, settings()));
      expect(reasoning.options(modelId, settings()))
        .toEqual(config.getReasoningOptions(modelId, settings()));
      expect(reasoning.defaultValue(modelId, settings()))
        .toBe(config.getDefaultReasoningValue(modelId, settings()));
    }
  });

  it.each(CONFIGS)('%s answers its permission toggle as its config does', (providerId, config) => {
    const permissionMode = providerCatalog().declarations(providerId).chatUI.permissionMode;

    expect(permissionMode?.toggle() ?? null).toEqual(config.getPermissionModeToggle?.() ?? null);
    expect(permissionMode?.resolve?.(settings()) ?? null)
      .toBe(config.resolvePermissionMode?.(settings()) ?? null);
  });

  it.each(CONFIGS)('%s answers custom model ids and bang-bash as its config does', (providerId, config) => {
    const chatUI = providerCatalog().declarations(providerId).chatUI;
    const environment = { ANTHROPIC_MODEL: 'claude-custom', OPENAI_MODEL: 'gpt-custom' };

    expect([...chatUI.models.customModelIds(environment)])
      .toEqual([...config.getCustomModelIds(environment)]);
    expect(chatUI.bangBashEnabled(settings()))
      .toBe(config.isBangBashEnabled?.(settings()) ?? false);
  });

  it.each(CONFIGS)('%s writes the same model defaults its config writes', (providerId, config) => {
    const models = providerCatalog().declarations(providerId).chatUI.models;
    const throughRow = settings();
    const throughConfig = settings();

    models.applyDefaults('gpt-5.5', throughRow);
    config.applyModelDefaults('gpt-5.5', throughConfig);

    // In place, both of them. The contract says so now; it used to say the
    // opposite while delegating to this.
    expect(throughRow).toEqual(throughConfig);
  });

  it.each(CONFIGS)('%s honours a per-model override as its config does', (providerId, config) => {
    const models = providerCatalog().declarations(providerId).chatUI.models;
    const overrides = { 'gpt-5.5': 12_345 };

    // The delegation's one genuine parameter transposition — the row takes
    // `(model, customLimits, settings)` and the slot `(model, settings,
    // customLimits)` — and it was never exercised with an override present.
    expect(models.contextWindow('gpt-5.5', settings(), overrides))
      .toBe(config.getContextWindowSize('gpt-5.5', overrides, settings()));
  });

  it.each(CONFIGS)('%s resolves its icon only when asked', (providerId, config) => {
    const chatUI = providerCatalog().declarations(providerId).chatUI;

    // A module is built at import. An icon held rather than asked for runs
    // whatever resolves it before the application has composed anything, which
    // is how this first went in.
    expect(typeof chatUI.icon).toBe('function');
    // The whole icon, not its viewBox: a `toChatIcon` that returned an empty
    // path, or dropped every group child, would pass a viewBox comparison —
    // and the contract's own note says a flattened icon fails nowhere until it
    // renders wrong. Two providers share a mark, so a viewBox cannot even tell
    // them apart.
    expect(chatUI.icon()).toEqual(config.getProviderIcon?.() ?? null);
  });
});
