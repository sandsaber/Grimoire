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
    expect(sendRule).toContain('margin-inline-start: var(--grimoire-space-4)');
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

    expect(contextRule).toContain('padding: 0 var(--grimoire-space-2) var(--grimoire-space-4)');
  });

  it('spends the one filled action a surface gets on send', () => {
    const css = readInputCss();
    const sendRule = getRule(css, '.grimoire-container--chat-window button.grimoire-send-button');
    const disabledRule = getRule(css, '.grimoire-container--chat-window button.grimoire-send-button:disabled');

    expect(sendRule).toContain('border: 0');
    expect(sendRule).toContain('width: var(--grimoire-hit-l)');
    expect(sendRule).toContain('background: var(--grimoire-accent)');
    expect(sendRule).toContain('color: var(--grimoire-accent-contrast)');
    // Nothing to send is an inert square, not a dimmed accent.
    expect(disabledRule).toContain('background: var(--grimoire-line)');
    expect(disabledRule).toContain('color: var(--grimoire-ink-faint)');
  });

  it('makes stop the same square, in the same place', () => {
    const css = readInputCss();
    const sendRule = getRule(css, '.grimoire-container--chat-window button.grimoire-send-button');
    const stopRule = getRule(css, '.grimoire-container--chat-window button.grimoire-stop-button');
    const hiddenRule = getRule(css, '.grimoire-container--chat-window button.grimoire-stop-button.grimoire-hidden');

    for (const declaration of [
      'width: var(--grimoire-hit-l)',
      'height: var(--grimoire-hit-l)',
      'border-radius: var(--grimoire-radius-1)',
      'background: var(--grimoire-accent)',
      'color: var(--grimoire-accent-contrast)',
    ]) {
      expect(sendRule).toContain(declaration);
      expect(stopRule).toContain(declaration);
    }
    expect(hiddenRule).toContain('display: none');
  });

  it('draws the composer card with one line, and moves that line on focus', () => {
    const css = readInputCss();
    const cardRule = getRule(css, '.grimoire-input-wrapper');
    const focusRule = getRule(css, '.grimoire-input-wrapper:focus-within');
    const budgetRule = getRule(css, '.grimoire-input-wrapper.is-over-budget');

    expect(cardRule).toContain('border: 1px solid var(--grimoire-line)');
    expect(cardRule).toContain('border-radius: var(--grimoire-radius-3)');
    // Focus used to add an accent border, an inset highlight and an outer ring:
    // three effects saying one thing about a box the cursor is inside.
    expect(focusRule).toContain('border-color: var(--grimoire-line-3)');
    expect(focusRule).toContain('box-shadow: none');
    expect(budgetRule).toContain('border-color: var(--grimoire-error-line)');
  });

  it('hangs an attachment chip on a hairline rather than a wash', () => {
    const css = readInputCss();
    const chipRule = getRule(css, '.grimoire-file-chip');

    expect(chipRule).toContain('height: var(--grimoire-chip-h)');
    expect(chipRule).toContain('border: 1px solid var(--grimoire-accent-line)');
    expect(chipRule).toContain('border-radius: var(--grimoire-radius-1)');
    expect(chipRule).toContain('background: none');
  });
});
