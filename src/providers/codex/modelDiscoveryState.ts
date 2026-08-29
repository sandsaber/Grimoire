import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';

export interface CodexDiscoveredModel {
  description?: string;
  id: string;
  isDefault?: boolean;
  label: string;
}

interface CodexModelDiscoveryState {
  discoveredModels: CodexDiscoveredModel[];
}

const CODEX_MODEL_DISCOVERY_STATE = Symbol('codexModelDiscoveryState');

type SettingsBag = Record<string | symbol, unknown>;

function ensureDiscoveryState(settings: Record<string, unknown>): CodexModelDiscoveryState {
  const bag = settings as SettingsBag;
  const existing = bag[CODEX_MODEL_DISCOVERY_STATE];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const state = existing as Partial<CodexModelDiscoveryState>;
    state.discoveredModels = normalizeCodexDiscoveredModels(state.discoveredModels);
    return state as CodexModelDiscoveryState;
  }

  const next: CodexModelDiscoveryState = {
    discoveredModels: normalizeCodexDiscoveredModels(
      getProviderConfig(settings, 'codex').discoveredModels,
    ),
  };
  Object.defineProperty(bag, CODEX_MODEL_DISCOVERY_STATE, {
    configurable: true,
    enumerable: false,
    value: next,
    writable: true,
  });
  return next;
}

function cloneDiscoveredModels(models: CodexDiscoveredModel[]): CodexDiscoveredModel[] {
  return models.map((model) => ({ ...model }));
}

export function normalizeCodexDiscoveredModels(value: unknown): CodexDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: CodexDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : id;
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
      ...(record.isDefault === true ? { isDefault: true } : {}),
      label: label || id,
    });
  }

  return normalized;
}

export function getCodexModelDiscoveryState(
  settings: Record<string, unknown>,
): CodexModelDiscoveryState {
  const state = ensureDiscoveryState(settings);
  return {
    discoveredModels: cloneDiscoveredModels(state.discoveredModels),
  };
}

export interface CodexModelDiscoveryUpdates {
  discoveredModels?: CodexDiscoveredModel[];
  discoveredModelsFingerprint?: string;
}

/**
 * Persists a discovery result and the digest of the configuration it ran under.
 *
 * Returns whether persisted discovery state changed, so the caller knows to
 * save. A run that finds the same models under a new CLI still changes the
 * digest, which is the point: without that write the next load would compare
 * the previous configuration's digest and rediscover on every start.
 */
export function updateCodexModelDiscoveryState(
  settings: Record<string, unknown>,
  updates: CodexModelDiscoveryUpdates,
): boolean {
  const state = ensureDiscoveryState(settings);
  const config = getProviderConfig(settings, 'codex');
  const nextDiscoveredModels = 'discoveredModels' in updates
    ? normalizeCodexDiscoveredModels(updates.discoveredModels)
    : state.discoveredModels;
  const currentFingerprint = typeof config.discoveredModelsFingerprint === 'string'
    ? config.discoveredModelsFingerprint
    : '';
  const nextFingerprint = typeof updates.discoveredModelsFingerprint === 'string'
    ? updates.discoveredModelsFingerprint
    : currentFingerprint;

  if (
    sameDiscoveredModels(state.discoveredModels, nextDiscoveredModels)
    && nextFingerprint === currentFingerprint
  ) {
    return false;
  }

  state.discoveredModels = cloneDiscoveredModels(nextDiscoveredModels);
  setProviderConfig(settings, 'codex', {
    ...config,
    discoveredModels: cloneDiscoveredModels(nextDiscoveredModels),
    discoveredModelsFingerprint: nextFingerprint,
  });
  return true;
}

function sameDiscoveredModels(
  left: CodexDiscoveredModel[],
  right: CodexDiscoveredModel[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftModel, index) => {
    const rightModel = right[index];
    return rightModel
      && leftModel.id === rightModel.id
      && leftModel.label === rightModel.label
      && leftModel.description === rightModel.description
      && leftModel.isDefault === rightModel.isDefault;
  });
}
