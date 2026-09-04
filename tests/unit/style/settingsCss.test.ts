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
    expect(css).not.toContain('border-top: 1px solid var(--background-modifier-border)');
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

    expect(tabsRule).toContain('margin-bottom: var(--grimoire-space-6)');
  });

  it('uses the compact Codian tab dimensions with an accent underline', () => {
    const css = readSettingsCss();
    const tabRule = getRule(css, '.grimoire-settings-tabs-viewport > .grimoire-settings-tab');
    const activeRule = getRule(css, '.grimoire-settings-tabs-viewport > .grimoire-settings-tab--active,\n.grimoire-settings-tabs-viewport > .grimoire-settings-tab--active:hover');

    expect(tabRule).toContain('height: auto');
    expect(tabRule).toContain('min-height: 0');
    expect(tabRule).toContain('padding: var(--grimoire-space-4) var(--grimoire-space-6)');
    expect(tabRule).toContain('flex: 0 0 auto');
    expect(tabRule).toContain('border: 0');
    expect(tabRule).toContain('border-bottom: 4px solid transparent');
    expect(tabRule).toContain('border-radius: 0');
    expect(tabRule).toContain('background: transparent');
    expect(tabRule).toContain('color: var(--text-muted)');
    expect(tabRule).toContain('font-size: var(--font-ui-small)');
    expect(tabRule).toContain('font-weight: var(--font-medium)');

    expect(activeRule).toContain('border-bottom-color: var(--grimoire-accent)');
    expect(activeRule).toContain('background: transparent');
    expect(activeRule).toContain('color: var(--text-normal)');
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
    expect(viewportRule).toContain('gap: var(--grimoire-space-1)');
    expect(viewportRule).toContain('padding: 0');
    expect(tabRule).toContain('flex: 0 0 auto');
    expect(tabRule).toContain('min-width: max-content');
    expect(tabRule).toContain('padding: var(--grimoire-space-4) var(--grimoire-space-6)');
    expect(scrollButtonRule).toContain('width: 26px');
    expect(scrollButtonRule).toContain('height: auto');
    expect(scrollButtonRule).toContain('min-height: 0');
    expect(overflowingScrollButtonRule).toContain('display: inline-flex');
    expect(previousScrollButtonRule).toContain('margin-inline-end: var(--grimoire-space-2)');
    expect(nextScrollButtonRule).toContain('margin-inline-start: var(--grimoire-space-2)');
  });

  it('uses borderless provider cards with muted copy and blue selected states', () => {
    const css = readSettingsCss();
    const cardRule = getRule(css, '.grimoire-settings-provider-card');
    const hoverRule = getRule(css, '.grimoire-settings-provider-card:hover');
    const activeRule = getRule(css, '.grimoire-settings-provider-card--active');
    const activeHoverRule = getRule(css, '.grimoire-settings-provider-card--active:hover');
    const metaRule = getRule(css, '.grimoire-settings-provider-card-meta');

    expect(cardRule).toContain('border: 0');
    expect(cardRule).toContain('var(--setting-items-background, var(--background-secondary)) 82%');
    expect(hoverRule).toContain('var(--setting-items-background, var(--background-secondary)) 78%');
    expect(activeRule).toContain('border: 0');
    expect(activeRule).toContain('var(--grimoire-accent) 18%');
    expect(activeHoverRule).toContain('var(--grimoire-accent) 13%');
    expect(metaRule).toContain('color: var(--text-muted)');
  });

  it('styles the provider selection hint as compact muted UI copy', () => {
    const css = readSettingsCss();
    const gridRule = getRule(css, '.grimoire-settings-provider-grid');
    const hintRule = getRule(css, '.grimoire-settings-provider-hint');

    expect(gridRule).toContain('margin: var(--grimoire-space-1) 0 var(--grimoire-space-4)');
    expect(hintRule).toContain('margin: 0 0 var(--grimoire-space-1)');
    expect(hintRule).toContain('color: var(--text-faint)');
    expect(hintRule).toContain('font-size: var(--font-ui-small)');
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
    expect(providerDetailsRule).toContain('padding: var(--grimoire-space-5) 0 var(--grimoire-space-6)');
    expect(providerDetailsRule).toContain('border: 0');
    expect(providerDetailsRule).toContain('background: transparent');
    expect(providerDetailsRule).not.toContain(
      'border: 1px solid var(--background-modifier-border)',
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
    expect(workspaceContentRule).toContain('padding: var(--grimoire-space-5) var(--grimoire-space-6) var(--grimoire-space-6)');
    expect(workspaceContentRule).toContain('border: 0');
    expect(workspaceContentRule).toContain('background: transparent');
    expect(workspaceContentRule).not.toContain('background-secondary');
    expect(settingRule).toContain('border-radius: var(--grimoire-radius-2)');
    expect(settingRule).toContain('background: var(--background-primary)');
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

  it('uses four provider columns and keeps row edit/delete actions visible', () => {
    const css = readSettingsCss();
    const providerGridRule = getRule(css, '.grimoire-settings-provider-grid');
    const resourceRowRule = getRule(css, '.grimoire-settings-resource-row');
    const actionRule = getRule(
      css,
      '.grimoire-settings-resource-edit,\n.grimoire-settings-resource-delete',
    );

    expect(providerGridRule).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(resourceRowRule).toContain(
      'grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.8fr) minmax(0, 1fr) 76px',
    );
    expect(actionRule).toContain('display: inline-flex');
    expect(actionRule).toContain('width: 28px');
  });
});
