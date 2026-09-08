import { setIcon, setTooltip } from 'obsidian';

import type { TitleSource } from '../../../core/types';
import { t } from '../../../i18n/i18n';

/**
 * The mark that says who wrote the title being shown.
 *
 * Two marks, not three. The mark answers «who named this», and for the
 * placeholder cut from the first message the answer is nobody — so its absence
 * is the answer. A third glyph standing for «no one» was one mark too many and
 * read as neither; the history row already draws the regenerate control on
 * exactly those rows, and the tab's own label names the placeholder in words.
 *
 * The shape carries the meaning and the colour carries none: both are drawn in
 * `--grimoire-ink-muted`, the way provider identity is. A state told apart by
 * hue alone is one a reader with a colour deficiency cannot read and a reader
 * who has not learnt the palette cannot name — and the first draft of this,
 * which used `--grimoire-ok` against `--grimoire-accent-text`, drew the same
 * mark twice in any vault whose accent is green. The element carries its
 * meaning as text besides: an `aria-label` and a tooltip naming the source.
 *
 * The tab bar itself is deliberately not a caller — a badge is a number, and
 * the name it stands for is announced through its own label.
 */
function titleSourceMark(
  source: TitleSource,
): { readonly icon: string; readonly label: string } | null {
  switch (source) {
    case 'fallback':
      return null;
    // The mark the rename dialog's own «suggest a title» button already carries.
    case 'model':
      return { icon: 'sparkles', label: t('chat.ui.history.titleSourceModel') };
    // The mark the rename action already carries.
    case 'manual':
      return { icon: 'pencil', label: t('chat.ui.history.titleSourceManual') };
  }
}

/** Appends the mark to `parent`. A source with no mark, or none recorded, gets nothing. */
export function appendTitleSourceMark(
  parent: HTMLElement | DocumentFragment,
  source: TitleSource | undefined,
): HTMLElement | null {
  const mark = source ? titleSourceMark(source) : null;
  if (!mark) return null;

  // Through the parent when it offers the helper, which is how a span is made
  // everywhere else in this codebase, and through the global otherwise: a
  // `DocumentFragment` is a caller too, and only one of the two answers both.
  const cls = `grimoire-title-source grimoire-title-source-${source}`;
  const host = parent as Partial<HTMLElement>;
  const el = typeof host.createSpan === 'function'
    ? host.createSpan({ cls })
    : createSpan({ cls });
  setIcon(el, mark.icon);
  el.setAttribute('aria-label', mark.label);
  setTooltip(el, mark.label, { placement: 'top' });
  if (el.parentNode !== parent) parent.appendChild(el);
  return el;
}
