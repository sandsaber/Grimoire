import type { ProviderChatUIConfig } from '@/providers/shared/providerHostContracts';
import { getVaultPath } from '@/utils/path';

import { discoverCommandcodeEfforts } from '../runtime/CommandcodeModelDiscovery';
import { COMMANDCODE_MODEL_PREFIX, commandcodeEnvironment, decodeCommandcodeModel, getCommandcodeSettings, resolveCommandcodeCli, updateCommandcodeSettings } from '../settings';
import { COMMANDCODE_ICON } from './CommandcodeIcon';

const owns = (model: string) => model === 'commandcode' || model.startsWith(COMMANDCODE_MODEL_PREFIX);

export const commandcodeChatUIConfig: ProviderChatUIConfig = {
  getProviderIcon: () => COMMANDCODE_ICON,
  getModelOptions: settings => {
    const models = getCommandcodeSettings(settings).discoveredModels;
    return models.length ? models.map(model => ({ value: `${COMMANDCODE_MODEL_PREFIX}${model.rawId}`,
      label: model.label, description: model.description }))
      : [{ value: 'commandcode', label: 'Command Code', description: 'Use the CLI default model' }];
  },
  ownsModel: owns,
  isDefaultModel: owns,
  isAdaptiveReasoningModel: () => true,
  getReasoningOptions: (model, settings) => [
    { value: 'default', label: 'CLI default', description: 'Uses the native CLI/session default.' },
    ...(getCommandcodeSettings(settings).reasoningEffortsByModel[decodeCommandcodeModel(model) ?? ''] ?? [])
      .map(value => ({ value, label: value === 'xhigh' ? 'Extra high' : value[0].toUpperCase() + value.slice(1) })),
  ],
  getDefaultReasoningValue: () => 'default',
  async prepareModelMetadata(model, _settings, { plugin }) {
    const rawId = decodeCommandcodeModel(model);
    if (!rawId || !getCommandcodeSettings(plugin.settings).enabled) return;
    const command = resolveCommandcodeCli(plugin.settings) ?? 'command-code';
    const environment = commandcodeEnvironment(plugin.settings, command);
    try {
      const efforts = await discoverCommandcodeEfforts(command, getVaultPath(plugin.app) ?? process.cwd(), environment, rawId);
      // A settings edit while discovery was running invalidates the response.
      if (command !== (resolveCommandcodeCli(plugin.settings) ?? 'command-code')
        || JSON.stringify(environment) !== JSON.stringify(commandcodeEnvironment(plugin.settings, command))) return;
      updateCommandcodeSettings(plugin.settings, { reasoningEffortsByModel: {
        ...getCommandcodeSettings(plugin.settings).reasoningEffortsByModel, [rawId]: efforts,
      } });
      await plugin.saveSettings();
    } catch {
      // Metadata is optional; never turn an unknown response into invented effort options.
    }
  },
  // Estimate only; Command Code's model listing does not report context windows.
  getContextWindowSize: (model, limits) => limits?.[model] ?? 200_000,
  getCustomModelIds: () => new Set(),
  normalizeModelVariant: model => owns(model) ? model : 'commandcode',
  applyModelDefaults(model, settings) {
    if (settings && typeof settings === 'object') Object.assign(settings, { model, effortLevel: 'default' });
  },
  getPermissionModeToggle: () => ({
    inactiveValue: 'normal', inactiveLabel: 'Safe',
    inactiveDescription: 'Ask before each edit, command or other non-read tool. Approval applies once.',
    activeValue: 'full_access', activeLabel: 'Auto-approve',
    activeDescription: 'Allows edits and commands without asking. Explicit CLI deny and ask rules still apply.',
  }),
  applyPermissionMode(value, settings) {
    if (settings && typeof settings === 'object') Object.assign(settings, { permissionMode: value });
  },
};
