import { Notice, setIcon, setTooltip } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import type { ProjectWorkspace } from '../../../core/context/types';
import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import type {
  ProviderChatUiContribution,
  ProviderModelOption,
  ProviderModeSelector,
  ProviderPermissionModeToggle,
  ProviderReasoningTier,
  ProviderServiceTierToggle,
  ProviderUsageSnapshot,
  ProviderUsageWindow,
} from '../../../core/providers/ProviderModule';
import type {
  ProviderCapabilities,
  ProviderId,
} from '../../../core/providers/types';
import type {
  ManagedMcpServer,
  UsageInfo,
} from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { appendCheckIcon, appendMcpIcon, createProviderIconSvg } from '../../../shared/icons';
import { filterValidPaths, findConflictingPath, isDuplicatePath, isValidContextPath, validateContextPath } from '../../../utils/externalContext';
import { expandHomePath, normalizePathForFilesystem } from '../../../utils/path';
import { localizeReasoningLevel } from '../utils/reasoningDisplay';

interface ElectronOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronRemoteApi {
  dialog: {
    showOpenDialog(options: { properties: string[]; title: string }): Promise<ElectronOpenDialogResult>;
  };
}

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

function formatModelFallbackLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return t('chat.ui.model.unknown');
  }
  if (/^gpt-/i.test(trimmed)) {
    return trimmed.replace(/^gpt-/i, 'GPT-').replace(/-([a-z])/gi, (_, letter: string) => ` ${letter.toUpperCase()}`);
  }
  return trimmed
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatModelButtonLabel(label: string): string {
  const trimmed = label.trim();
  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return trimmed;
  }

  return trimmed.slice(slashIndex + 1).trim() || trimmed;
}

function splitModelOptionLabel(label: string): { detail: string | null; label: string } {
  const trimmed = label.trim();
  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return { detail: null, label: trimmed };
  }

  const detail = trimmed.slice(0, slashIndex).trim();
  const modelLabel = trimmed.slice(slashIndex + 1).trim();
  return {
    detail: detail || null,
    label: modelLabel || trimmed,
  };
}

const PLAN_USAGE_WARN_THRESHOLD = 80;
const FIVE_HOUR_WINDOW_PATTERN = /5\s*-?\s*h/i;
const WEEKLY_WINDOW_PATTERN = /week/i;

function clampUsagePct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function isQuotaUsage(usage: ProviderUsageSnapshot | null | undefined): usage is ProviderUsageSnapshot & { windows: ProviderUsageWindow[] } {
  return Array.isArray(usage?.windows);
}

function isSpendUsage(usage: ProviderUsageSnapshot | null | undefined): usage is ProviderUsageSnapshot & { spend: string } {
  return typeof usage?.spend === 'string' && usage.spend.trim().length > 0;
}

function normalizeUsageWindow(window: ProviderUsageWindow): ProviderUsageWindow {
  return {
    label: window.label,
    pct: clampUsagePct(window.pct),
    ...(window.pctKnown === false ? { pctKnown: false } : {}),
    reset: window.reset,
  };
}

function findFiveHourWindow(usage: ProviderUsageSnapshot | null | undefined): ProviderUsageWindow | null {
  if (!isQuotaUsage(usage)) {
    return null;
  }
  const window = usage.windows.find(item => FIVE_HOUR_WINDOW_PATTERN.test(item.label));
  if (!window) {
    return null;
  }
  const normalized = normalizeUsageWindow(window);
  return isUsagePctKnown(normalized) ? normalized : null;
}

function findPrimaryQuotaWindow(usage: ProviderUsageSnapshot | null | undefined): ProviderUsageWindow | null {
  const fiveHourWindow = findFiveHourWindow(usage);
  if (fiveHourWindow) {
    return fiveHourWindow;
  }

  if (!isQuotaUsage(usage)) {
    return null;
  }

  for (const window of usage.windows) {
    const normalized = normalizeUsageWindow(window);
    if (isUsagePctKnown(normalized)) {
      return normalized;
    }
  }

  return null;
}

function formatQuotaBadgeLabel(label: string): string {
  if (FIVE_HOUR_WINDOW_PATTERN.test(label)) {
    return '5H';
  }
  if (WEEKLY_WINDOW_PATTERN.test(label)) {
    return 'WK';
  }

  const trimmed = label.trim();
  if (!trimmed) {
    return t('chat.ui.usage.label');
  }

  return trimmed.length <= 4 ? trimmed.toUpperCase() : trimmed;
}

function formatQuotaLimitDescription(window: ProviderUsageWindow): string {
  if (FIVE_HOUR_WINDOW_PATTERN.test(window.label)) {
    return t('chat.ui.usage.fiveHourLimit');
  }

  return t('chat.ui.usage.namedLimit', { name: window.label });
}

function stripThisMonth(spend: string): string {
  return spend.replace(/\s+this\s+month\s*$/i, '').trim() || spend.trim();
}

function isUsagePctKnown(window: ProviderUsageWindow): boolean {
  return window.pctKnown !== false;
}

function formatUsagePct(window: ProviderUsageWindow): string {
  return isUsagePctKnown(window) ? `${window.pct}%` : '—';
}

function isUsageWindowHot(window: ProviderUsageWindow): boolean {
  return isUsagePctKnown(window) && window.pct >= PLAN_USAGE_WARN_THRESHOLD;
}

function formatQuotaAriaLabel(plan: string, window: ProviderUsageWindow): string {
  const limitDescription = formatQuotaLimitDescription(window);
  return isUsagePctKnown(window)
    ? t('chat.ui.usage.ariaWithPercent', {
      plan,
      limit: limitDescription,
      percent: window.pct,
      reset: window.reset,
    })
    : t('chat.ui.usage.ariaWithoutPercent', {
      plan,
      limit: limitDescription,
      reset: window.reset,
    });
}

function areUsageIndicatorsEnabled(settings: Partial<ToolbarSettings> | null | undefined): boolean {
  return settings?.usageIndicatorsEnabled !== false;
}

export interface ToolbarSettings {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  permissionMode: string;
  usageIndicatorsEnabled?: boolean;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onEffortLevelChange: (effort: string) => Promise<void>;
  onServiceTierChange: (serviceTier: string) => Promise<void>;
  onPermissionModeChange: (mode: string) => Promise<void>;
  onOrchestratorModeChange?: () => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getChatUI: () => ProviderChatUiContribution;
  getCapabilities: () => ProviderCapabilities;
  refreshModelOptions?: () => Promise<void>;
  getProviderId?: () => ProviderId;
  getProviderUsage?: (providerId: ProviderId) => ProviderUsageSnapshot | null;
  refreshProviderUsage?: (providerId: ProviderId) => Promise<ProviderUsageSnapshot | null>;
  onProviderUsageRefresh?: (providerId: ProviderId) => void;
  resolveProviderForModel?: (model: string) => ProviderId;
  getOrchestratorMode?: () => boolean;
  getProjectWorkspaces?: () => ProjectWorkspace[];
  getActiveProjectWorkspaceId?: () => string;
  onProjectWorkspaceChange?: (workspaceId: string) => Promise<void>;
  onExternalContextFileSelect?: (filePath: string) => void;
}

