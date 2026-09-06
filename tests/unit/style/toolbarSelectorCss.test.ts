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
      'background: var(--background-primary)',
      'box-shadow: var(--grimoire-lift-1)',
    ]) {
      expect(thinkingMenu).toContain(declaration);
      expect(permissionMenu).toContain(declaration);
    }
    for (const declaration of [
      'min-height: var(--grimoire-hit-l)',
      'padding: 0 var(--grimoire-space-8)',
      'border-radius: var(--grimoire-radius-1)',
      'font-weight: var(--grimoire-weight-normal)',
    ]) {
      expect(thinkingOption).toContain(declaration);
      expect(permissionOption).toContain(declaration);
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
    expect(getRule(tabsCss, '.grimoire-tab-badge-active'))
      .toContain('border-bottom: 1.5px solid var(--grimoire-accent)');
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
