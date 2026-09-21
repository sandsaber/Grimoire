import * as fs from 'fs';
import { Notice, Setting } from 'obsidian';

import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { McpSettingsManager } from '../../../features/settings/ui/McpSettingsManager';
import { renderProviderDisabledNotice } from '../../../features/settings/ui/ProviderDisabledNotice';
import { ProviderSkillSettings } from '../../../features/settings/ui/ProviderSkillSettings';
import { t } from '../../../i18n/i18n';
import type {
  ProviderSettingsTabRenderer,
} from '../../../providers/shared/providerHostContracts';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetReasonixWorkspaceServices } from '../app/ReasonixWorkspaceServices';
import { getReasonixProviderSettings, updateReasonixProviderSettings } from '../settings';

const REASONIX_CLI_PATH_PLACEHOLDER = '~/.local/bin/reasonix';

export const reasonixSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const reasonixWorkspace = maybeGetReasonixWorkspaceServices(context.plugin);
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const reasonixSettings = getReasonixProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const reloadWorkspaceResources = async (): Promise<void> => {
      for (const view of context.plugin.getAllViews()) {
        await view.getTabManager()?.broadcastToProviderTabs?.(
          'reasonix',
          (service) => service.reloadWorkspaceResources?.() ?? Promise.resolve(),
        );
      }
    };

    if (!reasonixSettings.enabled) {
      renderProviderDisabledNotice(container, 'Reasonix');
    }

    new Setting(container).setName(t('settings.setup')).setHeading();

    const cliPathSetting = new Setting(container)
      .setName(t('settings.providerTabs.reasonix.cliPath.name'))
      .setDesc(t('settings.providerTabs.reasonix.cliPath.desc'));

    const validationEl = container.createDiv({
      cls: 'grimoire-cli-path-validation grimoire-setting-validation grimoire-setting-validation-error grimoire-hidden',
    });
    const cliPathsByHost = { ...reasonixSettings.cliPathsByHost };
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

      updateReasonixProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      return true;
    };

    const currentValue = reasonixSettings.cliPathsByHost[hostnameKey] || '';
    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(REASONIX_CLI_PATH_PLACEHOLDER)
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('grimoire-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container).setName('Image attachments as files')
      .setDesc('Save pasted or dropped images in the vault and send paths for the agent to read. Enable only with a model or tool that can read images. This requires an extra tool call; ACP image blocks are not sent.')
      .addToggle(toggle => toggle.setValue(reasonixSettings.imageAttachmentsAsFiles)
        .onChange(async value => {
          updateReasonixProviderSettings(settingsBag, { imageAttachmentsAsFiles: value });
          await context.plugin.saveSettings();
        }));

    // --- Models ---

    new Setting(container).setName(t('settings.models')).setHeading();

    // The one place a user can ask the CLI for its current list. What the
    // session offers depends on the account, so a different login is a
    // different list — see `ReasonixMetadataSession`.
    new Setting(container)
      .setName(t('settings.refreshModels.name'))
      .setDesc(t('settings.refreshModels.desc', { provider: 'Reasonix' }))
      .addButton((button) => {
        button
          .setButtonText(t('settings.refreshModels.button'))
          .onClick(async () => {
            const catalog = reasonixWorkspace?.modelCatalog;
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
              const modelCount = getReasonixProviderSettings(settingsBag).discoveredModels.length;
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
      count: 4,
      summary: t('settings.advanced.providerSummary'),
    });

    const skillsSection = context.createWorkspaceSection(advancedContainer, ['skills']);
    new Setting(skillsSection).setName(t('settings.hub.skills')).setHeading();
    if (reasonixWorkspace?.commandCatalog) {
      const skillsContainer = skillsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new ProviderSkillSettings(
        skillsContainer,
        context.plugin.app,
        'reasonix',
        reasonixWorkspace.commandCatalog,
        reloadWorkspaceResources,
      );
    }

    // Commands are the session's own announcements; the only control over
    // them is which ones to hide.
    const commandsSection = context.createWorkspaceSection(advancedContainer, ['commands']);
    new Setting(commandsSection).setName(t('settings.slashCommands.name')).setHeading();
    context.renderHiddenProviderCommandSetting(commandsSection, 'reasonix', {
      name: t('settings.providerTabs.reasonix.hiddenCommands.name'),
      desc: t('settings.providerTabs.reasonix.hiddenCommands.desc'),
      placeholder: t('settings.providerTabs.reasonix.hiddenCommands.placeholder'),
    });

    if (reasonixWorkspace?.mcpStorage) {
      const mcpSection = context.createWorkspaceSection(advancedContainer, ['mcp']);
      new Setting(mcpSection).setName(t('settings.mcpServers.name')).setHeading();
      const mcpContainer = mcpSection.createDiv({ cls: 'grimoire-mcp-container' });
      new McpSettingsManager(mcpContainer, {
        app: context.plugin.app,
        mcpStorage: reasonixWorkspace.mcpStorage,
        broadcastMcpReload: async () => {
          for (const view of context.plugin.getAllViews()) {
            await view.getTabManager()?.broadcastToProviderTabs?.(
              'reasonix',
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
      scope: 'provider:reasonix',
      heading: t('settings.providerTabs.reasonix.environment.heading'),
      name: t('settings.providerTabs.reasonix.environment.name'),
      desc: t('settings.providerTabs.reasonix.environment.desc'),
      placeholder: 'REASONIX_HOME=~/.reasonix\nDEEPSEEK_API_KEY=…',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'reasonix'),
    });
  },
};
