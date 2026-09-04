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
      'border-color: var(--grimoire-accent)',
    );
    expect(getRule(css, '.grimoire-rename-tab-footer')).toContain('justify-content: space-between');
  });

  it('reserves input space for the reset control', () => {
    const css = readCss();

    expect(getRule(css, '.grimoire-rename-tab-input')).toContain('padding: 0 40px 0 var(--grimoire-space-5)');
    expect(getRule(css, 'button.grimoire-rename-tab-reset')).toContain('position: absolute');
  });
});
