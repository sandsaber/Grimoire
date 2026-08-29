interface FenceState {
  marker: '`' | '~';
  length: number;
}

type DelimiterKind = 'displayOpen' | 'displayClose' | 'inlineOpen' | 'inlineClose';

interface DelimiterToken {
  index: number;
  kind: DelimiterKind;
}

interface DelimiterPair {
  close: DelimiterToken;
  display: boolean;
  open: DelimiterToken;
}

interface Replacement {
  end: number;
  start: number;
  text: string;
}

const DELIMITER_KINDS: Record<string, DelimiterKind> = {
  '(': 'inlineOpen',
  ')': 'inlineClose',
  '[': 'displayOpen',
  ']': 'displayClose',
};

function getFenceRun(line: string): string | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return match?.[1] ?? null;
}

function isClosingFence(line: string, fence: FenceState): boolean {
  const run = getFenceRun(line);
  return !!run && run[0] === fence.marker && run.length >= fence.length;
}

function isHtmlTagStart(line: string, index: number): boolean {
  const next = line[index + 1];
  return !!next && /[A-Za-z/!?]/.test(next);
}

function readBacktickRun(line: string, index: number): number {
  let length = 0;
  while (line[index + length] === '`') {
    length += 1;
  }
  return length;
}

function visitPlainSegmentsInLine(
  line: string,
  lineOffset: number,
  visit: (segment: string, offset: number) => void,
): void {
  let inlineCodeRunLength = 0;
  let inHtmlTag = false;
  let segmentStart: number | null = null;

  const closeSegment = (end: number): void => {
    if (segmentStart !== null) {
      visit(line.slice(segmentStart, end), lineOffset + segmentStart);
      segmentStart = null;
    }
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '`') {
      closeSegment(index);
      const runLength = readBacktickRun(line, index);
      index += runLength - 1;
      if (inlineCodeRunLength === 0) {
        inlineCodeRunLength = runLength;
      } else if (runLength === inlineCodeRunLength) {
        inlineCodeRunLength = 0;
      }
      continue;
    }

    if (inlineCodeRunLength > 0) {
      closeSegment(index);
      continue;
    }

    if (inHtmlTag) {
      closeSegment(index);
      if (char === '>') {
        inHtmlTag = false;
      }
      continue;
    }

    if (char === '<' && isHtmlTagStart(line, index)) {
      closeSegment(index);
      inHtmlTag = true;
      continue;
    }

    if (segmentStart === null) {
      segmentStart = index;
    }
  }

  closeSegment(line.length);
}

/**
 * Visits the parts of `markdown` that are outside fenced code blocks, code
 * spans and raw HTML tags, with their absolute offsets. Both math passes work
 * from this single scan so they agree on what counts as prose.
 */
function forEachPlainSegment(
  markdown: string,
  visit: (segment: string, offset: number) => void,
): void {
  let fence: FenceState | null = null;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart);
    const lineEnd = newlineIndex === -1 ? markdown.length : newlineIndex + 1;
    const line = markdown.slice(lineStart, lineEnd);
    const lineWithoutNewline = line.endsWith('\n') ? line.slice(0, -1) : line;

    if (fence) {
      if (isClosingFence(lineWithoutNewline, fence)) {
        fence = null;
      }
    } else {
      const fenceRun = getFenceRun(lineWithoutNewline);
      if (fenceRun) {
        fence = {
          marker: fenceRun[0] as '`' | '~',
          length: fenceRun.length,
        };
      } else {
        visitPlainSegmentsInLine(line, lineStart, visit);
      }
    }

    lineStart = lineEnd;
  }
}

function escapeDollarsInPlainSegment(segment: string): string {
  let escaped = '';

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];

    if (char === '\\' && segment[index + 1] === '$') {
      escaped += '\\$';
      index += 1;
      continue;
    }

    escaped += char === '$' ? '\\$' : char;
  }

  return escaped;
}

function collectLatexDelimiters(markdown: string): DelimiterToken[] {
  const tokens: DelimiterToken[] = [];

  forEachPlainSegment(markdown, (segment, offset) => {
    for (let index = 0; index < segment.length; index += 1) {
      if (segment[index] !== '\\') {
        continue;
      }

      let runLength = 1;
      while (segment[index + runLength] === '\\') {
        runLength += 1;
      }

      const next = segment[index + runLength];
      const kind = next ? DELIMITER_KINDS[next] : undefined;
      // A doubled backslash is LaTeX's own line break, so `\\[2pt]` is row
      // spacing inside a formula rather than a display-math opener.
      if (kind && runLength % 2 === 1) {
        tokens.push({ index: offset + index + runLength - 1, kind });
      }

      index += runLength;
    }
  });

  return tokens;
}

