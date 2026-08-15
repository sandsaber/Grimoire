import * as fs from 'node:fs';
import * as path from 'node:path';

import { sameDiscoveredModels, sameStringList } from '../../../utils/collections';
import { expandHomePath } from '../../../utils/path';
import { updateGrokDiscoveryState } from '../discoveryState';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
import {
  decodeGrokModelId,
  encodeGrokModelId,
  type GrokDiscoveredModel,
  isGrokModelSelectionId,
  normalizeGrokDiscoveredModels,
  resolveGrokBaseModelRawId,
} from '../models';
import { getGrokProviderSettings, updateGrokProviderSettings } from '../settings';
import { resolveGrokDataDir } from './GrokPaths';

export const GROK_MODELS_CACHE_FILE = 'models_cache.json';

export interface GrokNativeModelCatalog {
  defaultModelId: string | null;
  models: GrokDiscoveredModel[];
}

export function resolveNativeGrokDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicitAuth = env.GROK_AUTH_PATH?.trim() || env.GROK_AUTH?.trim();
  if (explicitAuth) {
    return path.dirname(expandHomePath(explicitAuth));
  }

  const { GROK_HOME: _ignored, ...withoutManagedHome } = env;
  return resolveGrokDataDir(withoutManagedHome);
}

export function resolveGrokModelsCachePaths(params: {
  env?: NodeJS.ProcessEnv;
  managedGrokHomePath?: string | null;
} = {}): string[] {
  const env = params.env ?? process.env;
  const paths: string[] = [];
  const seen = new Set<string>();
  const push = (filePath: string): void => {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    paths.push(resolved);
  };

  push(path.join(resolveNativeGrokDataDir(env), GROK_MODELS_CACHE_FILE));
  const managedHome = params.managedGrokHomePath?.trim();
  if (managedHome) {
    push(path.join(expandHomePath(managedHome), GROK_MODELS_CACHE_FILE));
  }
  const grokHome = env.GROK_HOME?.trim();
  if (grokHome) {
    push(path.join(expandHomePath(grokHome), GROK_MODELS_CACHE_FILE));
  }

  return paths;
}

export function readGrokNativeModelCatalog(params: {
  env?: NodeJS.ProcessEnv;
  managedGrokHomePath?: string | null;
} = {}): GrokNativeModelCatalog {
  const env = params.env ?? process.env;
  const models: GrokDiscoveredModel[] = [];
  for (const cachePath of resolveGrokModelsCachePaths(params)) {
    models.push(...readGrokModelsCacheFile(cachePath).models);
  }

  const configuredDefault = readGrokConfigDefaultModel(
    path.join(resolveNativeGrokDataDir(env), 'config.toml'),
  );
  const normalized = mergeGrokDiscoveredModels(models);
  return {
    defaultModelId: resolveGrokCatalogDefaultModel(normalized, configuredDefault),
    models: normalized,
  };
}

export function readGrokModelsCacheFile(filePath: string): GrokNativeModelCatalog {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseGrokModelsCache(JSON.parse(raw));
  } catch {
    return { defaultModelId: null, models: [] };
  }
}

export function parseGrokModelsCache(value: unknown): GrokNativeModelCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { defaultModelId: null, models: [] };
  }

  const record = value as Record<string, unknown>;
  const modelsRecord = isPlainObject(record.models) ? record.models : {};
  const models: GrokDiscoveredModel[] = [];
  for (const [rawId, entry] of Object.entries(modelsRecord)) {
    const info = isPlainObject(entry) && isPlainObject(entry.info)
      ? entry.info
      : (isPlainObject(entry) ? entry : null);
    if (!info || info.hidden === true) {
      continue;
    }

    const id = readNonEmptyString(info.id)
      ?? readNonEmptyString(info.model)
      ?? rawId.trim();
    if (!id) {
      continue;
    }

    const label = readNonEmptyString(info.name) ?? id;
    const description = readNonEmptyString(info.description);
    models.push({
      ...(description ? { description } : {}),
      label,
      rawId: id,
    });
  }

  const normalized = normalizeGrokDiscoveredModels(models);
  return {
    defaultModelId: resolveGrokCatalogDefaultModel(normalized, null),
    models: normalized,
  };
}

export function parseGrokModelsCliOutput(output: string): GrokNativeModelCatalog {
  const defaultFromHeader = output.match(/^Default model:\s+(\S+)/m)?.[1]?.trim() ?? null;
  const models: GrokDiscoveredModel[] = [];
  const seen = new Set<string>();
  let defaultFromList: string | null = null;

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[*+-]\s+(\S+)/);
    if (!match) {
      continue;
    }

    const rawId = match[1]?.trim() ?? '';
    if (!rawId || seen.has(rawId)) {
      continue;
    }

    seen.add(rawId);
    if (/\(default\)/i.test(line)) {
      defaultFromList = rawId;
    }
    models.push({
      label: formatGrokCatalogLabel(rawId),
      rawId,
    });
  }

  const normalized = normalizeGrokDiscoveredModels(models);
  return {
    defaultModelId: resolveGrokCatalogDefaultModel(
      normalized,
      defaultFromHeader ?? defaultFromList,
    ),
    models: normalized,
  };
}

