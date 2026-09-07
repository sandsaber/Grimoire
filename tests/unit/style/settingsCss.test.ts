import { readFileSync } from 'fs';

function readSettingsCss(): string {
  return [
    readFileSync('src/style/settings/base.css', 'utf8'),
    readFileSync('src/style/settings/hub.css', 'utf8'),
  ].join('\n').replace(/\r\n/g, '\n');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

describe('settings base CSS', () => {
  it('lets Obsidian and the active theme own setting cards and section geometry', () => {
    const css = readSettingsCss();

    expect(getRule(css, '.grimoire-settings .setting-item')).toBe('');
    expect(getRule(css, '.grimoire-settings .setting-item-heading')).toBe('');
    expect(getRule(css, '.grimoire-settings .setting-item-heading:first-child')).toBe('');
    expect(getRule(css, '.grimoire-adv-body .setting-item-heading:first-child')).toBe('');
    expect(css).not.toContain('border-top: 1px solid var(--grimoire-line)');
  });

  it('isolates the custom settings page from Obsidian declarative group styling', () => {
    const css = readSettingsCss();
    const groupItemsRule = getRule(
      css,
      '.setting-group.grimoire-settings-root-group > .setting-items',
    );
    const nestedSettingRule = getRule(
      css,
      '.grimoire-settings-root-group .grimoire-settings .setting-item:not(.setting-item-heading)',
    );
    const nestedDividerRule = getRule(
      css,
      '.grimoire-settings-root-group .grimoire-settings .setting-item:not(.setting-item-heading)::before',
    );

    expect(groupItemsRule).toContain('background-color: transparent');
    expect(groupItemsRule).toContain('border: 0');
    expect(nestedSettingRule).toContain('background-color: var(--setting-items-background)');
    expect(nestedSettingRule).toContain('border: var(--setting-items-border-width) solid var(--setting-items-border-color)');
    expect(nestedSettingRule).toContain('border-radius: var(--setting-items-radius)');
    expect(nestedDividerRule).toContain('content: none');
  });

  it('keeps the official gap between the tab bar and the first setting', () => {
    const tabsRule = getRule(readSettingsCss(), '.grimoire-settings-tabs');

    expect(tabsRule).toContain('margin-bottom: var(--grimoire-space-16)');
  });

  it('uses the compact Codian tab dimensions with an accent underline', () => {
    const css = readSettingsCss();
    const tabRule = getRule(css, '.grimoire-settings-tabs-viewport > .grimoire-settings-tab');
    const activeRule = getRule(css, '.grimoire-settings-tabs-viewport > .grimoire-settings-tab--active,\n.grimoire-settings-tabs-viewport > .grimoire-settings-tab--active:hover');

    expect(tabRule).toContain('height: auto');
    expect(tabRule).toContain('min-height: 0');
    expect(tabRule).toContain('padding: var(--grimoire-space-8) var(--grimoire-space-16)');
    expect(tabRule).toContain('flex: 0 0 auto');
    expect(tabRule).toContain('border: 0');
    expect(tabRule).toContain('border-bottom: 4px solid transparent');
    expect(tabRule).toContain('border-radius: 0');
    expect(tabRule).toContain('background: transparent');
    expect(tabRule).toContain('color: var(--grimoire-ink-muted)');
    expect(tabRule).toContain('font-size: var(--grimoire-text-m)');
    expect(tabRule).toContain('font-weight: var(--grimoire-weight-medium)');

    expect(activeRule).toContain('border-bottom-color: var(--grimoire-accent)');
    expect(activeRule).toContain('background: transparent');
    expect(activeRule).toContain('color: var(--grimoire-ink)');
    expect(activeRule).not.toContain('font-weight: 600');
  });

  it('keeps overflowing provider tabs compact and horizontally scrollable', () => {
    const css = readSettingsCss();
    const viewportRule = getRule(css, '.grimoire-settings-tabs-viewport');
    const tabRule = getRule(css, '.grimoire-settings-tabs-viewport > .grimoire-settings-tab');
    const scrollButtonRule = getRule(css, '.grimoire-settings-tab-scroll');
    const overflowingScrollButtonRule = getRule(css, '.grimoire-settings-tabs.is-overflowing .grimoire-settings-tab-scroll');
    const previousScrollButtonRule = getRule(css, '.grimoire-settings-tab-scroll--previous');
    const nextScrollButtonRule = getRule(css, '.grimoire-settings-tab-scroll--next');

    expect(viewportRule).toContain('overflow-x: auto');
    expect(viewportRule).toContain('justify-content: flex-start');
    expect(viewportRule).toContain('gap: var(--grimoire-space-2)');
    expect(viewportRule).toContain('padding: 0');
    expect(tabRule).toContain('flex: 0 0 auto');
    expect(tabRule).toContain('min-width: max-content');
    expect(tabRule).toContain('padding: var(--grimoire-space-8) var(--grimoire-space-16)');
    expect(scrollButtonRule).toContain('width: 26px');
    expect(scrollButtonRule).toContain('height: auto');
    expect(scrollButtonRule).toContain('min-height: 0');
    expect(overflowingScrollButtonRule).toContain('display: inline-flex');
    expect(previousScrollButtonRule).toContain('margin-inline-end: var(--grimoire-space-4)');
    expect(nextScrollButtonRule).toContain('margin-inline-start: var(--grimoire-space-4)');
  });

  it('marks the selected provider with a line, not a fill', () => {
    const css = readSettingsCss();
    const cardRule = getRule(css, '.grimoire-settings-provider-card');
    const activeRule = getRule(css, '.grimoire-settings-provider-card--active');
    const metaRule = getRule(css, '.grimoire-settings-provider-card-meta');

    // Eight tinted tiles, one of them an 18% accent fill: the budget is one fill
    // per surface, and a card that is only "selected" has not earned it.
    expect(cardRule).toContain('background: var(--grimoire-ground)');
    expect(cardRule).not.toContain('--grimoire-accent');
    expect(activeRule).toContain('border-left: 1.5px solid var(--grimoire-accent)');
    expect(activeRule).toContain('background: var(--grimoire-ground)');
    expect(metaRule).toContain('color: var(--grimoire-ink-muted)');
  });

  it('styles the provider selection hint as compact muted UI copy', () => {
    const css = readSettingsCss();
    const hintRule = getRule(css, '.grimoire-settings-provider-hint');

    expect(hintRule).toContain('margin: 0 0 var(--grimoire-space-2)');
    expect(hintRule).toContain('color: var(--grimoire-ink-faint)');
    expect(hintRule).toContain('font-size: var(--grimoire-text-m)');
  });

  it('keeps provider settings panel wrappers transparent while preserving setting cards', () => {
    const providerDetailsRule = getRule(
      readSettingsCss(),
      '.grimoire-settings-provider-details',
    );
    const settingRule = getRule(
      readSettingsCss(),
      '.grimoire-settings-provider-details > .setting-item,\n.grimoire-settings-provider-details details .setting-item:not(.setting-item-heading)',
    );

    expect(providerDetailsRule).toContain('box-sizing: border-box');
    expect(providerDetailsRule).toContain('width: 100%');
    expect(providerDetailsRule).toContain('max-width: none');
    expect(providerDetailsRule).toContain('padding: var(--grimoire-space-12) 0 var(--grimoire-space-16)');
    expect(providerDetailsRule).toContain('border: 0');
    expect(providerDetailsRule).toContain('background: transparent');
    expect(providerDetailsRule).not.toContain(
      'border: 1px solid var(--grimoire-line)',
    );
    expect(providerDetailsRule).not.toContain('background-secondary');
    expect(settingRule).toContain('border-radius: var(--grimoire-radius-2)');
  });

  it('keeps workspace modal content wrappers transparent while preserving their setting cards', () => {
    const workspaceContentRule = getRule(
      readSettingsCss(),
      '.grimoire-settings-workspace-modal-content',
    );
    const settingRule = getRule(
      readSettingsCss(),
      '.grimoire-settings-workspace-modal-content > .setting-item:not(.setting-item-heading),\n.grimoire-settings-workspace-modal-content > .grimoire-workspace-provider-section > .setting-item:not(.setting-item-heading),\n.grimoire-settings-workspace-modal-content > .grimoire-workspace-provider-section details .setting-item:not(.setting-item-heading),\n.grimoire-settings-workspace-modal-content details .setting-item:not(.setting-item-heading)',
    );

    expect(workspaceContentRule).toContain('min-height: 180px');
    expect(workspaceContentRule).toContain('padding: var(--grimoire-space-12) var(--grimoire-space-16) var(--grimoire-space-16)');
    expect(workspaceContentRule).toContain('border: 0');
    expect(workspaceContentRule).toContain('background: transparent');
    expect(workspaceContentRule).not.toContain('background-secondary');
    expect(settingRule).toContain('border-radius: var(--grimoire-radius-2)');
    expect(settingRule).toContain('background: var(--grimoire-ground)');
  });

  it('keeps workspace provider sections as normal flow containers for Obsidian CSS review', () => {
    const sectionRule = getRule(readSettingsCss(), '.grimoire-workspace-provider-section');

    expect(sectionRule).toContain('display: block');
    expect(sectionRule).not.toMatch(/display\s*:\s*contents\b/);
  });

  it('stretches provider setting rows to the full panel width', () => {
    const settingRule = getRule(
      readSettingsCss(),
      '.grimoire-settings-provider-details > .setting-item,\n.grimoire-settings-provider-details details .setting-item:not(.setting-item-heading)',
    );

    expect(settingRule).toContain('box-sizing: border-box');
    expect(settingRule).toContain('width: 100%');
    expect(settingRule).toContain('max-width: none');
  });

  it('holds the providers in a hairline grid and keeps row actions visible', () => {
    const css = readSettingsCss();
    const providerGridRule = getRule(css, '.grimoire-settings-provider-grid');
    const resourceRowRule = getRule(css, '.grimoire-settings-resource-row');
    const actionRule = getRule(
      css,
      'button.grimoire-settings-resource-edit,\nbutton.grimoire-settings-resource-delete',
    );

    // Two columns with a 1px gap over a line-coloured ground: the gap is the rule
    // between cells, so the grid draws its own table without a border each.
    expect(providerGridRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(providerGridRule).toContain('gap: 1px');
    expect(providerGridRule).toContain('background: var(--grimoire-line)');
    expect(resourceRowRule).toContain(
      'grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) 88px',
    );
    expect(actionRule).toContain('display: inline-flex');
    expect(actionRule).toContain('height: var(--grimoire-hit-s)');
    // Edit is a glyph in a square; delete is a word, and a 24px square is not
    // wide enough to hold one - it spilled over the pencil beside it.
    expect(getRule(css, 'button.grimoire-settings-resource-edit'))
      .toContain('width: var(--grimoire-hit-s)');
    expect(css).toContain(
      'button.grimoire-settings-resource-delete {\n  padding: 0 var(--grimoire-space-6);\n}',
    );
  });
});
