import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { markDecorative } from '../../../shared/components/activatable';
import { createInputResizeHandle } from '../ui/inputResizeHandle';
import type { TabDOMElements, TabPanelView } from './types';

/** The glyph each panel is recognised by, before its word is read. */
const PANEL_ICONS: Record<TabPanelView, string> = {
  chat: 'message-square',
  sources: 'book-open',
  context: 'layers',
};

/**
 * Whether the inactive segments say their words.
 *
 * The active one always does — a rail of glyphs with nothing named would leave
 * the reader's own position unwritten.
 */
export function applyPanelLabels(dom: TabDOMElements, showLabels: boolean): void {
  dom.panelSwitchEl.toggleClass('grimoire-panel-switch--labelled', showLabels);
}

export function buildTabDOM(contentEl: HTMLElement): TabDOMElements {
  contentEl.addClass('grimoire-tab-chat-window');
  contentEl.dataset.panelView = 'chat';

  const workbenchGridEl = contentEl.createDiv({ cls: 'grimoire-chat-window-grid' });

  /*
   * The panel switch. A segment is its glyph; the active one also says its
   * word, so the row stays a rail of icons and still names where the reader is.
   * `showPanelLabels` turns the other words on for someone who would rather
   * read them than learn them.
   */
  const panelSwitchEl = workbenchGridEl.createDiv({ cls: 'grimoire-panel-switch' });
  const panelTabsEl = panelSwitchEl.createEl('nav', {
    cls: 'grimoire-panel-tabs',
  });
  const createPanelButton = (view: TabPanelView, label: string): HTMLButtonElement => {
    const button = panelTabsEl.createEl('button', {
      cls: view === 'chat' ? 'grimoire-panel-tab is-active' : 'grimoire-panel-tab',
      attr: {
        type: 'button',
        'data-panel-view': view,
        'aria-pressed': String(view === 'chat'),
        'aria-label': label,
        title: label,
      },
    });
    const icon = button.createSpan({ cls: 'grimoire-panel-tab-icon' });
    setIcon(icon, PANEL_ICONS[view]);
    markDecorative(icon);
    button.createSpan({ cls: 'grimoire-panel-tab-label', text: label });
    return button;
  };
  const chatPanelButtonEl = createPanelButton('chat', t('chat.ui.view.chat'));
  const sourcesPanelButtonEl = createPanelButton('sources', t('chat.ui.view.sources'));
  const contextPanelButtonEl = createPanelButton('context', t('chat.ui.view.context'));
  /*
   * The other end of the row belongs to whichever view is open: the transcript's
   * jump controls in Chat, the source filters in Sources. They were stacked into
   * the panel below instead, which spent a whole row on three words and left the
   * switch row half empty.
   */
  const panelAsideEl = panelSwitchEl.createDiv({ cls: 'grimoire-panel-aside' });
  const sourceFiltersEl = panelAsideEl.createDiv({ cls: 'grimoire-source-filters' });
  sourceFiltersEl.createEl('button', {
    cls: 'grimoire-source-filter is-active',
    text: t('chat.ui.view.all'),
    attr: { type: 'button', 'data-source-filter': 'all', 'aria-pressed': 'true' },
  });
  sourceFiltersEl.createEl('button', {
    cls: 'grimoire-source-filter',
    text: t('chat.ui.view.linked'),
    attr: { type: 'button', 'data-source-filter': 'linked', 'aria-pressed': 'false' },
  });
  sourceFiltersEl.createEl('button', {
    cls: 'grimoire-source-filter',
    text: t('chat.ui.view.current'),
    attr: { type: 'button', 'data-source-filter': 'current', 'aria-pressed': 'false' },
  });
  const panelJumpEl = panelAsideEl.createDiv({ cls: 'grimoire-panel-jump' });
  const chatScrollEl = workbenchGridEl.createDiv({
    cls: 'grimoire-chat-scroll',
    attr: { 'aria-live': 'polite' },
  });
  const focusedMainEl = chatScrollEl.createDiv({ cls: 'grimoire-panel-content' });

  const chatStageEl = focusedMainEl.createDiv({
    cls: 'grimoire-panel-view grimoire-chat-panel is-active',
    attr: { 'data-panel-view': 'chat' },
  });
  const boundStatusEl = chatStageEl.createDiv({ cls: 'grimoire-bound-status grimoire-hidden' });
  const boundStatusDotEl = boundStatusEl.createSpan({ cls: 'grimoire-bound-status-dot' });
  const boundStatusNoteEl = boundStatusEl.createSpan({ cls: 'grimoire-bound-status-note' });
  const boundStatusMetaEl = boundStatusEl.createSpan({ cls: 'grimoire-bound-status-meta' });
  const messagesWrapperEl = chatStageEl.createDiv({ cls: 'grimoire-messages-wrapper' });
  const messagesEl = messagesWrapperEl.createDiv({ cls: 'grimoire-messages' });
  const welcomeEl = messagesEl.createDiv({ cls: 'grimoire-welcome grimoire-welcome--chat-window' });

  const sourceRailEl = focusedMainEl.createDiv({
    cls: 'grimoire-panel-view grimoire-sources-panel',
    attr: { 'data-panel-view': 'sources' },
  });
  sourceRailEl.hidden = true;
  const sourceHeaderEl = sourceRailEl.createDiv({ cls: 'grimoire-panel-section-heading' });
  sourceHeaderEl.createSpan({ text: t('chat.ui.view.sourcesInTab') });
  const sourceShownCountEl = sourceHeaderEl.createSpan({
    cls: 'grimoire-panel-section-count',
    text: t('chat.ui.view.shownCount', { count: 0 }),
  });
  const sourceCardsEl = sourceRailEl.createDiv({ cls: 'grimoire-source-card-stack' });
  const statusPanelContainerEl = sourceRailEl.createDiv({
    cls: 'grimoire-status-panel-container grimoire-operational-panel',
  });

  const contextRailEl = focusedMainEl.createDiv({
    cls: 'grimoire-panel-view grimoire-context-panel',
    attr: { 'data-panel-view': 'context' },
  });
  contextRailEl.hidden = true;
  const contextHeaderEl = contextRailEl.createDiv({ cls: 'grimoire-panel-section-heading' });
  contextHeaderEl.createSpan({ text: t('chat.ui.view.contextMemoryTab') });
  const contextSummaryEl = contextRailEl.createDiv({ cls: 'grimoire-context-summary' });
  const contextMemoryEl = contextRailEl.createDiv({ cls: 'grimoire-context-memory-panel grimoire-hidden' });
  const contextRuntimeEl = contextRailEl.createDiv({ cls: 'grimoire-context-runtime-panel grimoire-hidden' });

  const composerSurfaceEl = workbenchGridEl.createDiv({ cls: 'grimoire-composer-surface grimoire-composer' });
  const inputContainerEl = composerSurfaceEl.createDiv({
    cls: 'grimoire-input-container grimoire-composer-shell',
  });
  const queueIndicatorEl = inputContainerEl.createDiv({ cls: 'grimoire-input-queue-row' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'grimoire-input-wrapper' });
  const contextRowEl = inputWrapper.createDiv({ cls: 'grimoire-context-row' });
  const inputEl = inputWrapper.createEl('textarea', {
    cls: 'grimoire-input',
    attr: {
      placeholder: t('chat.ui.composer.placeholder'),
      rows: '3',
      dir: 'auto',
    },
  });
  const panelViews: Record<TabPanelView, HTMLElement> = {
    chat: chatStageEl,
    sources: sourceRailEl,
    context: contextRailEl,
  };
  const panelButtons: Record<TabPanelView, HTMLButtonElement> = {
    chat: chatPanelButtonEl,
    sources: sourcesPanelButtonEl,
    context: contextPanelButtonEl,
  };
  const setPanelView = (view: TabPanelView): void => {
    contentEl.dataset.panelView = view;
    for (const [name, panelEl] of Object.entries(panelViews) as [TabPanelView, HTMLElement][]) {
      const isActive = name === view;
      panelEl.hidden = !isActive;
      panelEl.toggleClass('is-active', isActive);
      panelButtons[name].toggleClass('is-active', isActive);
      panelButtons[name].setAttribute('aria-pressed', String(isActive));
    }
  };
  chatPanelButtonEl.addEventListener('click', () => setPanelView('chat'));
  sourcesPanelButtonEl.addEventListener('click', () => setPanelView('sources'));
  contextPanelButtonEl.addEventListener('click', () => setPanelView('context'));

  return {
    contentEl,
    workbenchGridEl,
    panelSwitchEl,
    panelJumpEl,
    contextRailEl,
    contextMemoryEl,
    contextRuntimeEl,
    contextSummaryEl,
    chatStageEl,
    chatScrollEl,
    sourceRailEl,
    sourceCardsEl,
    sourceFiltersEl,
    sourceShownCountEl,
    composerSurfaceEl,
    panelTabsEl,
    chatPanelButtonEl,
    sourcesPanelButtonEl,
    contextPanelButtonEl,
    focusedMainEl,
    focusedChatPanelEl: chatStageEl,
    focusedSourcesPanelEl: sourceRailEl,
    focusedContextPanelEl: contextRailEl,
    boundStatusEl,
    boundStatusDotEl,
    boundStatusNoteEl,
    boundStatusMetaEl,
    messagesEl,
    welcomeEl,
    statusPanelContainerEl,
    inputContainerEl,
    queueIndicatorEl,
    inputWrapper,
    inputEl,
    sendButtonEl: null,
    stopButtonEl: null,
    contextRowEl,
    selectionIndicatorEl: null,
    browserIndicatorEl: null,
    canvasIndicatorEl: null,
    eventCleanups: [],
  };
}

export function attachInputResizeHandle(dom: TabDOMElements): () => void {
  const viewport = dom.inputWrapper.closest<HTMLElement>('.grimoire-container');
  if (!viewport) {
    return () => {};
  }

  return createInputResizeHandle({
    inputWrapper: dom.inputWrapper,
    viewport,
  });
}
