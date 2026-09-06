import * as fs from 'node:fs';

import { Setting } from 'obsidian';

import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { renderProviderDisabledNotice } from '../../../features/settings/ui/ProviderDisabledNotice';
import { t } from '../../../i18n/i18n';
import type {
  ProviderSettingsTabRenderer,
} from '../../../providers/shared/providerHostContracts';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { getAntigravityProviderSettings, updateAntigravityProviderSettings } from '../settings';

const ANTIGRAVITY_CLI_PATH_PLACEHOLDER = '/usr/local/bin/agy';

export const antigravitySettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const antigravitySettings = getAntigravityProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    if (!antigravitySettings.enabled) {
      renderProviderDisabledNotice(container, 'Antigravity');
    }

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName(t('settings.providerTabs.antigravity.windowsLimitations.name'))
      .setDesc(t('settings.providerTabs.antigravity.windowsLimitations.desc'));

    const cliPathSetting = new Setting(container)
      .setName(t('settings.providerTabs.antigravity.cliPath.name'))
      .setDesc(t('settings.providerTabs.antigravity.cliPath.desc'));

    const validationEl = container.createDiv({
      cls: 'grimoire-cli-path-validation grimoire-setting-validation grimoire-setting-validation-error grimoire-hidden',
    });
    const cliPathsByHost = { ...antigravitySettings.cliPathsByHost };
    let cliPathInputEl: HTMLInputElement | null = null;

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const expandedPath = expandHomePath(trimmed);
      if (!fs.existsSync(expandedPath)) {
        return t('settings.cliPath.validation.notExist');
      }
      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return t('settings.cliPath.validation.isDirectory');
      }
      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('grimoire-hidden', false);
        inputEl?.toggleClass('grimoire-input-error', true);
        return false;
      }

      validationEl.toggleClass('grimoire-hidden', true);
      inputEl?.toggleClass('grimoire-input-error', false);
      return true;
    };

    const persistCliPath = async (value: string): Promise<boolean> => {
      if (!updateCliPathValidation(value, cliPathInputEl ?? undefined)) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateAntigravityProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      return true;
    };

    const currentValue = antigravitySettings.cliPathsByHost[hostnameKey] || '';
    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(ANTIGRAVITY_CLI_PATH_PLACEHOLDER)
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('grimoire-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container).setName(t('settings.models')).setHeading();

    new Setting(container)
      .setName(t('settings.providerTabs.antigravity.customModels.name'))
      .setDesc(t('settings.providerTabs.antigravity.customModels.desc'))
      .addTextArea((text) => {
        let pendingCustomModels = antigravitySettings.customModels;
        let savedCustomModels = antigravitySettings.customModels;

        const commitCustomModels = async (): Promise<void> => {
          if (pendingCustomModels === savedCustomModels) {
            return;
          }

          updateAntigravityProviderSettings(settingsBag, { customModels: pendingCustomModels });
          savedCustomModels = getAntigravityProviderSettings(settingsBag).customModels;
          text.setValue(savedCustomModels);
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        };

        text
          .setPlaceholder('Gemini 3.5 Flash (Low)\nClaude Opus 4.6 (Thinking)')
          .setValue(antigravitySettings.customModels)
          .onChange((value) => {
            pendingCustomModels = value;
          });
        text.inputEl.rows = 5;
        text.inputEl.cols = 40;
        text.inputEl.addEventListener('blur', () => {
          void commitCustomModels();
        });
      });

    const advancedContainer = context.renderAdvancedSection(container, {
      count: 3,
      summary: t('settings.advanced.environmentSummary'),
    });

    renderEnvironmentSettingsSection({
      container: context.createWorkspaceSection(advancedContainer, ['environment']),
      plugin: context.plugin,
      scope: 'provider:antigravity',
      heading: t('settings.environment'),
      name: t('settings.providerTabs.environmentVariables'),
      desc: t('settings.providerTabs.antigravity.environmentDesc'),
      placeholder: 'GOOGLE_CLOUD_PROJECT=...',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'antigravity'),
    });
  },
};
