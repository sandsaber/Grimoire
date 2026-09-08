import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { asActivatable } from '../../../shared/components/activatable';
import type { TabBarItem, TabId } from './types';

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab badge is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when a tab badge is right-clicked. */
  onTabContextMenu: (tabId: TabId, event: MouseEvent) => void;

  /** Called when a tab badge is middle-clicked. */
  onTabMiddleClick: (tabId: TabId) => void;

  /** Called when the new tab button is clicked. */
  onNewTab: () => void;
}

/**
 * The tab strip: one numbered tab per conversation, and the control that adds
 * another.
 *
 * A tab carries its state as a dot rather than as a colour — filled and pulsing
 * while the provider streams, a ring while the turn is waiting on an answer,
 * nothing at rest — because a colour alone is not a state a reader can name.
 * The active tab is marked by the accent underline sitting on the header's own
 * rule, which is the only line in the strip.
 */
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private newTabButtonEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.build();
  }

  /** Builds the tab bar UI. */
  private build(): void {
    this.containerEl.addClass('grimoire-tab-badges');
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    // Clear existing badges
    this.containerEl.empty();
    this.newTabButtonEl = null;

    // Render badges
    for (const item of items) {
      this.renderBadge(item);
    }

    this.renderNewTabButton();
  }

  /** The add control belongs to the strip it extends, not to the header's actions. */
  private renderNewTabButton(): void {
    const button = this.containerEl.createEl('button', {
      cls: 'grimoire-header-btn grimoire-new-tab-btn',
      attr: { type: 'button', 'aria-label': t('chat.ui.tabs.newTab') },
    });
    setIcon(button, 'plus');
    button.addEventListener('click', () => this.callbacks.onNewTab());
    this.newTabButtonEl = button;
  }

  /** The add control, so a caller can hide it once no further tab can be created. */
  getNewTabButton(): HTMLElement | null {
    return this.newTabButtonEl;
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem): void {
    const stateClass = item.needsAttention
      ? 'grimoire-tab-badge-attention'
      : item.isStreaming
        ? 'grimoire-tab-badge-streaming'
        : 'grimoire-tab-badge-idle';
    const activeClass = item.isActive ? ' grimoire-tab-badge-active' : '';

    const badgeEl = this.containerEl.createDiv({
      cls: `grimoire-tab-badge ${stateClass}${activeClass}`,
    });
    badgeEl.createSpan({ cls: 'grimoire-tab-activity-dot' });
    badgeEl.createSpan({ cls: 'grimoire-tab-number', text: String(item.index) });

    asActivatable(badgeEl, {
      label: this.getAccessibleTitle(item),
      onActivate: () => this.callbacks.onTabClick(item.id),
    });
    if (item.isActive) badgeEl.setAttribute('aria-current', 'page');

    badgeEl.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      this.callbacks.onTabContextMenu(item.id, event);
    });

    badgeEl.addEventListener('auxclick', (event: MouseEvent) => {
      if (event.button !== 1 || !item.canClose) return;
      event.preventDefault();
      this.callbacks.onTabMiddleClick(item.id);
    });
  }

  private getAccessibleTitle(item: TabBarItem): string {
    // The tab shows its number, so the number is half of what names it; the
    // title is the other half. No orchestrator or worker variants any more: a
    // worker is a dispatched agent rather than a tab, so no tab is one.
    //
    // A word rather than the coloured star the menu and the history rows show:
    // this is an `aria-label`, so it is a string with no DOM to colour, and a
    // screen reader cannot see a colour anyway. Only the placeholder is called
    // out — a title the model or the user wrote needs no announcing.
    const title = item.titleSource === 'fallback'
      ? `${t('chat.ui.tabs.titleSourceFallbackPrefix')} · ${item.title}`
      : item.title;
    return t('chat.ui.tabs.tabLabel', { index: item.index, title });
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.containerEl.empty();
    this.newTabButtonEl = null;
    this.containerEl.removeClass('grimoire-tab-badges');
  }
}
