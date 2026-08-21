import type { AntigravityDiscoveredModel } from './settings';

export const ANTIGRAVITY_SYNTHETIC_MODEL_ID = 'antigravity';
export const ANTIGRAVITY_MODEL_PREFIX = 'antigravity:';
export const ANTIGRAVITY_DEFAULT_REASONING_LEVEL = 'default';
export const ANTIGRAVITY_FALLBACK_DISCOVERED_MODELS: ReadonlyArray<AntigravityDiscoveredModel> = Object.freeze([
  {
    description: 'Antigravity fallback model',
    label: 'Gemini 3.5 Flash (Medium)',
    rawId: 'Gemini 3.5 Flash (Medium)',
  },
  {
    description: 'Antigravity fallback model',
    label: 'Gemini 3.5 Flash (High)',
    rawId: 'Gemini 3.5 Flash (High)',
  },
  {
    description: 'Antigravity fallback model',
    label: 'Gemini 3.5 Flash (Low)',
    rawId: 'Gemini 3.5 Flash (Low)',
  },
  {
    description: 'Antigravity fallback model',
    label: 'Gemini 3.1 Pro (Low)',
    rawId: 'Gemini 3.1 Pro (Low)',
  },
  {
    description: 'Antigravity fallback model',
    label: 'Gemini 3.1 Pro (High)',
    rawId: 'Gemini 3.1 Pro (High)',
  },
  {
    description: 'Antigravity fallback model',
    label: 'Claude Sonnet 4.6 (Thinking)',
    rawId: 'Claude Sonnet 4.6 (Thinking)',
  },
  {
    description: 'Antigravity fallback model',
    label: 'Claude Opus 4.6 (Thinking)',
    rawId: 'Claude Opus 4.6 (Thinking)',
  },
  {
    description: 'Antigravity fallback model',
    label: 'GPT-OSS 120B (Medium)',
    rawId: 'GPT-OSS 120B (Medium)',
  },
]);

export function normalizeAntigravityModelSelector(value: string): string {
  const columns = value
    .split('\t')
    .map((column) => column.trim())
    .filter(Boolean);
  return columns.at(-1) ?? '';
}

export function encodeAntigravityModelId(rawModelId: string): string {
  const normalized = normalizeAntigravityModelSelector(rawModelId);
  return normalized ? `${ANTIGRAVITY_MODEL_PREFIX}${normalized}` : ANTIGRAVITY_SYNTHETIC_MODEL_ID;
}

export function decodeAntigravityModelId(model: string): string | null {
  if (!model.startsWith(ANTIGRAVITY_MODEL_PREFIX)) {
    // Both branches of the ternary that was here answered `null`; the synthetic
    // id is not prefixed either, so it lands in exactly the same place.
    return null;
  }

  const rawModelId = normalizeAntigravityModelSelector(model.slice(ANTIGRAVITY_MODEL_PREFIX.length));
  return rawModelId || null;
}

export function isAntigravityModelSelectionId(model: string): boolean {
  return model === ANTIGRAVITY_SYNTHETIC_MODEL_ID || model.startsWith(ANTIGRAVITY_MODEL_PREFIX);
}
