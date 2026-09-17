import { Setting } from 'obsidian';

import { renderEnvironmentSettingsSection } from '@/features/settings/ui/EnvironmentSettingsSection';
import type { ProviderSettingsTabRenderer } from '@/providers/shared/providerHostContracts';
import { getHostnameKey } from '@/utils/env';
import { resolveCliFile } from '@/utils/resolveCliExecutable';

import { getCommandcodeSettings, updateCommandcodeSettings } from '../settings';

export const commandcodeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const { plugin } = context;
    new Setting(container).setName('Setup').setHeading();
    new Setting(container).setName('Setup')
      .setDesc('Install with npm i -g command-code, then run command-code login in a terminal. Authentication stays with the CLI.');
    new Setting(container).setName('Headless permissions')
      .setDesc('Safe asks in Grimoire before each edit, command or other non-read tool. It requires command-code 1.53.0 from npm and does not run native subagents. Auto-approve runs without asking. Native deny and ask rules still apply. Questions, images and slash commands are unavailable here.');
    new Setting(container).setName('CLI path')
      .setDesc('Optional path to command-code on this computer. Leave empty to detect it automatically.')
      .addText(text => {
        const host = getHostnameKey();
        text.setValue(getCommandcodeSettings(plugin.settings).cliPathsByHost[host] ?? '');
        text.inputEl.addEventListener('blur', () => {
          void (async () => {
            const value = text.getValue().trim();
            if (value && !resolveCliFile(value)) {
              text.inputEl.setCustomValidity('Choose an existing CLI file.');
              text.inputEl.reportValidity();
              return;
            }
            text.inputEl.setCustomValidity('');
            const paths = { ...getCommandcodeSettings(plugin.settings).cliPathsByHost };
            if (value) paths[host] = value;
            else delete paths[host];
            updateCommandcodeSettings(plugin.settings, { cliPathsByHost: paths, discoveredModels: [] });
            await plugin.saveSettings();
          })();
        });
      });
    const environment = context.createWorkspaceSection(container, ['environment']);
    renderEnvironmentSettingsSection({ container: environment, plugin, scope: 'provider:commandcode',
      heading: 'Environment', name: 'Environment variables',
      desc: 'Variables passed to Command Code alongside the shared environment.', placeholder: 'NAME=value',
      renderCustomContextLimits: target => context.renderCustomContextLimits(target, 'commandcode') });
  },
};
