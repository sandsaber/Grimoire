export interface KimicodeDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface KimicodeModelVariant {
  description?: string;
  label: string;
  value: string;
}

export type KimicodeThinkingOptionsByModel = Record<string, KimicodeModelVariant[]>;

export interface KimicodeBaseModel {
  description?: string;
  label: string;
  rawId: string;
  variants: KimicodeModelVariant[];
}

export const KIMICODE_SYNTHETIC_MODEL_ID = 'kimicode';
export const KIMICODE_DEFAULT_THINKING_LEVEL = 'default';

const KIMICODE_MODEL_PREFIX = 'kimicode:';
const KIMICODE_VARIANT_ASCENDING_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
] as const;
const KIMICODE_VARIANT_ASCENDING_RANK = new Map<string, number>(
  KIMICODE_VARIANT_ASCENDING_ORDER.map((value, index) => [value, index] as const),
);

export function isKimicodeModelSelectionId(model: string): boolean {
  return model === KIMICODE_SYNTHETIC_MODEL_ID || model.startsWith(KIMICODE_MODEL_PREFIX);
}

export function encodeKimicodeModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${KIMICODE_MODEL_PREFIX}${normalized}` : KIMICODE_SYNTHETIC_MODEL_ID;
}

export function decodeKimicodeModelId(model: string): string | null {
  if (!model.startsWith(KIMICODE_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(KIMICODE_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeKimicodeDiscoveredModels(value: unknown): KimicodeDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: KimicodeDiscoveredModel[] = [];
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

export function normalizeKimicodeModelVariants(value: unknown): KimicodeModelVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const variants: KimicodeModelVariant[] = [];
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
      label: rawLabel || formatKimicodeThinkingLevelLabel(rawValue),
      value: rawValue,
    });
  }

  return dedupeKimicodeVariants(variants);
}

export function normalizeKimicodeThinkingOptionsByModel(
  value: unknown,
  discoveredModels: KimicodeDiscoveredModel[] = [],
): KimicodeThinkingOptionsByModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: KimicodeThinkingOptionsByModel = {};
  for (const [rawId, variants] of Object.entries(value as Record<string, unknown>)) {
    const normalizedRawId = resolveKimicodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedVariants = normalizeKimicodeModelVariants(variants);
    if (!normalizedRawId || normalizedVariants.length === 0) {
      continue;
    }

    normalized[normalizedRawId] = normalizedVariants;
  }

  return normalized;
}

export function resolveKimicodeBaseModelRawId(
  rawId: string,
  discoveredModels: KimicodeDiscoveredModel[] | Set<string>,
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
  return KIMICODE_VARIANT_ASCENDING_RANK.has(variant)
    ? candidate
    : normalizedRawId;
}

export function extractKimicodeModelVariantValue(
  rawId: string,
  discoveredModels: KimicodeDiscoveredModel[] | Set<string>,
): string | null {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return null;
  }

  const baseRawId = resolveKimicodeBaseModelRawId(normalizedRawId, discoveredModels);
  if (baseRawId === normalizedRawId || baseRawId.length >= normalizedRawId.length) {
    return null;
  }

  const variant = normalizedRawId.slice(baseRawId.length + 1).trim();
  return variant || null;
}

export function splitKimicodeModelLabel(label: string): {
  modelLabel: string;
  providerLabel: string;
} {
  const trimmed = label.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return {
      modelLabel: trimmed,
      providerLabel: 'Other',
    };
  }

  return {
    modelLabel: trimmed.slice(slashIndex + 1).trim(),
    providerLabel: trimmed.slice(0, slashIndex).trim(),
  };
}

export function buildKimicodeBaseModels(
  models: KimicodeDiscoveredModel[],
): KimicodeBaseModel[] {
  const discoveredRawIds = new Set(models.map((model) => model.rawId));
  const discoveredByRawId = new Map(models.map((model) => [model.rawId, model] as const));
  const grouped = new Map<string, KimicodeDiscoveredModel[]>();

  for (const model of models) {
    const baseRawId = resolveKimicodeBaseModelRawId(model.rawId, discoveredRawIds);
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

        const variant = extractKimicodeModelVariantValue(entry.rawId, discoveredRawIds);
        if (!variant) {
          return [];
        }

        return [{
          ...(entry.description ? { description: entry.description } : {}),
          label: formatKimicodeThinkingLevelLabel(variant),
          value: variant,
        }];
      });

      return {
        ...(baseModel?.description ? { description: baseModel.description } : {}),
        label: baseModel?.label ?? baseRawId,
        rawId: baseRawId,
        variants: dedupeKimicodeVariants(variants),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function formatKimicodeThinkingLevelLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function dedupeKimicodeVariants(variants: KimicodeModelVariant[]): KimicodeModelVariant[] {
  const unique = new Map<string, KimicodeModelVariant>();
  for (const variant of variants) {
    if (!unique.has(variant.value)) {
      unique.set(variant.value, variant);
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => compareKimicodeVariantValues(left.value, right.value));
}

function compareKimicodeVariantValues(left: string, right: string): number {
  const leftRank = KIMICODE_VARIANT_ASCENDING_RANK.get(left.toLowerCase());
  const rightRank = KIMICODE_VARIANT_ASCENDING_RANK.get(right.toLowerCase());

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
