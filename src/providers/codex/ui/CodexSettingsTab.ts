import * as fs from 'fs';
import { Notice, Setting } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { renderProviderDisabledNotice } from '../../../features/settings/ui/ProviderDisabledNotice';
import { t } from '../../../i18n/i18n';
import type {
  ProviderSettingsTabRenderer,
} from '../../../providers/shared/providerHostContracts';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { getCodexWorkspaceServices } from '../app/CodexWorkspaceServices';
import { parseConfiguredCustomModelIds, resolveCodexModelSelection } from '../modelOptions';
import { isWindowsStyleCliReference } from '../runtime/CodexBinaryLocator';
import { getCodexProviderSettings, updateCodexProviderSettings } from '../settings';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '../types/models';
import { CodexSkillSettings } from './CodexSkillSettings';
import { CodexSubagentSettings } from './CodexSubagentSettings';

export const codexSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const codexWorkspace = getCodexWorkspaceServices(context.plugin);
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const codexSettings = getCodexProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const isWindowsHost = process.platform === 'win32';
    let installationMethod = codexSettings.installationMethod;

    if (!codexSettings.enabled) {
      renderProviderDisabledNotice(container, 'Codex');
    }

    const reconcileActiveCodexModelSelection = (): void => {
      const activeProvider = settingsBag.settingsProvider;
      if (activeProvider !== 'codex') {
        return;
      }

      const currentModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
      const nextModel = resolveCodexModelSelection(settingsBag, currentModel);
      if (!nextModel || nextModel === currentModel) {
        return;
      }

      settingsBag.model = nextModel;
    };

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    if (isWindowsHost) {
      new Setting(container)
        .setName(t('settings.providerTabs.codex.installationMethod.name'))
        .setDesc(t('settings.providerTabs.codex.installationMethod.desc'))
        .addDropdown((dropdown) => {
          dropdown
            .addOption('native-windows', t('settings.providerTabs.codex.installationMethod.nativeWindows'))
            .addOption('wsl', 'WSL')
            .setValue(installationMethod)
            .onChange(async (value) => {
              installationMethod = value === 'wsl' ? 'wsl' : 'native-windows';
              updateCodexProviderSettings(settingsBag, { installationMethod });
              refreshInstallationMethodUI();
              await context.plugin.saveSettings();
            });
        });
    }

    const getCliPathCopy = (): { desc: string; placeholder: string } => {
      if (!isWindowsHost) {
        return {
          desc: t('settings.providerTabs.codex.cliPath.desc'),
          placeholder: '/usr/local/bin/codex',
        };
      }

      if (installationMethod === 'wsl') {
        return {
          desc: t('settings.providerTabs.codex.cliPath.descWsl'),
          placeholder: 'codex',
        };
      }

      return {
        desc: t('settings.providerTabs.codex.cliPath.descWindows'),
        placeholder: 'C:\\Users\\you\\AppData\\Roaming\\npm\\codex.exe',
      };
    };

    const shouldValidateCliPathAsFile = (): boolean => !isWindowsHost || installationMethod !== 'wsl';

    const cliPathSetting = new Setting(container)
      .setName(t('settings.providerTabs.codex.cliPath.name'))
      .setDesc(getCliPathCopy().desc);

    const validationEl = container.createDiv({
      cls: 'grimoire-cli-path-validation grimoire-setting-validation grimoire-setting-validation-error grimoire-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;

      if (!shouldValidateCliPathAsFile()) {
        if (isWindowsStyleCliReference(trimmed)) {
          return t('settings.providerTabs.codex.cliPath.wslValidation');
        }
        return null;
      }

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

    const cliPathsByHost = { ...codexSettings.cliPathsByHost };
    let cliPathInputEl: HTMLInputElement | null = null;
    let wslDistroSettingEl: HTMLElement | null = null;
    let wslDistroInputEl: HTMLInputElement | null = null;

    const refreshInstallationMethodUI = (): void => {
      const cliCopy = getCliPathCopy();
      cliPathSetting.setDesc(cliCopy.desc);
      if (cliPathInputEl) {
        cliPathInputEl.placeholder = cliCopy.placeholder;
        updateCliPathValidation(cliPathInputEl.value, cliPathInputEl);
      }
      if (wslDistroSettingEl) {
        wslDistroSettingEl.toggleClass('grimoire-hidden', installationMethod !== 'wsl');
      }
      if (wslDistroInputEl) {
        wslDistroInputEl.disabled = installationMethod !== 'wsl';
      }
    };

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

      updateCodexProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      const view = context.plugin.getView();
      await view?.getTabManager()?.broadcastToAllTabs(
        (service) => Promise.resolve(service.cleanup())
      );
      return true;
    };

    const currentValue = codexSettings.cliPathsByHost[hostnameKey] || '';

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(getCliPathCopy().placeholder)
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('grimoire-settings-cli-path-input');
      cliPathInputEl = text.inputEl;

      updateCliPathValidation(currentValue, text.inputEl);
    });

    if (isWindowsHost) {
      const wslDistroSetting = new Setting(container)
        .setName(t('settings.providerTabs.codex.wslDistro.name'))
        .setDesc(t('settings.providerTabs.codex.wslDistro.desc'));

      wslDistroSettingEl = wslDistroSetting.settingEl;
      wslDistroSetting.addText((text) => {
        text
          .setPlaceholder('Ubuntu')
          .setValue(codexSettings.wslDistroOverride)
          .onChange(async (value) => {
            updateCodexProviderSettings(settingsBag, { wslDistroOverride: value });
            await context.plugin.saveSettings();
          });

        text.inputEl.addClass('grimoire-settings-cli-path-input');
        text.inputEl.disabled = installationMethod !== 'wsl';
        wslDistroInputEl = text.inputEl;
      });
    }

    refreshInstallationMethodUI();

    // --- Models ---

    new Setting(container).setName(t('settings.models')).setHeading();

    // A settled catalog is never re-probed in the background, and the binary
    // fingerprint only notices an upgrade that changed the file Grimoire resolved.
    // This is the one place a user can ask the app-server for its current list.
    new Setting(container)
      .setName(t('settings.refreshModels.name'))
      .setDesc(t('settings.refreshModels.desc', { provider: 'Codex' }))
      .addButton((button) => {
        button
          .setButtonText(t('settings.refreshModels.button'))
          .onClick(async () => {
            const catalog = codexWorkspace?.modelCatalog;
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
              const modelCount = getCodexProviderSettings(settingsBag).discoveredModels.length;
              if (modelCount === 0) {
                new Notice(t('settings.provider.loadModelsFailed'));
                return;
              }

              // A release can retire a model the user had selected, so reconcile before
              // the pickers are redrawn rather than leaving them on a dead id.
              const previousModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
              reconcileActiveCodexModelSelection();
              const didReconcileTitleModel = ProviderSettingsCoordinator
                .reconcileTitleGenerationModelSelection(settingsBag);
              if (didReconcileTitleModel || settingsBag.model !== previousModel) {
                await context.plugin.saveSettings();
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

    const SUMMARY_OPTIONS: { value: string; label: string }[] = [
      { value: 'auto', label: t('settings.providerTabs.codex.reasoning.auto') },
      { value: 'concise', label: t('settings.providerTabs.codex.reasoning.concise') },
      { value: 'detailed', label: t('settings.providerTabs.codex.reasoning.detailed') },
      { value: 'none', label: t('settings.providerTabs.codex.reasoning.off') },
    ];

    new Setting(container)
      .setName(t('settings.providerTabs.codex.customModels.name'))
      .setDesc(t('settings.providerTabs.codex.customModels.desc'))
      .addTextArea((text) => {
        let pendingCustomModels = codexSettings.customModels;
        let savedCustomModels = codexSettings.customModels;

        const reconcileInactiveCodexProjection = (
          previousCustomModels: string,
        ): boolean => {
          if (settingsBag.settingsProvider === 'codex') {
            return false;
          }

          const savedProviderModel = (
            settingsBag.savedProviderModel
            && typeof settingsBag.savedProviderModel === 'object'
          )
            ? settingsBag.savedProviderModel as Record<string, unknown>
            : {};
          const currentSavedModel = typeof savedProviderModel.codex === 'string'
            ? savedProviderModel.codex
            : '';
          if (!currentSavedModel) {
            return false;
          }

          const previousCustomModelIds = new Set(parseConfiguredCustomModelIds(previousCustomModels));
          if (!previousCustomModelIds.has(currentSavedModel)) {
            return false;
          }

          const nextSavedModel = resolveCodexModelSelection(settingsBag, currentSavedModel);
          if (!nextSavedModel || nextSavedModel === currentSavedModel) {
            return false;
          }

          settingsBag.savedProviderModel = {
            ...savedProviderModel,
            codex: nextSavedModel,
          };
          return true;
        };

        const commitCustomModels = async (): Promise<void> => {
          const previousCustomModels = savedCustomModels;
          const previousModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
          const previousTitleModel = typeof settingsBag.titleGenerationModel === 'string'
            ? settingsBag.titleGenerationModel
            : '';

          if (pendingCustomModels !== savedCustomModels) {
            updateCodexProviderSettings(settingsBag, { customModels: pendingCustomModels });
            savedCustomModels = pendingCustomModels;
          }

          reconcileActiveCodexModelSelection();
          const didReconcileInactiveProjection = reconcileInactiveCodexProjection(previousCustomModels);
          const didReconcileTitleModel = ProviderSettingsCoordinator
            .reconcileTitleGenerationModelSelection(settingsBag);
          const nextModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
          const nextTitleModel = typeof settingsBag.titleGenerationModel === 'string'
            ? settingsBag.titleGenerationModel
            : '';
          const didModelSelectionChange = previousModel !== nextModel;
          const didCustomModelsChange = previousCustomModels !== savedCustomModels;

          if (!didCustomModelsChange && !didModelSelectionChange && !didReconcileInactiveProjection
            && !didReconcileTitleModel
            && previousTitleModel === nextTitleModel) {
            return;
          }

          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        };

        text
          .setPlaceholder('gpt-5.4\ngpt-5.3-codex-spark')
          .setValue(codexSettings.customModels)
          .onChange((value) => {
            pendingCustomModels = value;
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
        text.inputEl.addEventListener('blur', () => {
          void commitCustomModels();
        });
      });

    new Setting(container)
      .setName(t('settings.providerTabs.codex.reasoning.name'))
      .setDesc(t('settings.providerTabs.codex.reasoning.desc'))
      .addDropdown((dropdown) => {
        for (const opt of SUMMARY_OPTIONS) {
          dropdown.addOption(opt.value, opt.label);
        }
        dropdown.setValue(codexSettings.reasoningSummary);
        dropdown.onChange(async (value) => {
          updateCodexProviderSettings(
            settingsBag,
            { reasoningSummary: value as 'auto' | 'concise' | 'detailed' | 'none' },
          );
          await context.plugin.saveSettings();
        });
      });

    const advancedContainer = context.renderAdvancedSection(container, {
      count: 5,
      summary: t('settings.providerTabs.codex.advancedSummary'),
    });

    const skillsSection = context.createWorkspaceSection(advancedContainer, ['skills']);

    // --- Skills ---

    const codexCatalog = codexWorkspace.commandCatalog;
    if (codexCatalog) {
      new Setting(skillsSection).setName(t('settings.providerTabs.codex.skills.name')).setHeading();

      const skillsDesc = skillsSection.createDiv({ cls: 'grimoire-sp-settings-desc' });
      skillsDesc.createEl('p', {
        cls: 'setting-item-description',
        text: t('settings.providerTabs.codex.skills.desc'),
      });

      const skillsContainer = skillsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new CodexSkillSettings(skillsContainer, codexCatalog, context.plugin.app);
    }

    context.renderHiddenProviderCommandSetting(skillsSection, 'codex', {
      name: t('settings.providerTabs.codex.hiddenSkills.name'),
      desc: t('settings.providerTabs.codex.hiddenSkills.desc'),
      placeholder: 'analyze\nexplain\nfix',
    });

    // --- Subagents ---

    const agentsSection = context.createWorkspaceSection(advancedContainer, ['agents']);
    new Setting(agentsSection).setName(t('settings.providerTabs.codex.subagents.name')).setHeading();

    const subagentDesc = agentsSection.createDiv({ cls: 'grimoire-sp-settings-desc' });
    subagentDesc.createEl('p', {
      cls: 'setting-item-description',
      text: t('settings.providerTabs.codex.subagents.desc'),
    });

    const subagentContainer = agentsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
    new CodexSubagentSettings(subagentContainer, codexWorkspace.subagentStorage, context.plugin.app, () => {
      void codexWorkspace.refreshAgentMentions?.();
    });

    // --- MCP Servers ---

    const mcpSection = context.createWorkspaceSection(advancedContainer, ['mcp']);
    new Setting(mcpSection).setName(t('settings.mcpServers.name')).setHeading();
    const mcpNotice = mcpSection.createDiv({ cls: 'grimoire-mcp-settings-desc' });
    const mcpDesc = mcpNotice.createEl('p', { cls: 'setting-item-description' });
    mcpDesc.appendText(t('settings.providerTabs.codex.mcp.beforeCommand'));
    mcpDesc.createEl('code').appendText('codex mcp');
    mcpDesc.appendText(t('settings.providerTabs.codex.mcp.afterCommand'));
    mcpDesc.createEl('a', {
      text: t('settings.learnMore'),
      href: 'https://developers.openai.com/codex/mcp',
    });

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container: context.createWorkspaceSection(advancedContainer, ['environment']),
      plugin: context.plugin,
      scope: 'provider:codex',
      heading: t('settings.environment'),
      name: t('settings.providerTabs.codex.environment.name'),
      desc: t('settings.providerTabs.codex.environment.desc'),
      placeholder: `OPENAI_API_KEY=your-key\nOPENAI_BASE_URL=https://api.openai.com/v1\nOPENAI_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}\nCODEX_SANDBOX=workspace-write`,
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'codex'),
    });
  },
};
