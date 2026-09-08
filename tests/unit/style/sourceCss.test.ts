import { readFileSync } from 'fs';

function readContainerCss(): string {
  return readFileSync('src/style/base/container.css', 'utf8');
}

function getRuleIncludingSelector(css: string, selector: string): string {
  for (const block of css.split('}')) {
    const [selectors, declarations] = block.split('{');
    if (!selectors || !declarations) continue;
    if (selectors.split(',').map(value => value.trim()).includes(selector)) {
      return declarations;
    }
  }
  return '';
}

describe('container.css source controls', () => {
  it('keeps the composer bottom gutter visually compact', () => {
    const composerRule = getRuleIncludingSelector(readContainerCss(), '.grimoire-composer-surface');

    expect(composerRule).toContain('padding: var(--grimoire-space-8) var(--grimoire-window-padding-x) var(--grimoire-space-12)');
  });

  it('underlines the chosen source filter rather than filling it', () => {
    const css = readContainerCss();

    // Three words, not three buttons the width of the panel: the accent marks
    // the chosen one the way it marks a tab.
    const baseRule = getRuleIncludingSelector(css, '.grimoire-source-filters button.grimoire-source-filter');
    expect(baseRule).toContain('appearance: none');
    expect(baseRule).toContain('border-bottom: 1.5px solid transparent');
    expect(baseRule).toContain('background: none');
    expect(baseRule).toContain('box-shadow: none');

    const activeRule = getRuleIncludingSelector(css, '.grimoire-source-filters button.grimoire-source-filter.is-active');
    expect(activeRule).toContain('border-bottom-color: var(--grimoire-accent)');
    expect(activeRule).toContain('background: none');
    expect(activeRule).toContain('box-shadow: none');
  });

  it('keeps source rows from inheriting native button chrome', () => {
    const css = readContainerCss();

    const cardRule = getRuleIncludingSelector(css, '.grimoire-source-card-stack button.grimoire-source-card');
    expect(cardRule).toContain('appearance: none');
    expect(cardRule).toContain('background: transparent');
    expect(cardRule).toContain('box-shadow: none');

    const hoverRule = getRuleIncludingSelector(css, '.grimoire-source-card-stack button.grimoire-source-card:hover');
    expect(hoverRule).toContain('box-shadow: none');
  });
});
