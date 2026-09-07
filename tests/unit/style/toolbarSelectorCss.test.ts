import { readFileSync } from 'fs';

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

describe('chat toolbar selector CSS', () => {
  it('renders Files as a compact icon action', () => {
    const css = readFileSync('src/style/toolbar/external-context.css', 'utf8');
    const buttonRule = getRule(
      css,
      '.grimoire-container--chat-window .grimoire-external-context-icon-wrapper',
    );
    const iconRule = getRule(
      css,
      '.grimoire-container--chat-window .grimoire-external-context-icon',
    );
    const labelRule = getRule(
      css,
      '.grimoire-container--chat-window .grimoire-external-context-label',
    );

    expect(buttonRule).toContain('width: 28px');
    expect(buttonRule).toContain('min-width: 28px');
    expect(iconRule).toContain('display: inline-flex');
    expect(labelRule).toContain('display: none');
  });

  it('uses the same menu surface and option geometry for reasoning and work mode', () => {
    const thinkingCss = readFileSync('src/style/toolbar/thinking-selector.css', 'utf8');
    const permissionCss = readFileSync('src/style/toolbar/permission-toggle.css', 'utf8');
    const thinkingMenu = getRule(
      thinkingCss,
      '.grimoire-container--chat-window .grimoire-thinking-options',
    );
    const permissionMenu = getRule(permissionCss, '.grimoire-permission-options');
    const thinkingOption = getRule(
      thinkingCss,
      '.grimoire-container--chat-window .grimoire-thinking-gear',
    );
    const permissionOption = getRule(permissionCss, '.grimoire-permission-option');

    for (const declaration of [
      'min-width: 92px',
      'border-radius: var(--grimoire-radius-2)',
      'background: var(--grimoire-ground)',
      'box-shadow: var(--grimoire-lift-1)',
    ]) {
      expect(thinkingMenu).toContain(declaration);
      expect(permissionMenu).toContain(declaration);
    }
    for (const declaration of [
      'min-height: var(--grimoire-hit-l)',
      'border-radius: var(--grimoire-radius-1)',
      'font-weight: var(--grimoire-weight-normal)',
    ]) {
      expect(thinkingOption).toContain(declaration);
      expect(permissionOption).toContain(declaration);
    }
  });

  it('marks what is picked the same way in every menu the composer opens', () => {
    // One question, three answers: the reasoning menu filled the row with a 15%
    // accent wash and set the word in accent, the work-mode menu did the same,
    // and the MCP menu drew a 16px bordered box with a 20% fill inside a 10%
    // washed row. The row that is picked carries the accent as a check on the
    // ground a pointer would give it, and nothing else.
    const thinkingCss = readFileSync('src/style/toolbar/thinking-selector.css', 'utf8');
    const permissionCss = readFileSync('src/style/toolbar/permission-toggle.css', 'utf8');
    const mcpCss = readFileSync('src/style/toolbar/mcp-selector.css', 'utf8');

    expect(getRule(
      thinkingCss,
      '.grimoire-container--chat-window .grimoire-thinking-gear.selected',
    )).toContain('background: var(--grimoire-hover)');
    expect(getRule(permissionCss, '.grimoire-permission-option.selected'))
      .toContain('background: var(--grimoire-hover)');
    expect(getRule(mcpCss, '.grimoire-mcp-selector-item.enabled'))
      .not.toContain('background:');

    // The wash is still spent on the buttons these menus hang from - a mode
    // that is not the default is a pressed toggle - but never on a row.
    for (const rule of [
      getRule(thinkingCss, '.grimoire-container--chat-window .grimoire-thinking-gear.selected'),
      getRule(thinkingCss, '.grimoire-thinking-gear.selected'),
      getRule(permissionCss, '.grimoire-permission-option.selected'),
      getRule(mcpCss, '.grimoire-mcp-selector-item.enabled'),
      getRule(mcpCss, '.grimoire-mcp-selector-check'),
    ]) {
      expect(rule).not.toContain('accent-wash');
      expect(rule).not.toContain('color-mix');
    }

    // The check is one glyph at one size, defined once.
    const check = getRule(readFileSync('src/style/base/primitives.css', 'utf8'), '.grimoire-menu-check');
    expect(check).toContain('width: var(--grimoire-icon-2xs)');
    expect(check).toContain('color: var(--grimoire-accent)');
  });

  it('puts the same uppercase label over every composer menu', () => {
    const mcpHeader = getRule(
      readFileSync('src/style/toolbar/mcp-selector.css', 'utf8'),
      '.grimoire-mcp-selector-header',
    );
    const groupLabel = getRule(
      readFileSync('src/style/base/primitives.css', 'utf8'),
      '.grimoire-group-label',
    );

    for (const declaration of [
      'font-family: var(--grimoire-mono)',
      'font-size: var(--grimoire-text-2xs)',
      'letter-spacing: var(--grimoire-label-tracking)',
      'text-transform: uppercase',
    ]) {
      expect(mcpHeader).toContain(declaration);
      expect(groupLabel).toContain(declaration);
    }
  });

  it('gives a tab the header\'s full height and the header button its 28px square', () => {
    const tabsCss = readFileSync('src/style/components/tabs.css', 'utf8');
    const headerCss = readFileSync('src/style/components/header.css', 'utf8');
    const badgeRule = getRule(tabsCss, '.grimoire-tab-badge');
    const headerButtonRule = getRule(headerCss, '.grimoire-header-btn');

    // A tab is not a badge any more: it fills the header's height so its
    // underline can sit on the header's own rule.
    expect(badgeRule).not.toContain('width: 28px');
    expect(badgeRule).toContain('padding: 0 var(--grimoire-space-8)');
    // 2px, not 1.5: the line lands on the header's own rule and half of it is
    // spent hiding that rule, so at 1.5 it read as a brighter piece of the
    // rule rather than as the mark for which tab you are in.
    expect(getRule(tabsCss, '.grimoire-tab-badge-active'))
      .toContain('border-bottom: 2px solid var(--grimoire-accent)');
    expect(headerButtonRule).toContain('width: var(--grimoire-hit-l)');
    expect(headerButtonRule).toContain('height: var(--grimoire-hit-l)');
  });

  it('keeps toolbar popup menus at the same distance from their buttons', () => {
    const rules = [
      getRule(
        readFileSync('src/style/toolbar/model-selector.css', 'utf8'),
        '.grimoire-container--chat-window .grimoire-model-dropdown',
      ),
      getRule(
        readFileSync('src/style/toolbar/thinking-selector.css', 'utf8'),
        '.grimoire-container--chat-window .grimoire-thinking-options',
      ),
      getRule(
        readFileSync('src/style/toolbar/permission-toggle.css', 'utf8'),
        '.grimoire-permission-options',
      ),
      getRule(
        readFileSync('src/style/toolbar/mcp-selector.css', 'utf8'),
        '.grimoire-container--chat-window .grimoire-mcp-selector-dropdown',
      ),
    ];

    for (const rule of rules) {
      expect(rule).toContain('bottom: calc(100% + 8px)');
    }
  });

  it('carries provider identity as ink in the model, tab, and response surfaces alike', () => {
    const modelCss = readFileSync('src/style/toolbar/model-selector.css', 'utf8');
    const tabsCss = readFileSync('src/style/components/tabs.css', 'utf8');
    const messagesCss = readFileSync('src/style/components/messages.css', 'utf8');

    // One provider used to be pinned to one hue in three places, which is three
    // chances to disagree. There is no hue to disagree about now.
    for (const css of [modelCss, tabsCss, messagesCss]) {
      expect(css).not.toMatch(/--grimoire-provider-[a-z]/);
      expect(css).not.toMatch(/\[data-provider="[a-z]+"\]/);
    }
  });
});
