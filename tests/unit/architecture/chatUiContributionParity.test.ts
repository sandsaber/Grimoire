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

  it.each(CONFIGS)('%s declares a reasoning control only where its config has one', (providerId, config) => {
    const chatUI = providerCatalog().declarations(providerId).chatUI;

    // Absent means unsupported: a provider with no reasoning control has no
    // reasoning row, which is a different statement from an empty tier list.
    expect(chatUI.reasoning !== undefined).toBe(config.getReasoningOptions !== undefined);
    expect(chatUI.permissionMode !== undefined).toBe(config.getPermissionModeToggle !== undefined);
    expect(chatUI.serviceTier !== undefined).toBe(config.getServiceTierToggle !== undefined);
    expect(chatUI.modeSelector !== undefined).toBe(config.getModeSelector !== undefined);
  });

  it.each(CONFIGS)('%s resolves its icon only when asked', (providerId, config) => {
    const chatUI = providerCatalog().declarations(providerId).chatUI;

    // A module is built at import. An icon held rather than asked for runs
    // whatever resolves it before the application has composed anything, which
    // is how this first went in.
    expect(typeof chatUI.icon).toBe('function');
    expect(chatUI.icon()?.viewBox).toBe(config.getProviderIcon?.()?.viewBox);
  });
});
