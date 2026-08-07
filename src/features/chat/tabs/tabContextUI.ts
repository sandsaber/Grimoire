import { Notice, setIcon, TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { validateContextPath } from '../../../utils/externalContext';
import { updateContextRowHasContent } from '../controllers/contextRowVisibility';
import { FileContextManager } from '../ui/FileContext';
import { ImageContextManager } from '../ui/ImageContext';
import type { RelevantNotesCurrentSource } from '../ui/RelevantNotesView';
import { autoResizeTextarea } from '../ui/textareaResize';
import { localizeReasoningLevel } from '../utils/reasoningDisplay';
import { getTabProviderId } from './providerResolution';
import {
  type ContextEngineRelevantSettings,
  getProviderMcpManager,
  getTabPermissionMode,
  getTabSettingsSnapshot,
  type TabProviderSettings,
} from './tabSettings';
import type { TabData } from './types';

export function getBasename(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || filePath;
}

export function getOrCreateExternalFileIndicator(tab: TabData): HTMLElement {
  const existing = tab.dom.contextRowEl.querySelector('.grimoire-external-file-indicator');
  if (existing) {
    return existing as HTMLElement;
  }
  return tab.dom.contextRowEl.createDiv({ cls: 'grimoire-external-file-indicator grimoire-hidden' });
}

export function isExternalFilePath(contextPath: string): boolean {
  return validateContextPath(contextPath).type === 'file';
}

export function getSelectedExternalFilePaths(tab: TabData): string[] {
  return (tab.ui.externalContextSelector?.getExternalContexts() ?? []).filter(isExternalFilePath);
}

export function renderExternalFileChips(tab: TabData, selectedFilePath?: string): void {
  const indicatorEl = getOrCreateExternalFileIndicator(tab);
  const filePaths = getSelectedExternalFilePaths(tab);
  const selectedPaths = selectedFilePath && !filePaths.includes(selectedFilePath)
    ? [...filePaths, selectedFilePath]
    : filePaths;

  indicatorEl.empty();

  if (selectedPaths.length === 0) {
    indicatorEl.removeClass('grimoire-visible-flex');
    indicatorEl.addClass('grimoire-hidden');
    updateContextRowHasContent(tab.dom.contextRowEl);
    return;
  }

  indicatorEl.addClass('grimoire-visible-flex');
  indicatorEl.removeClass('grimoire-hidden');

  for (const filePath of selectedPaths) {
    const chipEl = indicatorEl.createSpan({ cls: 'grimoire-external-file-chip' });
    chipEl.setAttribute('title', filePath);
    const iconEl = chipEl.createSpan({ cls: 'grimoire-external-file-chip-icon' });
    setIcon(iconEl, 'file');
    chipEl.createSpan({
      cls: 'grimoire-external-file-chip-name',
      text: getBasename(filePath),
    });
    const removeEl = chipEl.createSpan({
      cls: 'grimoire-external-file-chip-remove',
      text: '\u00D7',
      attr: { 'aria-label': t('chat.ui.externalContext.removeFile') },
    });
    removeEl.addEventListener('click', (event) => {
      event.stopPropagation();
      tab.ui.externalContextSelector?.removePath(filePath);
      renderExternalFileChips(tab);
    });
  }

  updateContextRowHasContent(tab.dom.contextRowEl);
}
export function syncContextSummary(tab: TabData, plugin: GrimoirePlugin): void {
  const { contextSummaryEl } = tab.dom;
  contextSummaryEl.empty();

  const providerId = getTabProviderId(tab, plugin);
  const settings = getTabSettingsSnapshot(tab, plugin);
  const providerName = ProviderRegistry.getProviderDisplayName(providerId);
  const reasoningLabel = getReasoningLabel(settings);
  const currentPath = tab.ui.fileContextManager?.getCurrentNotePath() ?? '';

  appendContextSummaryRow(
    contextSummaryEl,
    currentPath ? getPathTitle(currentPath) : t('chat.ui.context.noNoteSelected'),
    currentPath ? t('chat.ui.context.boundToTab') : t('chat.ui.context.openNoteToBind'),
    currentPath ? t('chat.ui.context.active') : t('chat.ui.context.idle'),
    Boolean(currentPath),
  );

  const selectedExternalFiles = getSelectedExternalFilePaths(tab);
  if (selectedExternalFiles.length > 0) {
    appendContextSummaryRow(
      contextSummaryEl,
      selectedExternalFiles.length === 1
        ? t('chat.ui.context.selectedFile')
        : t('chat.ui.context.selectedFiles'),
      selectedExternalFiles.map(getBasename).join(', '),
      t('chat.ui.context.filesBadge'),
      true,
    );
  }

  appendContextSummaryRow(
    contextSummaryEl,
    getModelSummaryLabel(providerId, settings),
    t('chat.ui.context.modelDetail', {
      provider: providerName,
      reasoning: reasoningLabel ? ` · ${reasoningLabel}` : '',
    }),
    t('chat.ui.context.modelBadge'),
    false,
  );

  const permissionMode = getTabPermissionMode(tab, plugin);
  appendContextSummaryRow(
    contextSummaryEl,
    getPermissionTitle(providerId, permissionMode),
    getPermissionSummary(providerId, permissionMode),
    getPermissionTitle(providerId, permissionMode),
    permissionMode !== 'full_access',
  );
}

export function getModelSummaryLabel(providerId: ProviderId, settings: TabProviderSettings): string {
  const model = settings.model || '';
  const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
  const modelInfo = uiConfig.getModelOptions(settings).find(option => option.value === model);
  return modelInfo?.label ?? formatModelFallbackLabel(model);
}

export function formatModelFallbackLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return t('chat.ui.model.unknown');
  }
  if (/^gpt-/i.test(trimmed)) {
    return trimmed
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-([a-z])/gi, (_, letter: string) => ` ${letter.toUpperCase()}`);
  }
  const readable = trimmed
    .replace(/^claude[-_/]/i, '')
    .replace(/-(\d+)-(\d+)/g, ' $1.$2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
  return readable;
}