export class ModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private pendingModel: string | null = null;
  private modelCatalogRefreshPromise: Promise<void> | null = null;
  private modelCatalogRefreshFailed = false;
  private isRefreshingModelCatalog = false;
  private providerUsageRefreshPromises = new Map<ProviderId, Promise<ProviderUsageSnapshot | null>>();
  private modelGroupOpenState = new Map<string, boolean>();
  private searchQuery = '';
  private callbacks: ToolbarCallbacks;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-model-selector' });
    this.render();
    this.refreshModelOptionsInBackground();
  }

  destroy(): void {
    this.removeOutsideListeners();
  }

  private removeOutsideListeners(): void {
    if (this.outsideClickHandler) {
      this.container.ownerDocument.removeEventListener('click', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
    if (this.escapeHandler) {
      this.container.ownerDocument.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
  }

  private getAvailableModels() {
    const settings = this.callbacks.getSettings();
    return this.callbacks.getChatUI().models.options({
      ...settings,
      environmentVariables: this.callbacks.getEnvironmentVariables?.(),
    });
  }

  private getCurrentModel(): string {
    return this.pendingModel ?? this.callbacks.getSettings().model;
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'grimoire-model-btn' });
    this.buttonEl.setAttribute('role', 'button');
    this.buttonEl.setAttribute('aria-haspopup', 'listbox');
    this.buttonEl.setAttribute('aria-expanded', 'false');
    this.buttonEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(!this.container.classList.contains('open'));
    });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'grimoire-model-dropdown' });
    this.dropdownEl.setAttribute('role', 'listbox');
    this.renderOptions();
  }

  private setOpen(open: boolean): void {
    this.container.classList.toggle('open', open);
    this.buttonEl?.setAttribute('aria-expanded', String(open));
    if (open) {
      this.removeOutsideListeners();
      this.outsideClickHandler = (e: MouseEvent) => {
        if (!this.container.contains(e.target as Node)) {
          this.setOpen(false);
        }
      };
      this.escapeHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          this.setOpen(false);
        }
      };
      this.container.ownerDocument.addEventListener('click', this.outsideClickHandler);
      this.container.ownerDocument.addEventListener('keydown', this.escapeHandler);
      this.searchInputEl?.focus();
      this.refreshProviderUsageInBackground();
      this.refreshModelOptionsInBackground();
    } else {
      this.removeOutsideListeners();
    }
  }

  private refreshModelOptionsInBackground(): void {
    if (!this.callbacks.refreshModelOptions || this.modelCatalogRefreshPromise) {
      return;
    }

    this.isRefreshingModelCatalog = true;
    this.modelCatalogRefreshFailed = false;
    this.renderOptions();
    if (this.container.hasClass('open')) {
      this.searchInputEl?.focus();
    }

    const refreshPromise = this.callbacks.refreshModelOptions();
    this.modelCatalogRefreshPromise = refreshPromise;
    void refreshPromise
      .catch(() => {
        this.modelCatalogRefreshFailed = true;
      })
      .finally(() => {
        if (this.modelCatalogRefreshPromise !== refreshPromise) {
          return;
        }
        this.modelCatalogRefreshPromise = null;
        this.isRefreshingModelCatalog = false;
        this.updateDisplay();
        this.renderOptions();
        if (this.container.hasClass('open')) {
          this.searchInputEl?.focus();
        }
      });
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const currentModel = this.getCurrentModel();
    const models = this.getAvailableModels();
    const modelInfo = models.find(m => m.value === currentModel);

    this.buttonEl.empty();

    const providerId = modelInfo
      ? this.resolveProviderIdForModel(modelInfo)
      : this.callbacks.resolveProviderForModel?.(currentModel) ?? this.callbacks.getProviderId?.() ?? null;
    const icon = modelInfo?.providerIcon ?? this.callbacks.getChatUI().icon();
    if (icon) {
      this.buttonEl.appendChild(createProviderIconSvg(icon, {
        className: 'grimoire-model-button-provider-icon',
        ...(providerId ? { dataProvider: providerId } : {}),
        height: 13,
        ownerDocument: this.buttonEl.ownerDocument,
        width: 13,
      }));
    }

    const labelEl = this.buttonEl.createSpan({ cls: 'grimoire-model-label' });
    const fullLabel = modelInfo?.label.trim() || formatModelFallbackLabel(currentModel);
    const buttonLabel = modelInfo?.buttonLabel?.trim() || modelInfo?.label;
    labelEl.setText(buttonLabel ? formatModelButtonLabel(buttonLabel) : fullLabel);
    const chevronEl = this.buttonEl.createSpan({ cls: 'grimoire-model-chevron' });
    setIcon(chevronEl, 'chevron-up');
    this.buttonEl.removeAttribute('title');
    this.buttonEl.setAttribute('aria-label', `${t('chat.ui.model.selectTooltip')}: ${fullLabel}`);
    setTooltip(this.buttonEl, fullLabel, { placement: 'top' });
  }

  renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const currentModel = this.getCurrentModel();

    if (this.pendingModel) {
      this.dropdownEl.addClass('grimoire-model-dropdown--loading');
      const loadingEl = this.dropdownEl.createDiv({ cls: 'grimoire-model-loading' });
      loadingEl.setText(t('chat.ui.model.switching'));
      return;
    }

    this.dropdownEl.removeClass('grimoire-model-dropdown--loading');
    const models = this.getAvailableModels();
    this.renderSearchInput();
    this.renderCatalogRefreshStatus();
    this.renderCatalogRefreshError();

    if (models.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: 'grimoire-model-empty' });
      emptyEl.setText(t('chat.ui.model.noneAvailable'));
      return;
    }

    const filteredModels = this.filterModels(models);
    if (filteredModels.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: 'grimoire-model-empty' });
      emptyEl.setText(t('chat.ui.model.noMatch', { query: this.searchQuery }));
      return;
    }

    const hasGroups = filteredModels.some(model => Boolean(model.group));

    if (!hasGroups) {
      for (const [index, model] of filteredModels.entries()) {
        this.renderOption(this.dropdownEl, model, index, currentModel);
      }
      return;
    }

    const groups: Array<{ name: string; models: ProviderModelOption[] }> = [];
    const groupsByName = new Map<string, ProviderModelOption[]>();
    for (const model of filteredModels) {
      const group = model.group || t('chat.ui.model.models');
      let groupModels = groupsByName.get(group);
      if (!groupModels) {
        groupModels = [];
        groupsByName.set(group, groupModels);
        groups.push({ name: group, models: groupModels });
      }
      groupModels.push(model);
    }
    groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    let optionIndex = 0;
    for (const group of groups) {
      const normalizedGroupName = group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const groupKey = normalizedGroupName || group.name;
      const isOpen = this.modelGroupOpenState.get(groupKey) ?? true;
      const groupEl = this.dropdownEl.createDiv({
        cls: `grimoire-model-group-section${isOpen ? ' is-open' : ''}`,
      });
      if (normalizedGroupName) {
        groupEl.addClass(`grimoire-model-group-section--${normalizedGroupName}`);
      }
      const headerEl = groupEl.createEl('button', {
        cls: 'grimoire-model-group',
        attr: {
          type: 'button',
          'aria-expanded': String(isOpen),
        },
      });

      const providerId = this.resolveGroupProviderId(group.models);
      const firstIcon = group.models[0]?.providerIcon ?? this.callbacks.getChatUI().icon();
      if (firstIcon) {
        headerEl.appendChild(createProviderIconSvg(firstIcon, {
          className: 'grimoire-model-group-provider-icon',
          ...(providerId ? { dataProvider: providerId } : {}),
          height: 7,
          ownerDocument: headerEl.ownerDocument,
          width: 7,
        }));
      } else {
        const providerIconEl = headerEl.createSpan({ cls: 'grimoire-model-group-provider-icon' });
        if (providerId) {
          providerIconEl.dataset.provider = providerId;
        }
      }
      headerEl.createSpan({ cls: 'grimoire-model-group-label', text: group.name });
      headerEl.createSpan({ cls: 'grimoire-model-group-count', text: String(group.models.length) });
      headerEl.createSpan({ cls: 'grimoire-model-group-chevron' });

      const groupBodyEl = groupEl.createDiv({ cls: 'grimoire-model-group-options' });
      if (providerId) {
        this.renderPlanUsageReadout(groupBodyEl, this.callbacks.getProviderUsage?.(providerId) ?? null);
      }
      headerEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !groupEl.hasClass('is-open');
        groupEl.toggleClass('is-open', open);
        this.modelGroupOpenState.set(groupKey, open);
        headerEl.setAttribute('aria-expanded', String(open));
      });

      for (const model of group.models) {
        this.renderOption(groupBodyEl, model, optionIndex, currentModel);
        optionIndex += 1;
      }
    }
  }

  refreshProviderUsageInBackground(): void {
    if (!this.callbacks.refreshProviderUsage) {
      return;
    }

    const providerIds = new Set<ProviderId>();
    for (const model of this.getAvailableModels()) {
      const providerId = this.resolveProviderIdForModel(model);
      if (providerId) {
        providerIds.add(providerId);
      }
    }

    for (const providerId of providerIds) {
      this.refreshProviderUsageForProvider(providerId);
    }
  }

  private refreshProviderUsageForProvider(providerId: ProviderId): void {
    if (!this.callbacks.refreshProviderUsage || this.providerUsageRefreshPromises.has(providerId)) {
      return;
    }

    const refreshPromise = this.callbacks.refreshProviderUsage(providerId);
    this.providerUsageRefreshPromises.set(providerId, refreshPromise);
    void refreshPromise
      .catch(() => null)
      .finally(() => {
        if (this.providerUsageRefreshPromises.get(providerId) !== refreshPromise) {
          return;
        }
        this.providerUsageRefreshPromises.delete(providerId);
        this.callbacks.onProviderUsageRefresh?.(providerId);
        if (this.container.hasClass('open')) {
          this.renderOptions();
          this.searchInputEl?.focus();
        }
      });
  }

  private resolveGroupProviderId(models: readonly ProviderModelOption[]): ProviderId | null {
    const providerIds = new Set<ProviderId>();
    for (const model of models) {
      const providerId = this.resolveProviderIdForModel(model);
      if (providerId) {
        providerIds.add(providerId);
      }
    }
    return providerIds.size === 1 ? [...providerIds][0] : null;
  }

  private resolveProviderIdForModel(model: ProviderModelOption): ProviderId | null {
    if (model.providerId) {
      return model.providerId;
    }
    return this.callbacks.resolveProviderForModel?.(model.value) ?? null;
  }

  private renderPlanUsageReadout(parentEl: HTMLElement, usage: ProviderUsageSnapshot | null): void {
    if (!usage || !areUsageIndicatorsEnabled(this.callbacks.getSettings())) {
      return;
    }

    if (isQuotaUsage(usage) && usage.windows.some(window => isUsagePctKnown(normalizeUsageWindow(window)))) {
      this.renderQuotaPlanUsageReadout(parentEl, usage);
    }
    if (isSpendUsage(usage)) {
      this.renderSpendPlanUsageReadout(parentEl, usage);
    }
  }

  private renderSpendPlanUsageReadout(parentEl: HTMLElement, usage: ProviderUsageSnapshot & { spend: string }): void {
    const readoutEl = parentEl.createDiv({
      cls: 'grimoire-plan-usage-readout grimoire-plan-usage-readout--spend',
    });
    const headerEl = readoutEl.createDiv({ cls: 'grimoire-plan-usage-readout-header' });
    headerEl.createSpan({ cls: 'grimoire-plan-usage-readout-plan', text: usage.plan });
    headerEl.createSpan({ cls: 'grimoire-plan-usage-readout-spend', text: usage.spend });
    if (usage.note) {
      readoutEl.createDiv({ cls: 'grimoire-plan-usage-readout-note', text: usage.note });
    }
  }

  private renderQuotaPlanUsageReadout(parentEl: HTMLElement, usage: ProviderUsageSnapshot & { windows: ProviderUsageWindow[] }): void {
    if (usage.windows.length === 0) {
      return;
    }

    const windows = usage.windows
      .map(normalizeUsageWindow)
      .filter(isUsagePctKnown);
    if (windows.length === 0) {
      return;
    }
    const hasWarning = windows.some(isUsageWindowHot);
    const readoutEl = parentEl.createDiv({
      cls: `grimoire-plan-usage-readout${hasWarning ? ' is-warning' : ''}`,
    });
    const headerEl = readoutEl.createDiv({ cls: 'grimoire-plan-usage-readout-header' });
    headerEl.createSpan({ cls: 'grimoire-plan-usage-readout-plan', text: usage.plan });
    headerEl.createSpan({
      cls: 'grimoire-plan-usage-readout-caption',
      text: t('chat.ui.usage.planUsage'),
    });

    for (const window of windows) {
      const rowEl = readoutEl.createDiv({ cls: 'grimoire-plan-usage-readout-row' });
      rowEl.createSpan({
        cls: 'grimoire-plan-usage-readout-label',
        text: window.label.toUpperCase(),
      });
      const trackEl = rowEl.createSpan({ cls: 'grimoire-plan-usage-readout-track' });
      const fillEl = trackEl.createSpan({ cls: 'grimoire-plan-usage-readout-fill' });
      fillEl.style.width = `${window.pct}%`;
      const valueEl = rowEl.createSpan({
        cls: 'grimoire-plan-usage-readout-value',
        text: formatUsagePct(window),
      });
      rowEl.createSpan({ cls: 'grimoire-plan-usage-readout-reset', text: window.reset });
      const isHot = isUsageWindowHot(window);
      fillEl.toggleClass('is-hot', isHot);
      valueEl.toggleClass('is-hot', isHot);
    }
  }

  private renderSearchInput(): void {
    if (!this.dropdownEl) return;

    const searchEl = this.dropdownEl.createDiv({ cls: 'grimoire-model-search' });
    const iconEl = searchEl.createSpan({ cls: 'grimoire-model-search-icon' });
    setIcon(iconEl, 'search');
    this.searchInputEl = searchEl.createEl('input', {
      cls: 'grimoire-model-search-input',
      attr: {
        'aria-label': t('chat.ui.model.searchAriaLabel'),
        placeholder: t('chat.ui.model.searchPlaceholder'),
        type: 'search',
      },
    });
    this.searchInputEl.value = this.searchQuery;
    this.searchInputEl.addEventListener('input', () => {
      this.searchQuery = this.searchInputEl?.value ?? '';
      this.renderOptions();
      this.searchInputEl?.focus();
    });
  }

  private renderCatalogRefreshStatus(): void {
    if (!this.dropdownEl || !this.isRefreshingModelCatalog) {
      return;
    }

    const loadingEl = this.dropdownEl.createDiv({
      cls: 'grimoire-model-catalog-loading grimoire-model-loading',
    });
    loadingEl.setText(t('chat.ui.model.loading'));
  }

  private renderCatalogRefreshError(): void {
    if (!this.dropdownEl || !this.modelCatalogRefreshFailed) {
      return;
    }

    const errorEl = this.dropdownEl.createDiv({
      cls: 'grimoire-model-catalog-error grimoire-model-loading',
    });
    errorEl.setText(t('chat.ui.model.loadFailed'));
  }

  private filterModels(models: readonly ProviderModelOption[]): readonly ProviderModelOption[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
      return models;
    }
    const terms = query.split(/\s+/).filter(Boolean);

    return models.filter((model) => {
      const haystack = [
        model.label,
        model.description,
        model.group,
        model.value,
      ].filter(Boolean).join(' ').toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }

  private renderOption(
    parentEl: HTMLElement,
    model: ProviderModelOption,
    index: number,
    currentModel: string,
  ): void {
    const option = parentEl.createDiv({ cls: 'grimoire-model-option' });
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(model.value === currentModel));
    option.setAttribute('aria-posinset', String(index + 1));
    if (model.value === currentModel) {
      option.addClass('selected');
    }

    const icon = model.providerIcon ?? this.callbacks.getChatUI().icon();
    if (icon) {
      option.appendChild(createProviderIconSvg(icon, {
        className: 'grimoire-model-provider-icon',
        height: 12,
        ownerDocument: option.ownerDocument,
        width: 12,
      }));
    }

    const displayLabel = splitModelOptionLabel(model.label);
    const copyEl = option.createSpan({ cls: 'grimoire-model-option-copy' });
    copyEl.createSpan({ cls: 'grimoire-model-option-label', text: displayLabel.label });
    if (displayLabel.detail) {
      copyEl.createSpan({ cls: 'grimoire-model-option-detail', text: displayLabel.detail });
    }
    if (model.description) {
      option.setAttribute('title', `${model.label}\n${model.description}`);
    } else {
      option.setAttribute('title', model.label);
    }

    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const previousPendingModel = this.pendingModel;
      this.pendingModel = model.value;
      this.updateDisplay();
      this.setOpen(false);
      void (async () => {
        try {
          await this.callbacks.onModelChange(model.value);
          this.pendingModel = null;
        } catch {
          this.pendingModel = previousPendingModel;
          new Notice(t('chat.ui.model.changeFailed'));
        }
        this.updateDisplay();
        this.renderOptions();
      })();
    });
  }
}

