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

    expect(composerRule).toContain('padding: var(--grimoire-space-3) var(--grimoire-window-padding-x) var(--grimoire-space-1)');
  });

  it('keeps source filter buttons visually flat except the active state', () => {
    const css = readContainerCss();

    const baseRule = getRuleIncludingSelector(css, '.grimoire-source-filters button.grimoire-source-filter');
    expect(baseRule).toContain('appearance: none');
    expect(baseRule).toContain('border: 0');
    expect(baseRule).toContain('box-shadow: none');

    const hoverRule = getRuleIncludingSelector(css, '.grimoire-source-filters button.grimoire-source-filter:hover');
    expect(hoverRule).toContain('box-shadow: none');

    const activeRule = getRuleIncludingSelector(css, '.grimoire-source-filters button.grimoire-source-filter.is-active');
    expect(activeRule).toContain('background: var(--grimoire-accent-soft)');
    expect(activeRule).toContain('box-shadow: inset 0 0 0 1px var(--grimoire-accent-line)');
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
