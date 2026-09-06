import { Notice, TFile } from 'obsidian';

import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import type { ProviderId } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { validateContextPath } from '../../../utils/externalContext';
import { updateContextRowHasContent } from '../controllers/contextRowVisibility';
import { ContextAttachments } from '../ui/context-manager/ContextAttachments';
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

export function isExternalFilePath(contextPath: string): boolean {
  return validateContextPath(contextPath).type === 'file';
}

export function getSelectedExternalFilePaths(tab: TabData): string[] {
  return (tab.ui.externalContextSelector?.getExternalContexts() ?? []).filter(isExternalFilePath);
}

/**
 * Redraws what is attached after an external path changed.
 *
 * External files used to have a chip row of their own beside the vault one,
 * which is how a reader could have nine things attached across two rows that
 * never agreed on a count.
 */
export function renderExternalFileChips(tab: TabData): void {
  tab.ui.contextAttachments?.sync();
  updateContextRowHasContent(tab.dom.contextRowEl);
}

export function syncContextSummary(tab: TabData, plugin: GrimoirePlugin): void {
  const { contextSummaryEl } = tab.dom;
  contextSummaryEl.empty();

  const providerId = getTabProviderId(tab, plugin);
  const settings = getTabSettingsSnapshot(tab, plugin);
  const providerName = providerCatalog().displayName(providerId);
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
  const modelInfo = providerCatalog().declarations(providerId)
    .chatUI.models.options(settings)
    .find(option => option.value === model);
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

/**
 * Send and Stop are one square that changes what it does.
 *
 * Stop used to appear only once a subagent was seen working, beside a Send
 * that stayed enabled — so during an ordinary turn there was no way to stop it
 * from the composer at all, and during a subagent turn there were two primary
 * actions where the design allows one.
 */
export function syncComposerStopButton(tab: TabData, _hasSubagentActivity = false): void {
  const streaming = tab.state.isStreaming;
  tab.dom.stopButtonEl?.toggleClass('grimoire-hidden', !streaming);
  tab.dom.sendButtonEl?.toggleClass('grimoire-hidden', streaming);
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
  const toggle = providerCatalog().declarations(providerId)
    .chatUI.permissionMode?.toggle() ?? null;
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
  const toggle = providerCatalog().declarations(providerId)
    .chatUI.permissionMode?.toggle() ?? null;
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
        tab.ui.contextAttachments?.sync();
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
  tab.ui.fileContextManager.setMcpManager(getProviderMcpManager(getTabProviderId(tab, plugin), plugin));

  /*
   * One list over the three places an attachment can come from. Each had its
   * own view before this and none could see the other two, so "what is
   * attached, and what does it cost" was a question the composer could not
   * answer past four chips.
   */
  tab.ui.contextAttachments = new ContextAttachments(dom.contextRowEl, {
    app,
    getOpenNotePath: () => (typeof tab.ui.fileContextManager?.getCurrentNotePath === 'function'
      ? tab.ui.fileContextManager.getCurrentNotePath()
      : null),
    getVaultPaths: () => {
      const manager = tab.ui.fileContextManager;
      const openNote = typeof manager?.getCurrentNotePath === 'function'
        ? manager.getCurrentNotePath()
        : null;
      const attached = typeof manager?.getAttachedFiles === 'function'
        ? manager.getAttachedFiles()
        : new Set<string>();
      return [...attached].filter(path => path !== openNote);
    },
    getExternalPaths: () => (typeof tab.ui.externalContextSelector?.getExternalContexts === 'function'
      ? tab.ui.externalContextSelector.getExternalContexts()
      : []),
    detachOpenNote: () => tab.ui.fileContextManager?.clearCurrentNote?.(),
    detachVaultPath: (path) => tab.ui.fileContextManager?.detachFile?.(path),
    detachExternalPath: (path) => tab.ui.externalContextSelector?.removePath?.(path),
    attachVaultPath: (path) => tab.ui.fileContextManager?.attachFile?.(path),
    getBudget: () => ({
      windowTokens: tab.state.usage?.contextWindow ?? 0,
      usedTokens: tab.state.usage?.contextTokens ?? 0,
    }),
    isStreaming: () => tab.state.isStreaming,
    openPath: (path) => openRelevantVaultPath(plugin, path),
    cardEl: dom.inputWrapper,
    attachOpenFile: () => {
      const active = app.workspace.getActiveFile?.();
      if (active) tab.ui.fileContextManager?.attachFile?.(active.path);
      tab.ui.contextAttachments?.sync();
    },
  });
  dom.eventCleanups.push(() => tab.ui.contextAttachments?.destroy());

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
    dom.contextRowEl,
    plugin.storage?.attachments,
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
