import * as fs from 'fs';
import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { McpSettingsManager } from '../../../features/settings/ui/McpSettingsManager';
import { renderProviderDisabledNotice } from '../../../features/settings/ui/ProviderDisabledNotice';
import { ProviderSkillSettings } from '../../../features/settings/ui/ProviderSkillSettings';
import { t } from '../../../i18n/i18n';
import { sameStringList } from '../../../utils/collections';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetMimocodeWorkspaceServices } from '../app/MimocodeWorkspaceServices';
import { clearMimocodeDiscoveryState } from '../discoveryState';
import {
  buildMimocodeBaseModels,
  type MimocodeDiscoveredModel,
  splitMimocodeModelLabel,
} from '../models';
import {
  getMimocodeProviderSettings,
  MIMOCODE_DEFAULT_ENVIRONMENT_VARIABLES,
  normalizeMimocodeVisibleModels,
  updateMimocodeProviderSettings,
} from '../settings';
import { MimocodeAgentSettings } from './MimocodeAgentSettings';

const ALL_PROVIDERS_KEY = 'all';

interface EnrichedModel {
  description: string;
  isAvailable: boolean;
  modelLabel: string;
  providerKey: string;
  providerLabel: string;
  rawId: string;
}

export const mimocodeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const mimocodeWorkspace = maybeGetMimocodeWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const mimocodeSettings = getMimocodeProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    if (!mimocodeSettings.enabled) {
      renderProviderDisabledNotice(container, 'MiMoCode');
    }

    new Setting(container).setName(t('settings.setup')).setHeading();

    const cliPathSetting = new Setting(container)
      .setName(t('settings.providerTabs.acp.cliPath.name', { provider: 'MiMoCode' }))
      .setDesc(t('settings.providerTabs.acp.cliPath.desc', {
        command: 'mimo',
        provider: 'MiMoCode',
      }));

    const validationEl = container.createDiv({
      cls: 'grimoire-cli-path-validation grimoire-setting-validation grimoire-setting-validation-error grimoire-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) {
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

    const cliPathsByHost = { ...mimocodeSettings.cliPathsByHost };
    const currentValue = mimocodeSettings.cliPathsByHost[hostnameKey] || '';
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

      updateMimocodeProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      clearMimocodeDiscoveryState(settingsBag);
      await context.plugin.saveSettings();
      mimocodeWorkspace?.cliResolver?.reset();
      await recycleMimocodeRuntime();
      return true;
    };

    const recycleMimocodeRuntime = async (): Promise<void> => {
      for (const view of context.plugin.getAllViews()) {
        const tabManager = view.getTabManager();
        if (tabManager?.broadcastToProviderTabs) {
          await tabManager.broadcastToProviderTabs('mimocode', (service) => Promise.resolve(service.cleanup()));
        } else {
          await tabManager?.broadcastToAllTabs(
            (service) => Promise.resolve(service.cleanup()),
          );
        }
        view.invalidateProviderCommandCaches?.(['mimocode']);
        view.refreshModelSelector?.();
      }
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\mimo.cmd'
          : '/usr/local/bin/mimo')
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
      .setName(t('settings.providerTabs.acp.visibleModels.name'))
      .setDesc(t('settings.providerTabs.acp.visibleModels.desc', { provider: 'MiMoCode' }));

    const pickerEl = container.createDiv({ cls: 'grimoire-mimocode-model-picker' });

    let searchQuery = '';
    let providerFilter = ALL_PROVIDERS_KEY;

    const summaryEl = pickerEl.createDiv({ cls: 'grimoire-mimocode-model-picker-summary' });
    const selectedEl = pickerEl.createDiv({ cls: 'grimoire-mimocode-model-picker-selected' });
    const catalogEl = pickerEl.createEl('details', { cls: 'grimoire-mimocode-model-picker-catalog' });
    catalogEl.open = getMimocodeProviderSettings(settingsBag).visibleModels.length === 0;
    const catalogSummaryEl = catalogEl.createEl('summary', {
      cls: 'grimoire-mimocode-model-picker-catalog-summary',
    });
    catalogSummaryEl.createSpan({
      cls: 'grimoire-mimocode-model-picker-catalog-caret',
      text: '▸',
    });
    catalogSummaryEl.createSpan({
      cls: 'grimoire-mimocode-model-picker-catalog-title',
      text: t('settings.providerModelPicker.browseModels'),
    });
    const catalogSummaryCountEl = catalogSummaryEl.createSpan({
      cls: 'grimoire-mimocode-model-picker-catalog-count',
    });

    const controlsEl = catalogEl.createDiv({ cls: 'grimoire-mimocode-model-picker-controls' });

    const searchInput = controlsEl.createEl('input', {
      cls: 'grimoire-mimocode-model-picker-search',
      type: 'search',
    });
    searchInput.placeholder = t('settings.providerModelPicker.searchPlaceholder');
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderList();
    });

    const providerSelectEl = controlsEl.createEl('select', {
      cls: 'grimoire-mimocode-model-picker-provider',
    });
    providerSelectEl.addEventListener('change', () => {
      providerFilter = providerSelectEl.value;
      renderList();
    });

    const listEl = catalogEl.createDiv({ cls: 'grimoire-mimocode-model-picker-list' });
    let loadingModelCatalog = false;
    let modelCatalogLoadFailed = false;

    const getEnrichedModels = (): EnrichedModel[] => {
      const current = getMimocodeProviderSettings(settingsBag);
      return buildEnrichedModels(current.discoveredModels, current.visibleModels);
    };

    const filterModels = (models: EnrichedModel[]): EnrichedModel[] => {
      return models.filter((model) => {
        if (providerFilter !== ALL_PROVIDERS_KEY && model.providerKey !== providerFilter) {
          return false;
        }

        if (!searchQuery) {
          return true;
        }

        return (
          model.rawId.toLowerCase().includes(searchQuery)
          || model.modelLabel.toLowerCase().includes(searchQuery)
          || model.providerLabel.toLowerCase().includes(searchQuery)
          || model.description.toLowerCase().includes(searchQuery)
        );
      });
    };

    const persistVisibleModels = async (visibleModels: string[]): Promise<void> => {
      const currentVisibleModels = getMimocodeProviderSettings(settingsBag).visibleModels;
      const normalized = normalizeMimocodeVisibleModels(
        visibleModels,
        getMimocodeProviderSettings(settingsBag).discoveredModels,
      );
      if (sameStringList(currentVisibleModels, normalized)) {
        return;
      }

      updateMimocodeProviderSettings(settingsBag, { visibleModels: normalized });
      await context.plugin.saveSettings();
      renderAll();
      context.refreshModelSelectors();
    };

    const persistModelMetadata = async (_rawId: string): Promise<void> => {
      // Phase 9 cutover — MimocodeChatRuntime removed. Model metadata
      // persistence now happens through the application runtime; no-op.
    };

    const persistModelAliases = async (modelAliases: Record<string, string>): Promise<void> => {
      updateMimocodeProviderSettings(settingsBag, { modelAliases });
      await context.plugin.saveSettings();
      renderSelected();
      context.refreshModelSelectors();
    };

    const renderSummary = (): void => {
      summaryEl.empty();
      const current = getMimocodeProviderSettings(settingsBag);
      const enriched = getEnrichedModels();
      const providerCount = new Set(enriched.map((model) => model.providerKey)).size;
      const providerWord = t(providerCount === 1
        ? 'settings.providerModelPicker.providerSingular'
        : 'settings.providerModelPicker.providerPlural');

      summaryEl.createSpan({ text: `${t('settings.providerModelPicker.visibleLabel')} ` });
      summaryEl.createSpan({
        cls: 'grimoire-mimocode-model-picker-summary-value',
        text: String(current.visibleModels.length),
      });
      summaryEl.createSpan({
        text: ` ${t('settings.providerModelPicker.summaryDiscovered', {
          total: current.discoveredModels.length,
          count: providerCount,
          providerWord,
        })}`,
      });

      let catalogSummary = t('settings.providerModelPicker.noDiscovered');
      if (loadingModelCatalog) {
        catalogSummary = t('settings.providerModelPicker.loadingModels');
      } else if (current.discoveredModels.length > 0) {
        catalogSummary = t('settings.providerModelPicker.availableCount', {
          count: current.discoveredModels.length,
        });
      }
      catalogSummaryCountEl.setText(catalogSummary);
    };

    const renderSelected = (): void => {
      selectedEl.empty();
      const current = getMimocodeProviderSettings(settingsBag);
      if (current.visibleModels.length === 0) {
        selectedEl.toggleClass('grimoire-hidden', true);
        return;
      }

      selectedEl.toggleClass('grimoire-hidden', false);
      const enrichedByRawId = new Map(
        getEnrichedModels().map((model) => [model.rawId, model] as const),
      );

      const headerEl = selectedEl.createDiv({ cls: 'grimoire-mimocode-model-picker-selected-header' });
      headerEl.createSpan({
        cls: 'grimoire-mimocode-model-picker-selected-label',
        text: t('settings.providerModelPicker.selectedCount', { count: current.visibleModels.length }),
      });
      const clearAllBtn = headerEl.createEl('button', {
        cls: 'grimoire-mimocode-model-picker-selected-clear',
        text: t('common.clearAll'),
      });
      clearAllBtn.setAttribute('aria-label', t('settings.providerModelPicker.clearSelected'));
      clearAllBtn.addEventListener('click', () => {
        void persistVisibleModels([]);
      });

      const rowsEl = selectedEl.createDiv({ cls: 'grimoire-mimocode-model-picker-selected-rows' });

      for (const rawId of current.visibleModels) {
        const enriched = enrichedByRawId.get(rawId);
        const defaultLabel = enriched
          ? `${enriched.providerLabel}/${enriched.modelLabel}`
          : rawId;

        const rowEl = rowsEl.createDiv({ cls: 'grimoire-mimocode-model-picker-selected-row' });
        if (enriched && !enriched.isAvailable) {
          rowEl.classList.add('grimoire-mimocode-model-picker-selected-row--unavailable');
        }

        const infoEl = rowEl.createDiv({ cls: 'grimoire-mimocode-model-picker-selected-info' });
        const titleEl = infoEl.createDiv({ cls: 'grimoire-mimocode-model-picker-selected-title' });
        if (enriched) {
          titleEl.createSpan({
            cls: 'grimoire-mimocode-model-picker-selected-badge',
            text: enriched.providerLabel,
          });
          titleEl.createSpan({
            cls: 'grimoire-mimocode-model-picker-selected-name',
            text: enriched.modelLabel,
          });
        } else {
          titleEl.createSpan({
            cls: 'grimoire-mimocode-model-picker-selected-name',
            text: rawId,
          });
        }

        if (enriched && !enriched.isAvailable) {
          infoEl.createDiv({
            cls: 'grimoire-mimocode-model-picker-selected-unavailable',
            text: t('settings.providerModelPicker.notReported', { provider: 'MiMoCode' }),
          });
        }

        infoEl.createDiv({
          cls: 'grimoire-mimocode-model-picker-selected-id',
          text: rawId,
        });

        const controlsEl = rowEl.createDiv({ cls: 'grimoire-mimocode-model-picker-selected-controls' });
        const aliasInput = controlsEl.createEl('input', {
          cls: 'grimoire-mimocode-model-picker-selected-alias',
          type: 'text',
        });
        aliasInput.placeholder = defaultLabel;
        aliasInput.value = current.modelAliases[rawId] ?? '';
        aliasInput.setAttribute('aria-label', t('settings.providerModelPicker.aliasLabel', { model: defaultLabel }));
        aliasInput.title = t('settings.providerModelPicker.aliasTitle');

        const commitAlias = (): void => {
          const latest = getMimocodeProviderSettings(settingsBag);
          const existing = latest.modelAliases[rawId] ?? '';
          const next = aliasInput.value.trim();
          if (next === existing) {
            aliasInput.value = existing;
            return;
          }

          const nextAliases = { ...latest.modelAliases };
          if (next) {
            nextAliases[rawId] = next;
          } else {
            delete nextAliases[rawId];
          }
          void persistModelAliases(nextAliases);
        };

        aliasInput.addEventListener('blur', commitAlias);
        aliasInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            aliasInput.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            aliasInput.value = getMimocodeProviderSettings(settingsBag).modelAliases[rawId] ?? '';
            aliasInput.blur();
          }
        });

        const removeBtn = controlsEl.createEl('button', {
          cls: 'grimoire-mimocode-model-picker-selected-remove',
          text: '×',
        });
        removeBtn.setAttribute('aria-label', t('settings.providerModelPicker.removeModel', { model: defaultLabel }));
        removeBtn.addEventListener('click', () => {
          void persistVisibleModels(current.visibleModels.filter((entry) => entry !== rawId));
        });
      }
    };

    const renderProviderSelect = (): void => {
      const enriched = getEnrichedModels();
      const providers = new Map<string, { count: number; label: string }>();
      for (const model of enriched) {
        const existing = providers.get(model.providerKey);
        if (existing) {
          existing.count += 1;
        } else {
          providers.set(model.providerKey, { count: 1, label: model.providerLabel });
        }
      }

      providerSelectEl.empty();
      providerSelectEl.createEl('option', {
        text: t('settings.providerModelPicker.allProviders', { count: enriched.length }),
        value: ALL_PROVIDERS_KEY,
      });

      const sortedProviders = Array.from(providers.entries())
        .sort(([, left], [, right]) => left.label.localeCompare(right.label));
      for (const [key, { count, label }] of sortedProviders) {
        providerSelectEl.createEl('option', {
          text: `${label} (${count})`,
          value: key,
        });
      }

      if (providerFilter !== ALL_PROVIDERS_KEY && !providers.has(providerFilter)) {
        providerFilter = ALL_PROVIDERS_KEY;
      }
      providerSelectEl.value = providerFilter;
    };

    const renderList = (): void => {
      listEl.empty();
      const current = getMimocodeProviderSettings(settingsBag);
      const selectedIds = new Set(current.visibleModels);
      const enriched = getEnrichedModels();
      const filtered = filterModels(enriched);

      if (filtered.length === 0) {
        const emptyEl = listEl.createDiv({ cls: 'grimoire-mimocode-model-picker-empty' });
        let emptyText = t('settings.providerModelPicker.noMatch');
        if (loadingModelCatalog) {
          emptyText = t('settings.providerModelPicker.loadingCatalog', { provider: 'MiMoCode' });
        } else if (modelCatalogLoadFailed) {
          emptyText = t('settings.providerModelPicker.loadFailed', { provider: 'MiMoCode' });
        } else if (enriched.length === 0) {
          emptyText = t('settings.providerModelPicker.startToLoad', { provider: 'MiMoCode' });
        }
        emptyEl.setText(emptyText);
        return;
      }

      for (const model of filtered) {
        const rowEl = listEl.createEl('label', { cls: 'grimoire-mimocode-model-picker-row' });
        const isSelected = selectedIds.has(model.rawId);
        if (isSelected) {
          rowEl.classList.add('grimoire-mimocode-model-picker-row--selected');
        }
        rowEl.title = model.rawId;

        const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
        checkboxEl.checked = isSelected;
        checkboxEl.addEventListener('change', () => {
          const currentVisibleModels = getMimocodeProviderSettings(settingsBag).visibleModels;
          const next = checkboxEl.checked
            ? [...currentVisibleModels, model.rawId]
            : currentVisibleModels.filter((id) => id !== model.rawId);
          void (async () => {
            await persistVisibleModels(next);
            if (checkboxEl.checked) {
              await persistModelMetadata(model.rawId);
            }
          })();
        });

        const textEl = rowEl.createDiv({ cls: 'grimoire-mimocode-model-picker-row-text' });

        const headerEl = textEl.createDiv({ cls: 'grimoire-mimocode-model-picker-row-header' });
        headerEl.createSpan({
          cls: 'grimoire-mimocode-model-picker-row-name',
          text: model.modelLabel,
        });
        const badgeEl = headerEl.createSpan({
          cls: 'grimoire-mimocode-model-picker-row-badge',
          text: model.providerLabel,
        });
        if (!model.isAvailable) {
          badgeEl.classList.add('grimoire-mimocode-model-picker-row-badge--unavailable');
          badgeEl.setText(t('settings.providerModelPicker.unavailable'));
          badgeEl.title = t('settings.providerModelPicker.unavailableTitle', { provider: 'MiMoCode' });
        }

        textEl.createDiv({
          cls: 'grimoire-mimocode-model-picker-row-meta',
          text: model.rawId,
        });

        if (model.description) {
          textEl.createDiv({
            cls: 'grimoire-mimocode-model-picker-row-desc',
            text: model.description,
          });
        }

      }
    };

    const renderAll = (): void => {
      renderSummary();
      renderSelected();
      renderProviderSelect();
      renderList();
    };

    renderAll();

    const loadModelCatalog = async (): Promise<void> => {
      if (loadingModelCatalog || getMimocodeProviderSettings(settingsBag).discoveredModels.length > 0) {
        return;
      }

      loadingModelCatalog = true;
      modelCatalogLoadFailed = false;
      renderAll();

      // Phase 9 cutover — MimocodeChatRuntime removed. Catalog refresh now
      // happens through the application runtime; legacy manual refresh reports failure.
      try {
        modelCatalogLoadFailed = getMimocodeProviderSettings(settingsBag).discoveredModels.length === 0;
        if (!modelCatalogLoadFailed) {
          context.refreshModelSelectors();
        }
      } catch {
        modelCatalogLoadFailed = true;
      } finally {
        loadingModelCatalog = false;
        renderAll();
      }
    };

    catalogEl.addEventListener('toggle', () => {
      if (catalogEl.open && !context.suppressAutomaticDiscovery) {
        void loadModelCatalog();
      }
    });
    if (catalogEl.open && !context.suppressAutomaticDiscovery) {
      void loadModelCatalog();
    }

    const advancedContainer = context.renderAdvancedSection(container, {
      count: 6,
      summary: t('settings.advanced.providerSummary'),
    });

    const skillsSection = context.createWorkspaceSection(advancedContainer, ['skills']);
    new Setting(skillsSection).setName(t('settings.hub.skills')).setHeading();
    if (mimocodeWorkspace?.commandCatalog) {
      const skillsContainer = skillsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new ProviderSkillSettings(
        skillsContainer,
        context.plugin.app,
        'mimocode',
        mimocodeWorkspace.commandCatalog,
      );
    }

    const commandsSection = context.createWorkspaceSection(advancedContainer, ['commands']);
    new Setting(commandsSection).setName(t('settings.slashCommands.name')).setHeading();

    const commandsDesc = commandsSection.createDiv({ cls: 'grimoire-sp-settings-desc' });
    commandsDesc.createEl('p', {
      cls: 'setting-item-description',
      text: t('settings.providerTabs.acp.commandsDesc', { provider: 'MiMoCode' }),
    });

    context.renderHiddenProviderCommandSetting(commandsSection, 'mimocode', {
      name: t('settings.hiddenSlashCommands.name'),
      desc: t('settings.providerTabs.acp.hiddenCommandsDesc', { provider: 'MiMoCode' }),
      placeholder: 'compact\nreview\nfix',
    });

    if (mimocodeWorkspace?.agentStorage) {
      const agentsSection = context.createWorkspaceSection(advancedContainer, ['agents']);
      new Setting(agentsSection).setName(t('settings.subagents.name')).setHeading();

      const subagentsDesc = agentsSection.createDiv({ cls: 'grimoire-sp-settings-desc' });
      subagentsDesc.createEl('p', {
        cls: 'setting-item-description',
        text: t('settings.providerTabs.acp.subagentsDesc', {
          legacyRoot: '.mimocode/agents/',
          provider: 'MiMoCode',
          root: '.mimocode/agent/',
        }),
      });

      const subagentsContainer = agentsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new MimocodeAgentSettings(
        subagentsContainer,
        mimocodeWorkspace.agentStorage,
        context.plugin.app,
        async () => {
          await mimocodeWorkspace.refreshAgentMentions?.();
          await recycleMimocodeRuntime();
        },
      );
    }

    if (mimocodeWorkspace?.mcpStorage) {
      const mcpSection = context.createWorkspaceSection(advancedContainer, ['mcp']);
      new Setting(mcpSection).setName(t('settings.mcpServers.name')).setHeading();
      const mcpContainer = mcpSection.createDiv({ cls: 'grimoire-mcp-container' });
      new McpSettingsManager(mcpContainer, {
        app: context.plugin.app,
        mcpStorage: mimocodeWorkspace.mcpStorage,
        broadcastMcpReload: async () => {
          for (const view of context.plugin.getAllViews()) {
            await view.getTabManager()?.broadcastToProviderTabs?.(
              'mimocode',
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
      scope: 'provider:mimocode',
      heading: t('settings.environment'),
      name: t('settings.providerTabs.environmentVariables'),
      desc: t('settings.providerTabs.acp.environmentDesc', {
        environmentVariable: 'MIMOCODE_ENABLE_EXA',
        provider: 'MiMoCode',
      }),
      placeholder: `${MIMOCODE_DEFAULT_ENVIRONMENT_VARIABLES}\nMIMOCODE_DB=/path/to/mimocode.db`,
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'mimocode'),
    });
  },
};

function buildEnrichedModels(
  discoveredModels: MimocodeDiscoveredModel[],
  visibleModels: string[],
): EnrichedModel[] {
  const enriched: EnrichedModel[] = [];
  const discoveredIds = new Set<string>();
  const baseModels = buildMimocodeBaseModels(discoveredModels);

  for (const model of baseModels) {
    const { modelLabel, providerLabel } = splitMimocodeModelLabel(model.label || model.rawId);
    discoveredIds.add(model.rawId);
    enriched.push({
      description: model.description ?? '',
      isAvailable: true,
      modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      rawId: model.rawId,
    });
  }

  for (const rawId of visibleModels) {
    if (discoveredIds.has(rawId)) {
      continue;
    }

    const { modelLabel, providerLabel } = splitMimocodeModelLabel(rawId);
    enriched.push({
      description: '',
      isAvailable: false,
      modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      rawId,
    });
  }

  return enriched.sort((left, right) => {
    const providerCmp = left.providerLabel.localeCompare(right.providerLabel);
    if (providerCmp !== 0) {
      return providerCmp;
    }
    return left.modelLabel.localeCompare(right.modelLabel);
  });
}
