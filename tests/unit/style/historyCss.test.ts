import { readFileSync } from 'fs';

function readHistoryCss(): string {
  return readFileSync('src/style/components/history.css', 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('history.css', () => {
  it('hangs history off the control that opened it, not over the conversation', () => {
    const css = readHistoryCss();

    // It was a sheet inset 13px on all four sides, so looking for another
    // conversation meant losing sight of this one.
    const menuRule = getRule(css, '.grimoire-history-menu');
    expect(menuRule).toContain('position: absolute');
    expect(menuRule).toContain('top: calc(var(--grimoire-header-h) + var(--grimoire-space-4))');
    expect(menuRule).toContain('right: var(--grimoire-space-8)');
    expect(menuRule).toContain('bottom: auto');
    expect(menuRule).toContain('left: auto');
    expect(menuRule).toContain('width: min(320px, calc(100% - var(--grimoire-space-16)))');
    expect(menuRule).toContain('box-shadow: var(--grimoire-lift-1)');
    expect(getRule(css, '.grimoire-history-menu.visible')).toContain('display: grid');
    // No header band, so no close button in one: the panel opens on its search
    // row and closes on an outside click or Escape.
    expect(css).not.toContain('.grimoire-history-close');
    expect(getRule(css, '.grimoire-history-footer')).toContain('border-top: 1px solid var(--grimoire-line)');
    expect(css).not.toContain('.grimoire-history-btn[aria-expanded="true"]');
  });

  it('marks the open conversation with a rule rather than a fill', () => {
    const css = readHistoryCss();

    const rowRule = getRule(css, '.grimoire-history-item');
    expect(rowRule).toContain('height: 36px');
    expect(rowRule).toContain('border-left: 1.5px solid transparent');
    expect(getRule(css, '.grimoire-history-item.active'))
      .toContain('border-left-color: var(--grimoire-accent)');
    // Open in another tab is the same rule at the accent's border weight, not
    // the hover ground: a row nobody was pointing at looked pointed at.
    const openElsewhere = getRule(css, '.grimoire-history-item.is-open:not(.active)');
    expect(openElsewhere).toContain('border-left-color: var(--grimoire-accent-line)');
    expect(openElsewhere).toContain('background: transparent');
  });

  it('styles the redesigned search and grouped history list', () => {
    const css = readHistoryCss();

    expect(getRule(css, '.grimoire-history-search')).toContain('display: flex');
    expect(getRule(css, '.grimoire-history-group')).toContain('display: grid');
    expect(css).not.toContain('.grimoire-history-provider-dot');
  });

  it('reveals history actions without changing row width', () => {
    const css = readHistoryCss();

    const actionsRule = getRule(css, '.grimoire-history-item-actions');
    expect(actionsRule).toContain('position: absolute');
    expect(actionsRule).toContain('opacity: 0');
    expect(getRule(css, '.grimoire-history-item:hover .grimoire-history-item-actions')).toContain('opacity: 1');
    expect(getRule(css, '.grimoire-history-item:hover .grimoire-history-item-time')).toContain('opacity: 0');
  });

  it('keeps new-tab controls in the same hover action row as rename', () => {
    const css = readHistoryCss();

    expect(css).not.toContain('.grimoire-history-quick-open');
    expect(css).not.toContain('.grimoire-history-item.has-quick-open');
    expect(getRule(css, '.grimoire-history-item-actions')).toContain('right: 8px');
  });
});
