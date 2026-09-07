import { readFileSync } from 'fs';

function getRule(css: string, selector: string): string {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of bare.split('}')) {
    const [selectors, declarations] = block.split('{');
    if (selectors?.trim() === selector) return declarations ?? '';
  }
  return '';
}

describe('permission request CSS', () => {
  const css = readFileSync('src/style/features/ask-user-question.css', 'utf8');

  it('wears the shape every other decision wears', () => {
    // It was the odd one out: a raised panel tinted 2% accent with an accent
    // hairline across its top, a 30px tinted tile around the shield and a
    // banded header. Screen 2d has one card, and this is it.
    const card = getRule(css, '.grimoire-permission-request');
    expect(card).toContain('border: 1px solid var(--grimoire-line)');
    expect(card).toContain('border-radius: var(--grimoire-radius-2)');
    expect(card).toContain('background: var(--grimoire-ground)');
    expect(card).toContain('box-shadow: var(--grimoire-lift-0)');
    expect(css).not.toContain('.grimoire-permission-request::before');

    const shield = getRule(css, '.grimoire-permission-shield');
    expect(shield).toContain('width: var(--grimoire-icon-l)');
    expect(shield).toContain('background: none');
    expect(shield).toContain('box-shadow: none');
    expect(shield).toContain('color: var(--grimoire-accent)');

    const head = getRule(css, '.grimoire-permission-head');
    expect(head).toContain('border-bottom: 0');
    expect(head).toContain('background: none');
  });

  it('numbers the choices and marks one with the accent rule, not a glyph', () => {
    const row = getRule(css, '.grimoire-permission-actions > button.grimoire-permission-button');
    expect(row).toContain('min-height: 34px');
    expect(row).toContain('border-inline-start: 1.5px solid transparent');
    expect(row).toContain('background-color: transparent');
    expect(row).toContain('box-shadow: none');

    const chosen = getRule(
      css,
      '.grimoire-permission-actions > button.grimoire-permission-button:hover,\n.grimoire-permission-actions > button.grimoire-permission-button:focus-visible',
    );
    expect(chosen).toContain('border-inline-start-color: var(--grimoire-accent)');
    expect(chosen).toContain('background-color: var(--grimoire-hover)');

    // The key that answers a row, in the meta type, in a column of its own.
    const key = getRule(css, '.grimoire-permission-button-key');
    expect(key).toContain('font-family: var(--grimoire-mono)');
    expect(key).toContain('font-size: var(--grimoire-text-2xs)');
    expect(key).toContain('color: var(--grimoire-ink-faint)');

    // No accent glyph column, and no rule under every row.
    expect(css).not.toContain('.grimoire-permission-button-icon');
    expect(css).not.toContain('.grimoire-permission-button--reject::before');
  });

  it('shows what each choice costs instead of hiding it', () => {
    // The descriptions were rendered and then set to display:none, so three
    // near-identical verbs stood alone.
    const description = getRule(css, '.grimoire-permission-option-description');
    expect(description).toContain('color: var(--grimoire-ink-muted)');
    expect(description).not.toContain('display: none');
    expect(getRule(css, '.grimoire-permission-button-shortcut')).toContain('display: none');
  });

  it('names the tool in the meta type without a pill or a percentage cap', () => {
    const tool = getRule(css, '.grimoire-permission-tool');
    const label = getRule(css, '.grimoire-permission-tool-label');

    expect(tool).toContain('background: none');
    expect(tool).toContain('color: var(--grimoire-ink-faint)');
    expect(tool).toContain('font-family: var(--grimoire-mono)');
    // A percentage max-width on a grid item makes Chrome compute the item's
    // max-content contribution as zero: the track collapsed and "Bash" broke
    // into one letter per line.
    expect(tool).not.toMatch(/max-width:\s*\d+%/);
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