export class PlanUsageBadge {
  private container: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private meterEl: HTMLElement | null = null;
  private fillEl: HTMLElement | null = null;
  private valueEl: HTMLElement | null = null;
  private refreshPromise: Promise<ProviderUsageSnapshot | null> | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-plan-usage-badge grimoire-hidden' });
    this.container.setAttribute('role', 'button');
    this.container.setAttribute('tabindex', '0');
    this.render();
    this.updateDisplay();
  }

  private render(): void {
    this.container.empty();
    this.labelEl = this.container.createSpan({ cls: 'grimoire-plan-usage-badge-label' });
    this.meterEl = this.container.createSpan({ cls: 'grimoire-plan-usage-badge-meter' });
    this.fillEl = this.meterEl.createSpan({ cls: 'grimoire-plan-usage-badge-fill' });
    this.valueEl = this.container.createSpan({ cls: 'grimoire-plan-usage-badge-value' });
  }

  refreshInBackground(): void {
    const providerId = this.callbacks.getProviderId?.();
    if (!providerId || !this.callbacks.refreshProviderUsage || this.refreshPromise) {
      return;
    }

    const refreshPromise = this.callbacks.refreshProviderUsage(providerId);
    this.refreshPromise = refreshPromise;
    void refreshPromise
      .catch(() => null)
      .finally(() => {
        if (this.refreshPromise !== refreshPromise) {
          return;
        }
        this.refreshPromise = null;
        this.updateDisplay();
      });
  }

  updateDisplay(): void {
    const providerId = this.callbacks.getProviderId?.();
    const usage = providerId ? this.callbacks.getProviderUsage?.(providerId) ?? null : null;

    this.container.removeClass('is-hot');
    this.container.removeClass('grimoire-plan-usage-badge--spend');
    this.meterEl?.removeClass('grimoire-hidden');

    if (!usage || !areUsageIndicatorsEnabled(this.callbacks.getSettings())) {
      this.container.addClass('grimoire-hidden');
      return;
    }

    const primaryWindow = findPrimaryQuotaWindow(usage);
    if (primaryWindow) {
      this.renderQuotaUsage(usage, primaryWindow);
      return;
    }

    if (isSpendUsage(usage)) {
      this.renderSpendUsage(usage);
      return;
    }

    this.container.addClass('grimoire-hidden');
  }

  private renderQuotaUsage(usage: ProviderUsageSnapshot, window: ProviderUsageWindow): void {
    this.container.removeClass('grimoire-hidden');
    this.container.toggleClass('is-hot', isUsageWindowHot(window));
    this.labelEl?.setText(formatQuotaBadgeLabel(window.label));
    if (this.fillEl) {
      this.fillEl.style.width = `${window.pct}%`;
    }
    this.valueEl?.setText(formatUsagePct(window));

    this.container.setAttribute('aria-label', formatQuotaAriaLabel(usage.plan, window));
  }

  private renderSpendUsage(usage: ProviderUsageSnapshot & { spend: string }): void {
    this.container.removeClass('grimoire-hidden');
    this.container.addClass('grimoire-plan-usage-badge--spend');
    this.labelEl?.setText('API');
    if (this.fillEl) {
      this.fillEl.setCssProps({ width: '0%' });
    }
    this.meterEl?.addClass('grimoire-hidden');
    this.valueEl?.setText(stripThisMonth(usage.spend));
    this.container.setAttribute('aria-label', `${usage.plan}: ${usage.spend}`);
  }
}

