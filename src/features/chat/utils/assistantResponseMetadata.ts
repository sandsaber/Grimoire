import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type { AssistantResponseMetadata } from '../../../core/types';

type MetadataOptions = {
  model?: string;
};

const CHAT_PROVIDER_LABELS: Record<string, string> = {
  antigravity: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI (Legacy)',
  opencode: 'OpenCode',
  qwen: 'Qwen Code',
};

export function getAssistantResponseProviderLabel(providerId: ProviderId): string {
  return CHAT_PROVIDER_LABELS[providerId] ?? providerCatalog().displayName(providerId);
}

function normalizeDisplayString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function formatModelFallbackLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return 'Unknown';
  }

  if (/^gpt-/i.test(trimmed)) {
    return trimmed
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-([a-z])/gi, (_, letter: string) => ` ${letter.toUpperCase()}`);
  }

  return trimmed
    .replace(/^claude[-_/]/i, '')
    .replace(/-(\d+)-(\d+)/g, ' $1.$2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function resolveModelLabel(
  providerId: ProviderId,
  model: string,
  settings: Record<string, unknown>,
): string | undefined {
  if (!model) {
    return undefined;
  }

  const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
  return uiConfig.getModelOptions(settings).find(option => option.value === model)?.label
    ?? formatModelFallbackLabel(model);
}

function resolveEffortMetadata(
  providerId: ProviderId,
  model: string,
  settings: Record<string, unknown>,
): Pick<AssistantResponseMetadata, 'effort' | 'effortLabel'> {
  const capabilities = ProviderRegistry.getCapabilities(providerId);
  if (capabilities.reasoningControl !== 'effort') {
    return {};
  }

  const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
  const options = uiConfig.getReasoningOptions(model, settings);
  const rawEffort = normalizeDisplayString(settings.effortLevel)
    ?? normalizeDisplayString(uiConfig.getDefaultReasoningValue(model, settings));
  if (!rawEffort) {
    return {};
  }

  const effort = options.some(option => option.value === rawEffort)
    ? rawEffort
    : normalizeDisplayString(uiConfig.getDefaultReasoningValue(model, settings));
  if (!effort) {
    return {};
  }

  const effortLabel = options.find(option => option.value === effort)?.label
    ?? formatModelFallbackLabel(effort);

  return { effort, effortLabel };
}

export function buildAssistantResponseMetadata(
  providerId: ProviderId,
  settings: Record<string, unknown>,
  options: MetadataOptions = {},
): AssistantResponseMetadata {
  const model = normalizeDisplayString(options.model)
    ?? normalizeDisplayString(settings.model)
    ?? '';
  const modelLabel = resolveModelLabel(providerId, model, settings);
  const effortMetadata = resolveEffortMetadata(providerId, model, settings);

  return {
    providerId,
    providerLabel: getAssistantResponseProviderLabel(providerId),
    ...(model ? { model } : {}),
    ...(modelLabel ? { modelLabel } : {}),
    ...effortMetadata,
  };
}
