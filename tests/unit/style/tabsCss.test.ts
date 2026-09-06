import { readFileSync } from 'fs';

function readTabsCss(): string {
  return readFileSync('src/style/components/tabs.css', 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

describe('tabs.css', () => {
  it('shows an activity dot without replacing the tab number', () => {
    const css = readTabsCss();
    const normalizedCss = css.replace(/\r\n/g, '\n');

    expect(getRule(css, '.grimoire-tab-activity-dot')).toContain('display: none');
    expect(normalizedCss).toContain(`.grimoire-tab-badge-streaming .grimoire-tab-activity-dot,
.grimoire-tab-badge-attention .grimoire-tab-activity-dot {
  display: block;
}`);
    // The dot says a tab is working, not which vendor is doing the work: status
    // is the accent, and identity never a hue.
    expect(css).not.toContain('[data-provider=');
    expect(getRule(css, '.grimoire-tab-number')).toContain('display: inline-flex');
  });

  it('keeps the six-second undo toast inside the panel edge', () => {
    const css = readTabsCss();

    const stackRule = getRule(css, '.grimoire-tab-close-toast-stack');
    expect(stackRule).toContain('right: 12px');
    expect(stackRule).toContain('bottom: 12px');
    expect(stackRule).toContain('left: 12px');
    expect(getRule(css, '.grimoire-tab-close-toast-progress'))
      .toContain('animation: grimoire-tab-close-toast-countdown 6s linear forwards');
    expect(getRule(css, '.grimoire-tab-close-toast-separator'))
      .toContain('color: var(--text-muted)');
  });

  it('draws a panel segment as a glyph, and the active one as a wash and a word', () => {
    const css = readTabsCss();

    const baseRule = getRule(css, '.grimoire-panel-tabs button.grimoire-panel-tab');
    expect(baseRule).toContain('appearance: none');
    expect(baseRule).toContain('border: 0');
    expect(baseRule).toContain('background: transparent');
    expect(baseRule).toContain('box-shadow: none');
    expect(baseRule).toContain('height: var(--grimoire-segment-h)');

    expect(getRule(css, '.grimoire-panel-tabs button.grimoire-panel-tab:hover'))
      .toContain('background: var(--grimoire-hover)');

    const activeRule = getRule(css, '.grimoire-panel-tabs button.grimoire-panel-tab.is-active');
    expect(activeRule).toContain('background: var(--grimoire-hover)');
    expect(activeRule).toContain('font-weight: var(--grimoire-weight-medium)');
    expect(activeRule).toContain('box-shadow: none');
  });

  it('shows a segment its word when it is the one the reader is in, or when asked', () => {
    const css = readTabsCss();

    expect(getRule(css, '.grimoire-panel-tab-label')).toContain('display: none');
    expect(css).toContain(`.grimoire-panel-tab.is-active .grimoire-panel-tab-label,
.grimoire-panel-switch--labelled .grimoire-panel-tab-label {
  display: inline;
}`);
  });
});