export function syncBoundStatus(tab: TabData, plugin: GrimoirePlugin): void {
  const fileContextManager = tab.ui.fileContextManager;
  const currentPath = fileContextManager?.getCurrentNotePath() ?? '';
  const attachedFiles = typeof fileContextManager?.getAttachedFiles === 'function'
    ? fileContextManager.getAttachedFiles()
    : new Set<string>();
  const hasContext = Boolean(currentPath) || attachedFiles.size > 0;

  tab.dom.boundStatusEl.toggleClass('grimoire-hidden', !hasContext);
  tab.dom.boundStatusDotEl.toggleClass('busy', tab.state.isStreaming);

  if (!hasContext) {
    tab.dom.boundStatusNoteEl.setText('');
    tab.dom.boundStatusMetaEl.setText('');
    return;
  }

  const permissionMode = getTabPermissionMode(tab, plugin);
  const safeLabel = getPermissionInlineLabel(getTabProviderId(tab, plugin), permissionMode);
  const linkedCount = attachedFiles.size;

  tab.dom.boundStatusNoteEl.setText(currentPath ? getPathTitle(currentPath) : t('chat.ui.context.attached'));
  tab.dom.boundStatusMetaEl.setText(t('chat.ui.context.linkedNotes', {
    count: linkedCount,
    permission: safeLabel,
  }));
}

export function syncComposerStopButton(tab: TabData, hasSubagentActivity = false): void {
  const shouldShow = tab.state.isStreaming && hasSubagentActivity;
  tab.dom.stopButtonEl?.toggleClass('grimoire-hidden', !shouldShow);
}