export class ModeSelector {
  private container: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private toggleEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-mode-selector' });
    this.render();
  }

  private getSelectorConfig(): ProviderModeSelector | null {
    return this.callbacks.getChatUI().modeSelector?.selector(this.callbacks.getSettings()) ?? null;
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'grimoire-mode-label' });
    this.toggleEl = this.container.createDiv({ cls: 'grimoire-toggle-switch' });

    this.labelEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), t('chat.ui.toolbar.modeChangeFailed'));
    });
    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), t('chat.ui.toolbar.modeChangeFailed'));
    });

    this.updateDisplay();
  }

  /** Resolves the active/inactive option pair for a two-option toggle. */
  private resolveOptionPair(
    selectorConfig: ProviderModeSelector,
  ): { active: ProviderModelOption; inactive: ProviderModelOption } {
    const [first, second] = selectorConfig.options;
    const active = selectorConfig.activeValue
      ? selectorConfig.options.find((option) => option.value === selectorConfig.activeValue) ?? second
      : second;
    const inactive = active.value === first.value ? second : first;
    return { active, inactive };
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) {
      return;
    }

    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      this.container.addClass('grimoire-hidden');
      return;
    }

    this.container.removeClass('grimoire-hidden');
    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const currentOption = selectorConfig.options.find((option) => option.value === selectorConfig.value)
      ?? selectorConfig.options[0];
    const isActive = currentOption.value === active.value;

    this.labelEl.setText(currentOption.label || selectorConfig.label);
    this.labelEl.toggleClass('active', isActive);
    if (isActive) {
      this.toggleEl.addClass('active');
    } else {
      this.toggleEl.removeClass('active');
    }

    const titleParts = [`${inactive.label} <-> ${active.label}`];
    if (currentOption.description) {
      titleParts.push(currentOption.description);
    }
    this.container.setAttribute('title', titleParts.join('\n'));
  }

  renderOptions() {
    this.updateDisplay();
  }

  private async toggle() {
    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      return;
    }

    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const nextValue = selectorConfig.value === active.value ? inactive.value : active.value;
    await this.callbacks.onModeChange(nextValue);
    this.updateDisplay();
  }
}

