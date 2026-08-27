/**
 * The configured title model, if this provider is the one that owns it.
 *
 * Five providers wrote this: read `titleGenerationModel`, ask the provider's
 * chat UI whether it owns it, and — for the four with composite ids — decode it
 * to the native one. The ownership question is the load-bearing part: the title
 * provider is chosen from the model, so a provider asked for a title it does
 * not own is the fallback path, and passing a foreign model id to it is how
 * that fallback used to fail.
 */
export function resolveConfiguredTitleModel(
  settings: Record<string, unknown>,
  owns: (modelId: string, settings: Record<string, unknown>) => boolean,
  decode: (modelId: string) => string | null = modelId => modelId,
): string | undefined {
  const titleModel = typeof settings.titleGenerationModel === 'string'
    ? settings.titleGenerationModel
    : '';
  if (!titleModel || !owns(titleModel, settings)) {
    return undefined;
  }
  return decode(titleModel) ?? undefined;
}
