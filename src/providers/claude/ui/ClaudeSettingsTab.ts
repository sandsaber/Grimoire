import * as fs from 'fs';
import { Setting } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { McpSettingsManager } from '../../../features/settings/ui/McpSettingsManager';
import { t } from '../../../i18n/i18n';
import type {
  ProviderSettingsTabRenderer,
} from '../../../providers/shared/providerHostContracts';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { getClaudeWorkspaceServices } from '../app/ClaudeWorkspaceServices';
import { getCurrentModelFromEnvironment } from '../env/claudeModelEnv';
import { resolveClaudeModelSelection } from '../modelOptions';
import {
  getClaudeEffectiveEnvironmentVariables,
  getClaudeProviderSettings,
  updateClaudeProviderSettings,
} from '../settings';
import { AgentSettings } from './AgentSettings';
import { claudeChatUIConfig } from './ClaudeChatUIConfig';
import { SlashCommandSettings } from './SlashCommandSettings';

export const claudeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const claudeWorkspace = getClaudeWorkspaceServices(context.plugin);
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const claudeSettings = getClaudeProviderSettings(settingsBag);

    const reconcileActiveClaudeModelSelection = (): void => {
      const activeProvider = settingsBag.settingsProvider;
      if (activeProvider !== undefined && activeProvider !== 'claude') {
        return;
      }

      const currentModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
      const nextModel = resolveClaudeModelSelection(settingsBag, currentModel);
      if (!nextModel || nextModel === currentModel) {
        return;
      }

      settingsBag.model = nextModel;
      claudeChatUIConfig.applyModelDefaults(nextModel, settingsBag);
    };

    const applyProjectSettingsModelSelection = (): void => {
      const nextClaudeSettings = getClaudeProviderSettings(settingsBag);
      if (!nextClaudeSettings.respectProjectSettings) {
        return;
      }

      const preferredModel = nextClaudeSettings.projectSettingsSnapshot.model
        || getCurrentModelFromEnvironment(getClaudeEffectiveEnvironmentVariables(settingsBag))
        || '';
      if (!preferredModel) {
        return;
      }

      const isAvailable = claudeChatUIConfig
        .getModelOptions(settingsBag)
        .some(option => option.value === preferredModel);
      if (!isAvailable) {
        return;
      }

      settingsBag.model = preferredModel;
      claudeChatUIConfig.applyModelDefaults(preferredModel, settingsBag);
    };

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    const hostnameKey = getHostnameKey();
    const platformDesc = process.platform === 'win32'
      ? t('settings.cliPath.descWindows')
      : t('settings.cliPath.descUnix');
    const cliPathDescription = `${t('settings.cliPath.desc')} ${platformDesc}`;

    const cliPathSetting = new Setting(container)
      .setName(t('settings.cliPath.name'))
      .setDesc(cliPathDescription);

    const validationEl = container.createDiv({
      cls: 'grimoire-cli-path-validation grimoire-setting-validation grimoire-setting-validation-error grimoire-hidden',
    });

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
        if (inputEl) {
          inputEl.toggleClass('grimoire-input-error', true);
        }
        return false;
      }

      validationEl.toggleClass('grimoire-hidden', true);
      if (inputEl) {
        inputEl.toggleClass('grimoire-input-error', false);
      }
      return true;
    };

    const currentValue = claudeSettings.cliPathsByHost[hostnameKey] || '';
    const cliPathsByHost = { ...claudeSettings.cliPathsByHost };
    let cliPathInputEl: HTMLInputElement | null = null;

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateClaudeProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      claudeWorkspace.cliResolver.reset();
      const view = context.plugin.getView();
      await view?.getTabManager()?.broadcastToAllTabs(
        (service) => Promise.resolve(service.cleanup())
      );
      return true;
    };

    cliPathSetting.addText((text) => {
      const placeholder = process.platform === 'win32'
        ? 'D:\\nodejs\\node_global\\node_modules\\@anthropic-ai\\claude-code\\cli-wrapper.cjs'
        : '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs';

      text
        .setPlaceholder(placeholder)
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

    new Setting(container)
      .setName(t('settings.customModels.name'))
      .setDesc(t('settings.customModels.desc'))
      .addTextArea((text) => {
        let pendingCustomModels = claudeSettings.customModels;
        let savedCustomModels = claudeSettings.customModels;

        const commitCustomModels = async (): Promise<void> => {
          const previousCustomModels = savedCustomModels;
          const previousModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
          const previousTitleModel = typeof settingsBag.titleGenerationModel === 'string'
            ? settingsBag.titleGenerationModel
            : '';

          if (pendingCustomModels !== savedCustomModels) {
            updateClaudeProviderSettings(settingsBag, { customModels: pendingCustomModels });
            savedCustomModels = pendingCustomModels;
          }

          reconcileActiveClaudeModelSelection();
          const didReconcileTitleModel = ProviderSettingsCoordinator
            .reconcileTitleGenerationModelSelection(settingsBag);
          const nextModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
          const nextTitleModel = typeof settingsBag.titleGenerationModel === 'string'
            ? settingsBag.titleGenerationModel
            : '';
          const didModelSelectionChange = previousModel !== nextModel;
          const didCustomModelsChange = previousCustomModels !== savedCustomModels;

          if (!didCustomModelsChange && !didModelSelectionChange && !didReconcileTitleModel
            && previousTitleModel === nextTitleModel) {
            return;
          }

          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        };

        text
          .setPlaceholder(t('settings.customModels.placeholder'))
          .setValue(claudeSettings.customModels)
          .onChange((value) => {
            pendingCustomModels = value;
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 40;
        text.inputEl.addEventListener('blur', () => {
          void commitCustomModels();
        });
      });

    const advancedContainer = context.renderAdvancedSection(container, {
      count: 5,
      summary: t('settings.providerTabs.claude.advancedSummary'),
    });

    const slashCommandsSection = context.createWorkspaceSection(advancedContainer, ['skills', 'commands']);

    // --- Slash Commands ---

    new Setting(slashCommandsSection).setName(t('settings.slashCommands.name')).setHeading();

    const slashCommandsDesc = slashCommandsSection.createDiv({ cls: 'grimoire-sp-settings-desc' });
    const descP = slashCommandsDesc.createEl('p', { cls: 'setting-item-description' });
    descP.appendText(t('settings.slashCommands.desc') + ' ');
    descP.createEl('a', {
      text: t('settings.learnMore'),
      href: 'https://code.claude.com/docs/en/skills',
    });

    const slashCommandsContainer = slashCommandsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
    new SlashCommandSettings(
      slashCommandsContainer,
      context.plugin.app,
      claudeWorkspace.commandCatalog,
    );

    context.renderHiddenProviderCommandSetting(slashCommandsSection, 'claude', {
      name: t('settings.hiddenSlashCommands.name'),
      desc: t('settings.hiddenSlashCommands.desc'),
      placeholder: t('settings.hiddenSlashCommands.placeholder'),
    });

    // --- Subagents ---

    const agentsSection = context.createWorkspaceSection(advancedContainer, ['agents']);
    new Setting(agentsSection).setName(t('settings.subagents.name')).setHeading();

    const agentsDesc = agentsSection.createDiv({ cls: 'grimoire-sp-settings-desc' });
    agentsDesc.createEl('p', {
      text: t('settings.subagents.desc'),
      cls: 'setting-item-description',
    });

    const agentsContainer = agentsSection.createDiv({ cls: 'grimoire-agents-container' });
    new AgentSettings(agentsContainer, {
      app: context.plugin.app,
      agentManager: claudeWorkspace.agentManager,
      agentStorage: claudeWorkspace.agentStorage,
    });

    // --- MCP Servers ---

    const mcpSection = context.createWorkspaceSection(advancedContainer, ['mcp']);
    new Setting(mcpSection).setName(t('settings.mcpServers.name')).setHeading();

    const mcpDesc = mcpSection.createDiv({ cls: 'grimoire-mcp-settings-desc' });
    mcpDesc.createEl('p', {
      text: t('settings.mcpServers.desc'),
      cls: 'setting-item-description',
    });

    const mcpContainer = mcpSection.createDiv({ cls: 'grimoire-mcp-container' });
    new McpSettingsManager(mcpContainer, {
      app: context.plugin.app,
      mcpStorage: claudeWorkspace.mcpStorage,
      broadcastMcpReload: async () => {
        for (const view of context.plugin.getAllViews()) {
          await view.getTabManager()?.broadcastToAllTabs(
            (service) => service.reloadMcpServers(),
          );
        }
      },
    });

    // --- Environment ---

    new Setting(advancedContainer)
      .setName(t('settings.respectProjectSettings.name'))
      .setDesc(t('settings.respectProjectSettings.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.respectProjectSettings)
          .onChange(async (value) => {
            updateClaudeProviderSettings(settingsBag, { respectProjectSettings: value });
            applyProjectSettingsModelSelection();
            ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settingsBag);
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const environmentSection = context.createWorkspaceSection(advancedContainer, ['environment']);
    renderEnvironmentSettingsSection({
      container: environmentSection,
      plugin: context.plugin,
      scope: 'provider:claude',
      heading: t('settings.environment'),
      name: t('settings.customVariables.name'),
      desc: t('settings.providerTabs.claude.environmentDesc'),
      placeholder: 'ANTHROPIC_API_KEY=your-key\nANTHROPIC_BASE_URL=https://api.example.com\nANTHROPIC_MODEL=custom-model\nCLAUDE_CODE_USE_BEDROCK=1',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'claude'),
    });

    // --- Experimental ---

    new Setting(advancedContainer).setName(t('settings.experimental')).setHeading();

    new Setting(advancedContainer)
      .setName(t('settings.enableChrome.name'))
      .setDesc(t('settings.enableChrome.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.enableChrome)
          .onChange(async (value) => {
            updateClaudeProviderSettings(settingsBag, { enableChrome: value });
            await context.plugin.saveSettings();
          })
      );

    new Setting(advancedContainer)
      .setName(t('settings.enableBangBash.name'))
      .setDesc(t('settings.enableBangBash.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.enableBangBash)
          .onChange(async (value) => {
            bangBashValidationEl.toggleClass('grimoire-hidden', true);
            if (value) {
              const { findNodeExecutable, getEnhancedPath } = await import('../../../utils/env');
              const nodePath = findNodeExecutable(getEnhancedPath());
              if (!nodePath) {
                bangBashValidationEl.setText(t('settings.enableBangBash.validation.noNode'));
                bangBashValidationEl.toggleClass('grimoire-hidden', false);
                toggle.setValue(false);
                return;
              }
            }
            updateClaudeProviderSettings(settingsBag, { enableBangBash: value });
            await context.plugin.saveSettings();
          })
      );

    const bangBashValidationEl = advancedContainer.createDiv({
      cls: 'grimoire-bang-bash-validation grimoire-setting-validation grimoire-setting-validation-error grimoire-hidden',
    });
  },
};
