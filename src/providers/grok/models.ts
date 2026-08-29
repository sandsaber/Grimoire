export interface GrokDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface GrokModelVariant {
  description?: string;
  label: string;
  value: string;
}

export type GrokThinkingOptionsByModel = Record<string, GrokModelVariant[]>;

export interface GrokBaseModel {
  description?: string;
  label: string;
  rawId: string;
  variants: GrokModelVariant[];
}

export interface GrokDiscoveredModelGroup {
  models: GrokDiscoveredModel[];
  providerKey: string;
  providerLabel: string;
}

export const GROK_SYNTHETIC_MODEL_ID = 'grok';
export const GROK_DEFAULT_THINKING_LEVEL = 'default';
export const GROK_NATIVE_THINKING_DEFAULT = 'high';

const GROK_LAUNCH_REASONING_EFFORT_VALUES = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

export const GROK_NATIVE_THINKING_OPTIONS: GrokModelVariant[] = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra high', value: 'xhigh' },
];

const GROK_MODEL_PREFIX = 'grok:';
const GROK_VARIANT_ASCENDING_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
] as const;
const GROK_VARIANT_ASCENDING_RANK = new Map<string, number>(
  GROK_VARIANT_ASCENDING_ORDER.map((value, index) => [value, index] as const),
);

export function isGrokModelSelectionId(model: string): boolean {
  return model === GROK_SYNTHETIC_MODEL_ID || model.startsWith(GROK_MODEL_PREFIX);
}

export function normalizeGrokLaunchReasoningEffort(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === GROK_DEFAULT_THINKING_LEVEL || normalized === 'default') {
    return null;
  }

  return GROK_LAUNCH_REASONING_EFFORT_VALUES.has(normalized)
    ? normalized
    : null;
}

/**
 * Native xAI model ids, as opposed to third-party catalog ids such as
 * `anthropic/...`. Matched case-insensitively, like every other prefix test in
 * this file, so a catalog that reports `Grok-4.6` is still recognised.
 */
export function isGrokNativeModelId(rawModelId: string): boolean {
  const normalized = rawModelId.trim().toLowerCase();
  if (!normalized || normalized.includes('/')) {
    return false;
  }

  return normalized === GROK_SYNTHETIC_MODEL_ID || normalized.startsWith('grok-');
}

