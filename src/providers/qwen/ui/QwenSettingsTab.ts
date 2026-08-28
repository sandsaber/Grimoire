import * as fs from 'fs';
import { Setting } from 'obsidian';

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
import { maybeGetQwenWorkspaceServices } from '../app/QwenWorkspaceServices';
import { getQwenProviderSettings, updateQwenProviderSettings } from '../settings';
import { QwenAgentSettings } from './QwenAgentSettings';
import { QwenCommandSettings } from './QwenCommandSettings';

const QWEN_CLI_PATH_PLACEHOLDER = '/usr/local/bin/qwen';

export const qwenSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const qwenWorkspace = maybeGetQwenWorkspaceServices(context.plugin);
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const qwenSettings = getQwenProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const reloadWorkspaceResources = async (): Promise<void> => {
      for (const view of context.plugin.getAllViews()) {
        await view.getTabManager()?.broadcastToProviderTabs?.(
          'qwen',
          (service) => service.reloadWorkspaceResources?.() ?? Promise.resolve(),
        );
      }
    };

    if (!qwenSettings.enabled) {
      renderProviderDisabledNotice(container, 'Qwen Code');
    }

    new Setting(container).setName(t('settings.setup')).setHeading();

    const cliPathSetting = new Setting(container)
      .setName(t('settings.providerTabs.qwen.cliPath.name'))
      .setDesc(t('settings.providerTabs.qwen.cliPath.desc'));

    const validationEl = container.createDiv({
      cls: 'grimoire-cli-path-validation grimoire-setting-validation grimoire-setting-validation-error grimoire-hidden',
    });
    const cliPathsByHost = { ...qwenSettings.cliPathsByHost };
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

      updateQwenProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      return true;
    };

    const currentValue = qwenSettings.cliPathsByHost[hostnameKey] || '';
    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(QWEN_CLI_PATH_PLACEHOLDER)
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('grimoire-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentValue, text.inputEl);
    });

    const advancedContainer = context.renderAdvancedSection(container, {
      count: 5,
      summary: t('settings.advanced.providerSummary'),
    });

    const skillsSection = context.createWorkspaceSection(advancedContainer, ['skills']);
    new Setting(skillsSection).setName(t('settings.hub.skills')).setHeading();
    if (qwenWorkspace?.commandCatalog) {
      const skillsContainer = skillsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new ProviderSkillSettings(
        skillsContainer,
        context.plugin.app,
        'qwen',
        qwenWorkspace.commandCatalog,
        reloadWorkspaceResources,
      );
    }

    const commandsSection = context.createWorkspaceSection(advancedContainer, ['commands']);
    new Setting(commandsSection).setName(t('settings.slashCommands.name')).setHeading();
    context.renderHiddenProviderCommandSetting(commandsSection, 'qwen', {
      name: t('settings.providerTabs.qwen.hiddenCommands.name'),
      desc: t('settings.providerTabs.qwen.hiddenCommands.desc'),
      placeholder: t('settings.providerTabs.qwen.hiddenCommands.placeholder'),
    });
    if (qwenWorkspace?.commandCatalog) {
      new QwenCommandSettings(
        commandsSection.createDiv({ cls: 'grimoire-slash-commands-container' }),
        context.plugin.app,
        qwenWorkspace.commandCatalog,
        reloadWorkspaceResources,
      );
    }

    if (qwenWorkspace?.agentStorage) {
      const agentsSection = context.createWorkspaceSection(advancedContainer, ['agents']);
      new Setting(agentsSection).setName(t('settings.subagents.name')).setHeading();
      new QwenAgentSettings(
        agentsSection.createDiv({ cls: 'grimoire-slash-commands-container' }),
        qwenWorkspace.agentStorage,
        context.plugin.app,
        reloadWorkspaceResources,
      );
    }

    if (qwenWorkspace?.mcpStorage) {
      const mcpSection = context.createWorkspaceSection(advancedContainer, ['mcp']);
      new Setting(mcpSection).setName(t('settings.mcpServers.name')).setHeading();
      const mcpContainer = mcpSection.createDiv({ cls: 'grimoire-mcp-container' });
      new McpSettingsManager(mcpContainer, {
        app: context.plugin.app,
        mcpStorage: qwenWorkspace.mcpStorage,
        broadcastMcpReload: async () => {
          for (const view of context.plugin.getAllViews()) {
            await view.getTabManager()?.broadcastToProviderTabs?.(
              'qwen',
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
      scope: 'provider:qwen',
      heading: t('settings.providerTabs.qwen.environment.heading'),
      name: t('settings.providerTabs.qwen.environment.name'),
      desc: t('settings.providerTabs.qwen.environment.desc'),
      placeholder: 'DASHSCOPE_API_KEY=...\nOPENAI_API_KEY=...',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'qwen'),
    });
  },
};