export class ThinkingBudgetSelector {
  private container: HTMLElement;
  private effortEl: HTMLElement | null = null;
  private effortGearsEl: HTMLElement | null = null;
  private budgetEl: HTMLElement | null = null;
  private budgetGearsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private outsideClickHandler: ((event: MouseEvent) => void) | null = null;
  private escapeHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-thinking-selector' });
    this.render();
  }

  destroy(): void {
    this.closeMenus();
  }

  private render() {
    this.container.empty();

    // Effort selector (for adaptive thinking models)
    this.effortEl = this.container.createDiv({ cls: 'grimoire-thinking-effort' });
    const effortLabel = this.effortEl.createSpan({ cls: 'grimoire-thinking-label-text' });
    effortLabel.setText(t('chat.ui.toolbar.effort'));
    this.effortGearsEl = this.effortEl.createDiv({ cls: 'grimoire-thinking-gears' });

    // Legacy budget selector (for custom models)
    this.budgetEl = this.container.createDiv({ cls: 'grimoire-thinking-budget' });
    const budgetLabel = this.budgetEl.createSpan({ cls: 'grimoire-thinking-label-text' });
    budgetLabel.setText(t('chat.ui.toolbar.thinking'));
    this.budgetGearsEl = this.budgetEl.createDiv({ cls: 'grimoire-thinking-gears' });

    this.updateDisplay();
  }

  private renderEffortGears() {
    if (!this.effortGearsEl) return;
    this.effortGearsEl.empty();

    const currentEffort = this.callbacks.getSettings().effortLevel;
    const reasoning = this.callbacks.getChatUI().reasoning;
    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const options = reasoning?.options(model, settings) ?? [];
    const currentInfo = options.find(e => e.value === currentEffort);

    const currentEl = this.effortGearsEl.createDiv({ cls: 'grimoire-thinking-current' });
    const currentLabel = currentInfo?.label || options[0]?.label || t('chat.ui.toolbar.high');
    currentEl.setText(localizeReasoningLevel(currentEffort, currentLabel));
    this.bindThinkingCurrent(
      this.effortGearsEl,
      currentEl,
      t('chat.ui.toolbar.effort').replace(/[：:]\s*$/, ''),
    );

    const optionsEl = this.effortGearsEl.createDiv({ cls: 'grimoire-thinking-options' });
    optionsEl.setAttribute('role', 'listbox');

    for (const effort of [...options].reverse()) {
      const gearEl = optionsEl.createDiv({ cls: 'grimoire-thinking-gear' });
      gearEl.setText(localizeReasoningLevel(effort.value, effort.label));
      gearEl.setAttribute('role', 'option');
      gearEl.setAttribute('tabindex', '0');
      gearEl.setAttribute('aria-selected', String(effort.value === currentEffort));

      if (effort.value === currentEffort) {
        gearEl.addClass('selected');
      }

      const selectEffort = (): void => {
        runToolbarAction(async () => {
          this.closeMenus();
          await this.callbacks.onEffortLevelChange(effort.value);
          this.updateDisplay();
        }, t('chat.ui.toolbar.effortChangeFailed'));
      };
      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectEffort();
      });
      gearEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        selectEffort();
      });
    }
  }

  private renderBudgetGears() {
    if (!this.budgetGearsEl) return;
    this.budgetGearsEl.empty();

    const currentBudget = this.callbacks.getSettings().thinkingBudget;
    const reasoning = this.callbacks.getChatUI().reasoning;
    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const options: readonly ProviderReasoningTier[] = reasoning?.options(model, settings) ?? [];
    const currentBudgetInfo = options.find(b => b.value === currentBudget);

    const currentEl = this.budgetGearsEl.createDiv({ cls: 'grimoire-thinking-current' });
    const currentLabel = currentBudgetInfo?.label || options[0]?.label || t('chat.ui.toolbar.off');
    currentEl.setText(localizeReasoningLevel(currentBudget, currentLabel));
    this.bindThinkingCurrent(
      this.budgetGearsEl,
      currentEl,
      t('chat.ui.toolbar.thinking').replace(/[：:]\s*$/, ''),
    );

    const optionsEl = this.budgetGearsEl.createDiv({ cls: 'grimoire-thinking-options' });
    optionsEl.setAttribute('role', 'listbox');

    for (const budget of [...options].reverse()) {
      const gearEl = optionsEl.createDiv({ cls: 'grimoire-thinking-gear' });
      gearEl.setText(localizeReasoningLevel(budget.value, budget.label));
      gearEl.setAttribute('role', 'option');
      gearEl.setAttribute('tabindex', '0');
      gearEl.setAttribute('aria-selected', String(budget.value === currentBudget));
      const tokens = budget.tokens ?? 0;
      gearEl.setAttribute('title', tokens > 0
        ? t('chat.ui.toolbar.tokens', { count: tokens.toLocaleString() })
        : t('common.disabled'));

      if (budget.value === currentBudget) {
        gearEl.addClass('selected');
      }

      const selectBudget = (): void => {
        runToolbarAction(async () => {
          this.closeMenus();
          await this.callbacks.onThinkingBudgetChange(budget.value);
          this.updateDisplay();
        }, t('chat.ui.toolbar.thinkingChangeFailed'));
      };
      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectBudget();
      });
      gearEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        selectBudget();
      });
    }
  }

  private bindThinkingCurrent(
    gearsEl: HTMLElement,
    currentEl: HTMLElement,
    tooltip: string,
  ): void {
    currentEl.setAttribute('role', 'button');
    currentEl.setAttribute('tabindex', '0');
    currentEl.setAttribute('aria-haspopup', 'listbox');
    currentEl.setAttribute('aria-expanded', String(gearsEl.hasClass('open')));
    currentEl.setAttribute('aria-label', tooltip);
    setTooltip(currentEl, tooltip, { placement: 'top' });
    currentEl.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = !gearsEl.hasClass('open');
      this.setOpen(gearsEl, currentEl, open);
    });
    currentEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const open = !gearsEl.hasClass('open');
      this.setOpen(gearsEl, currentEl, open);
    });
  }

  private setOpen(gearsEl: HTMLElement, currentEl: HTMLElement, open: boolean): void {
    this.closeMenus();
    if (!open) {
      return;
    }

    gearsEl.addClass('open');
    currentEl.setAttribute('aria-expanded', 'true');
    this.outsideClickHandler = (event: MouseEvent) => {
      if (!this.container.contains(event.target as Node)) {
        this.closeMenus();
      }
    };
    this.escapeHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.closeMenus();
        currentEl.focus();
      }
    };
    this.container.ownerDocument.addEventListener('click', this.outsideClickHandler, true);
    this.container.ownerDocument.addEventListener('keydown', this.escapeHandler);
  }

  private closeMenus(): void {
    for (const gearsEl of [this.effortGearsEl, this.budgetGearsEl]) {
      gearsEl?.removeClass('open');
      gearsEl?.querySelector('.grimoire-thinking-current')?.setAttribute('aria-expanded', 'false');
    }
    if (this.outsideClickHandler) {
      this.container.ownerDocument.removeEventListener('click', this.outsideClickHandler, true);
      this.outsideClickHandler = null;
    }
    if (this.escapeHandler) {
      this.container.ownerDocument.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
  }

  updateDisplay() {
    this.closeMenus();
    const capabilities = this.callbacks.getCapabilities();
    if (capabilities.reasoningControl === 'none') {
      this.effortEl?.addClass('grimoire-hidden');
      this.budgetEl?.addClass('grimoire-hidden');
      return;
    }

    const settings = this.callbacks.getSettings();
    const model = settings.model;
    // A provider with no reasoning group has no control to draw. The
    // capability check above says the same thing for the two providers that
    // declare `reasoningControl: 'none'`; this says it from the contribution
    // itself, so the group's absence is what hides the row rather than a
    // second declaration agreeing with it.
    const reasoning = this.callbacks.getChatUI().reasoning;
    const options = reasoning?.options(model, settings) ?? [];
    const defaultValue = reasoning?.defaultValue(model, settings) ?? '';
    const shouldHide = options.length === 0
      || (options.length === 1 && options[0]?.value === defaultValue);

    if (shouldHide) {
      this.effortEl?.addClass('grimoire-hidden');
      this.budgetEl?.addClass('grimoire-hidden');
      return;
    }

    const adaptive = reasoning?.isTiered(model, settings) ?? false;

    if (this.effortEl) {
      this.effortEl.toggleClass('grimoire-hidden', !adaptive);
    }
    if (this.budgetEl) {
      this.budgetEl.toggleClass('grimoire-hidden', adaptive);
    }

    if (adaptive) {
      this.renderEffortGears();
    } else {
      this.renderBudgetGears();
    }
  }
}

export class PermissionToggle {
  private container: HTMLElement;
  private gearsEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private optionsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private visible = true;
  private outsideClickHandler: ((event: MouseEvent) => void) | null = null;
  private escapeHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-permission-toggle' });
    this.render();
  }

  destroy(): void {
    this.closeMenu();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  private render() {
    this.container.empty();

    this.gearsEl = this.container.createDiv({ cls: 'grimoire-permission-gears' });
    this.labelEl = this.gearsEl.createSpan({ cls: 'grimoire-permission-label' });
    this.labelEl.setAttribute('role', 'button');
    this.labelEl.setAttribute('tabindex', '0');
    this.labelEl.setAttribute('aria-haspopup', 'listbox');
    this.labelEl.addEventListener('click', (event) => {
      event?.stopPropagation();
      const open = !this.gearsEl?.hasClass('open');
      this.setOpen(open);
    });
    this.labelEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const open = !this.gearsEl?.hasClass('open');
      this.setOpen(open);
    });
    this.optionsEl = this.gearsEl.createDiv({ cls: 'grimoire-permission-options' });
    this.optionsEl.setAttribute('role', 'listbox');

    this.updateDisplay();
  }

  private getToggleConfig(): ProviderPermissionModeToggle | null {
    return this.callbacks.getChatUI().permissionMode?.toggle() ?? null;
  }

  updateDisplay() {
    if (!this.gearsEl || !this.labelEl || !this.optionsEl) return;

    this.closeMenu();

    const toggleConfig = this.getToggleConfig();
    const capabilities = this.callbacks.getCapabilities();
    if (!this.visible || !toggleConfig) {
      this.container.addClass('grimoire-hidden');
      return;
    }

    this.container.removeClass('grimoire-hidden');
    const mode = this.callbacks.getSettings().permissionMode;
    const planValue = toggleConfig.planValue;
    const canShowPlan = Boolean(planValue) && capabilities.supportsPlanMode;
    const options = [
      { label: t('chat.ui.toolbar.permissionSafe'), value: toggleConfig.inactiveValue },
      { label: t('chat.ui.toolbar.permissionAuto'), value: toggleConfig.activeValue },
      ...(canShowPlan && planValue
        ? [{ label: t('chat.ui.toolbar.permissionPlan'), value: planValue }]
        : []),
    ];
    const currentOption = options.find(option => option.value === mode) ?? options[0];

    this.labelEl.setText(currentOption.label);
    this.labelEl.toggleClass('active', mode === toggleConfig.activeValue);
    this.labelEl.toggleClass('plan-active', Boolean(planValue) && mode === planValue);
    this.labelEl.setAttribute('aria-expanded', String(this.gearsEl.hasClass('open')));
    this.labelEl.removeAttribute('title');
    setTooltip(this.labelEl, t('chat.ui.toolbar.modeTooltip'), { placement: 'top' });

    this.optionsEl.empty();
    for (const option of [...options].reverse()) {
      const optionEl = this.optionsEl.createDiv({
        cls: 'grimoire-permission-option',
        text: option.label,
      });
      optionEl.setAttribute('role', 'option');
      optionEl.setAttribute('tabindex', '0');
      optionEl.setAttribute('aria-selected', String(option.value === mode));
      optionEl.toggleClass('selected', option.value === mode);
      const selectOption = (): void => {
        runToolbarAction(async () => {
          this.closeMenu();
          await this.callbacks.onPermissionModeChange(option.value);
          this.updateDisplay();
        }, t('chat.ui.toolbar.permissionChangeFailed'));
      };
      optionEl.addEventListener('click', (event) => {
        event?.stopPropagation();
        selectOption();
      });
      optionEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        selectOption();
      });
    }
  }

  private setOpen(open: boolean): void {
    this.closeMenu();
    if (!open || !this.gearsEl || !this.labelEl) {
      return;
    }

    this.gearsEl.addClass('open');
    this.labelEl.setAttribute('aria-expanded', 'true');
    this.outsideClickHandler = (event: MouseEvent) => {
      if (!this.container.contains(event.target as Node)) {
        this.closeMenu();
      }
    };
    this.escapeHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.closeMenu();
        this.labelEl?.focus();
      }
    };
    this.container.ownerDocument.addEventListener('click', this.outsideClickHandler, true);
    this.container.ownerDocument.addEventListener('keydown', this.escapeHandler);
  }

  private closeMenu(): void {
    this.gearsEl?.removeClass('open');
    this.labelEl?.setAttribute('aria-expanded', 'false');
    if (this.outsideClickHandler) {
      this.container.ownerDocument.removeEventListener('click', this.outsideClickHandler, true);
      this.outsideClickHandler = null;
    }
    if (this.escapeHandler) {
      this.container.ownerDocument.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
  }
}

