import { readFileSync } from 'fs';

function readInputCss(): string {
  return readFileSync('src/style/components/input.css', 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

describe('input.css', () => {
  it('does not hard-cap compact chat textarea height before auto-resize runs', () => {
    const css = readInputCss();
    const rule = getRule(css, '.grimoire-container--chat-window .grimoire-input');

    expect(rule).not.toContain('120px');
    expect(rule).toContain('max-height: var(--grimoire-textarea-max-height, none)');
  });

  it('keeps the compact toolbar on one row until the pane is genuinely narrow', () => {
    const css = readInputCss();
    const actionsRule = getRule(css, '.grimoire-container--chat-window .grimoire-input-toolbar-actions-row');
    const configRule = getRule(css, '.grimoire-container--chat-window .grimoire-input-toolbar-config-actions');
    const modelStackRule = getRule(css, '.grimoire-container--chat-window .grimoire-model-context-stack');
    const sendRule = getRule(css, '.grimoire-send-actions');

    expect(actionsRule).toContain('flex-wrap: nowrap');
    expect(configRule).toContain('flex: 0 1 auto');
    expect(modelStackRule).toContain('flex: 0 1 auto');
    expect(modelStackRule).toContain('width: fit-content');
    expect(modelStackRule).not.toContain('border-inline-end');
    expect(sendRule).toContain('margin-inline-start: auto');
    expect(css).toContain('@container grimoire-composer (max-width: 520px)');
    expect(css).toMatch(/@container grimoire-composer \(max-width: 520px\)[\s\S]*?\.grimoire-input-toolbar-config-actions[\s\S]*?flex-wrap: wrap/);
    expect(css).toContain('@container grimoire-composer (max-width: 380px)');
    expect(css).toContain('grid-template-areas:');
    expect(css).toContain('"model model"');
    expect(css).toContain('"controls send"');
  });

  it('keeps context chips visually separated from long textarea content', () => {
    const css = readInputCss();
    const contextRule = getRule(css, '.grimoire-container--chat-window .grimoire-context-row');

    expect(contextRule).toContain('padding: 0 var(--grimoire-space-1) var(--grimoire-space-2)');
  });

  it('uses a borderless soft-accent send button with a deeper hover surface', () => {
    const css = readInputCss();
    const sendRule = getRule(css, '.grimoire-container--chat-window button.grimoire-send-button');
    const hoverRule = getRule(css, '.grimoire-container--chat-window button.grimoire-send-button:hover');

    expect(sendRule).toContain('border: 0');
    expect(sendRule).toContain('background: var(--grimoire-accent-soft)');
    expect(sendRule).toContain('color: var(--grimoire-accent-text)');
    expect(hoverRule).toContain('background: rgba(var(--grimoire-brand-rgb), 0.22)');
    expect(hoverRule).toContain('filter: none');
  });

  it('matches the stop control to the compact toolbar button system', () => {
    const css = readInputCss();
    const stopRule = getRule(css, '.grimoire-container--chat-window button.grimoire-stop-button');
    const hiddenRule = getRule(css, '.grimoire-container--chat-window button.grimoire-stop-button.grimoire-hidden');
    const hoverRule = getRule(css, '.grimoire-container--chat-window button.grimoire-stop-button:hover');

    expect(stopRule).toContain('width: 28px');
    expect(stopRule).toContain('border: 1px solid transparent');
    expect(stopRule).toContain('border-radius: var(--grimoire-radius-2)');
    expect(stopRule).toContain('background: var(--grimoire-raise)');
    expect(hiddenRule).toContain('display: none');
    expect(hoverRule).toContain('background: rgba(var(--grimoire-error-rgb), 0.1)');
  });
});
