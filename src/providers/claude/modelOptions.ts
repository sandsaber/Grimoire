import type { ProviderUIOption } from '../../core/providers/types';
import { getClaudeApiModelId, getCurrentModelFromEnvironment, getModelsFromEnvironment } from './env/claudeModelEnv';
import { formatCustomModelLabel } from './modelLabels';
import {
  type ClaudeDiscoveredModel,
  getClaudeEffectiveEnvironmentVariables,
  getClaudeProviderSettings,
} from './settings';
import { CONTEXT_WINDOW_1M, DEFAULT_CLAUDE_MODELS, resolveClaudeContextWindowSize } from './types/models';

function parseConfiguredCustomModelIds(value: string): string[] {
  const modelIds: string[] = [];
  const seen = new Set<string>();

  for (const line of value.split(/\r?\n/)) {
    const modelId = line.trim();
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    modelIds.push(modelId);
  }

  return modelIds;
}

function normalizeCustomModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const aliases: Record<string, string> = {};
  for (const [rawModelId, rawAlias] of Object.entries(value)) {
    if (typeof rawAlias !== 'string') {
      continue;
    }

    const modelId = rawModelId.trim();
    const alias = rawAlias.trim();
    if (modelId && alias) {
      aliases[modelId] = alias;
    }
  }

  return aliases;
}

function formatDiscoveredModelDescription(model: ClaudeDiscoveredModel): string {
  const description = model.description || 'Anthropic API model';
  const contextWindow = resolveClaudeContextWindowSize(model.id, undefined, [model]);
  if (contextWindow >= CONTEXT_WINDOW_1M && !/\b1m\s+context\b/i.test(description)) {
    return `${description} · 1M context`;
  }

  return description;
}

function appendModelOption(
  models: ProviderUIOption[],
  seenValues: Set<string>,
  option: ProviderUIOption,
): void {
  if (seenValues.has(option.value)) {
    return;
  }

  seenValues.add(option.value);
  models.push(option);
}

export function getClaudeModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const customModelAliases = normalizeCustomModelAliases(settings.customModelAliases);
  const customModels = getModelsFromEnvironment(
    getClaudeEffectiveEnvironmentVariables(settings),
    customModelAliases,
  );
  const claudeSettings = getClaudeProviderSettings(settings);
  const discovered = claudeSettings.discoveredModels;
  const apiCatalog = discovered.length > 0 && discovered.every(model => model.source === 'api');
  const models: ProviderUIOption[] = [];
  const seenValues = new Set<string>();

  for (const model of claudeSettings.discoveredModels) {
    appendModelOption(models, seenValues, {
      value: model.id,
      label: customModelAliases[model.id] ?? model.displayName,
      description: formatDiscoveredModelDescription(model),
    });
  }

  if (discovered.length === 0) {
    for (const model of customModels.length > 0 ? customModels : DEFAULT_CLAUDE_MODELS) {
      appendModelOption(models, seenValues, model);
    }
  } else {
    for (const option of customModels) {
      const match = discovered.find(model => model.id === getClaudeApiModelId(option.value));
      if (apiCatalog && !match) continue;
      if (discovered.some(model => model.resolvedModel === option.value)) continue;
      appendModelOption(models, seenValues, {
        ...option,
        ...(match ? { label: customModelAliases[option.value] ?? `${match.displayName}${option.value !== match.id ? ' (1M)' : ''}` } : {}),
      });
    }
  }

  for (const modelId of parseConfiguredCustomModelIds(claudeSettings.customModels)) {
    if (seenValues.has(modelId)) {
      continue;
    }

    seenValues.add(modelId);
    models.push({
      value: modelId,
      label: customModelAliases[modelId] ?? formatCustomModelLabel(modelId),
      description: 'Custom model',
    });
  }

  const projectSettingsModel = claudeSettings.respectProjectSettings
    ? claudeSettings.projectSettingsSnapshot.model
    : '';
  if (projectSettingsModel && !seenValues.has(projectSettingsModel)
    && (!apiCatalog || discovered.some(model => model.id === getClaudeApiModelId(projectSettingsModel)))) {
    seenValues.add(projectSettingsModel);
    models.push({
      value: projectSettingsModel,
      label: customModelAliases[projectSettingsModel] ?? formatCustomModelLabel(projectSettingsModel),
      description: 'Claude Code settings model',
    });
  }

  return models;
}

export function resolveClaudeModelSelection(
  settings: Record<string, unknown>,
  currentModel: string,
): string | null {
  const modelOptions = getClaudeModelOptions(settings);
  if (currentModel && modelOptions.some(option => option.value === currentModel)) {
    return currentModel;
  }

  const claudeSettings = getClaudeProviderSettings(settings);
  const projectSettingsModel = claudeSettings.respectProjectSettings
    ? claudeSettings.projectSettingsSnapshot.model
    || getCurrentModelFromEnvironment(getClaudeEffectiveEnvironmentVariables(settings))
    || ''
    : '';
  if (projectSettingsModel && modelOptions.some(option => option.value === projectSettingsModel)) {
    return projectSettingsModel;
  }

  const lastModel = claudeSettings.lastModel;
  if (lastModel && modelOptions.some(option => option.value === lastModel)) {
    return lastModel;
  }

  return modelOptions[0]?.value ?? null;
}
