import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';

type DirectoryEntry = {
  element: HTMLElement;
  title: string;
};

/**
 * The transcript's own controls: to the first message, to the thread outline,
 * to the latest.
 *
 * They sit in the panel switch row rather than floating over the column, which
 * is where they used to be — a rail of five translucent circles hovering at 16%
 * opacity over the text a reader was reading. Prev and next went with the
 * float: the outline reaches any message in one press and names it, which is
 * what stepping was for.
 */
export class NavigationSidebar {
  private readonly container: HTMLElement;
  private readonly topBtn: HTMLElement;
  private readonly directoryBtn: HTMLElement;
  private readonly bottomBtn: HTMLElement;
  private directoryPopover: HTMLElement | null = null;
  private pendingVisibilityFrame: ScheduledAnimationFrame | null = null;
  private isVisible: boolean | null = null;
  private readonly scrollHandler = () => this.updateVisibility();
  private readonly outsideClickHandler = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (!target) return;
    if (this.container.contains(target) || this.directoryPopover?.contains(target)) return;
    this.closeDirectory();
  };

  constructor(
    private readonly parentEl: HTMLElement,
    private readonly scrollEl: HTMLElement,
    private readonly messageListEl: HTMLElement = scrollEl,
    private readonly onScrollBottom?: () => void,
  ) {
    this.container = this.parentEl.createDiv({ cls: 'grimoire-nav-sidebar' });
    this.topBtn = this.createButton(
      'grimoire-nav-btn-top',
      'arrow-up-to-line',
      t('chat.ui.navigation.scrollTop'),
    );
    this.directoryBtn = this.createButton(
      'grimoire-nav-btn-directory',
      'list',
      t('chat.ui.navigation.directory'),
    );
    this.directoryBtn.setAttribute('aria-haspopup', 'dialog');
    this.directoryBtn.setAttribute('aria-expanded', 'false');
    this.bottomBtn = this.createButton(
      'grimoire-nav-btn-bottom',
      'arrow-down-to-line',
      t('chat.ui.navigation.scrollBottom'),
    );

    this.setupEventListeners();
    this.applyVisibility();
  }

  private createButton(cls: string, icon: string, label: string): HTMLElement {
    const button = this.container.createDiv({ cls: `grimoire-nav-btn ${cls}` });
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', label);
    setIcon(button, icon);
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      button.click();
    });
    return button;
  }

  private setupEventListeners(): void {
    this.scrollEl.addEventListener('scroll', this.scrollHandler, { passive: true });
    this.topBtn.addEventListener('click', () => this.scrollTo(0));
    this.bottomBtn.addEventListener('click', () => {
      if (this.onScrollBottom) {
        this.onScrollBottom();
        this.updateDirectoryActiveState();
        return;
      }
      this.scrollTo(this.scrollEl.scrollHeight);
    });
    this.directoryBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleDirectory();
    });
    this.parentEl.ownerDocument.addEventListener?.('click', this.outsideClickHandler);
  }

  updateVisibility(): void {
    if (this.pendingVisibilityFrame !== null) return;
    this.pendingVisibilityFrame = scheduleAnimationFrame(() => {
      this.pendingVisibilityFrame = null;
      this.applyVisibility();
    }, this.scrollEl.ownerDocument.defaultView ?? null);
  }

  private applyVisibility(): void {
    const isScrollable = this.scrollEl.scrollHeight > this.scrollEl.clientHeight + 50;
    if (!isScrollable) this.closeDirectory();
    if (isScrollable) this.updateDirectoryActiveState();
    if (this.isVisible === isScrollable) return;
    this.isVisible = isScrollable;
    this.container.classList.toggle('visible', isScrollable);
  }

  private toggleDirectory(): void {
    if (this.directoryPopover) {
      this.closeDirectory();
      return;
    }
    this.openDirectory();
  }

  private openDirectory(): void {
    const entries = this.getDirectoryEntries();
    const activeIndex = this.getActiveDirectoryIndex(entries);
    const popover = this.parentEl.createDiv({ cls: 'grimoire-nav-directory' });
    popover.setAttribute('role', 'dialog');
    popover.createDiv({
      cls: 'grimoire-nav-directory-title',
      text: t('chat.ui.navigation.directory'),
    });
    const list = popover.createDiv({ cls: 'grimoire-nav-directory-list' });

    if (entries.length === 0) {
      list.createDiv({
        cls: 'grimoire-nav-directory-empty',
        text: t('chat.ui.navigation.empty'),
      });
    } else {
      entries.forEach((entry, index) => {
        const item = list.createDiv({
          cls: 'grimoire-nav-directory-item',
        });
        const isActive = index === activeIndex;
        if (isActive) item.addClass('is-active');
        if (isActive) item.setAttribute('aria-current', 'location');
        item.setAttribute('aria-label', `${index + 1}. ${entry.title}`);
        item.createSpan({
          cls: 'grimoire-nav-directory-number',
          text: String(index + 1).padStart(2, '0'),
        });
        const label = item.createSpan({
          cls: 'grimoire-nav-directory-label',
          text: entry.title,
        });
        label.setAttribute('title', entry.title);
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        const activate = () => {
          this.scrollToElement(entry.element);
          this.closeDirectory();
        };
        item.addEventListener('click', activate);
        item.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activate();
        });
      });
    }

    this.directoryPopover = popover;
    this.directoryBtn.setAttribute('aria-expanded', 'true');
  }

  private closeDirectory(): void {
    this.directoryPopover?.remove();
    this.directoryPopover = null;
    this.directoryBtn?.setAttribute('aria-expanded', 'false');
  }

  private getDirectoryEntries(): DirectoryEntry[] {
    return Array.from(
      this.messageListEl.querySelectorAll<HTMLElement>('.grimoire-message-user'),
    ).map((element) => ({
      element,
      title: this.getDirectoryTitle(element),
    })).filter((entry) => entry.title.length > 0);
  }

  private getActiveDirectoryIndex(entries: DirectoryEntry[]): number {
    const viewportAnchor = this.scrollEl.scrollTop + 30;
    let activeIndex = 0;
    entries.forEach((entry, index) => {
      if (entry.element.offsetTop <= viewportAnchor) activeIndex = index;
    });
    return activeIndex;
  }

  private updateDirectoryActiveState(): void {
    if (!this.directoryPopover) return;
    const entries = this.getDirectoryEntries();
    const activeIndex = this.getActiveDirectoryIndex(entries);
    const items = Array.from(
      this.directoryPopover.querySelectorAll<HTMLElement>('.grimoire-nav-directory-item'),
    );
    items.forEach((item, index) => {
      const isActive = index === activeIndex;
      item.classList.toggle('is-active', isActive);
      if (isActive) {
        item.setAttribute('aria-current', 'location');
      } else {
        item.removeAttribute('aria-current');
      }
    });
  }

  private getDirectoryTitle(messageEl: HTMLElement): string {
    const content = messageEl.querySelector<HTMLElement>('.grimoire-message-content');
    const title = (content?.textContent ?? messageEl.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return title.length > 90 ? `${title.slice(0, 89)}…` : title;
  }

  private scrollToElement(element: HTMLElement): void {
    this.scrollTo(Math.max(0, element.offsetTop - 10));
  }

  private scrollTo(top: number): void {
    this.scrollEl.scrollTo({ top, behavior: 'smooth' });
    this.updateDirectoryActiveState();
  }

  destroy(): void {
    if (this.pendingVisibilityFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingVisibilityFrame);
      this.pendingVisibilityFrame = null;
    }
    this.closeDirectory();
    this.parentEl.ownerDocument.removeEventListener?.('click', this.outsideClickHandler);
    this.scrollEl.removeEventListener('scroll', this.scrollHandler);
    this.container.remove();
  }
}
