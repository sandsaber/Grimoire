import { readFileSync } from 'fs';

function readToolcallsCss(): string {
  return readFileSync('src/style/components/toolcalls.css', 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('toolcalls.css', () => {
  it('uses the full assistant column for expanded tool output', () => {
    const css = readToolcallsCss();

    const toolRule = getRule(css, '.grimoire-container--chat-window .grimoire-message-content > .grimoire-tool-call');
    const headerRule = getRule(css, '.grimoire-tool-step > .grimoire-tool-header');
    const contentRule = getRule(css, '.grimoire-tool-step > .grimoire-tool-content');
    expect(toolRule).toContain('width: calc(100% - 44px)');
    expect(toolRule).toContain('max-width: calc(100% - 44px)');
    expect(toolRule).toContain('justify-self: start');
    expect(headerRule).toContain('padding: 4px 8px 4px 0');
    expect(contentRule).toContain('margin: 1px 0 5px');
    expect(contentRule).toContain('max-width: 100%');
    expect(contentRule).toContain('max-height: min(52vh, 520px)');
    expect(contentRule).toContain('overflow: auto');
  });

  it('wraps long expanded tool output lines instead of clipping them horizontally', () => {
    const css = readToolcallsCss();

    const linesRule = getRule(css, '.grimoire-tool-step .grimoire-tool-lines');
    expect(linesRule).toContain('overflow-x: hidden');

    const lineRule = getRule(css, '.grimoire-tool-step .grimoire-tool-line');
    expect(lineRule).toContain('white-space: pre-wrap');
    expect(lineRule).toContain('overflow-wrap: anywhere');
  });

  it('keeps the result and completion status in their right-side columns when expanded', () => {
    const css = readToolcallsCss();

    const resultRule = getRule(css, '.grimoire-tool-result');
    const statusRule = getRule(css, '.grimoire-tool-step .grimoire-tool-status');
    expect(resultRule).toContain('grid-column: 4');
    expect(statusRule).toContain('grid-column: 5');
  });

  it('styles the show-all affordance as part of the expanded output preview', () => {
    const css = readToolcallsCss();

    const actionRule = getRule(css, '.grimoire-tool-truncation-action');
    expect(actionRule).toContain('display: flex');
    expect(actionRule).toContain('justify-content: space-between');
    expect(actionRule).toContain('padding: 8px 10px 6px 0');

    const buttonRule = getRule(css, '.grimoire-tool-show-all');
    expect(buttonRule).toContain('cursor: pointer');
    expect(buttonRule).toContain('border-radius: var(--grimoire-radius-pill)');
    expect(buttonRule).toContain('padding: 7px 11px');
  });
});
