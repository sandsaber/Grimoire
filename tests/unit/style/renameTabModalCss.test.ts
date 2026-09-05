import { readFileSync } from 'fs';

function readCss(): string {
  return readFileSync('src/style/modals/rename-tab.css', 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

describe('rename-tab.css', () => {
  it('keeps the field prominent and the footer compact', () => {
    const css = readCss();

    expect(getRule(css, '.grimoire-rename-tab-modal')).toContain('width: min(520px, calc(100vw - 32px))');
    expect(getRule(css, '.grimoire-rename-tab-field')).toContain('position: relative');
    expect(getRule(css, '.grimoire-rename-tab-field:focus-within')).toContain(
      'border-color: var(--interactive-accent)',
    );
    expect(getRule(css, '.grimoire-rename-tab-footer')).toContain('justify-content: space-between');
  });

  it('lets the flex row, not input padding, reserve space for the field controls', () => {
    const css = readCss();

    // A Chromium input paints its overflowing text across its own padding box, so
    // padding cannot keep a long title off the controls: they must be flex siblings.
    const input = getRule(css, '.grimoire-rename-tab-input');
    expect(input).toContain('flex: 1 1 auto');
    expect(input).not.toContain('78px');

    for (const selector of ['button.grimoire-rename-tab-reset', 'button.grimoire-rename-tab-suggest']) {
      const rule = getRule(css, selector);
      expect(rule).not.toContain('position: absolute');
      expect(rule).toContain('flex: 0 0 auto');
    }
  });

  it('dims the suggest control while it is disabled or loading', () => {
    const css = readCss();

    expect(getRule(css, 'button.grimoire-rename-tab-suggest:disabled')).toContain('opacity: 0.45');
    expect(getRule(css, 'button.grimoire-rename-tab-suggest.is-loading svg')).toContain('animation:');
  });
});
