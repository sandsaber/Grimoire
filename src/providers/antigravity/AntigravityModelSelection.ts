import {
  ANTIGRAVITY_SYNTHETIC_MODEL_ID,
  encodeAntigravityModelId,
} from './models';
import {
  type AntigravityProviderSettings,
  normalizeAntigravityCustomModels,
} from './settings';

export interface AntigravityModelChoice {
  readonly description: string;
  readonly label: string;
  readonly rawId: string | null;
  readonly selectionId: string;
  readonly source: 'custom' | 'discovered' | 'persisted' | 'provider-default';
}

/** Shared provider-owned selection semantics for legacy UI and the new feature port. */
export function resolveAntigravityModelChoices(
  settings: AntigravityProviderSettings,
): readonly AntigravityModelChoice[] {
  const discoveredModels = new Map(settings.discoveredModels.map(model => [model.rawId, model]));
  const visibleModels = settings.discoveredModels.length > 0
    ? settings.discoveredModels.map(model => model.rawId)
    : settings.visibleModels;
  const customModels = parseCustomModels(settings.customModels);
  const customModelIds = new Set(customModels);
  const rawIds = mergeModelIds(visibleModels, customModels);
  const choices = rawIds.map(rawId => {
    const discovered = discoveredModels.get(rawId);
    const source = discovered
      ? 'discovered' as const
      : customModelIds.has(rawId) ? 'custom' as const : 'persisted' as const;
    return Object.freeze({
      description: discovered
        ? discovered.description ?? 'Antigravity CLI model'
        : source === 'custom' ? 'Custom Antigravity CLI model' : 'Antigravity CLI model',
      label: settings.modelAliases[rawId] ?? discovered?.label ?? rawId,
      rawId,
      selectionId: encodeAntigravityModelId(rawId),
      source,
    });
  });
  return choices.length > 0
    ? choices
    : [Object.freeze({
      description: 'Antigravity CLI default model',
      label: 'Antigravity',
      rawId: null,
      selectionId: ANTIGRAVITY_SYNTHETIC_MODEL_ID,
      source: 'provider-default' as const,
    })];
}

function parseCustomModels(value: string): string[] {
  const normalized = normalizeAntigravityCustomModels(value);
  return normalized ? normalized.split('\n') : [];
}

function mergeModelIds(primary: readonly string[], extra: readonly string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const rawId of [...primary, ...extra]) {
    if (!rawId || seen.has(rawId)) {
      continue;
    }
    seen.add(rawId);
    merged.push(rawId);
  }
  return merged;
}
