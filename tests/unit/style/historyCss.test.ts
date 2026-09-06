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
  it('opens history as a full chat-pane sheet', () => {
    const css = readHistoryCss();

    const menuRule = getRule(css, '.grimoire-history-menu');
    expect(menuRule).toContain('position: absolute');
    expect(menuRule).toContain('left: 13px');
    expect(menuRule).toContain('right: 13px');
    expect(menuRule).toContain('top: 13px');
    expect(menuRule).toContain('bottom: 13px');
    expect(getRule(css, '.grimoire-history-menu.visible')).toContain('display: grid');
    expect(getRule(css, '.grimoire-history-close')).toContain('display: inline-grid');
    expect(css).not.toContain('.grimoire-history-btn[aria-expanded="true"]');
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
