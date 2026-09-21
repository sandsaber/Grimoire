import { Setting } from 'obsidian';

import { renderEnvironmentSettingsSection } from '@/features/settings/ui/EnvironmentSettingsSection';
import type { ProviderSettingsTabRenderer } from '@/providers/shared/providerHostContracts';
import { getHostnameKey } from '@/utils/env';
import { resolveCliFile } from '@/utils/resolveCliExecutable';

import { getPiSettings, updatePiSettings } from '../settings';
import { renderPiModelPicker } from './PiModelPicker';

export const piSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const { plugin } = context;
    new Setting(container).setName('Setup').setHeading();
    new Setting(container).setName('Install pi and its adapter')
      .setDesc('Requires Node.js 22+. Install pi: npm install -g --ignore-scripts @earendil-works/pi-coding-agent. Install its adapter: npm install -g pi-acp. Then run pi-acp --terminal-login to configure your model provider. Neither package is bundled with Grimoire.');
    new Setting(container).setName('Native tool permissions')
      .setDesc('Pi can read, write and run commands without asking. Grimoire displays permission requests from pi extensions, but cannot enforce safe or plan mode. Pi reads saved files on disk, not unsaved editor buffers.');
    new Setting(container).setName('Pi-owned configuration')
      .setDesc('Authentication, skills, prompt templates and extensions stay with pi. Configure external tools through a pi extension. Context usage and account quotas are not reported by the adapter.');
    new Setting(container).setName('Adapter path')
      .setDesc('Absolute path to pi-acp on this computer, or leave empty for auto-detection. Pi must also be installed.')
      .addText(text => {
        const host = getHostnameKey();
        text.setValue(getPiSettings(plugin.settings).cliPathsByHost[host] ?? '');
        text.inputEl.addEventListener('blur', () => {
          void (async () => {
            const value = text.getValue().trim();
            if (value && !resolveCliFile(value)) {
              text.inputEl.setCustomValidity('Choose an existing adapter file.');
              text.inputEl.reportValidity();
              return;
            }
            text.inputEl.setCustomValidity('');
            const paths = { ...getPiSettings(plugin.settings).cliPathsByHost };
            if (value) paths[host] = value;
            else delete paths[host];
            updatePiSettings(plugin.settings, { cliPathsByHost: paths, discoveredModels: [], thinkingLevels: [] });
            await plugin.saveSettings();
          })();
        });
      });
    renderPiModelPicker(container, context);
    const environment = context.createWorkspaceSection(container, ['environment']);
    renderEnvironmentSettingsSection({ container: environment, plugin, scope: 'provider:pi',
      heading: 'Environment', name: 'Environment variables',
      desc: 'Variables passed to pi-acp and Pi alongside the shared environment.', placeholder: 'NAME=value',
      renderCustomContextLimits: target => context.renderCustomContextLimits(target, 'pi') });
  },
};