export function encodeGrokModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${GROK_MODEL_PREFIX}${normalized}` : GROK_SYNTHETIC_MODEL_ID;
}

export function decodeGrokModelId(model: string): string | null {
  if (!model.startsWith(GROK_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(GROK_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeGrokDiscoveredModels(value: unknown): GrokDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: GrokDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : rawId;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!rawId || seen.has(rawId)) {
      continue;
    }

    seen.add(rawId);
    normalized.push({
      ...(description ? { description } : {}),
      label: label || rawId,
      rawId,
    });
  }

  return normalized;
}

export function normalizeGrokModelVariants(value: unknown): GrokModelVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const variants: GrokModelVariant[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawValue = typeof record.value === 'string' ? record.value.trim() : '';
    if (!rawValue) {
      continue;
    }

    let rawLabel = '';
    if (typeof record.label === 'string') {
      rawLabel = record.label.trim();
    } else if (typeof record.name === 'string') {
      rawLabel = record.name.trim();
    }
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    variants.push({
      ...(description ? { description } : {}),
      label: rawLabel || formatGrokThinkingLevelLabel(rawValue),
      value: rawValue,
    });
  }

  return dedupeGrokVariants(variants);
}

/**
 * Model ids reach this from the agent and from persisted settings, so they are
 * untrusted keys: `__proto__` would replace this object's prototype instead of
 * adding an entry.
 */
const UNSAFE_MODEL_ID_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizeGrokThinkingOptionsByModel(
  value: unknown,
  discoveredModels: GrokDiscoveredModel[] | Set<string> = [],
): GrokThinkingOptionsByModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  // Built once rather than per key: resolveGrokBaseModelRawId would otherwise
  // rebuild it for every entry, and this map now holds a whole catalog.
  const discoveredRawIds = discoveredModels instanceof Set
    ? discoveredModels
    : new Set(discoveredModels.map((model) => model.rawId));

  const normalized: GrokThinkingOptionsByModel = {};
  const exactRawIds = new Set<string>();
  for (const [rawId, variants] of Object.entries(value as Record<string, unknown>)) {
    const trimmedRawId = rawId.trim();
    if (UNSAFE_MODEL_ID_KEYS.has(trimmedRawId)) {
      continue;
    }

    const normalizedRawId = resolveGrokBaseModelRawId(trimmedRawId, discoveredRawIds);
    const normalizedVariants = normalizeGrokModelVariants(variants);
    if (!normalizedRawId || normalizedVariants.length === 0) {
      continue;
    }

    // A variant id collapses onto its base, so `grok-4.6/high` must not
    // overwrite what `grok-4.6` itself reported - otherwise iteration order
    // decides which list the picker gets.
    const isExact = normalizedRawId === trimmedRawId;
    if (!isExact && exactRawIds.has(normalizedRawId)) {
      continue;
    }
    if (isExact) {
      exactRawIds.add(normalizedRawId);
    }

    normalized[normalizedRawId] = normalizedVariants;
  }

  return normalized;
}

export function resolveGrokBaseModelRawId(
  rawId: string,
  discoveredModels: GrokDiscoveredModel[] | Set<string>,
): string {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return '';
  }

  const discoveredRawIds = discoveredModels instanceof Set
    ? discoveredModels
    : new Set(discoveredModels.map((model) => model.rawId));
  const slashIndex = normalizedRawId.lastIndexOf('/');
  if (slashIndex <= 0) {
    return normalizedRawId;
  }

  const candidate = normalizedRawId.slice(0, slashIndex);
  if (discoveredRawIds.has(candidate)) {
    return candidate;
  }

  const variant = normalizedRawId.slice(slashIndex + 1).trim().toLowerCase();
  return GROK_VARIANT_ASCENDING_RANK.has(variant)
    ? candidate
    : normalizedRawId;
}

export function extractGrokModelVariantValue(
  rawId: string,
  discoveredModels: GrokDiscoveredModel[] | Set<string>,
): string | null {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return null;
  }

  const baseRawId = resolveGrokBaseModelRawId(normalizedRawId, discoveredModels);
  if (baseRawId === normalizedRawId || baseRawId.length >= normalizedRawId.length) {
    return null;
  }

  const variant = normalizedRawId.slice(baseRawId.length + 1).trim();
  return variant || null;
}

export function combineGrokRawModelSelection(
  baseRawId: string | null | undefined,
  thinkingLevel: string | null | undefined,
  discoveredModels: GrokDiscoveredModel[],
): string | null {
  const normalizedBaseRawId = baseRawId?.trim();
  if (!normalizedBaseRawId) {
    return null;
  }

  const variant = thinkingLevel?.trim();
  if (!variant || variant === GROK_DEFAULT_THINKING_LEVEL) {
    return normalizedBaseRawId;
  }

  const supportedVariants = new Set(
    getGrokModelVariants(normalizedBaseRawId, discoveredModels).map((entry) => entry.value),
  );
  return supportedVariants.has(variant)
    ? `${normalizedBaseRawId}/${variant}`
    : normalizedBaseRawId;
}

export function splitGrokModelLabel(
  label: string,
  rawId?: string,
): {
  modelLabel: string;
  providerLabel: string;
} {
  const trimmedLabel = label.trim();
  const trimmedRawId = rawId?.trim() ?? '';
  const slashIndex = trimmedLabel.indexOf('/');
  if (slashIndex > 0 && slashIndex < trimmedLabel.length - 1) {
    return {
      modelLabel: trimmedLabel.slice(slashIndex + 1).trim(),
      providerLabel: trimmedLabel.slice(0, slashIndex).trim(),
    };
  }

  const fromRawId = splitGrokNativeModelIdentity(trimmedRawId);
  if (fromRawId) {
    return fromRawId;
  }

  const fromLabel = splitGrokNativeModelLabel(trimmedLabel);
  if (fromLabel) {
    return fromLabel;
  }

  return {
    modelLabel: trimmedLabel,
    providerLabel: 'Other',
  };
}

function splitGrokNativeModelIdentity(
  rawId: string,
): { modelLabel: string; providerLabel: string } | null {
  const normalized = rawId.trim().toLowerCase();
  if (!normalized.startsWith('grok-')) {
    return null;
  }

  const remainder = rawId.trim().slice('grok-'.length);
  if (remainder.toLowerCase().startsWith('composer')) {
    const composerRemainder = remainder.slice('composer'.length).replace(/^-/, '');
    return {
      modelLabel: formatGrokNativeModelSegment(composerRemainder) || 'Composer',
      providerLabel: 'Composer',
    };
  }

  if (remainder.toLowerCase().startsWith('build')) {
    const buildRemainder = remainder.slice('build'.length).replace(/^-/, '');
    return {
      modelLabel: buildRemainder
        ? formatGrokNativeModelSegment(buildRemainder)
        : 'Build',
      providerLabel: 'Grok Build',
    };
  }

  return {
    modelLabel: formatGrokNativeModelSegment(remainder),
    providerLabel: 'Grok',
  };
}

function splitGrokNativeModelLabel(
  label: string,
): { modelLabel: string; providerLabel: string } | null {
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('grok composer')) {
    const modelLabel = trimmed.slice('grok composer'.length).trim();
    return {
      modelLabel: modelLabel || 'Composer',
      providerLabel: 'Composer',
    };
  }

  if (lower.startsWith('grok build')) {
    const modelLabel = trimmed.slice('grok build'.length).trim();
    return {
      modelLabel: modelLabel || 'Build',
      providerLabel: 'Grok Build',
    };
  }

  if (lower.startsWith('grok ')) {
    return {
      modelLabel: trimmed.slice('grok '.length).trim() || trimmed,
      providerLabel: 'Grok',
    };
  }

  return null;
}

function formatGrokNativeModelSegment(segment: string): string {
  return segment
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => {
      if (/^\d/.test(part)) {
        return part;
      }

      if (part.toLowerCase() === 'xhigh') {
        return 'XHigh';
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export function buildGrokBaseModels(
  models: GrokDiscoveredModel[],
): GrokBaseModel[] {
  const discoveredRawIds = new Set(models.map((model) => model.rawId));
  const discoveredByRawId = new Map(models.map((model) => [model.rawId, model] as const));
  const grouped = new Map<string, GrokDiscoveredModel[]>();

  for (const model of models) {
    const baseRawId = resolveGrokBaseModelRawId(model.rawId, discoveredRawIds);
    const existing = grouped.get(baseRawId);
    if (existing) {
      existing.push(model);
    } else {
      grouped.set(baseRawId, [model]);
    }
  }

  return Array.from(grouped.entries())
    .map(([baseRawId, entries]) => {
      const baseModel = discoveredByRawId.get(baseRawId) ?? entries[0];
      const variants = entries.flatMap((entry) => {
        if (entry.rawId === baseRawId) {
          return [];
        }

        const variant = extractGrokModelVariantValue(entry.rawId, discoveredRawIds);
        if (!variant) {
          return [];
        }

        return [{
          ...(entry.description ? { description: entry.description } : {}),
          label: formatGrokThinkingLevelLabel(variant),
          value: variant,
        }];
      });

      return {
        ...(baseModel?.description ? { description: baseModel.description } : {}),
        label: baseModel?.label ?? baseRawId,
        rawId: baseRawId,
        variants: dedupeGrokVariants(variants),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getGrokModelVariants(
  rawId: string,
  models: GrokDiscoveredModel[],
): GrokModelVariant[] {
  const baseRawId = resolveGrokBaseModelRawId(rawId, models);
  return buildGrokBaseModels(models)
    .find((model) => model.rawId === baseRawId)?.variants ?? [];
}

function formatGrokThinkingLevelLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function groupGrokDiscoveredModels(
  models: GrokDiscoveredModel[],
): GrokDiscoveredModelGroup[] {
  const groups = new Map<string, GrokDiscoveredModelGroup>();
  for (const model of buildGrokBaseModels(models)) {
    const { providerLabel } = splitGrokModelLabel(model.label || model.rawId, model.rawId);
    const providerKey = providerLabel.toLowerCase();
    const existing = groups.get(providerKey);
    if (existing) {
      existing.models.push({
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        rawId: model.rawId,
      });
      continue;
    }

    groups.set(providerKey, {
      models: [{
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        rawId: model.rawId,
      }],
      providerKey,
      providerLabel,
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      models: [...group.models].sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => left.providerLabel.localeCompare(right.providerLabel));
}

function dedupeGrokVariants(variants: GrokModelVariant[]): GrokModelVariant[] {
  const unique = new Map<string, GrokModelVariant>();
  for (const variant of variants) {
    if (!unique.has(variant.value)) {
      unique.set(variant.value, variant);
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => compareGrokVariantValues(left.value, right.value));
}

function compareGrokVariantValues(left: string, right: string): number {
  const leftRank = GROK_VARIANT_ASCENDING_RANK.get(left.toLowerCase());
  const rightRank = GROK_VARIANT_ASCENDING_RANK.get(right.toLowerCase());

  if (leftRank !== undefined && rightRank !== undefined) {
    return leftRank - rightRank;
  }

  if (leftRank !== undefined) {
    return -1;
  }

  if (rightRank !== undefined) {
    return 1;
  }

  return left.localeCompare(right);
}
