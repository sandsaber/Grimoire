import { setIcon } from 'obsidian';

import { markDecorative } from '../../../shared/components/activatable';

/**
 * How long a turn took, drawn as a clock and a duration.
 *
 * It replaced "* Roasted for 19s" — a random flavour word set in italics, which
 * named the wait as a joke and made the one fact in the footer the hardest part
 * of it to read. The clock says what the number is; the number is mono, like
 * every other machine-written value in the transcript.
 */
export function appendTurnDuration(footerEl: HTMLElement, duration: string): HTMLElement {
  const durationEl = footerEl.createSpan({ cls: 'grimoire-baked-duration' });
  const iconEl = durationEl.createSpan({ cls: 'grimoire-baked-duration-icon' });
  setIcon(iconEl, 'clock');
  markDecorative(iconEl);
  durationEl.createSpan({ cls: 'grimoire-baked-duration-value', text: duration });
  return durationEl;
}