function pairLatexDelimiters(tokens: DelimiterToken[]): DelimiterPair[] {
  const pairs: DelimiterPair[] = [];
  let openDisplay: DelimiterToken | null = null;
  let openInline: DelimiterToken | null = null;

  for (const token of tokens) {
    if (openDisplay) {
      // Anything between `\[` and `\]` belongs to the formula, including
      // parentheses that look like inline delimiters.
      if (token.kind === 'displayClose') {
        pairs.push({ close: token, display: true, open: openDisplay });
        openDisplay = null;
      }
      continue;
    }

    if (token.kind === 'displayOpen') {
      openInline = null;
      openDisplay = token;
      continue;
    }

    if (token.kind === 'inlineOpen') {
      openInline = token;
      continue;
    }

    if (token.kind === 'inlineClose' && openInline) {
      pairs.push({ close: token, display: false, open: openInline });
      openInline = null;
    }
  }

  return pairs;
}

function isInlinePadding(char: string | undefined): boolean {
  return char === ' ' || char === '\t';
}

function buildDelimiterReplacements(markdown: string, pairs: DelimiterPair[]): Replacement[] {
  const replacements: Replacement[] = [];

  for (const { close, display, open } of pairs) {
    if (display) {
      replacements.push({ end: open.index + 2, start: open.index, text: '$$' });
      replacements.push({ end: close.index + 2, start: close.index, text: '$$' });
      continue;
    }

    // Obsidian is strict about padding inside `$...$`, so the spaces LaTeX
    // authors put next to `\(` and `\)` are absorbed into the delimiters.
    let innerStart = open.index + 2;
    let innerEnd = close.index;
    while (innerStart < innerEnd && isInlinePadding(markdown[innerStart])) {
      innerStart += 1;
    }
    while (innerEnd > innerStart && isInlinePadding(markdown[innerEnd - 1])) {
      innerEnd -= 1;
    }

    replacements.push({ end: innerStart, start: open.index, text: '$' });
    replacements.push({ end: close.index + 2, start: innerEnd, text: '$' });
  }

  return replacements.sort((left, right) => left.start - right.start);
}

/**
 * Rewrites LaTeX math delimiters into the dollar form Obsidian renders.
 *
 * Models routinely answer with `\( x \)` and `\[ x \]`, which Obsidian's
 * MathJax integration does not recognize - Markdown reads the backslash as an
 * escape, so the formula lands as literal text with its brackets stripped and
 * its subscripts turned into emphasis. Only matched pairs outside code are
 * rewritten, so prose that merely mentions an escaped bracket is left alone.
 */
export function normalizeLatexDelimiters(markdown: string): string {
  if (!markdown.includes('\\')) {
    return markdown;
  }

  const replacements = buildDelimiterReplacements(
    markdown,
    pairLatexDelimiters(collectLatexDelimiters(markdown)),
  );
  if (replacements.length === 0) {
    return markdown;
  }

  let result = '';
  let cursor = 0;
  for (const replacement of replacements) {
    result += markdown.slice(cursor, replacement.start) + replacement.text;
    cursor = replacement.end;
  }

  return result + markdown.slice(cursor);
}

/**
 * Escapes dollar math delimiters outside code spans and fenced code blocks.
 * Used only for transient streaming renders so MarkdownRenderer does not hand
 * incomplete math to Obsidian's math renderer on every frame.
 */
export function escapeMathDelimitersForStreaming(markdown: string): string {
  if (!markdown.includes('$')) {
    return markdown;
  }

  let result = '';
  let cursor = 0;
  forEachPlainSegment(markdown, (segment, offset) => {
    result += markdown.slice(cursor, offset) + escapeDollarsInPlainSegment(segment);
    cursor = offset + segment.length;
  });

  return result + markdown.slice(cursor);
}

export function hasStreamingMathDelimiters(markdown: string): boolean {
  const normalized = normalizeLatexDelimiters(markdown);
  if (!normalized.includes('$')) {
    return false;
  }

  return escapeMathDelimitersForStreaming(normalized) !== normalized;
}
