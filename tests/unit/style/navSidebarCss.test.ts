import { readFileSync } from 'fs';

function readNavigationCss(): string {
  return readFileSync('src/style/components/nav-sidebar.css', 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('nav-sidebar.css', () => {
  it('anchors the conversation navigator to the chat viewport', () => {
    const css = readNavigationCss();

    expect(getRule(css, '.grimoire-chat-window-grid')).toContain('position: relative');
    expect(getRule(css, '.grimoire-nav-sidebar')).toContain('position: absolute');
    expect(getRule(css, '.grimoire-nav-sidebar.visible')).toContain('pointer-events: auto');
  });

  it('uses theme surfaces for the compact conversation directory', () => {
    const css = readNavigationCss();
    const directory = getRule(css, '.grimoire-nav-directory');

    expect(directory).toContain('background: var(--background-secondary)');
    expect(directory).toContain('border: 1px solid var(--background-modifier-border)');
    expect(directory).toContain('box-shadow: var(--grimoire-lift-2)');
  });

  it('keeps the outline button visible and accents it while open', () => {
    const css = readNavigationCss();

    expect(getRule(css, '.grimoire-nav-btn-directory')).toContain('opacity: 0.48');
    expect(getRule(css, '.grimoire-nav-btn-directory[aria-expanded="true"]')).toContain(
      'color: var(--grimoire-accent)',
    );
  });

  it('styles numbered outline rows with a clear current prompt', () => {
    const css = readNavigationCss();

    expect(getRule(css, '.grimoire-nav-directory-item')).toContain('grid-template-columns: 30px minmax(0, 1fr)');
    expect(getRule(css, '.grimoire-nav-directory-item.is-active .grimoire-nav-directory-number')).toContain(
      'color: var(--grimoire-accent)',
    );
  });

  it('keeps the thread outline compact', () => {
    const css = readNavigationCss();
    const directory = getRule(css, '.grimoire-nav-directory');
    const row = getRule(css, '.grimoire-nav-directory-item');

    expect(directory).toContain('width: min(280px, calc(100% - 56px))');
    expect(directory).toContain('padding: var(--grimoire-space-4) var(--grimoire-space-5)');
    expect(row).toContain('min-height: 30px');
    expect(row).toContain('padding: var(--grimoire-space-1) var(--grimoire-space-3)');
  });
});