export function appendContextSummaryRow(
  parentEl: HTMLElement,
  title: string,
  detail: string,
  badge: string,
  accent: boolean,
): void {
  const rowEl = parentEl.createDiv({ cls: 'grimoire-context-summary-row' });
  const copyEl = rowEl.createDiv({ cls: 'grimoire-context-summary-copy' });
  copyEl.createEl('strong', { cls: 'grimoire-context-summary-title', text: title });
  copyEl.createSpan({ cls: 'grimoire-context-summary-detail', text: detail });
  rowEl.createSpan({
    cls: `grimoire-context-summary-badge${accent ? ' is-active' : ''}`,
    text: badge,
  });
}

export function getReasoningLabel(settings: TabProviderSettings): string {
  if (settings.effortLevel) {
    return t('chat.ui.context.reasoningEffort', {
      value: localizeReasoningLevel(settings.effortLevel),
    });
  }
  if (settings.thinkingBudget && settings.thinkingBudget !== 'off') {
    return t('chat.ui.context.reasoningThinking', {
      value: localizeReasoningLevel(settings.thinkingBudget),
    });
  }
  return '';
}

export function getPermissionSummary(providerId: ProviderId, permissionMode: string): string {
  const toggle = ProviderRegistry.getChatUIConfig(providerId).getPermissionModeToggle?.() ?? null;
  if (toggle) {
    if (permissionMode === toggle.activeValue) {
      return t('chat.ui.context.autoApprove');
    }
    if (permissionMode === toggle.inactiveValue) {
      return toggle.inactiveLabel === 'Blocked'
        ? toggle.inactiveDescription ?? t('chat.ui.context.permissionSafeDescription')
        : t('chat.ui.context.permissionSafeDescription');
    }
    if (permissionMode === toggle.planValue) {
      return t('chat.ui.context.permissionPlanDescription');
    }
  }
  if (permissionMode === 'plan') {
    return t('chat.ui.context.permissionPlanDescription');
  }
  if (permissionMode === 'full_access') {
    return t('chat.ui.context.autoApprove');
  }
  return t('chat.ui.context.permissionSafeDescription');
}

export function getPermissionTitle(providerId: ProviderId, permissionMode: string): string {
  const toggle = ProviderRegistry.getChatUIConfig(providerId).getPermissionModeToggle?.() ?? null;
  if (toggle) {
    if (permissionMode === toggle.activeValue) {
      return t('chat.ui.toolbar.permissionAuto');
    }
    if (permissionMode === toggle.inactiveValue) {
      return toggle.inactiveLabel === 'Blocked'
        ? t('chat.ui.status.blocked')
        : t('chat.ui.toolbar.permissionSafe');
    }
    if (permissionMode === toggle.planValue) {
      return t('chat.ui.toolbar.permissionPlan');
    }
  }
  if (permissionMode === 'plan') {
    return t('chat.ui.toolbar.permissionPlan');
  }
  if (permissionMode === 'full_access') {
    return t('chat.ui.toolbar.permissionAuto');
  }
  return t('chat.ui.toolbar.permissionSafe');
}