export function applyGrokNativeModelCatalog(
  settings: Record<string, unknown>,
  catalog: GrokNativeModelCatalog,
): boolean {
  if (catalog.models.length === 0) {
    return false;
  }

  const currentSettings = getGrokProviderSettings(settings);
  const nextVisibleModels = expandGrokVisibleModelsWithFrontier(
    currentSettings.visibleModels,
    catalog.models,
  );
  const discoveryChanged = !sameDiscoveredModels(
    currentSettings.discoveredModels,
    catalog.models,
  ) && updateGrokDiscoveryState(settings, { discoveredModels: catalog.models });
  const upgradedDefault = upgradeGrokFrontierDefaultSelection(
    settings,
    catalog.models,
    currentSettings.visibleModels,
    catalog.defaultModelId,
  );
  const shouldSeedVisibleModels = !sameStringList(
    currentSettings.visibleModels,
    nextVisibleModels,
  );
  if (shouldSeedVisibleModels) {
    updateGrokProviderSettings(settings, { visibleModels: nextVisibleModels });
  }
  return Boolean(discoveryChanged || shouldSeedVisibleModels || upgradedDefault);
}

function upgradeGrokFrontierDefaultSelection(
  settings: Record<string, unknown>,
  discoveredModels: readonly GrokDiscoveredModel[],
  visibleModels: readonly string[],
  configuredDefault?: string | null,
): boolean {
  const savedProviderModel = ensureProviderProjectionMap(settings, 'savedProviderModel');
  const savedRawId = typeof savedProviderModel.grok === 'string'
    ? resolveGrokBaseModelRawId(
      decodeGrokModelId(savedProviderModel.grok) ?? '',
      [...discoveredModels],
    )
    : null;
  const defaultRawId = resolveGrokCatalogDefaultModel(discoveredModels, configuredDefault);
  if (!defaultRawId) {
    return false;
  }
  const shouldSeedEmptySelection = !savedRawId;
  const shouldUpgradeExisting = shouldUpgradeGrokFrontierDefault({
    defaultRawId,
    savedRawId,
    visibleModels,
  });
  if (!shouldSeedEmptySelection && !shouldUpgradeExisting) {
    return false;
  }

  const nextModelId = encodeGrokModelId(defaultRawId);
  savedProviderModel.grok = nextModelId;
  if (typeof settings.model === 'string' && isGrokModelSelectionId(settings.model)) {
    settings.model = nextModelId;
  }
  return true;
}

function formatGrokCatalogLabel(rawId: string): string {
  return /^grok-\d+\.\d+/.test(rawId)
    ? `Grok ${rawId.slice('grok-'.length)}`
    : rawId;
}

export function parseGrokConfigDefaultModel(toml: string): string | null {
  const modelsSection = toml.match(/\[models\]([\s\S]*?)(?:\n\[|\s*$)/);
  if (!modelsSection) {
    return null;
  }

  const match = modelsSection[1]?.match(/^\s*default\s*=\s*"([^"]+)"/m);
  return match?.[1]?.trim() || null;
}

export function mergeGrokDiscoveredModels(
  ...lists: ReadonlyArray<ReadonlyArray<GrokDiscoveredModel>>
): GrokDiscoveredModel[] {
  return normalizeGrokDiscoveredModels(lists.flat());
}

export function resolveGrokCatalogDefaultModel(
  models: readonly GrokDiscoveredModel[],
  configuredDefault?: string | null,
): string | null {
  const configured = configuredDefault?.trim() ?? '';
  if (configured && models.some((model) => model.rawId === configured)) {
    return configured;
  }

  const frontierIds = models
    .map((model) => model.rawId)
    .filter((rawId) => parseGrokFrontierVersion(rawId) !== null)
    .sort(compareGrokFrontierIds);
  return frontierIds[frontierIds.length - 1] ?? models[0]?.rawId ?? null;
}

export function compareGrokFrontierIds(left: string, right: string): number {
  const leftVersion = parseGrokFrontierVersion(left);
  const rightVersion = parseGrokFrontierVersion(right);
  if (!leftVersion || !rightVersion) {
    return left.localeCompare(right);
  }

  return leftVersion.major - rightVersion.major || leftVersion.minor - rightVersion.minor;
}

export function isGrokFrontierModelId(rawId: string): boolean {
  return parseGrokFrontierVersion(rawId) !== null;
}

export function expandGrokVisibleModelsWithFrontier(
  visibleModels: readonly string[],
  discoveredModels: readonly GrokDiscoveredModel[],
): string[] {
  const discoveredIds = discoveredModels.map((model) => model.rawId);
  if (visibleModels.length === 0) {
    return [...discoveredIds];
  }

  const next = [...visibleModels];
  const seen = new Set(visibleModels);
  for (const rawId of discoveredIds) {
    if (!isGrokFrontierModelId(rawId) || seen.has(rawId)) {
      continue;
    }
    seen.add(rawId);
    next.push(rawId);
  }
  return next;
}

export function shouldUpgradeGrokFrontierDefault(params: {
  defaultRawId: string | null;
  savedRawId: string | null;
  visibleModels: readonly string[];
}): boolean {
  const { defaultRawId, savedRawId, visibleModels } = params;
  if (!savedRawId || !defaultRawId || savedRawId === defaultRawId) {
    return false;
  }
  if (visibleModels.length !== 1 || visibleModels[0] !== savedRawId) {
    return false;
  }
  if (!isGrokFrontierModelId(savedRawId) || !isGrokFrontierModelId(defaultRawId)) {
    return false;
  }

  return compareGrokFrontierIds(savedRawId, defaultRawId) < 0;
}

function parseGrokFrontierVersion(
  rawId: string,
): { major: number; minor: number } | null {
  const match = rawId.trim().match(/^grok-(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

function readGrokConfigDefaultModel(filePath: string): string | null {
  try {
    return parseGrokConfigDefaultModel(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
