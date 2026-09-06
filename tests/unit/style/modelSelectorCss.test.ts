import { readFileSync } from 'fs';

function readModelSelectorCss(): string {
  return readFileSync('src/style/toolbar/model-selector.css', 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

function getLastRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'gm'))];
  return matches.at(-1)?.[1] ?? '';
}

describe('model-selector.css', () => {
  it('keeps provider group headers visually flat', () => {
    const css = readModelSelectorCss();

    const baseRule = getRule(css, '.grimoire-model-dropdown button.grimoire-model-group');
    expect(baseRule).toContain('appearance: none');
    expect(baseRule).toContain('border: 0');
    expect(baseRule).toContain('background: transparent');
    expect(baseRule).toContain('box-shadow: none');

    // A group header is a control that opens and closes, so it answers hover
    // like every other row in the plugin.
    const hoverRule = getRule(css, '.grimoire-model-dropdown button.grimoire-model-group:hover');
    expect(hoverRule).toContain('background: var(--grimoire-hover)');
    expect(hoverRule).toContain('box-shadow: none');
  });

  it('keeps the model search container height stable while filtering', () => {
    const css = readModelSelectorCss();
    const searchRule = getRule(css, '.grimoire-model-search');
    expect(searchRule).toContain('height: 36px');
    expect(searchRule).toContain('min-height: 36px');
    expect(searchRule).toContain('max-height: 36px');
    expect(searchRule).toContain('padding: 0 var(--grimoire-space-10)');
  });

  it('frames the model search container so it does not bleed past the dropdown edges', () => {
    const css = readModelSelectorCss();
    const searchRule = getRule(css, '.grimoire-model-search');
    // A band with a rule under it: the panel already encloses this, and a
    // second box says nothing the first did not.
    expect(searchRule).toContain('border-bottom: 1px solid var(--grimoire-line)');
    expect(searchRule).toContain('border-radius: 0');
    expect(searchRule).toContain('box-sizing: border-box');
    // It spans the panel's full width by cancelling the panel's own padding,
    // so the rule under it reaches both edges.
    expect(searchRule).toContain('margin: calc(-1 * var(--grimoire-space-6)) calc(-1 * var(--grimoire-space-6)) var(--grimoire-space-6)');
  });

  it('prevents the native search input from changing the selector height', () => {
    const css = readModelSelectorCss();
    const inputRule = getRule(css, '.grimoire-model-search input.grimoire-model-search-input[type="search"]');
    expect(inputRule).not.toContain('!important');
    expect(inputRule).toContain('height: 24px');
    expect(inputRule).toContain('min-height: 24px');
    expect(inputRule).toContain('max-height: 24px');
    expect(inputRule).toContain('box-shadow: none');
  });

  it('keeps a readable selected model label before wrapping adjacent controls', () => {
    const css = readModelSelectorCss();
    const selectorRule = getRule(css, '.grimoire-container--chat-window .grimoire-model-selector');
    const buttonRule = getRule(css, '.grimoire-container--chat-window .grimoire-model-btn');

    expect(selectorRule).toContain('min-width: 96px');
    expect(buttonRule).toContain('min-width: 96px');
    expect(buttonRule).toContain('max-width: min(100%, 260px)');
  });

  it('marks a provider in ink rather than in its vendor colour', () => {
    const css = readModelSelectorCss();

    // Nordic spends no hue on identity. The nine brand colours are gone, and
    // with them every `[data-provider="…"]` rule whose whole body was one.
    expect(css).not.toMatch(/--grimoire-provider-/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(getRule(css, '.grimoire-model-button-provider-icon')).toContain('color: var(--grimoire-ink-muted)');
  });

  it('gives model choices room and preserves distinguishing secondary context', () => {
    const css = readModelSelectorCss();
    const dropdownRule = getRule(css, '.grimoire-container--chat-window .grimoire-model-dropdown');
    const detailRule = getLastRule(css, '.grimoire-model-option-detail');

    expect(dropdownRule).toContain('width: min(320px, calc(100vw - 24px))');
    expect(detailRule).not.toContain('display: none');
    expect(detailRule).toContain('font-size: var(--grimoire-text-s)');
    expect(detailRule).toContain('color: var(--grimoire-ink-muted)');

    const labelRule = getLastRule(css, '.grimoire-model-option-label');
    expect(labelRule).toContain('color: var(--grimoire-ink)');
    expect(labelRule).toContain('font-weight: var(--grimoire-weight-medium)');
  });

  it('keeps the plan usage badge compact and delegates its tooltip to the aria label', () => {
    const css = readModelSelectorCss();
    const badgeRule = getRule(css, '.grimoire-plan-usage-badge');
    const labelRule = getRule(css, '.grimoire-plan-usage-badge-label');
    const meterRule = getRule(css, '.grimoire-plan-usage-badge-meter');

    expect(badgeRule).toContain('gap: var(--grimoire-space-4)');
    expect(badgeRule).toContain('padding: 0 var(--grimoire-space-6)');
    expect(labelRule).toContain('display: none');
    expect(meterRule).toContain('width: 18px');
    expect(css).not.toContain('.grimoire-plan-usage-badge-tip');
    expect(css).not.toContain('.grimoire-plan-usage-badge-accessible-label');
  });
});
