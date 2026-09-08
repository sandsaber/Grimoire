import { readFileSync } from 'fs';

function readCss(file: string): string {
  return readFileSync(`src/style/modals/${file}`, 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

describe('the rename dialog', () => {
  it('keeps its own width and leaves the rest of the shape to every other dialog', () => {
    const css = readCss('rename-tab.css');

    expect(getRule(css, '.grimoire-rename-tab-modal')).toContain('width: min(520px, calc(100vw - 32px))');
    // Five dialogs had five button heights and four field heights between them.
    // What is particular to this one is the width and the spinner; the shape it
    // shares now lives in dialog.css, so a change there reaches all of them.
    expect(getRule(css, 'button.grimoire-rename-tab-suggest.is-loading svg')).toContain('animation:');
  });

  it('sets the field controls beside the input, never over it', () => {
    const css = readCss('dialog.css');

    // A Chromium input paints its overflowing text across its own padding box,
    // so padding cannot keep a long title off the controls beside it: they are
    // siblings in the row, each holding its own width.
    expect(getRule(css, '.grimoire-dialog-input')).toContain('flex: 1 1 auto');
    const control = getRule(css, 'button.grimoire-dialog-field-btn');
    expect(control).not.toContain('position: absolute');
    expect(control).toContain('flex: 0 0 auto');
    expect(control).toContain('width: var(--grimoire-field-h)');
  });

  it('spends the accent once per dialog, on the action that commits', () => {
    const css = readCss('dialog.css');

    expect(getRule(css, '.grimoire-dialog-actions button.mod-cta')).toContain(
      'background: var(--grimoire-accent)',
    );
    // Cancel is a border and a word. A second fill would make the two choices
    // look equally weighted, which is the one thing a dialog must not do.
    expect(getRule(css, '.grimoire-dialog-actions button')).toContain('background: transparent');
    expect(getRule(css, 'button.grimoire-dialog-field-btn:disabled')).toContain('opacity: 0.45');
  });
});
