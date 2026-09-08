import { setIcon, setTooltip } from 'obsidian';

import type { TitleSource } from '../../../core/types';
import { t } from '../../../i18n/i18n';

/**
 * The mark that says who wrote the title being shown.
 *
 * One helper because the mark appears next to every rendering of a tab's name —
 * the context-menu heading, the history row, the rename dialog — and three
 * copies of «which mark means what» is three places to disagree.
 *
 * The shape carries the meaning and the colour carries none: all three are
 * drawn in `--grimoire-ink-muted`, the way provider identity is. A state told
 * apart by hue alone is one a reader with a colour deficiency cannot read and a
 * reader who has not learnt the palette cannot name — and it would have failed
 * outright in a vault whose accent is green, where `--grimoire-ok` and
 * `--grimoire-accent-text` are the same colour. The element carries the same
 * meaning as text besides: an `aria-label` and a tooltip naming the source.
 *
 * The tab bar itself is deliberately not a caller — a badge is a number, and
 * the name it stands for is announced through its own label.
 */
const TITLE_SOURCE_ICONS: Readonly<Record<TitleSource, string>> = {
  // An outline not yet filled in: a placeholder is the absence of a title.
  fallback: 'circle-dashed',
  // The same mark the rename dialog's «suggest a title» button carries.
  model: 'sparkles',
  // The same mark the rename action carries.
  manual: 'pencil',
};

export function titleSourceLabel(source: TitleSource): string {
  switch (source) {
    case 'fallback': return t('chat.ui.history.titleSourceFallback');
    case 'model': return t('chat.ui.history.titleSourceModel');
    case 'manual': return t('chat.ui.history.titleSourceManual');
  }
}

/** Appends the marker to `parent`. A conversation with no recorded source gets nothing. */
export function appendTitleSourceMark(
  parent: HTMLElement | DocumentFragment,
  source: TitleSource | undefined,
): HTMLElement | null {
  if (!source) return null;

  // Through the parent when it offers the helper, which is how a span is made
  // everywhere else in this codebase, and through the global otherwise: a
  // `DocumentFragment` is a caller too, and only one of the two answers both.
  const cls = `grimoire-title-source grimoire-title-source-${source}`;
  const host = parent as Partial<HTMLElement>;
  const el = typeof host.createSpan === 'function'
    ? host.createSpan({ cls })
    : createSpan({ cls });
  setIcon(el, TITLE_SOURCE_ICONS[source]);
  const label = titleSourceLabel(source);
  el.setAttribute('aria-label', label);
  setTooltip(el, label, { placement: 'top' });
  if (el.parentNode !== parent) parent.appendChild(el);
  return el;
}
