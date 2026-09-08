import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { markDecorative } from '../../../shared/components/activatable';
import { collapseElement, setupCollapsible } from './collapsible';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: number | null;
  isExpanded: boolean;
}

export function createThinkingBlock(
  parentEl: HTMLElement,
  renderContent: RenderContentFn
): ThinkingBlockState {
  const wrapperEl = parentEl.createDiv({ cls: 'grimoire-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'grimoire-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', t('chat.ui.thinking.expandAriaLabel'));

  // The chevron says the line opens; without it the row reads as a caption.
  const caretEl = header.createSpan({ cls: 'grimoire-thinking-caret' });
  setIcon(caretEl, 'chevron-right');
  markDecorative(caretEl);

  // Label with timer
  const labelEl = header.createSpan({ cls: 'grimoire-thinking-label' });
  const startTime = Date.now();
  labelEl.setText(t('chat.ui.thinking.inProgress', { seconds: 0 }));

  // Start timer interval to update label every second
  const timerInterval = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    labelEl.setText(t('chat.ui.thinking.inProgress', { seconds: elapsed }));
  }, 1000);

  // Collapsible content (collapsed by default)
  const contentEl = wrapperEl.createDiv({ cls: 'grimoire-thinking-content' });

  // Create state object first so toggle can reference it
  const state: ThinkingBlockState = {
    wrapperEl,
    contentEl,
    labelEl,
    content: '',
    startTime,
    timerInterval,
    isExpanded: false,
  };

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  setupCollapsible(wrapperEl, header, contentEl, state);

  return state;
}

export async function appendThinkingContent(
  state: ThinkingBlockState,
  content: string,
  renderContent: RenderContentFn
) {
  state.content += content;
  await renderContent(state.contentEl, state.content);
}

/*
 * Whether a thinking row is a thing that opens.
 *
 * The chevron says the line opens, and a row that promises an empty body is
 * worse than a row that promises nothing — so where the provider redacted the
 * reasoning, the row is a caption and says so: no chevron, no button role, no
 * tab stop. Both halves ask this, because the live row and the one read back
 * from the record are the same row and had drifted: the live one always wore
 * the chevron and the restored one never did.
 */
function applyThinkingAffordance(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  hasContent: boolean,
): void {
  if (hasContent) return;
  wrapperEl.addClass('is-caption');
  headerEl.querySelector('.grimoire-thinking-caret')?.remove();
  headerEl.removeAttribute('role');
  headerEl.removeAttribute('tabindex');
  headerEl.removeAttribute('aria-expanded');
  headerEl.removeAttribute('aria-label');
}

export function finalizeThinkingBlock(state: ThinkingBlockState): number {
  // Stop the timer
  if (state.timerInterval) {
    window.clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // Calculate final duration
  const durationSeconds = Math.floor((Date.now() - state.startTime) / 1000);

  // Update label to show final duration (without "...")
  state.labelEl.setText(t('chat.ui.thinking.completed', { seconds: durationSeconds }));

  // Collapse when done and sync state
  const header = state.wrapperEl.querySelector('.grimoire-thinking-header');
  if (header) {
    collapseElement(state.wrapperEl, header as HTMLElement, state.contentEl, state);
    applyThinkingAffordance(state.wrapperEl, header as HTMLElement, state.content.length > 0);
  }

  return durationSeconds;
}

export function cleanupThinkingBlock(state: ThinkingBlockState | null) {
  if (state?.timerInterval) {
    window.clearInterval(state.timerInterval);
  }
}

export function renderStoredThinkingBlock(
  parentEl: HTMLElement,
  content: string,
  durationSeconds: number | undefined,
  renderContent: RenderContentFn
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'grimoire-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'grimoire-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-label', t('chat.ui.thinking.expandAriaLabel'));

  // Label with duration
  const caretEl = header.createSpan({ cls: 'grimoire-thinking-caret' });
  setIcon(caretEl, 'chevron-right');
  markDecorative(caretEl);

  const labelEl = header.createSpan({ cls: 'grimoire-thinking-label' });
  const labelText = durationSeconds !== undefined
    ? t('chat.ui.thinking.completed', { seconds: durationSeconds })
    : t('chat.ui.thinking.thought');
  labelEl.setText(labelText);

  // Collapsible content
  const contentEl = wrapperEl.createDiv({ cls: 'grimoire-thinking-content' });
  void renderContent(contentEl, content).catch(() => {
    contentEl.setText(content);
  });

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state);
  applyThinkingAffordance(wrapperEl, header, content.length > 0);

  return wrapperEl;
}
