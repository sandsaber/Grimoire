import * as fs from 'fs';
import { Notice, Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { McpSettingsManager } from '../../../features/settings/ui/McpSettingsManager';
import { renderProviderDisabledNotice } from '../../../features/settings/ui/ProviderDisabledNotice';
import { ProviderSkillSettings } from '../../../features/settings/ui/ProviderSkillSettings';
import { t } from '../../../i18n/i18n';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetGeminiWorkspaceServices } from '../app/GeminiWorkspaceServices';
import { getGeminiProviderSettings, updateGeminiProviderSettings } from '../settings';
import { GeminiAgentSettings } from './GeminiAgentSettings';
import { GeminiCommandSettings } from './GeminiCommandSettings';

const GEMINI_CLI_PATH_PLACEHOLDER = '/usr/local/bin/gemini';

export const geminiSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const geminiWorkspace = maybeGetGeminiWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const geminiSettings = getGeminiProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    if (!geminiSettings.enabled) {
      renderProviderDisabledNotice(container, 'Gemini');
    }

    new Setting(container).setName(t('settings.setup')).setHeading();

    const cliPathSetting = new Setting(container)
      .setName(t('settings.providerTabs.gemini.cliPath.name'))
      .setDesc(t('settings.providerTabs.gemini.cliPath.desc'));

    const validationEl = container.createDiv({
      cls: 'grimoire-cli-path-validation grimoire-setting-validation grimoire-setting-validation-error grimoire-hidden',
    });
    const cliPathsByHost = { ...geminiSettings.cliPathsByHost };
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

      updateGeminiProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      return true;
    };

    const currentValue = geminiSettings.cliPathsByHost[hostnameKey] || '';
    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(GEMINI_CLI_PATH_PLACEHOLDER)
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('grimoire-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentValue, text.inputEl);
    });

    // --- Models ---

    new Setting(container).setName(t('settings.models')).setHeading();

    // A settled catalog is never re-probed in the background, and the binary
    // fingerprint only notices an upgrade that changed the file Grimoire resolved.
    // This is the one place a user can ask the CLI for its current list.
    new Setting(container)
      .setName(t('settings.refreshModels.name'))
      .setDesc(t('settings.refreshModels.desc', { provider: 'Gemini CLI' }))
      .addButton((button) => {
        button
          .setButtonText(t('settings.refreshModels.button'))
          .onClick(async () => {
            const catalog = geminiWorkspace?.modelCatalog;
            if (!catalog) {
              return;
            }

            button.setDisabled(true);
            try {
              await catalog.refreshModels({
                force: true,
                plugin: context.plugin,
                settings: settingsBag,
              });
              const modelCount = getGeminiProviderSettings(settingsBag).discoveredModels.length;
              if (modelCount === 0) {
                new Notice(t('settings.provider.loadModelsFailed'));
                return;
              }

              context.refreshModelSelectors();
              new Notice(t('settings.refreshModels.done', { count: modelCount }));
            } catch {
              new Notice(t('settings.provider.loadModelsFailed'));
            } finally {
              button.setDisabled(false);
            }
          });
      });

    const advancedContainer = context.renderAdvancedSection(container, {
      count: 6,
      summary: t('settings.advanced.providerSummary'),
    });

    const skillsSection = context.createWorkspaceSection(advancedContainer, ['skills']);
    new Setting(skillsSection).setName(t('settings.hub.skills')).setHeading();
    if (geminiWorkspace?.commandCatalog) {
      const skillsContainer = skillsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new ProviderSkillSettings(
        skillsContainer,
        context.plugin.app,
        'gemini',
        geminiWorkspace.commandCatalog,
      );
    }

    if (geminiWorkspace?.commandCatalog) {
      const commandsSection = context.createWorkspaceSection(advancedContainer, ['commands']);
      new Setting(commandsSection).setName(t('settings.slashCommands.name')).setHeading();
      const commandsContainer = commandsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new GeminiCommandSettings(
        commandsContainer,
        context.plugin.app,
        geminiWorkspace.commandCatalog,
      );
    }

    if (geminiWorkspace?.agentStorage) {
      const agentsSection = context.createWorkspaceSection(advancedContainer, ['agents']);
      new Setting(agentsSection).setName(t('settings.subagents.name')).setHeading();
      const agentsContainer = agentsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new GeminiAgentSettings(
        agentsContainer,
        geminiWorkspace.agentStorage,
        context.plugin.app,
      );
    }

    if (geminiWorkspace?.mcpStorage) {
      const mcpSection = context.createWorkspaceSection(advancedContainer, ['mcp']);
      new Setting(mcpSection).setName(t('settings.mcpServers.name')).setHeading();
      const mcpContainer = mcpSection.createDiv({ cls: 'grimoire-mcp-container' });
      new McpSettingsManager(mcpContainer, {
        app: context.plugin.app,
        mcpStorage: geminiWorkspace.mcpStorage,
        broadcastMcpReload: async () => {
          for (const view of context.plugin.getAllViews()) {
            await view.getTabManager()?.broadcastToProviderTabs?.(
              'gemini',
              (service) => service.reloadMcpServers(),
            );
          }
        },
        features: { contextSaving: false, toolFiltering: false },
      });
    }

    renderEnvironmentSettingsSection({
      container: context.createWorkspaceSection(advancedContainer, ['environment']),
      plugin: context.plugin,
      scope: 'provider:gemini',
      heading: t('settings.environment'),
      name: t('settings.providerTabs.environmentVariables'),
      desc: t('settings.providerTabs.gemini.environmentDesc'),
      placeholder: 'GEMINI_API_KEY=...\nGOOGLE_CLOUD_PROJECT=...',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'gemini'),
    });
  },
};