export function getNextPermissionMode(
  current: string,
  toggleConfig: ProviderPermissionModeToggle,
  supportsPlanMode: boolean,
): string {
  const planValue = toggleConfig.planValue;
  if (supportsPlanMode && planValue) {
    if (current === toggleConfig.inactiveValue) return toggleConfig.activeValue;
    if (current === toggleConfig.activeValue) return planValue;
    return toggleConfig.inactiveValue;
  }

  return current === toggleConfig.activeValue
    ? toggleConfig.inactiveValue
    : toggleConfig.activeValue;
}

export class ServiceTierToggle {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-service-tier-toggle' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'grimoire-service-tier-button' });
    this.iconEl = this.buttonEl.createSpan({ cls: 'grimoire-service-tier-icon' });
    setIcon(this.iconEl, 'zap');

    this.updateDisplay();

    this.buttonEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), t('chat.ui.toolbar.serviceTierChangeFailed'));
    });
  }

  private getToggleConfig(): ProviderServiceTierToggle | null {
    return this.callbacks.getChatUI().serviceTier?.toggle(this.callbacks.getSettings()) ?? null;
  }

  updateDisplay() {
    if (!this.buttonEl || !this.iconEl) return;

    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) {
      this.container.addClass('grimoire-hidden');
      return;
    }

    this.container.removeClass('grimoire-hidden');
    const current = this.callbacks.getSettings().serviceTier;
    const isActive = current === toggleConfig.activeValue;
    if (isActive) {
      this.buttonEl.addClass('active');
    } else {
      this.buttonEl.removeClass('active');
    }

    this.container.setAttribute('title', t('chat.ui.toolbar.toggleFastMode'));
  }

  private async toggle() {
    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) return;

    const current = this.callbacks.getSettings().serviceTier;
    const next = current === toggleConfig.activeValue
      ? toggleConfig.inactiveValue
      : toggleConfig.activeValue;
    await this.callbacks.onServiceTierChange(next);
    this.updateDisplay();
  }
}

export type AddExternalContextResult =
  | { success: true; normalizedPath: string }
  | { success: false; error: string };

