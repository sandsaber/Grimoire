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
  it('puts the transcript controls in the chrome rather than over the transcript', () => {
    const css = readNavigationCss();
    const rail = getRule(css, '.grimoire-nav-sidebar');

    // They used to float over the column as translucent circles at 16%
    // opacity: a control that hides from the reader and then appears on top of
    // what they are reading.
    expect(rail).not.toContain('position: absolute');
    expect(rail).toContain('display: flex');
    expect(css).not.toContain('opacity: 0.16');
    expect(css).not.toContain('transform: scale');
  });

  it('weighs the controls the same as every other repeating control', () => {
    const css = readNavigationCss();
    const button = getRule(css, '.grimoire-nav-btn');

    expect(button).toContain('width: var(--grimoire-hit-m)');
    expect(button).toContain('height: var(--grimoire-hit-m)');
    expect(button).toContain('border-radius: var(--grimoire-radius-1)');
    expect(button).toContain('background: none');
    expect(getRule(css, '.grimoire-nav-btn svg')).toContain('width: var(--grimoire-icon-m)');
  });

  it('lifts the outline off the panel switch that opened it', () => {
    const css = readNavigationCss();
    const directory = getRule(css, '.grimoire-nav-directory');

    // A popover is one of the few surfaces in the system with a shadow, and it
    // hangs off the control that opened it.
    expect(directory).toContain('position: absolute');
    expect(directory).toContain('top: calc(100% + var(--grimoire-space-4))');
    expect(directory).toContain('background: var(--grimoire-ground)');
    expect(directory).toContain('border: 1px solid var(--grimoire-line)');
    expect(directory).toContain('box-shadow: var(--grimoire-lift-1)');
  });

  it('marks the reader position with a rule rather than a wash of accent', () => {
    const css = readNavigationCss();
    const row = getRule(css, '.grimoire-nav-directory-item');
    const active = getRule(css, '.grimoire-nav-directory-item.is-active');

    expect(row).toContain('height: var(--grimoire-list-row-h)');
    expect(active).toContain('box-shadow: inset 1.5px 0 0 var(--grimoire-accent)');
  });

  it('sets the outline label in the system\'s uppercase monospace micro-label', () => {
    const css = readNavigationCss();
    const title = getRule(css, '.grimoire-nav-directory-title');

    expect(title).toContain('font-family: var(--grimoire-mono)');
    expect(title).toContain('font-size: var(--grimoire-text-2xs)');
    expect(title).toContain('letter-spacing: var(--grimoire-label-tracking)');
    expect(title).toContain('text-transform: uppercase');
  });
});
