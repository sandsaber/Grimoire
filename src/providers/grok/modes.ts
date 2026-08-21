import { coercePermissionMode } from '../../core/types/settings';

export interface GrokMode {
  description?: string;
  id: string;
  name: string;
}

export const GROK_BUILD_MODE_ID = 'build';
export const GROK_FULL_ACCESS_MODE_ID = 'grimoire-full-access';
export const GROK_LEGACY_YOLO_MODE_ID = 'grimoire-yolo';
export const GROK_SAFE_MODE_ID = 'grimoire-safe';
export const GROK_PLAN_MODE_ID = 'plan';

export const GROK_FALLBACK_MODES: ReadonlyArray<GrokMode> = Object.freeze([
  {
    description: 'Auto-approves tool actions.',
    id: GROK_FULL_ACCESS_MODE_ID,
    name: 'auto-approve',
  },
  {
    description: 'Safe mode. Asks before shell commands and file edits.',
    id: GROK_SAFE_MODE_ID,
    name: 'safe',
  },
  {
    description: 'Plan mode. Disallows all edit tools.',
    id: GROK_PLAN_MODE_ID,
    name: GROK_PLAN_MODE_ID,
  },
]);

export function normalizeGrokAvailableModes(value: unknown): GrokMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: GrokMode[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : id;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      ...(description ? { description } : {}),
      id,
      name: name || id,
    });
  }

  return normalized;
}

export function getEffectiveGrokModes(modes: GrokMode[]): GrokMode[] {
  return modes.length > 0 ? modes : [...GROK_FALLBACK_MODES];
}

export function getManagedGrokModes(modes: GrokMode[]): GrokMode[] {
  const effectiveModes = getEffectiveGrokModes(modes);
  return GROK_FALLBACK_MODES.map((fallbackMode) => (
    effectiveModes.find((mode) => mode.id === fallbackMode.id) ?? fallbackMode
  ));
}

export function normalizeGrokSelectedMode(
  value: unknown,
): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed;
}

export function normalizeManagedGrokSelectedMode(
  value: unknown,
  modes: GrokMode[] = [],
): string {
  const normalized = normalizeGrokSelectedMode(value);
  if (!normalized) {
    return '';
  }

  const permissionMode = resolvePermissionModeForManagedGrokMode(normalized);
  const canonicalModeId = permissionMode
    ? resolveGrokModeForPermissionMode(permissionMode, modes)
    : normalized;
  const managedModes = getManagedGrokModes(modes);
  return managedModes.some((mode) => mode.id === canonicalModeId)
    ? canonicalModeId
    : (managedModes[0]?.id ?? '');
}

export function resolveGrokModeForPermissionMode(
  permissionMode: unknown,
  modes: GrokMode[] = [],
): string {
  const managedModes = getManagedGrokModes(modes);
  const managedModeIds = new Set(managedModes.map((mode) => mode.id));

  if (permissionMode === 'plan' && managedModeIds.has(GROK_PLAN_MODE_ID)) {
    return GROK_PLAN_MODE_ID;
  }
  if (permissionMode === 'normal' && managedModeIds.has(GROK_SAFE_MODE_ID)) {
    return GROK_SAFE_MODE_ID;
  }
  if (coercePermissionMode(permissionMode) === 'full_access' && managedModeIds.has(GROK_FULL_ACCESS_MODE_ID)) {
    return GROK_FULL_ACCESS_MODE_ID;
  }
  if (managedModeIds.has(GROK_FULL_ACCESS_MODE_ID)) {
    return GROK_FULL_ACCESS_MODE_ID;
  }

  return managedModes[0]?.id ?? '';
}

export type GrokPermissionMode = 'always-approve' | 'ask' | 'plan';

export function resolveGrokPermissionModeForSettings(
  permissionMode: unknown,
): GrokPermissionMode {
  if (permissionMode === 'plan') {
    return 'plan';
  }
  if (coercePermissionMode(permissionMode) === 'full_access') {
    return 'always-approve';
  }
  return 'ask';
}

/**
 * ACP `session/set_mode` must use an id the live session actually advertised.
 * Grimoire toolbar ids (`grimoire-full-access`, `grimoire-safe`) are not Grok
 * native mode ids; sending them after a later `current_mode_update` yields
 * JSON-RPC `-32602 Invalid params` and aborts the turn before the prompt.
 */
export function resolveGrokAcpModeId(
  selectedModeId: string,
  currentModeId: string | null,
  advertisedModeIds: readonly string[] = [],
): string | null {
  const selectedPermission = resolvePermissionModeForManagedGrokMode(selectedModeId);
  if (
    currentModeId
    && selectedPermission
    && selectedPermission === resolvePermissionModeForManagedGrokMode(currentModeId)
  ) {
    return currentModeId;
  }

  if (advertisedModeIds.includes(selectedModeId)) {
    return selectedModeId;
  }

  if (!selectedPermission) {
    return null;
  }

  const nativeId = resolveGrokPermissionModeForSettings(selectedPermission);
  if (advertisedModeIds.includes(nativeId)) {
    return nativeId;
  }

  return advertisedModeIds.find((id) => (
    resolvePermissionModeForManagedGrokMode(id) === selectedPermission
  )) ?? null;
}

export function resolvePermissionModeForManagedGrokMode(
  modeId: unknown,
): 'normal' | 'plan' | 'full_access' | null {
  if (typeof modeId !== 'string') {
    return null;
  }

  const normalized = modeId.trim().toLowerCase();
  if (
    normalized === GROK_BUILD_MODE_ID
    || normalized === GROK_FULL_ACCESS_MODE_ID
    || normalized === GROK_LEGACY_YOLO_MODE_ID
    || normalized === 'always-approve'
    || normalized === 'bypasspermissions'
    || normalized === 'yolo'
  ) {
    return 'full_access';
  }
  if (
    normalized === GROK_SAFE_MODE_ID
    || normalized === 'ask'
    || normalized === 'default'
    || normalized === 'normal'
    || normalized === 'safe'
  ) {
    return 'normal';
  }
  if (normalized === GROK_PLAN_MODE_ID) {
    return 'plan';
  }
  return null;
}
