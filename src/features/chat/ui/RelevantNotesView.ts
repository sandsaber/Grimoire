import type { RelevantNote } from '../../../core/context/types';
import { t } from '../../../i18n/i18n';

const MAX_VISIBLE_RELEVANT_NOTES = 6;

export type RelevantNotesSourceFilter = 'all' | 'linked' | 'current';

export interface RelevantNotesCurrentSource {
  path: string;
  title: string;
  detail: string;
  badge: string;
}

export interface RelevantNotesViewControls {
  filtersEl?: HTMLElement;
  shownCountEl?: HTMLElement;
}

function isButtonElement(element: Element): element is HTMLButtonElement {
  if (typeof element.instanceOf === 'function') {
    return element.instanceOf(HTMLButtonElement);
  }
  return element.tagName === 'BUTTON';
}

export class RelevantNotesView {
  private filter: RelevantNotesSourceFilter = 'all';
  private linkedNotes: RelevantNote[] = [];
  private currentSources: RelevantNotesCurrentSource[] = [];
  private readonly eventCleanups: Array<() => void> = [];

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly openVaultPath: (path: string) => void,
    private readonly controls: RelevantNotesViewControls = {},
  ) {
    this.bindFilterControls();
  }

  render(notes: RelevantNote[], currentSources: RelevantNotesCurrentSource[] = []): void {
    this.linkedNotes = notes;
    this.currentSources = currentSources;
    this.renderFiltered();
  }

  private renderFiltered(): void {
    this.containerEl.replaceChildren();
    this.containerEl.classList.add('grimoire-source-card-stack');

    const visibleSources = this.getVisibleSources();
    this.updateShownCount(visibleSources.length);

    if (visibleSources.length === 0) {
      const emptyEl = this.createChild(this.containerEl, 'div', 'grimoire-source-empty');
      emptyEl.textContent = t('chat.relevantNotes.empty');
      return;
    }

    const renderedSources = visibleSources.slice(0, MAX_VISIBLE_RELEVANT_NOTES);
    for (const source of renderedSources) {
      const buttonEl = this.createChild(this.containerEl, 'button', 'grimoire-source-card');
      buttonEl.type = 'button';
      buttonEl.title = source.path;
      buttonEl.dataset.sourceKind = source.kind;

      const dotEl = this.createChild(buttonEl, 'span', 'grimoire-source-card-dot');
      dotEl.setAttribute('aria-hidden', 'true');

      const titleEl = this.createChild(buttonEl, 'strong', 'grimoire-source-card-title');
      titleEl.textContent = source.title || source.path;

      const pathEl = this.createChild(buttonEl, 'span', 'grimoire-source-card-path');
      pathEl.textContent = source.detail;

      if (source.badge) {
        const scoreEl = this.createChild(buttonEl, 'span', 'grimoire-source-card-score');
        scoreEl.textContent = source.badge;
        // A percentage can be drawn as well as read: the row shows a line filled
        // to the score. A badge that is a word — "current" — has no line.
        const percent = /^(\d{1,3})\s*%$/.exec(source.badge);
        if (percent) {
          scoreEl.style.setProperty('--grimoire-source-score', percent[1]);
        }
      }

      buttonEl.addEventListener('click', () => this.openVaultPath(source.path));
    }

    const overflowCount = visibleSources.length - renderedSources.length;
    if (overflowCount > 0) {
      const moreEl = this.createChild(this.containerEl, 'div', 'grimoire-source-more');
      moreEl.textContent = t('chat.ui.view.moreNotes', { count: overflowCount });
      moreEl.title = visibleSources.slice(MAX_VISIBLE_RELEVANT_NOTES)
        .map(source => source.title || source.path)
        .join('\n');
    }
  }

  destroy(): void {
    for (const cleanup of this.eventCleanups.splice(0)) {
      cleanup();
    }
    this.containerEl.replaceChildren();
    this.containerEl.classList.remove('grimoire-source-card-stack');
  }

  private bindFilterControls(): void {
    const filtersEl = this.controls.filtersEl;
    if (!filtersEl) {
      return;
    }

    for (const button of this.getFilterButtons(filtersEl)) {
      const filter = this.parseFilter(button.dataset.sourceFilter);
      if (!filter) {
        continue;
      }
      const onClick = (): void => {
        this.filter = filter;
        this.syncFilterButtons();
        this.renderFiltered();
      };
      button.addEventListener('click', onClick);
      this.eventCleanups.push(() => button.removeEventListener('click', onClick));
    }
    this.syncFilterButtons();
  }

  private getFilterButtons(filtersEl: HTMLElement): HTMLButtonElement[] {
    return Array.from(filtersEl.querySelectorAll('[data-source-filter]'))
      .filter(isButtonElement);
  }

  private getVisibleSources(): Array<{
    badge: string;
    detail: string;
    kind: RelevantNotesSourceFilter;
    path: string;
    title: string;
  }> {
    const currentSources = this.currentSources.map(source => ({
      ...source,
      kind: 'current' as const,
    }));
    const linkedSources = this.linkedNotes.map(note => ({
      badge: this.formatScore(note.score) ?? '',
      detail: note.path,
      kind: 'linked' as const,
      path: note.path,
      title: note.title || note.path,
    }));

    if (this.filter === 'current') {
      return currentSources;
    }
    if (this.filter === 'linked') {
      return linkedSources;
    }
    return [...currentSources, ...linkedSources];
  }

  private parseFilter(value: string | undefined): RelevantNotesSourceFilter | null {
    return value === 'all' || value === 'linked' || value === 'current'
      ? value
      : null;
  }

  private syncFilterButtons(): void {
    const filtersEl = this.controls.filtersEl;
    if (!filtersEl) {
      return;
    }
    for (const button of this.getFilterButtons(filtersEl)) {
      const isActive = button.dataset.sourceFilter === this.filter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  private updateShownCount(count: number): void {
    if (!this.controls.shownCountEl) {
      return;
    }
    this.controls.shownCountEl.textContent = t('chat.ui.view.shownCount', { count });
  }

  private createChild<K extends keyof HTMLElementTagNameMap>(
    parentEl: HTMLElement,
    tagName: K,
    className: string,
  ): HTMLElementTagNameMap[K] {
    return parentEl.createEl(tagName, { cls: className });
  }

  private formatScore(score: number): string | null {
    if (!Number.isFinite(score)) {
      return null;
    }

    const percent = score <= 1 ? score * 100 : score;
    const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
    return t('chat.ui.view.matchScore', { percent: clampedPercent });
  }
}
