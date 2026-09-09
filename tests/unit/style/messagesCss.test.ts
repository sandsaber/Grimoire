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
  it('keeps the question a plane at the weight that reaches it', () => {
    // `.grimoire-container--chat-window .grimoire-message` flattens every
    // message to no padding and no radius, and it outranks
    // `.grimoire-message-user` - so the question came out as a full-bleed grey
    // band with its text against the pane's edge. Merging the two as
    // "duplicates" is what removed the counterweight.
    const css = readFileSync('src/style/components/messages.css', 'utf8');
    const scoped = getExactRule(css, '.grimoire-container--chat-window .grimoire-message-user');

    expect(scoped).toContain('padding: var(--grimoire-space-10) var(--grimoire-space-12)');
    expect(scoped).toContain('border-radius: var(--grimoire-radius-2)');
  });

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
    expect(renderedMarkdownRule).toContain('padding-inline-end: var(--grimoire-text-block-inline-end-buffer, var(--grimoire-space-24))');
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

    expect(userBubbleRule).toContain('margin-bottom: var(--grimoire-space-24)');
    expect(userActionsRule).toContain('bottom: calc(-1 * var(--grimoire-hit-s))');
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

  it('puts what can be done with an answer on one row under it', () => {
    // The copy was pinned inside the last text block and the duration sat on a
    // row of its own below it - two lines and two alignments for three small
    // things, where the design has one row: how long it took, then the action.
    const css = readMessagesCss();
    const contentRule = getRule(
      css,
      '.grimoire-container--chat-window .grimoire-message-assistant .grimoire-message-content'
    );
    const footerRule = getExactRule(css, '.grimoire-response-footer');
    const copyRule = getExactRule(css, '.grimoire-response-copy-btn');

    expect(contentRule).toContain('gap: var(--grimoire-space-8)');
    expect(footerRule).toContain('display: flex');
    expect(footerRule).toContain('gap: var(--grimoire-space-2)');
    expect(copyRule).toContain('width: var(--grimoire-hit-s)');
    // Nothing reserves a row inside the prose for a stamp any more.
    expect(css).not.toContain('grimoire-text-block--with-completion-time');
  });

  it('separates provider metadata from the response', () => {
    const css = readMessagesCss();
    const metadataRule = getExactRule(css, '.grimoire-assistant-response-meta');

    expect(metadataRule).toContain('margin-bottom: var(--grimoire-space-4)');
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
    const panelSwitchRule = getExactRule(readTabsCss(), '.grimoire-panel-switch');

    // 12px is the gutter the design draws every column against; the header
    // insets its own left edge to the same line.
    expect(windowRule).toContain('--grimoire-window-padding-x: var(--grimoire-space-12)');
    // The transcript is inset one step further than the chrome around it.
    expect(chatScrollRule).toContain('padding: var(--grimoire-space-16) var(--grimoire-space-16) var(--grimoire-space-8)');
    expect(composerRule).toContain('var(--grimoire-window-padding-x)');
    expect(headerRule).toContain('var(--grimoire-space-12)');
    expect(panelSwitchRule).toContain('var(--grimoire-window-padding-x)');
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

  it('sets a fenced block one step below the prose it answers in', () => {
    // Code in an answer is content the reader reads, not the monospace meta
    // `--grimoire-text-xs` names. One step down puts a block at 12px against
    // 13px of prose - the same optical size the 0.92em correction gives a word
    // of inline code in that prose, rather than below it.
    const css = readChatMarkdownCss();

    expect(getRule(css, '.grimoire-message-content pre')).toContain('font-size: var(--grimoire-text-s)');
    expect(getRule(css, '.grimoire-message-content :not(pre) > code'))
      .toContain('font-size: var(--grimoire-text-inline-code)');
  });
});
