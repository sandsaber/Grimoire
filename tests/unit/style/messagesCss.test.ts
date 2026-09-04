import { readFileSync } from 'fs';

function readCss(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function readMessagesCss(): string {
  return readCss('src/style/components/messages.css');
}

function readContainerCss(): string {
  return readCss('src/style/base/container.css');
}

function readHeaderCss(): string {
  return readCss('src/style/components/header.css');
}

function readTabsCss(): string {
  return readCss('src/style/components/tabs.css');
}

function readChatMarkdownCss(): string {
  return [
    readCss('src/style/components/messages.css'),
    readCss('src/style/components/code.css'),
    readCss('src/style/features/image-embed.css'),
  ].join('\n');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

function getExactRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? '';
}

describe('messages.css', () => {
  it('keeps wide assistant markdown from expanding the chat pane', () => {
    const css = readMessagesCss();

    expect(getRule(css, '.grimoire-container--chat-window .grimoire-message'))
      .toContain('min-width: 0');
    expect(getRule(css, '.grimoire-container--chat-window .grimoire-message-assistant'))
      .toContain('min-width: 0');
    expect(getRule(css, '.grimoire-message-content')).toContain('min-width: 0');
    expect(getRule(css, '.grimoire-text-block')).toContain('min-width: 0');

    const renderedMarkdownRule = getRule(css, '.grimoire-message-content .markdown-rendered');
    expect(renderedMarkdownRule).toContain('max-width: 100%');
    expect(renderedMarkdownRule).toContain('overflow-x: auto');
  });

  it('makes wide markdown tables scroll inside the message instead of clipping text', () => {
    const wrapperRule = getRule(readMessagesCss(), '.grimoire-message-content .grimoire-table-scroll');

    expect(wrapperRule).toContain('display: block');
    expect(wrapperRule).toContain('max-width: 100%');
    expect(wrapperRule).toContain('overflow-x: auto');
    expect(wrapperRule).toContain('overflow-y: hidden');

    const tableRule = getRule(readMessagesCss(), '.grimoire-message-content .grimoire-table-scroll > table');

    expect(tableRule).toContain('width: max-content');
    expect(tableRule).toContain('min-width: 100%');
    expect(tableRule).toContain('max-width: none');
    expect(tableRule).toContain('table-layout: auto');

    const cellRule = getRule(readMessagesCss(), '.grimoire-message-content th,\n.grimoire-message-content td');
    expect(cellRule).toContain('overflow-wrap: normal');
    expect(cellRule).toContain('word-break: normal');
    expect(cellRule).toContain('white-space: nowrap');
  });

  it('wraps provider markdown prose without clipping long links or paths', () => {
    const css = readMessagesCss();

    expect(getRule(css, '.grimoire-message-content p')).toContain('overflow-wrap: anywhere');
    expect(getRule(css, '.grimoire-message-content li,\n.grimoire-message-content a,\n.grimoire-message-content blockquote,\n.grimoire-message-content details,\n.grimoire-message-content summary')).toContain('overflow-wrap: anywhere');
    expect(getRule(css, '.grimoire-message-content h1,\n.grimoire-message-content h2,\n.grimoire-message-content h3,\n.grimoire-message-content h4,\n.grimoire-message-content h5,\n.grimoire-message-content h6')).toContain('overflow-wrap: anywhere');
  });

  it('keeps a small inline-end buffer so wrapped markdown glyphs and copy controls are not clipped', () => {
    const css = readMessagesCss();
    const textBlockRule = getRule(css, '.grimoire-text-block');
    const renderedMarkdownRule = getRule(
      css,
      '.grimoire-message-content .markdown-rendered'
    );
    const copyButtonRule = getRule(css, '.grimoire-text-copy-btn');

    expect(textBlockRule).toContain('--grimoire-text-block-inline-end-buffer: 44px');
    expect(textBlockRule).toContain('box-sizing: border-box');
    expect(textBlockRule).toContain('padding-inline-end: var(--grimoire-text-block-inline-end-buffer)');
    expect(renderedMarkdownRule).toContain('box-sizing: border-box');
    expect(renderedMarkdownRule).toContain('padding-inline-end: var(--grimoire-text-block-inline-end-buffer, var(--grimoire-space-8))');
    expect(copyButtonRule).toContain('inset-inline-end: 12px');
    expect(copyButtonRule).toContain('width: 24px');
    expect(copyButtonRule).toContain('height: 24px');
    expect(copyButtonRule).toContain('box-sizing: border-box');
  });

  it('keeps assistant markdown and copy controls in a capped content column on wide panes', () => {
    const assistantTextBlockRule = getExactRule(
      readMessagesCss(),
      '.grimoire-message-assistant .grimoire-text-block'
    );

    expect(assistantTextBlockRule).toContain('justify-self: start');
    expect(assistantTextBlockRule).toContain('width: 100%');
    expect(assistantTextBlockRule).toContain('max-width: min(100%, 760px)');
  });

  it('does not reserve assistant copy-button space inside user bubbles', () => {
    const userTextBlockRule = getExactRule(
      readMessagesCss(),
      '.grimoire-message-user .grimoire-text-block'
    );

    expect(userTextBlockRule).toContain('--grimoire-text-block-inline-end-buffer: 0px');
    expect(userTextBlockRule).toContain('padding-inline-end: 0');
  });

  it('reserves enough space below question bubbles for their date and action row', () => {
    const css = readMessagesCss();
    const userBubbleRule = getExactRule(
      css,
      '.grimoire-container--chat-window .grimoire-message-user'
    );
    const userActionsRule = getExactRule(css, '.grimoire-user-msg-actions');

    expect(userBubbleRule).toContain('margin-bottom: var(--grimoire-space-6)');
    expect(userActionsRule).toContain('bottom: -24px');
  });

  it('keeps message dates and copy controls visible without requiring hover', () => {
    const css = readMessagesCss();
    const assistantCopyRule = getExactRule(css, '.grimoire-text-copy-btn');
    const userActionsRule = getExactRule(css, '.grimoire-user-msg-actions');

    expect(assistantCopyRule).toContain('opacity: 1');
    expect(userActionsRule).toContain('opacity: 1');
    expect(css).not.toContain('.grimoire-text-block:hover .grimoire-text-copy-btn');
    expect(css).not.toContain('.grimoire-message-user:hover .grimoire-user-msg-actions');
  });

  it('keeps copy feedback inside the fixed icon footprint', () => {
    const css = readMessagesCss();
    const assistantCopiedRule = getExactRule(css, '.grimoire-text-copy-btn.copied');
    const userCopiedRule = getExactRule(css, '.grimoire-user-msg-actions span.copied');

    expect(assistantCopiedRule).toContain('color: var(--grimoire-accent-text)');
    expect(assistantCopiedRule).not.toContain('width: auto');
    expect(assistantCopiedRule).not.toContain('min-width');
    expect(userCopiedRule).not.toContain('font-size');
    expect(css).not.toContain('inset-inline-start: 62px');
  });

  it('uses compact activity spacing and reserves a small completion-time row', () => {
    const css = readMessagesCss();
    const contentRule = getRule(
      css,
      '.grimoire-container--chat-window .grimoire-message-assistant .grimoire-message-content'
    );
    const completionRule = getRule(css, '.grimoire-text-block--with-completion-time');

    expect(contentRule).toContain('gap: var(--grimoire-space-2)');
    expect(completionRule).toContain('padding-bottom: var(--grimoire-space-8)');
    expect(css).toContain('.grimoire-message-completion-time');
  });

  it('separates provider metadata from the response and anchors assistant time to the response edge', () => {
    const css = readMessagesCss();
    const metadataRule = getExactRule(css, '.grimoire-assistant-response-meta');
    const completionRule = getExactRule(
      css,
      '.grimoire-text-block > .grimoire-message-completion-time'
    );

    expect(metadataRule).toContain('margin-bottom: var(--grimoire-space-2)');
    expect(completionRule).toContain('inset-inline-start: 32px');
    expect(completionRule).toContain('pointer-events: auto');
    expect(completionRule).not.toContain('inset-inline-end: 42px');

    const finalCopyRule = getExactRule(
      css,
      '.grimoire-text-block--with-completion-time > .grimoire-text-copy-btn'
    );
    expect(finalCopyRule).toContain('inset-inline-start: 0');
    expect(finalCopyRule).toContain('inset-inline-end: auto');
  });

  it('does not render a second standalone scroll-to-bottom control', () => {
    expect(readMessagesCss()).not.toContain('.grimoire-scroll-resume-btn');
  });

  it('can hide the chat scrollbar while streaming is auto-following output', () => {
    const css = readContainerCss();

    expect(getExactRule(css, '.grimoire-chat-scroll.grimoire-chat-scroll--quiet'))
      .toContain('scrollbar-width: none');
    expect(getExactRule(css, '.grimoire-chat-scroll.grimoire-chat-scroll--quiet::-webkit-scrollbar'))
      .toContain('width: 0');
  });

  it('uses a compact shared window gutter for chat content and the composer', () => {
    const css = readContainerCss();
    const windowRule = getExactRule(css, '.grimoire-container--chat-window');
    const chatScrollRule = getExactRule(css, '.grimoire-chat-scroll');
    const composerRule = getExactRule(css, '.grimoire-composer-surface');
    const headerRule = getExactRule(readHeaderCss(), '.grimoire-header');
    const panelTabsRule = getExactRule(readTabsCss(), '.grimoire-panel-tabs');

    expect(windowRule).toContain('--grimoire-window-padding-x: var(--grimoire-space-3)');
    expect(chatScrollRule).toContain('var(--grimoire-window-padding-x)');
    expect(composerRule).toContain('var(--grimoire-window-padding-x)');
    expect(headerRule).toContain('var(--grimoire-window-padding-x)');
    expect(panelTabsRule).toContain('var(--grimoire-window-padding-x)');
  });

  it('constrains provider markdown media and raw html embeds to the chat width', () => {
    const mediaRule = getRule(
      readChatMarkdownCss(),
      '.grimoire-message-content img,\n.grimoire-message-content video,\n.grimoire-message-content iframe,\n.grimoire-message-content canvas,\n.grimoire-message-content svg'
    );

    expect(mediaRule).toContain('max-width: 100%');
    expect(mediaRule).toContain('height: auto');
  });

  it('keeps code blocks and inline code inside the markdown layout boundary', () => {
    const css = readChatMarkdownCss();

    expect(getRule(css, '.grimoire-code-wrapper')).toContain('max-width: 100%');
    expect(getRule(css, '.grimoire-message-content pre')).toContain('max-width: 100%');
    expect(getRule(css, '.grimoire-message-content :not(pre) > code')).toContain('overflow-wrap: anywhere');
  });
});
