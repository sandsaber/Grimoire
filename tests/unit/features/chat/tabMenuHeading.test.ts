/**
 * @jest-environment jsdom
 */
import { setTooltip } from 'obsidian';

import { truncateTitleOnWordBoundary } from '@/core/prompt/titleLength';
import { buildTabMenuHeading, MAX_TAB_MENU_HEADING_LENGTH } from '@/features/chat/GrimoireView';

const LONG_TITLE = 'Объяснить логику системного промпта и генерации заголовков Grimoire';

describe('buildTabMenuHeading', () => {
  it('passes a short title through untouched', () => {
    expect(buildTabMenuHeading('Объяснить логику Grimoire')).toBe('Объяснить логику Grimoire');
  });

  it('keeps a title of exactly the budget intact', () => {
    const exact = 'x'.repeat(MAX_TAB_MENU_HEADING_LENGTH);

    expect(buildTabMenuHeading(exact)).toBe(exact);
  });

  it('shortens a longer title to the budget', () => {
    const heading = buildTabMenuHeading(LONG_TITLE) as DocumentFragment;
    const shown = heading.textContent ?? '';

    expect(shown.length).toBeLessThanOrEqual(MAX_TAB_MENU_HEADING_LENGTH);
    expect(shown.endsWith('...')).toBe(true);
    expect(LONG_TITLE.startsWith(shown.slice(0, -3))).toBe(true);
  });

  it('cuts the same way every other shortened title is cut', () => {
    const heading = buildTabMenuHeading(LONG_TITLE) as DocumentFragment;

    expect(heading.textContent).toBe(
      truncateTitleOnWordBoundary(LONG_TITLE, MAX_TAB_MENU_HEADING_LENGTH),
    );
  });

  it('never cuts through a surrogate pair', () => {
    // The budget lands inside the emoji: a raw slice would leave its leading half behind.
    const withEmoji = `${'x'.repeat(MAX_TAB_MENU_HEADING_LENGTH - 2)}\u{1F600} and more text`;
    const heading = buildTabMenuHeading(withEmoji) as DocumentFragment;
    const shown = heading.textContent ?? '';

    expect(shown).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('still exposes the whole name through the accessible label and tooltip', () => {
    (setTooltip as jest.Mock).mockClear();

    const heading = buildTabMenuHeading(LONG_TITLE) as DocumentFragment;
    const span = heading.firstElementChild;

    expect(span?.getAttribute('aria-label')).toBe(LONG_TITLE);
    expect(setTooltip).toHaveBeenCalledWith(span, LONG_TITLE, expect.anything());
  });
});
