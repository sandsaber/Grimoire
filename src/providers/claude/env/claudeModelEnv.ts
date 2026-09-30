import { formatCustomModelLabel } from '../modelLabels';

const CUSTOM_MODEL_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

/** Claude Code treats the context suffix as an option, not part of the API ID. */
export function getClaudeApiModelId(model: string): string {
  return model.trim().replace(/\[1m\]$/i, '');
}

export function getEnvironmentModelName(envVars: Record<string, string>, model: string): string | undefined {
  const apiId = getClaudeApiModelId(model);
  for (const key of CUSTOM_MODEL_ENV_KEYS) {
    if (getClaudeApiModelId(envVars[key] ?? '') === apiId) {
      const name = envVars[`${key}_NAME`]?.trim();
      if (name) return name;
    }
  }
  return undefined;
}

export function getEnvironmentModelSlots(envVars: Record<string, string>): { id: string; model: string }[] {
  return CUSTOM_MODEL_ENV_KEYS.flatMap(key => {
    const model = envVars[key]?.trim();
    return model ? [{ id: key === 'ANTHROPIC_MODEL' ? 'default' : getModelTypeFromEnvKey(key), model }] : [];
  });
}

function getModelTypeFromEnvKey(envKey: string): string {
  if (envKey === 'ANTHROPIC_MODEL') return 'model';
  const match = envKey.match(/ANTHROPIC_DEFAULT_(\w+)_MODEL/);
  return match ? match[1].toLowerCase() : envKey;
}

export function getModelsFromEnvironment(
  envVars: Record<string, string>,
  modelAliases: Record<string, string> = {},
): { value: string; label: string; description: string }[] {
  const modelMap = new Map<string, { types: string[]; label: string }>();

  for (const envKey of CUSTOM_MODEL_ENV_KEYS) {
    const type = getModelTypeFromEnvKey(envKey);
    const modelValue = envVars[envKey];
    if (modelValue) {
      const label = modelAliases[modelValue] ?? getEnvironmentModelName(envVars, modelValue) ?? formatCustomModelLabel(modelValue);

      if (!modelMap.has(modelValue)) {
        modelMap.set(modelValue, { types: [type], label });
      } else {
        modelMap.get(modelValue)!.types.push(type);
      }
    }
  }

  const models: { value: string; label: string; description: string }[] = [];
  const typePriority = { 'model': 5, 'fable': 4, 'haiku': 3, 'sonnet': 2, 'opus': 1 };

  const sortedEntries = Array.from(modelMap.entries()).sort(([, aInfo], [, bInfo]) => {
    const aPriority = Math.max(...aInfo.types.map(t => typePriority[t as keyof typeof typePriority] || 0));
    const bPriority = Math.max(...bInfo.types.map(t => typePriority[t as keyof typeof typePriority] || 0));
    return bPriority - aPriority;
  });

  for (const [modelValue, info] of sortedEntries) {
    const sortedTypes = info.types.sort((a, b) =>
      (typePriority[b as keyof typeof typePriority] || 0) -
      (typePriority[a as keyof typeof typePriority] || 0)
    );

    models.push({
      value: modelValue,
      label: info.label,
      description: `Custom model (${sortedTypes.join(', ')})`
    });
  }

  return models;
}

export function getCurrentModelFromEnvironment(envVars: Record<string, string>): string | null {
  if (envVars.ANTHROPIC_MODEL) {
    return envVars.ANTHROPIC_MODEL;
  }
  if (envVars.ANTHROPIC_DEFAULT_FABLE_MODEL) {
    return envVars.ANTHROPIC_DEFAULT_FABLE_MODEL;
  }
  if (envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    return envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  }
  if (envVars.ANTHROPIC_DEFAULT_SONNET_MODEL) {
    return envVars.ANTHROPIC_DEFAULT_SONNET_MODEL;
  }
  if (envVars.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    return envVars.ANTHROPIC_DEFAULT_OPUS_MODEL;
  }
  return null;
}

export function getCustomModelIds(envVars: Record<string, string>): Set<string> {
  const modelIds = new Set<string>();
  for (const envKey of CUSTOM_MODEL_ENV_KEYS) {
    const modelId = envVars[envKey];
    if (modelId) {
      modelIds.add(modelId);
    }
  }
  return modelIds;
}
