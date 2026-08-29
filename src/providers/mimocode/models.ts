export interface MimocodeDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface MimocodeModelVariant {
  description?: string;
  label: string;
  value: string;
}

export type MimocodeThinkingOptionsByModel = Record<string, MimocodeModelVariant[]>;

export interface MimocodeBaseModel {
  description?: string;
  label: string;
  rawId: string;
  variants: MimocodeModelVariant[];
}

export const MIMOCODE_SYNTHETIC_MODEL_ID = 'mimocode';
export const MIMOCODE_DEFAULT_THINKING_LEVEL = 'default';

const MIMOCODE_MODEL_PREFIX = 'mimocode:';
const MIMOCODE_VARIANT_ASCENDING_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
] as const;
const MIMOCODE_VARIANT_ASCENDING_RANK = new Map<string, number>(
  MIMOCODE_VARIANT_ASCENDING_ORDER.map((value, index) => [value, index] as const),
);

export function isMimocodeModelSelectionId(model: string): boolean {
  return model === MIMOCODE_SYNTHETIC_MODEL_ID || model.startsWith(MIMOCODE_MODEL_PREFIX);
}

export function encodeMimocodeModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${MIMOCODE_MODEL_PREFIX}${normalized}` : MIMOCODE_SYNTHETIC_MODEL_ID;
}

export function decodeMimocodeModelId(model: string): string | null {
  if (!model.startsWith(MIMOCODE_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(MIMOCODE_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeMimocodeDiscoveredModels(value: unknown): MimocodeDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: MimocodeDiscoveredModel[] = [];
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

export function normalizeMimocodeModelVariants(value: unknown): MimocodeModelVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const variants: MimocodeModelVariant[] = [];
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
      label: rawLabel || formatMimocodeThinkingLevelLabel(rawValue),
      value: rawValue,
    });
  }

  return dedupeMimocodeVariants(variants);
}

export function normalizeMimocodeThinkingOptionsByModel(
  value: unknown,
  discoveredModels: MimocodeDiscoveredModel[] = [],
): MimocodeThinkingOptionsByModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: MimocodeThinkingOptionsByModel = {};
  for (const [rawId, variants] of Object.entries(value as Record<string, unknown>)) {
    const normalizedRawId = resolveMimocodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedVariants = normalizeMimocodeModelVariants(variants);
    if (!normalizedRawId || normalizedVariants.length === 0) {
      continue;
    }

    normalized[normalizedRawId] = normalizedVariants;
  }

  return normalized;
}

export function resolveMimocodeBaseModelRawId(
  rawId: string,
  discoveredModels: MimocodeDiscoveredModel[] | Set<string>,
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
  return MIMOCODE_VARIANT_ASCENDING_RANK.has(variant)
    ? candidate
    : normalizedRawId;
}

export function extractMimocodeModelVariantValue(
  rawId: string,
  discoveredModels: MimocodeDiscoveredModel[] | Set<string>,
): string | null {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return null;
  }

  const baseRawId = resolveMimocodeBaseModelRawId(normalizedRawId, discoveredModels);
  if (baseRawId === normalizedRawId || baseRawId.length >= normalizedRawId.length) {
    return null;
  }

  const variant = normalizedRawId.slice(baseRawId.length + 1).trim();
  return variant || null;
}

export function splitMimocodeModelLabel(label: string): {
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

export function buildMimocodeBaseModels(
  models: MimocodeDiscoveredModel[],
): MimocodeBaseModel[] {
  const discoveredRawIds = new Set(models.map((model) => model.rawId));
  const discoveredByRawId = new Map(models.map((model) => [model.rawId, model] as const));
  const grouped = new Map<string, MimocodeDiscoveredModel[]>();

  for (const model of models) {
    const baseRawId = resolveMimocodeBaseModelRawId(model.rawId, discoveredRawIds);
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

        const variant = extractMimocodeModelVariantValue(entry.rawId, discoveredRawIds);
        if (!variant) {
          return [];
        }

        return [{
          ...(entry.description ? { description: entry.description } : {}),
          label: formatMimocodeThinkingLevelLabel(variant),
          value: variant,
        }];
      });

      return {
        ...(baseModel?.description ? { description: baseModel.description } : {}),
        label: baseModel?.label ?? baseRawId,
        rawId: baseRawId,
        variants: dedupeMimocodeVariants(variants),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function formatMimocodeThinkingLevelLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function dedupeMimocodeVariants(variants: MimocodeModelVariant[]): MimocodeModelVariant[] {
  const unique = new Map<string, MimocodeModelVariant>();
  for (const variant of variants) {
    if (!unique.has(variant.value)) {
      unique.set(variant.value, variant);
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => compareMimocodeVariantValues(left.value, right.value));
}

function compareMimocodeVariantValues(left: string, right: string): number {
  const leftRank = MIMOCODE_VARIANT_ASCENDING_RANK.get(left.toLowerCase());
  const rightRank = MIMOCODE_VARIANT_ASCENDING_RANK.get(right.toLowerCase());

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