export function getPermissionInlineLabel(providerId: ProviderId, permissionMode: string): string {
  const title = getPermissionTitle(providerId, permissionMode);
  return title.toLowerCase();
}
export function initializeContextManagers(tab: TabData, plugin: GrimoirePlugin): void {
  const { dom } = tab;
  const app = plugin.app;

  // File context manager - chips in contextRowEl, dropdown in inputContainerEl
  tab.ui.fileContextManager = new FileContextManager(
    app,
    dom.contextRowEl,
    dom.inputEl,
    {
      getExcludedTags: () => plugin.settings.excludedTags,
      getExcludedFolders: () => plugin.settings.excludedFolders,
      onChipsChanged: () => {
        void updateRelevantNotes(tab, plugin);
        syncContextSummary(tab, plugin);
        syncBoundStatus(tab, plugin);
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
      getExternalContexts: () => tab.ui.externalContextSelector?.getExternalContexts() || [],
    },
    dom.inputContainerEl,
    dom.contextMemoryEl
  );
  tab.ui.fileContextManager.setMcpManager(getProviderMcpManager(getTabProviderId(tab, plugin)));

  const markVaultSearchDirty = (file: unknown): void => {
    if (file instanceof TFile) {
      tab.services.vaultTextIndex?.markDirty(file.path);
    }
  };
  const markVaultSearchRenameDirty = (file: unknown, oldPath: string): void => {
    if (file instanceof TFile) {
      tab.services.vaultTextIndex?.markDirty(oldPath);
      tab.services.vaultTextIndex?.markDirty(file.path);
    }
  };
  const modifyRef = app.vault.on('modify', markVaultSearchDirty);
  const deleteRef = app.vault.on('delete', markVaultSearchDirty);
  const renameRef = app.vault.on('rename', markVaultSearchRenameDirty);
  dom.eventCleanups.push(() => {
    app.vault.offref(modifyRef);
    app.vault.offref(deleteRef);
    app.vault.offref(renameRef);
  });

  // Image context manager - drag/drop uses inputContainerEl, preview in contextRowEl
  tab.ui.imageContextManager = new ImageContextManager(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
    },
    dom.contextRowEl
  );
}

export async function updateRelevantNotes(tab: TabData, plugin: GrimoirePlugin): Promise<void> {
  syncBoundStatus(tab, plugin);
  const view = tab.ui.relevantNotesView;
  if (!view) {
    return;
  }

  const currentSources = getCurrentSourceRows(tab);
  const settings = plugin.settings as ContextEngineRelevantSettings;
  if (settings.contextEngine?.relevantNotesEnabled === false) {
    view.render([], currentSources);
    return;
  }

  const currentPath = tab.ui.fileContextManager?.getCurrentNotePath();
  if (!currentPath) {
    view.render([], currentSources);
    return;
  }

  const maxResults = settings.contextEngine?.relevantNotesMaxResults ?? 6;
  if (maxResults <= 0) {
    view.render([], currentSources);
    return;
  }

  try {
    await tab.services.vaultTextIndex?.refresh({
      excludedTags: settings.excludedTags,
      excludedFolders: settings.excludedFolders,
    });
    const notes = tab.services.relevantNotesService?.findRelevantNotes(currentPath, { maxResults }) ?? [];
    view.render(notes, currentSources);
  } catch (error) {
    view.render([], currentSources);
    new Notice(t('chat.ui.errors.relevantNotesFailed', {
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function getCurrentSourceRows(tab: TabData): RelevantNotesCurrentSource[] {
  const fileContextManager = tab.ui.fileContextManager;
  if (!fileContextManager) {
    return [];
  }

  const currentNotePath = fileContextManager.getCurrentNotePath();
  const sources: RelevantNotesCurrentSource[] = [];
  if (currentNotePath) {
    sources.push({
      path: currentNotePath,
      title: getPathTitle(currentNotePath),
      detail: 'current note',
      badge: 'live',
    });
  }

  const attachedFiles = typeof fileContextManager.getAttachedFiles === 'function'
    ? fileContextManager.getAttachedFiles()
    : new Set<string>();
  for (const filePath of attachedFiles) {
    if (filePath === currentNotePath) {
      continue;
    }
    sources.push({
      path: filePath,
      title: getPathTitle(filePath),
      detail: 'attached file',
      badge: 'file',
    });
  }
  return sources;
}

export function getPathTitle(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

export function openRelevantVaultPath(plugin: GrimoirePlugin, path: string): void {
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    new Notice(t('chat.ui.errors.couldNotOpenFile', { path }));
    return;
  }

  void (async (): Promise<void> => {
    try {
      await plugin.app.workspace.getLeaf().openFile(file);
    } catch (error) {
      new Notice(t('chat.ui.errors.openFileFailed', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  })();
}