export class ExternalContextSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  /**
   * Current external context paths. May contain:
   * - Persistent paths only (new sessions via clearExternalContexts)
   * - Restored session paths (loaded sessions via setExternalContexts)
   * - Mixed paths during active sessions
   */
  private externalContextPaths: string[] = [];
  /** Paths that persist across all sessions (stored in settings). */
  private persistentPaths: Set<string> = new Set();
  private onChangeCallback: ((paths: string[]) => void) | null = null;
  private onPersistenceChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-external-context-selector' });
    this.render();
  }

  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  setOnPersistenceChange(callback: (paths: string[]) => void): void {
    this.onPersistenceChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  getPersistentPaths(): string[] {
    return [...this.persistentPaths];
  }

  setPersistentPaths(paths: string[]): void {
    // Validate paths - remove non-existent directories
    const validPaths = filterValidPaths(paths);
    const invalidPaths = paths.filter(p => !validPaths.includes(p));

    this.persistentPaths = new Set(validPaths);
    // Merge persistent paths into external context paths
    this.mergePersistentPaths();
    this.updateDisplay();
    this.renderDropdown();

    // If invalid paths were removed, notify user and save updated list
    if (invalidPaths.length > 0) {
      const pathNames = invalidPaths.map(p => this.shortenPath(p)).join(', ');
      new Notice(t('chat.ui.externalContext.removedInvalid', {
        count: invalidPaths.length,
        paths: pathNames,
      }), 5000);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
  }

  togglePersistence(path: string): void {
    if (this.persistentPaths.has(path)) {
      this.persistentPaths.delete(path);
    } else {
      // Validate path still exists before persisting
      if (!isValidContextPath(path)) {
        new Notice(t('chat.ui.externalContext.cannotPersistMissing', {
          path: this.shortenPath(path),
        }), 4000);
        return;
      }
      this.persistentPaths.add(path);
    }
    this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    this.renderDropdown();
  }

  private mergePersistentPaths(): void {
    const pathSet = new Set(this.externalContextPaths);
    for (const path of this.persistentPaths) {
      pathSet.add(path);
    }
    this.externalContextPaths = [...pathSet];
  }

  /**
   * Restore exact external context paths from a saved conversation.
   * Does NOT merge with persistent paths - preserves the session's historical state.
   * Use clearExternalContexts() for new sessions to start with current persistent paths.
   */
  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Remove a path from external contexts (and persistent paths if applicable).
   * Exposed for testing the remove button behavior.
   */
  removePath(pathStr: string): void {
    this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
    // Also remove from persistent paths if it was persistent
    if (this.persistentPaths.has(pathStr)) {
      this.persistentPaths.delete(pathStr);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Add an external context path programmatically (e.g., from /add-dir command).
   * Validates the path and handles duplicates/conflicts.
   * @param pathInput - Path string (supports ~/ expansion)
   * @returns Result with success status and normalized path, or error message on failure
   */
  addExternalContext(pathInput: string): AddExternalContextResult {
    const trimmed = pathInput?.trim();
    if (!trimmed) {
      return { success: false, error: t('chat.ui.externalContext.noPath') };
    }

    // Strip surrounding quotes if present (e.g., "/path/with spaces")
    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }

    // Expand home directory and normalize path
    const expandedPath = expandHomePath(cleanPath);
    const normalizedPath = normalizePathForFilesystem(expandedPath);

    if (!path.isAbsolute(normalizedPath)) {
      return { success: false, error: t('chat.ui.externalContext.absolutePathRequired') };
    }

    // Validate path exists and is a file or directory with specific error messages
    const validation = validateContextPath(normalizedPath);
    if (!validation.valid) {
      return { success: false, error: `${validation.error}: ${pathInput}` };
    }

    // Check for duplicate (normalized comparison for cross-platform support)
    if (isDuplicatePath(normalizedPath, this.externalContextPaths)) {
      return { success: false, error: t('chat.ui.externalContext.duplicate') };
    }

    // Check for nested/overlapping paths
    const conflict = findConflictingPath(normalizedPath, this.externalContextPaths);
    if (conflict) {
      return { success: false, error: this.formatConflictMessage(normalizedPath, conflict) };
    }

    // Add the path
    this.externalContextPaths = [...this.externalContextPaths, normalizedPath];
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();

    return { success: true, normalizedPath };
  }

  /**
   * Clear session-only external context paths (call on new conversation).
   * Uses persistent paths from settings if provided, otherwise falls back to local cache.
   * Validates paths before using them (silently filters invalid during session init).
   */
  clearExternalContexts(persistentPathsFromSettings?: string[]): void {
    // Use settings value if provided (most up-to-date), otherwise use local cache
    if (persistentPathsFromSettings) {
      // Validate paths - silently filter during session initialization (not user action)
      const validPaths = filterValidPaths(persistentPathsFromSettings);
      this.persistentPaths = new Set(validPaths);
    }
    this.externalContextPaths = [...this.persistentPaths];
    this.updateDisplay();
    this.renderDropdown();
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'grimoire-external-context-icon-wrapper' });

    this.iconEl = this.buttonEl.createDiv({ cls: 'grimoire-external-context-icon' });
    setIcon(this.iconEl, 'paperclip');
    this.labelEl = this.buttonEl.createSpan({ cls: 'grimoire-external-context-label' });

    this.badgeEl = this.buttonEl.createDiv({ cls: 'grimoire-external-context-badge' });

    this.updateDisplay();

    // Click to open native folder picker
    this.buttonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openFolderPicker();
    });
    this.container.addEventListener('mouseenter', () => {
      this.positionDropdown();
    });
    this.container.addEventListener('focusin', () => {
      this.positionDropdown();
    });

    this.dropdownEl = this.container.createDiv({ cls: 'grimoire-external-context-dropdown' });
    this.renderDropdown();
  }

  private positionDropdown(): void {
    if (!this.dropdownEl) return;

    const selectorRect = this.container.getBoundingClientRect();
    const ownerView = this.container.ownerDocument.defaultView;
    const viewportWidth = ownerView?.innerWidth ?? window.innerWidth;
    const viewportHeight = ownerView?.innerHeight ?? window.innerHeight;
    const composerEl = this.container.closest('.grimoire-composer-shell');
    const composerRect = typeof composerEl?.getBoundingClientRect === 'function'
      ? composerEl.getBoundingClientRect()
      : null;
    const gutter = 10;
    const boundaryLeft = composerRect?.left ?? gutter;
    const boundaryRight = composerRect?.right ?? viewportWidth - gutter;
    const boundaryWidth = Math.max(0, boundaryRight - boundaryLeft);
    const width = Math.min(320, Math.max(220, boundaryWidth - gutter * 2));
    const minLeft = boundaryLeft + gutter;
    const maxLeft = Math.max(minLeft, boundaryRight - width - gutter);
    const preferredLeft = selectorRect.left + selectorRect.width / 2 - width / 2;
    const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);
    const bottom = Math.max(gutter, viewportHeight - selectorRect.top + 8);
    const maxHeight = Math.min(260, Math.max(96, selectorRect.top - gutter * 2));

    this.dropdownEl.setCssProps({
      '--grimoire-external-context-dropdown-bottom': `${Math.round(bottom)}px`,
      '--grimoire-external-context-dropdown-left': `${Math.round(left)}px`,
      '--grimoire-external-context-dropdown-max-height': `${Math.round(maxHeight)}px`,
      '--grimoire-external-context-dropdown-width': `${Math.round(width)}px`,
    });
  }

  private async openFolderPicker() {
    try {
      // Access Electron's dialog through remote
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
      const { remote } = require('electron') as { remote?: ElectronRemoteApi };
      if (!remote) {
        throw new Error('Electron remote API is unavailable');
      }
      const result = await remote.dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory'],
        title: t('chat.ui.externalContext.selectTitle'),
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];

        // Check for duplicate (normalized comparison for cross-platform support)
        if (isDuplicatePath(selectedPath, this.externalContextPaths)) {
          new Notice(t('chat.ui.externalContext.duplicate'), 3000);
          return;
        }

        // Check for nested/overlapping paths
        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          new Notice(this.formatConflictMessage(selectedPath, conflict), 5000);
          return;
        }

        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        if (validateContextPath(selectedPath).type === 'file') {
          this.callbacks.onExternalContextFileSelect?.(selectedPath);
        }
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch {
      new Notice(t('chat.ui.externalContext.pickerFailed'), 5000);
    }
  }

  /** Formats a conflict error message for display. */
  private formatConflictMessage(newPath: string, conflict: { path: string; type: 'parent' | 'child' }): string {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    return conflict.type === 'parent'
      ? t('chat.ui.externalContext.conflictInside', { path: shortNew, existing: shortExisting })
      : t('chat.ui.externalContext.conflictContains', { path: shortNew, existing: shortExisting });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;

    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'grimoire-external-context-header' });
    headerEl.setText(t('chat.ui.externalContext.header'));

    // Path list
    const listEl = this.dropdownEl.createDiv({ cls: 'grimoire-external-context-list' });

    if (this.externalContextPaths.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'grimoire-external-context-empty' });
      emptyEl.setText(t('chat.ui.externalContext.empty'));
    } else {
      for (const pathStr of this.externalContextPaths) {
        const itemEl = listEl.createDiv({ cls: 'grimoire-external-context-item' });

        const pathTextEl = itemEl.createSpan({ cls: 'grimoire-external-context-text' });
        // Show shortened path for display
        const displayPath = this.shortenPath(pathStr);
        pathTextEl.setText(displayPath);
        pathTextEl.setAttribute('title', pathStr);

        // Lock toggle button
        const isPersistent = this.persistentPaths.has(pathStr);
        const lockBtn = itemEl.createSpan({ cls: 'grimoire-external-context-lock' });
        if (isPersistent) {
          lockBtn.addClass('locked');
        }
        setIcon(lockBtn, isPersistent ? 'lock' : 'unlock');
        lockBtn.setAttribute('title', isPersistent
          ? t('chat.ui.externalContext.makeSessionOnly')
          : t('chat.ui.externalContext.makePersistent'));
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePersistence(pathStr);
        });

        const removeBtn = itemEl.createSpan({ cls: 'grimoire-external-context-remove' });
        setIcon(removeBtn, 'x');
        removeBtn.setAttribute('title', t('chat.ui.externalContext.removePath'));
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removePath(pathStr);
        });
      }
    }
  }

  /** Shorten path for display (replace home dir with ~) */
  private shortenPath(fullPath: string): string {
    try {
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedFull;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        // Use normalized path length and normalize the result for consistent display
        const remainder = normalizedFull.slice(normalizedHome.length);
        return '~' + remainder;
      }
    } catch {
      // Fall through to return full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (!this.buttonEl || !this.iconEl || !this.labelEl || !this.badgeEl) return;

    this.container.removeAttribute('title');
    this.iconEl.removeAttribute('title');
    this.labelEl.removeAttribute('title');

    const count = this.externalContextPaths.length;
    const firstPath = this.externalContextPaths[0] ?? '';
    this.buttonEl.toggleClass('active', count > 0);

    if (count > 0) {
      this.iconEl.addClass('active');
      const title = count === 1
        ? firstPath
        : t('chat.ui.externalContext.countTitle', { count });
      this.labelEl.setText(t('chat.ui.externalContext.files'));
      this.buttonEl.setAttribute('aria-label', title);
      setTooltip(this.buttonEl, title, { placement: 'top' });

      // Show badge only when more than 1 path
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.labelEl.setText(t('chat.ui.externalContext.files'));
      const title = t('chat.ui.externalContext.addTitle');
      this.buttonEl.setAttribute('aria-label', title);
      setTooltip(this.buttonEl, title, { placement: 'top' });
      this.badgeEl.removeClass('visible');
    }
  }
}

export class McpServerSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpManager: McpServerManager | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;
  private visible = true;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'grimoire-mcp-selector' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.container.addClass('grimoire-hidden');
    } else {
      this.updateDisplay();
    }
  }

  setMcpManager(manager: McpServerManager | null): void {
    this.mcpManager = manager;
    if (!manager && this.enabledServers.size > 0) {
      this.enabledServers.clear();
      this.onChangeCallback?.(this.enabledServers);
    }
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpManager) return;
    const activeNames = new Set(this.mcpManager.getServers().filter((s) => s.enabled).map((s) => s.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'grimoire-mcp-selector-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'grimoire-mcp-selector-icon' });
    appendMcpIcon(this.iconEl);

    this.badgeEl = iconWrapper.createDiv({ cls: 'grimoire-mcp-selector-badge' });

    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'grimoire-mcp-selector-dropdown' });
    this.renderDropdown();

    // Re-render dropdown content on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'grimoire-mcp-selector-header' });
    headerEl.setText(t('chat.ui.mcp.header'));

    // Server list
    const listEl = this.dropdownEl.createDiv({ cls: 'grimoire-mcp-selector-list' });

    const allServers = this.mcpManager?.getServers() || [];
    const servers = allServers.filter(s => s.enabled);

    if (servers.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'grimoire-mcp-selector-empty' });
      emptyEl.setText(allServers.length === 0
        ? t('chat.ui.mcp.noneConfigured')
        : t('chat.ui.mcp.allDisabled'));
      return;
    }

    for (const server of servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'grimoire-mcp-selector-item' });
    itemEl.dataset.serverName = server.name;

    const isEnabled = this.enabledServers.has(server.name);
    if (isEnabled) {
      itemEl.addClass('enabled');
    }

    // Checkbox
    const checkEl = itemEl.createDiv({ cls: 'grimoire-mcp-selector-check' });
    if (isEnabled) {
      appendCheckIcon(checkEl);
    }

    // Info
    const infoEl = itemEl.createDiv({ cls: 'grimoire-mcp-selector-item-info' });

    const nameEl = infoEl.createSpan({ cls: 'grimoire-mcp-selector-item-name' });
    nameEl.setText(server.name);

    // Badges
    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'grimoire-mcp-selector-cs-badge' });
      csEl.setText('@');
      csEl.setAttribute('title', t('chat.ui.mcp.contextSaving', { server: server.name }));
    }

    // Click to toggle (use mousedown for more reliable capture)
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
  }

  private toggleServer(name: string, itemEl: HTMLElement) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place (immediate feedback)
    const isEnabled = this.enabledServers.has(name);
    const checkEl = itemEl.querySelector<HTMLElement>('.grimoire-mcp-selector-check');

    if (isEnabled) {
      itemEl.addClass('enabled');
      if (checkEl) appendCheckIcon(checkEl);
    } else {
      itemEl.removeClass('enabled');
      if (checkEl) checkEl.empty();
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.enabledServers.size;
    const hasServers = (this.mcpManager?.getServers().length || 0) > 0;

    // Show/hide container based on whether there are servers and visibility
    if (!hasServers || !this.visible) {
      this.container.addClass('grimoire-hidden');
      return;
    }
    this.container.removeClass('grimoire-hidden');

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', t('chat.ui.mcp.enabledCount', { count }));

      // Show badge only when more than 1
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', t('chat.ui.mcp.enableTitle'));
      this.badgeEl.removeClass('visible');
    }
  }
}

