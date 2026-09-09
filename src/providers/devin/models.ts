export const DEVIN_SYNTHETIC_MODEL_ID = 'devin';
export const DEVIN_MODEL_PREFIX = 'devin:';

export function encodeDevinModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${DEVIN_MODEL_PREFIX}${normalized}` : DEVIN_SYNTHETIC_MODEL_ID;
}

export function decodeDevinModelId(model: string): string | null {
  if (!model.startsWith(DEVIN_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(DEVIN_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function isDevinModelSelectionId(model: string): boolean {
  return model === DEVIN_SYNTHETIC_MODEL_ID || model.startsWith(DEVIN_MODEL_PREFIX);
}
