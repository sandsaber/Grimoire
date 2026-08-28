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
import { maybeGetGrokWorkspaceServices } from '../app/GrokWorkspaceServices';
import { clearGrokDiscoveryState } from '../discoveryState';
import {
  buildGrokBaseModels,
  encodeGrokModelId,
  type GrokDiscoveredModel,
  splitGrokModelLabel,
} from '../models';
import {
  getGrokProviderSettings,
  GROK_DEFAULT_ENVIRONMENT_VARIABLES,
  normalizeGrokVisibleModels,
  updateGrokProviderSettings,
} from '../settings';
import { GrokAgentSettings } from './GrokAgentSettings';

const ALL_PROVIDERS_KEY = 'all';


interface EnrichedModel {
  description: string;
  isAvailable: boolean;
  modelLabel: string;
  providerKey: string;
  providerLabel: string;
  rawId: string;
}

export const grokSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const grokWorkspace = maybeGetGrokWorkspaceServices(context.plugin);
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const grokSettings = getGrokProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    if (!grokSettings.enabled) {
      renderProviderDisabledNotice(container, 'Grok');
    }

    new Setting(container).setName(t('settings.setup')).setHeading();

    const cliPathSetting = new Setting(container)
      .setName(t('settings.cliPath.name'))
      .setDesc(t('settings.grok.cliPath.desc'));

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

    const cliPathsByHost = { ...grokSettings.cliPathsByHost };
    const currentValue = grokSettings.cliPathsByHost[hostnameKey] || '';
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

      updateGrokProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      clearGrokDiscoveryState(settingsBag);
      await context.plugin.saveSettings();
      grokWorkspace?.cliResolver?.reset();
      await recycleGrokRuntime();
      return true;
    };

    const recycleGrokRuntime = async (): Promise<void> => {
      for (const view of context.plugin.getAllViews()) {
        const tabManager = view.getTabManager();
        if (tabManager?.broadcastToProviderTabs) {
          await tabManager.broadcastToProviderTabs('grok', (service) => Promise.resolve(service.cleanup()));
        } else {
          await tabManager?.broadcastToAllTabs(
            (service) => Promise.resolve(service.cleanup()),
          );
        }
        view.invalidateProviderCommandCaches?.(['grok']);
        view.refreshModelSelector?.();
      }
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\grok.cmd'
          : '/usr/local/bin/grok')
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
      .setName(t('settings.grok.visibleModels.name'))
      .setDesc(t('settings.grok.visibleModels.desc'));

    const pickerEl = container.createDiv({ cls: 'grimoire-grok-model-picker' });

    let searchQuery = '';
    let providerFilter = ALL_PROVIDERS_KEY;

    const summaryEl = pickerEl.createDiv({ cls: 'grimoire-grok-model-picker-summary' });
    const selectedEl = pickerEl.createDiv({ cls: 'grimoire-grok-model-picker-selected' });
    const catalogEl = pickerEl.createEl('details', { cls: 'grimoire-grok-model-picker-catalog' });
    catalogEl.open = getGrokProviderSettings(settingsBag).visibleModels.length === 0;
    const catalogSummaryEl = catalogEl.createEl('summary', {
      cls: 'grimoire-grok-model-picker-catalog-summary',
    });
    catalogSummaryEl.createSpan({
      cls: 'grimoire-grok-model-picker-catalog-caret',
      text: '▸',
    });
    catalogSummaryEl.createSpan({
      cls: 'grimoire-grok-model-picker-catalog-title',
      text: t('settings.grok.modelPicker.browseModels'),
    });
    const catalogSummaryCountEl = catalogSummaryEl.createSpan({
      cls: 'grimoire-grok-model-picker-catalog-count',
    });

    const controlsEl = catalogEl.createDiv({ cls: 'grimoire-grok-model-picker-controls' });

    const searchInput = controlsEl.createEl('input', {
      cls: 'grimoire-grok-model-picker-search',
      type: 'search',
    });
    searchInput.placeholder = t('settings.grok.modelPicker.searchPlaceholder');
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderList();
    });

    const providerSelectEl = controlsEl.createEl('select', {
      cls: 'grimoire-grok-model-picker-provider',
    });
    providerSelectEl.addEventListener('change', () => {
      providerFilter = providerSelectEl.value;
      renderList();
    });

    const listEl = catalogEl.createDiv({ cls: 'grimoire-grok-model-picker-list' });
    let loadingModelCatalog = false;
    let modelCatalogLoadFailed = false;

    const getEnrichedModels = (): EnrichedModel[] => {
      const current = getGrokProviderSettings(settingsBag);
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
      const currentVisibleModels = getGrokProviderSettings(settingsBag).visibleModels;
      const normalized = normalizeGrokVisibleModels(
        visibleModels,
        getGrokProviderSettings(settingsBag).discoveredModels,
      );
      if (sameStringList(currentVisibleModels, normalized)) {
        return;
      }

      updateGrokProviderSettings(settingsBag, { visibleModels: normalized });
      await context.plugin.saveSettings();
      renderAll();
      context.refreshModelSelectors();
    };

    const persistModelMetadata = async (rawId: string): Promise<void> => {
      try {
        const loaded = await context.plugin.getGrokExecution().metadata.discoverMetadata({
          model: encodeGrokModelId(rawId),
        });
        if (loaded) {
          context.refreshModelSelectors();
        }
      } catch {
        // Metadata warmup is opportunistic; the first chat turn can still
        // discover it. The session closes itself on every path.
      }
    };

    const persistModelAliases = async (modelAliases: Record<string, string>): Promise<void> => {
      updateGrokProviderSettings(settingsBag, { modelAliases });
      await context.plugin.saveSettings();
      renderSelected();
      context.refreshModelSelectors();
    };

    const renderSummary = (): void => {
      summaryEl.empty();
      const current = getGrokProviderSettings(settingsBag);
      const enriched = getEnrichedModels();
      const providerCount = new Set(enriched.map((model) => model.providerKey)).size;
      const providerWord = t(providerCount === 1
        ? 'settings.grok.modelPicker.providerSingular'
        : 'settings.grok.modelPicker.providerPlural');

      summaryEl.createSpan({ text: `${t('settings.grok.modelPicker.visibleLabel')} ` });
      summaryEl.createSpan({
        cls: 'grimoire-grok-model-picker-summary-value',
        text: String(current.visibleModels.length),
      });
      summaryEl.createSpan({
        text: ` ${t('settings.grok.modelPicker.summaryDiscovered', {
          count: providerCount,
          providerWord,
          total: current.discoveredModels.length,
        })}`,
      });

      let catalogSummary = t('settings.grok.modelPicker.noDiscovered');
      if (loadingModelCatalog) {
        catalogSummary = t('settings.grok.modelPicker.loadingModels');
      } else if (current.discoveredModels.length > 0) {
        catalogSummary = t('settings.grok.modelPicker.availableCount', { count: current.discoveredModels.length });
      }
      catalogSummaryCountEl.setText(catalogSummary);
    };

    const renderSelected = (): void => {
      selectedEl.empty();
      const current = getGrokProviderSettings(settingsBag);
      if (current.visibleModels.length === 0) {
        selectedEl.toggleClass('grimoire-hidden', true);
        return;
      }

      selectedEl.toggleClass('grimoire-hidden', false);
      const enrichedByRawId = new Map(
        getEnrichedModels().map((model) => [model.rawId, model] as const),
      );

      const headerEl = selectedEl.createDiv({ cls: 'grimoire-grok-model-picker-selected-header' });
      headerEl.createSpan({
        cls: 'grimoire-grok-model-picker-selected-label',
        text: t('settings.grok.modelPicker.selectedCount', { count: current.visibleModels.length }),
      });
      const clearAllBtn = headerEl.createEl('button', {
        cls: 'grimoire-grok-model-picker-selected-clear',
        text: t('common.clearAll'),
      });
      clearAllBtn.setAttribute('aria-label', t('settings.grok.modelPicker.clearSelected'));
      clearAllBtn.addEventListener('click', () => {
        void persistVisibleModels([]);
      });

      const rowsEl = selectedEl.createDiv({ cls: 'grimoire-grok-model-picker-selected-rows' });

      for (const rawId of current.visibleModels) {
        const enriched = enrichedByRawId.get(rawId);
        const defaultLabel = enriched
          ? `${enriched.providerLabel}/${enriched.modelLabel}`
          : rawId;

        const rowEl = rowsEl.createDiv({ cls: 'grimoire-grok-model-picker-selected-row' });
        if (enriched && !enriched.isAvailable) {
          rowEl.classList.add('grimoire-grok-model-picker-selected-row--unavailable');
        }

        const infoEl = rowEl.createDiv({ cls: 'grimoire-grok-model-picker-selected-info' });
        const titleEl = infoEl.createDiv({ cls: 'grimoire-grok-model-picker-selected-title' });
        if (enriched) {
          titleEl.createSpan({
            cls: 'grimoire-grok-model-picker-selected-badge',
            text: enriched.providerLabel,
          });
          titleEl.createSpan({
            cls: 'grimoire-grok-model-picker-selected-name',
            text: enriched.modelLabel,
          });
        } else {
          titleEl.createSpan({
            cls: 'grimoire-grok-model-picker-selected-name',
            text: rawId,
          });
        }

        if (enriched && !enriched.isAvailable) {
          infoEl.createDiv({
            cls: 'grimoire-grok-model-picker-selected-unavailable',
            text: t('settings.grok.modelPicker.notReported'),
          });
        }

        infoEl.createDiv({
          cls: 'grimoire-grok-model-picker-selected-id',
          text: rawId,
        });

        const controlsEl = rowEl.createDiv({ cls: 'grimoire-grok-model-picker-selected-controls' });
        const aliasInput = controlsEl.createEl('input', {
          cls: 'grimoire-grok-model-picker-selected-alias',
          type: 'text',
        });
        aliasInput.placeholder = defaultLabel;
        aliasInput.value = current.modelAliases[rawId] ?? '';
        aliasInput.setAttribute('aria-label', t('settings.grok.modelPicker.aliasLabel', { model: defaultLabel }));
        aliasInput.title = t('settings.grok.modelPicker.aliasTitle');

        const commitAlias = (): void => {
          const latest = getGrokProviderSettings(settingsBag);
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
            aliasInput.value = getGrokProviderSettings(settingsBag).modelAliases[rawId] ?? '';
            aliasInput.blur();
          }
        });

        const removeBtn = controlsEl.createEl('button', {
          cls: 'grimoire-grok-model-picker-selected-remove',
          text: '×',
        });
        removeBtn.setAttribute('aria-label', t('settings.grok.modelPicker.removeModel', { model: defaultLabel }));
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
        text: t('settings.grok.modelPicker.allProviders', { count: enriched.length }),
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
      const current = getGrokProviderSettings(settingsBag);
      const selectedIds = new Set(current.visibleModels);
      const enriched = getEnrichedModels();
      const filtered = filterModels(enriched);

      if (filtered.length === 0) {
        const emptyEl = listEl.createDiv({ cls: 'grimoire-grok-model-picker-empty' });
        let emptyText = t('settings.grok.modelPicker.noMatch');
        if (loadingModelCatalog) {
          emptyText = t('settings.grok.modelPicker.loadingCatalog');
        } else if (modelCatalogLoadFailed) {
          emptyText = t('settings.grok.modelPicker.loadFailed');
        } else if (enriched.length === 0) {
          emptyText = t('settings.grok.modelPicker.startToLoad');
        }
        emptyEl.setText(emptyText);
        return;
      }

      for (const model of filtered) {
        const rowEl = listEl.createEl('label', { cls: 'grimoire-grok-model-picker-row' });
        const isSelected = selectedIds.has(model.rawId);
        if (isSelected) {
          rowEl.classList.add('grimoire-grok-model-picker-row--selected');
        }
        rowEl.title = model.rawId;

        const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
        checkboxEl.checked = isSelected;
        checkboxEl.addEventListener('change', () => {
          const currentVisibleModels = getGrokProviderSettings(settingsBag).visibleModels;
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

        const textEl = rowEl.createDiv({ cls: 'grimoire-grok-model-picker-row-text' });

        const headerEl = textEl.createDiv({ cls: 'grimoire-grok-model-picker-row-header' });
        headerEl.createSpan({
          cls: 'grimoire-grok-model-picker-row-name',
          text: model.modelLabel,
        });
        const badgeEl = headerEl.createSpan({
          cls: 'grimoire-grok-model-picker-row-badge',
          text: model.providerLabel,
        });
        if (!model.isAvailable) {
          badgeEl.classList.add('grimoire-grok-model-picker-row-badge--unavailable');
          badgeEl.setText(t('settings.grok.modelPicker.unavailable'));
          badgeEl.title = t('settings.grok.modelPicker.unavailableTitle');
        }

        textEl.createDiv({
          cls: 'grimoire-grok-model-picker-row-meta',
          text: model.rawId,
        });

        if (model.description) {
          textEl.createDiv({
            cls: 'grimoire-grok-model-picker-row-desc',
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
      if (loadingModelCatalog) {
        return;
      }

      loadingModelCatalog = true;
      modelCatalogLoadFailed = false;
      renderAll();

      try {
        const catalog = maybeGetGrokWorkspaceServices(context.plugin)?.modelCatalog;
        if (catalog) {
          await catalog.refreshModels({
            plugin: context.plugin,
            settings: settingsBag,
          });
        } else {
          await context.plugin.getGrokExecution().metadata.discoverMetadata();
        }
        modelCatalogLoadFailed = getGrokProviderSettings(settingsBag).discoveredModels.length === 0;
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
      summary: t('settings.grok.advanced.summary'),
    });

    const skillsSection = context.createWorkspaceSection(advancedContainer, ['skills']);
    new Setting(skillsSection).setName(t('settings.hub.skills')).setHeading();
    if (grokWorkspace?.commandCatalog) {
      const skillsContainer = skillsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new ProviderSkillSettings(
        skillsContainer,
        context.plugin.app,
        'grok',
        grokWorkspace.commandCatalog,
      );
    }

    const commandsSection = context.createWorkspaceSection(advancedContainer, ['commands']);
    new Setting(commandsSection).setName(t('settings.slashCommands.name')).setHeading();

    const commandsDesc = commandsSection.createDiv({ cls: 'grimoire-sp-settings-desc' });
    commandsDesc.createEl('p', {
      cls: 'setting-item-description',
      text: t('settings.grok.commands.desc'),
    });

    context.renderHiddenProviderCommandSetting(commandsSection, 'grok', {
      name: t('settings.hiddenSlashCommands.name'),
      desc: t('settings.grok.hiddenCommands.desc'),
      placeholder: 'compact\nreview\nfix',
    });

    if (grokWorkspace?.agentStorage) {
      const agentsSection = context.createWorkspaceSection(advancedContainer, ['agents']);
      new Setting(agentsSection).setName(t('settings.subagents.name')).setHeading();

      const subagentsDesc = agentsSection.createDiv({ cls: 'grimoire-sp-settings-desc' });
      subagentsDesc.createEl('p', {
        cls: 'setting-item-description',
        text: t('settings.grok.subagents.desc'),
      });

      const subagentsContainer = agentsSection.createDiv({ cls: 'grimoire-slash-commands-container' });
      new GrokAgentSettings(
        subagentsContainer,
        grokWorkspace.agentStorage,
        context.plugin.app,
        async () => {
          await grokWorkspace.refreshAgentMentions?.();
          await recycleGrokRuntime();
        },
      );
    }

    if (grokWorkspace?.mcpStorage) {
      const mcpSection = context.createWorkspaceSection(advancedContainer, ['mcp']);
      new Setting(mcpSection).setName(t('settings.mcpServers.name')).setHeading();
      const mcpContainer = mcpSection.createDiv({ cls: 'grimoire-mcp-container' });
      new McpSettingsManager(mcpContainer, {
        app: context.plugin.app,
        mcpStorage: grokWorkspace.mcpStorage,
        broadcastMcpReload: async () => {
          for (const view of context.plugin.getAllViews()) {
            await view.getTabManager()?.broadcastToProviderTabs?.(
              'grok',
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
      scope: 'provider:grok',
      heading: t('settings.environment'),
      name: t('settings.customVariables.name'),
      desc: t('settings.grok.environment.desc'),
      placeholder: `${GROK_DEFAULT_ENVIRONMENT_VARIABLES}\nGROK_AUTH_PATH=~/.grok/auth.json`,
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'grok'),
    });
  },
};

function buildEnrichedModels(
  discoveredModels: GrokDiscoveredModel[],
  visibleModels: string[],
): EnrichedModel[] {
  const enriched: EnrichedModel[] = [];
  const discoveredIds = new Set<string>();
  const baseModels = buildGrokBaseModels(discoveredModels);

  for (const model of baseModels) {
    const { modelLabel, providerLabel } = splitGrokModelLabel(model.label || model.rawId, model.rawId);
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

    const { modelLabel, providerLabel } = splitGrokModelLabel(rawId, rawId);
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
