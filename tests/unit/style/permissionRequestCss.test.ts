import { readFileSync } from 'fs';

function getRule(css: string, selector: string): string {
  for (const block of css.split('}')) {
    const [selectors, declarations] = block.split('{');
    if (selectors?.trim() === selector) return declarations ?? '';
  }
  return '';
}

describe('permission request CSS', () => {
  const css = readFileSync('src/style/features/ask-user-question.css', 'utf8');

  it('keeps decisions as a flat list rather than filled cards', () => {
    const row = getRule(css, '.grimoire-permission-actions > button.grimoire-permission-button');
    expect(row).toContain('height: 34px');
    expect(row).toContain('border: 0');
    expect(row).toContain('border-radius: var(--grimoire-radius-1)');
    expect(row).toContain('background-color: transparent');
    expect(row).toContain('box-shadow: none');
  });

  it('uses the branded permission shell and accents only safe action icons', () => {
    const card = getRule(css, '.grimoire-permission-request');
    expect(card).toContain('border-radius: var(--grimoire-radius-3)');
    expect(card).toContain('var(--grimoire-brand) 2%');
    expect(getRule(css, '.grimoire-permission-request::before'))
      .toContain('var(--grimoire-accent-line-strong)');
    expect(getRule(css, '.grimoire-permission-shield')).toContain('var(--grimoire-accent-soft)');
    expect(getRule(css, '.grimoire-permission-tool')).toContain('border-radius: var(--grimoire-radius-pill)');
    const target = getRule(css, '.grimoire-permission-target');
    expect(target).toContain('background: var(--grimoire-sink)');
    expect(target).toContain('box-shadow: inset 2px 0 0 var(--grimoire-accent-line)');
    const safeIcon = getRule(
      css,
      '.grimoire-permission-actions > .grimoire-permission-button:not(.grimoire-permission-button--reject)\n  .grimoire-permission-button-icon',
    );
    expect(safeIcon).toContain('color: var(--grimoire-accent-text)');
  });

  it('keeps shortcuts plain and separates reject from safe decisions', () => {
    const shortcut = getRule(css, '.grimoire-permission-button-shortcut');
    expect(shortcut).toContain('border: 0');
    expect(shortcut).toContain('background: transparent');

    const rejectDivider = getRule(css, '.grimoire-permission-actions > .grimoire-permission-button--reject::before');
    expect(rejectDivider).toContain('border-top: 1px solid var(--grimoire-line-2)');
  });

  it('wraps full permission tool names instead of clipping them', () => {
    const tool = getRule(css, '.grimoire-permission-tool');
    const label = getRule(css, '.grimoire-permission-tool-label');

    expect(tool).toContain('min-height: 22px');
    expect(tool).toContain('white-space: normal');
    expect(label).toContain('overflow-wrap: anywhere');
    expect(label).not.toContain('text-overflow: ellipsis');
  });

  it('keeps every permission decision scroll-reachable in short panes', () => {
    const card = getRule(css, '.grimoire-permission-request');
    const actions = getRule(css, '.grimoire-permission-actions');

    expect(card).toContain('grid-template-rows: auto minmax(0, 1fr) minmax(0, auto)');
    expect(actions).toContain('min-height: 0');
    expect(actions).toContain('max-height: min(38vh, 250px)');
    expect(actions).toContain('overflow-y: auto');
    expect(actions).toContain('scrollbar-width: thin');
  });
});
