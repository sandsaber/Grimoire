import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

/**
 * What a vault with no settings file is given.
 *
 * Written out rather than derived from the codecs, because a test that derives
 * the expectation from the thing under test asserts only that the code equals
 * itself. Adding or removing a key here is a change to the shipped settings
 * file, which is worth seeing in a diff.
 */
const DEFAULT_CONFIG_KEYS: Record<string, readonly string[]> = {
    claude: [
      'cliPath',
      'cliPathsByHost',
      'customModels',
      'discoveredCommands',
      'discoveredCommandsFingerprint',
      'discoveredModelsFingerprint',
      'discoveredModels',
      'enableBangBash',
      'enableChrome',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'lastModel',
      'loadUserSettings',
      'projectSettingsSnapshot',
      'respectProjectSettings',
    ],
    codex: [
      'cliPath',
      'cliPathsByHost',
      'customModels',
      'discoveredModels',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'installationMethod',
      'installationMethodsByHost',
      'reasoningSummary',
      'wslDistroOverride',
      'wslDistroOverridesByHost',
    ],
    opencode: [
      'cliPath',
      'cliPathsByHost',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'modelAliases',
      'preferredThinkingByModel',
      'selectedMode',
      'thinkingOptionsByModel',
      'visibleModels',
    ],
    grok: [
      'cliPath',
      'cliPathsByHost',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'modelAliases',
      'preferredThinkingByModel',
      'selectedMode',
      'thinkingOptionsByModel',
      'visibleModels',
    ],
    mimocode: [
      'cliPath',
      'cliPathsByHost',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'modelAliases',
      'preferredThinkingByModel',
      'selectedMode',
      'thinkingOptionsByModel',
      'visibleModels',
    ],
    kimicode: [
      'cliPath',
      'cliPathsByHost',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'modelAliases',
      'preferredThinkingByModel',
      'selectedMode',
      'thinkingOptionsByModel',
      'visibleModels',
    ],
    antigravity: [
      'cliPath',
      'cliPathsByHost',
      'customModels',
      'discoveredModels',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'modelAliases',
      'visibleModels',
    ],
    gemini: [
      'cliPath',
      'cliPathsByHost',
      'discoveredModelsFingerprint',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'modelAliases',
      'selectedMode',
      'visibleModels',
    ],
    qwen: [
      'cliPath',
      'cliPathsByHost',
      'discoveredModelsFingerprint',
      'effortLevel',
      'enabled',
      'environmentHash',
      'environmentVariables',
      'modelAliases',
      'selectedMode',
      'visibleModels',
    ],
};

describe('built-in provider default configs', () => {
  it('seeds every provider the catalog holds', () => {
    expect(Object.keys(getBuiltInProviderDefaultConfigs()).sort())
      .toEqual([...builtInProviderCatalog.ids()].sort());
  });

  it.each(Object.entries(DEFAULT_CONFIG_KEYS))('writes %s with the keys it ships', (providerId, expected) => {
    const config = getBuiltInProviderDefaultConfigs()[providerId] as Record<string, unknown>;

    expect(Object.keys(config).sort()).toEqual([...expected].sort());
  });

  it('enables exactly the default provider', () => {
    const configs = getBuiltInProviderDefaultConfigs() as Record<string, Record<string, unknown>>;
    const enabled = Object.keys(configs).filter(providerId => configs[providerId].enabled === true);

    expect(enabled).toEqual(['codex']);
  });

  it('returns fresh objects, because the caller seeds settings it will mutate', () => {
    const first = getBuiltInProviderDefaultConfigs();
    const second = getBuiltInProviderDefaultConfigs();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    for (const providerId of builtInProviderCatalog.ids()) {
      expect(first[providerId]).not.toBe(second[providerId]);
    }
  });
});