interface ContextUsageMeterOptions {
  showWhenEmpty?: boolean;
}

export class ContextUsageMeter {
  private container: HTMLElement;
  private percentEl: HTMLElement | null = null;
  private readonly showWhenEmpty: boolean;

  constructor(parentEl: HTMLElement, options: ContextUsageMeterOptions = {}) {
    this.showWhenEmpty = options.showWhenEmpty === true;
    this.container = parentEl.createDiv({ cls: 'grimoire-context-meter' });
    this.container.setAttribute('role', 'button');
    this.container.setAttribute('tabindex', '0');
    this.render();
    if (this.showWhenEmpty) {
      this.renderEmptyState();
    } else {
      // Initially hidden
      this.container.addClass('grimoire-hidden');
    }
  }

  setVisible(visible: boolean): void {
    this.container.toggleClass('grimoire-hidden', !visible);
  }

  private render() {
    this.container.createDiv({ cls: 'grimoire-context-meter-ring' });
    this.percentEl = this.container.createSpan({ cls: 'grimoire-context-meter-percent' });
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextTokens <= 0) {
      if (this.showWhenEmpty) {
        this.renderEmptyState(usage?.contextWindow);
      } else {
        this.container.addClass('grimoire-hidden');
      }
      return;
    }
    this.container.removeClass('grimoire-hidden');
    this.container.setCssProps({
      '--grimoire-context-meter-pct': `${Math.min(100, Math.max(0, usage.percentage))}`,
    });

    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    setTooltip(this.container, t('chat.ui.contextUsage.tokens', {
      used: this.formatTokens(usage.contextTokens),
      total: this.formatTokens(usage.contextWindow),
    }), { placement: 'bottom' });
  }

  private renderEmptyState(contextWindow?: number): void {
    this.container.removeClass('grimoire-hidden');
    this.container.removeClass('warning');
    this.container.setCssProps({ '--grimoire-context-meter-pct': '0' });
    this.percentEl?.setText('0%');
    const windowLabel = contextWindow ? this.formatTokens(contextWindow) : t('chat.ui.contextUsage.context');
    setTooltip(
      this.container,
      contextWindow
        ? t('chat.ui.contextUsage.tokens', { used: 0, total: windowLabel })
        : t('chat.ui.contextUsage.noneYet'),
      { placement: 'bottom' },
    );
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}

export class OrchestratorToggle {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-orchestrator-toggle' });
    this.render();
  }

  private render(): void {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'grimoire-orchestrator-button' });
    this.iconEl = this.buttonEl.createSpan({ cls: 'grimoire-orchestrator-icon' });
    setIcon(this.iconEl, 'git-fork');

    this.updateDisplay();

    this.buttonEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), t('chat.orchestrator.toggleFailed'));
    });
  }

  updateDisplay(): void {
    if (!this.buttonEl) return;

    this.buttonEl.toggleClass('active', this.callbacks.getOrchestratorMode?.() ?? false);
    this.buttonEl.setAttribute('aria-pressed', String(this.callbacks.getOrchestratorMode?.() ?? false));
    this.container.removeAttribute('title');
    this.buttonEl.setAttribute('aria-label', t('chat.orchestrator.toggleAriaLabel'));
    setTooltip(this.buttonEl, t('chat.orchestrator.toggleTitle'), { placement: 'top' });
  }

  private async toggle(): Promise<void> {
    await this.callbacks.onOrchestratorModeChange?.();
    this.updateDisplay();
  }
}

export class ProjectWorkspaceSelector {
  private container: HTMLElement;
  private selectEl: HTMLSelectElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'grimoire-project-workspace-selector' });
    this.render();
  }

  private render(): void {
    this.container.empty();
    this.selectEl = this.container.createEl('select', {
      attr: { 'aria-label': t('settings.projectWorkspaces.name') },
    });
    this.selectEl.addEventListener('change', () => {
      const workspaceId = this.selectEl?.value ?? '';
      runToolbarAction(
        () => this.callbacks.onProjectWorkspaceChange?.(workspaceId) ?? Promise.resolve(),
        t('settings.projectWorkspaces.changeFailed'),
      );
    });
    this.updateDisplay();
  }

  updateDisplay(): void {
    const workspaces = this.callbacks.getProjectWorkspaces?.() ?? [];
    this.container.toggleClass('grimoire-hidden', workspaces.length === 0);
    if (!this.selectEl) {
      return;
    }

    this.selectEl.empty();
    this.selectEl.createEl('option', { text: t('settings.projectWorkspaces.none'), value: '' });
    for (const workspace of workspaces) {
      this.selectEl.createEl('option', {
        text: workspace.name || t('settings.projectWorkspaces.untitled'),
        value: workspace.id,
      });
    }

    const activeId = this.callbacks.getActiveProjectWorkspaceId?.() ?? '';
    this.selectEl.value = workspaces.some((workspace) => workspace.id === activeId) ? activeId : '';
    const selectedWorkspace = workspaces.find((workspace) => workspace.id === this.selectEl?.value);
    this.container.setAttribute('title', selectedWorkspace?.name || t('settings.projectWorkspaces.none'));
  }
}

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  modeSelector: ModeSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  planUsageBadge: PlanUsageBadge;
  contextUsageMeter: ContextUsageMeter | null;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionToggle;
  serviceTierToggle: ServiceTierToggle;
  orchestratorToggle: OrchestratorToggle;
  projectWorkspaceSelector: ProjectWorkspaceSelector;
  relevantNotesContainerEl: HTMLElement;
} {
  const actionsRowEl = parentEl.createDiv({
    cls: 'grimoire-input-toolbar-row grimoire-input-toolbar-model-row grimoire-input-toolbar-actions-row',
  });
  const modelContextStackEl = actionsRowEl.createDiv({ cls: 'grimoire-model-context-stack' });
  const modelSelector = new ModelSelector(modelContextStackEl, callbacks);
  const planUsageBadge = new PlanUsageBadge(modelContextStackEl, callbacks);
  const relevantNotesContainerEl = modelContextStackEl.createDiv({ cls: 'grimoire-relevant-notes-slot' });
  const configActionsEl = actionsRowEl.createDiv({ cls: 'grimoire-input-toolbar-config-actions' });
  const thinkingBudgetSelector = new ThinkingBudgetSelector(configActionsEl, callbacks);
  const serviceTierToggle = new ServiceTierToggle(configActionsEl, callbacks);
  const contextUsageMeter = new ContextUsageMeter(configActionsEl);
  const externalContextSelector = new ExternalContextSelector(configActionsEl, callbacks);
  const mcpServerSelector = new McpServerSelector(configActionsEl);
  const permissionToggle = new PermissionToggle(configActionsEl, callbacks);
  const modeSelector = new ModeSelector(configActionsEl, callbacks);
  const orchestratorToggle = new OrchestratorToggle(configActionsEl, callbacks);
  const projectWorkspaceSelector = new ProjectWorkspaceSelector(configActionsEl, callbacks);

  return {
    modelSelector,
    modeSelector,
    thinkingBudgetSelector,
    planUsageBadge,
    serviceTierToggle,
    contextUsageMeter,
    externalContextSelector,
    mcpServerSelector,
    permissionToggle,
    orchestratorToggle,
    projectWorkspaceSelector,
    relevantNotesContainerEl,
  };
}
