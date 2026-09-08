import { setIcon } from 'obsidian';

import type { ChangelogRelease } from '../../app/changelog/types';
import { t } from '../../i18n/i18n';
import { markDecorative } from '../components/activatable';

export interface RenderWhatsNewCardOptions {
  release: ChangelogRelease;
  onDismiss: () => void | Promise<void>;
  fullChangelogUrl?: string;
}

export function renderWhatsNewCard(
  containerEl: HTMLElement,
  options: RenderWhatsNewCardOptions,
): void {
  if (containerEl.querySelector('.grimoire-whats-new-card')) {
    return;
  }

  const { release, onDismiss, fullChangelogUrl } = options;
  const cardEl = containerEl.createDiv({ cls: 'grimoire-whats-new-card' });
  const headerEl = cardEl.createDiv({ cls: 'grimoire-whats-new-card-header' });
  const titleBlockEl = headerEl.createDiv({ cls: 'grimoire-whats-new-card-title-block' });
  titleBlockEl.createDiv({
    cls: 'grimoire-whats-new-card-title',
    text: t('shared.whatsNew.title', { version: release.version }),
  });
  titleBlockEl.createDiv({
    cls: 'grimoire-whats-new-card-summary',
    text: release.date
      ? t('shared.whatsNew.released', { date: release.date })
      : t('shared.whatsNew.latestReleaseNotes'),
  });

  // A close glyph, not the word "Got it" in a frame: the card is an aside, and
  // the release it announces stays one link away, so dismissing costs nothing.
  const dismissButton = headerEl.createEl('button', {
    cls: 'grimoire-whats-new-card-dismiss',
    attr: {
      type: 'button',
      'aria-label': t('shared.whatsNew.gotIt'),
    },
  });
  const dismissGlyph = dismissButton.createSpan({ cls: 'grimoire-whats-new-card-dismiss-icon' });
  setIcon(dismissGlyph, 'x');
  markDecorative(dismissGlyph);

  const listEl = cardEl.createDiv({
    cls: 'grimoire-whats-new-card-list',
    attr: {
      role: 'region',
      tabindex: '0',
      'aria-label': t('shared.whatsNew.latestReleaseNotes'),
    },
  });
  for (const category of release.categories) {
    const sectionEl = listEl.createDiv({ cls: 'grimoire-whats-new-card-section' });
    sectionEl.createDiv({ cls: 'grimoire-whats-new-card-section-title', text: category.title });
    const itemsEl = sectionEl.createEl('ul', { cls: 'grimoire-whats-new-card-items' });
    for (const item of category.items) {
      itemsEl.createEl('li', { cls: 'grimoire-whats-new-card-item', text: item });
    }
  }

  // The way out of the card sits after what it says, not beside its title: it is
  // where a reader arrives once they have read the list, not a header control.
  if (fullChangelogUrl) {
    cardEl.createEl('a', {
      cls: 'grimoire-whats-new-card-link',
      text: t('shared.whatsNew.fullChangelog'),
      attr: {
        href: fullChangelogUrl,
        rel: 'noopener',
        target: '_blank',
      },
    });
  }

  let dismissing = false;
  dismissButton.addEventListener('click', () => {
    if (dismissing) {
      return;
    }
    dismissing = true;
    void Promise.resolve(onDismiss())
      .catch(() => undefined)
      .finally(() => {
        containerEl.empty();
      });
  });
}
