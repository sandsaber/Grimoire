import { extractUserQuery } from '../../utils/context';
import {
  MAX_TITLE_LENGTH,
  trimDanglingSurrogate,
  trimTitleNoise,
  truncateTitleOnWordBoundary,
} from './titleLength';

const DEFAULT_MAX_TITLE_LENGTH = MAX_TITLE_LENGTH;
/** Below this length a first sentence carries too little signal to stand alone as a title. */
const MIN_SIGNAL_LENGTH = 12;
/**
 * A first message can carry a pasted file. Only its opening can ever reach a title,
 * so every scan below runs over a bounded prefix instead of the whole paste.
 */
const SCAN_LIMIT = 4096;
const TAG_NAME = /^[A-Za-z_][\w.:-]*/;

export interface FallbackTitleOptions {
  /** Maximum length of the returned title. Defaults to the shared title budget. */
  maxLength?: number;
  /** Titles already in use; a matching title gets a numeric discriminator. */
  existingTitles?: Iterable<string>;
}

/**
 * Builds a conversation title from the first user message without calling a model.
 *
 * Deterministic and side-effect free: context blocks are dropped, the first
 * meaningful sentence is selected without breaking on decimals or versions, the
 * result is folded onto one line, cut on a word boundary and disambiguated against
 * existing titles.
 */
export function buildFallbackTitle(
  message: string,
  options: FallbackTitleOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_TITLE_LENGTH;
  const text = selectTitleSource(message);
  if (!text) {
    return '';
  }

  const sentence = selectFirstMeaningfulSentence(text);
  const truncated = truncateTitleOnWordBoundary(collapseWhitespace(sentence), maxLength);

  return disambiguate(truncated, options.existingTitles, maxLength);
}

/**
 * Narrows the message down to what the user actually typed.
 *
 * `extractUserQuery` removes the context Grimoire appends to a prompt, which is
 * written as a suffix; the leading-block pass additionally drops blocks a CLI host
 * prepends, such as `<git_status>` or a self-closing `<image … />` marker.
 */
function selectTitleSource(message: string): string {
  const bounded = message.slice(0, SCAN_LIMIT).trim();
  if (!bounded) {
    return '';
  }

  return stripLeadingContextBlocks(extractUserQuery(bounded).trim() || bounded);
}

function stripLeadingContextBlocks(text: string): string {
  let rest = text;

  for (;;) {
    if (!rest.startsWith('<')) {
      return rest;
    }

    const name = readTagName(rest, 1);
    if (!name) {
      return rest;
    }

    const blockEnd = findLeadingBlockEnd(rest, name);
    if (blockEnd === -1) {
      return rest;
    }

    const next = rest.slice(blockEnd).trim();
    if (!next) {
      // Nothing but blocks. A host context dump carries no identity worth keeping,
      // while markup the user typed is the only signal this message has.
      return isContextBlockName(name) ? '' : rest;
    }

    rest = next;
  }
}

/** Host context blocks are snake_case by convention; markup a user types is not. */
function isContextBlockName(name: string): boolean {
  return name.includes('_');
}

function readTagName(text: string, start: number): string {
  return TAG_NAME.exec(text.slice(start, start + 64))?.[0] ?? '';
}

/** Index just past the block opened at 0, or -1 when the text does not open one. */
function findLeadingBlockEnd(text: string, name: string): number {
  const openEnd = findTagEnd(text, 0);
  if (openEnd === -1) {
    return -1;
  }
  if (text[openEnd - 1] === '/') {
    return openEnd + 1;
  }

  return findBlockEnd(text, name, openEnd + 1);
}

/**
 * End of the block whose opening tag ends before `from`, counting nested tags of the
 * same name. A block that is never closed ends with its opening tag.
 */
function findBlockEnd(text: string, name: string, from: number): number {
  let depth = 1;
  let index = from;

  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      break;
    }

    const end = findTagEnd(text, open);
    if (end === -1) {
      break;
    }

    if (isTagNamed(text, open, name)) {
      if (text[open + 1] === '/') {
        depth -= 1;
        if (depth === 0) {
          return end + 1;
        }
      } else if (text[end - 1] !== '/') {
        depth += 1;
      }
    }

    index = end + 1;
  }

  return from;
}

/** Index of the `>` closing the tag that starts at `start`, ignoring quoted values. */
function findTagEnd(text: string, start: number): number {
  let quote = '';

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      return index;
    }
  }

  return -1;
}

function isTagNamed(text: string, index: number, name: string): boolean {
  const start = index + (text[index + 1] === '/' ? 2 : 1);
  return text.startsWith(name, start) && /[\s/>]/.test(text[start + name.length] ?? '>');
}

/**
 * Returns the first sentence long enough to describe the request. Sentence ends are
 * detected on line breaks and on terminal punctuation that is not part of a number
 * such as `0.4` or `1.4.5`.
 */
function selectFirstMeaningfulSentence(text: string): string {
  for (let index = 0; index < text.length; index += 1) {
    if (!isSentenceEnd(text, index)) {
      continue;
    }

    const candidate = trimTitleNoise(text.slice(0, index));
    if (candidate.length >= MIN_SIGNAL_LENGTH) {
      return candidate;
    }
  }

  return trimTitleNoise(text);
}

function isSentenceEnd(text: string, index: number): boolean {
  const char = text[index];
  if (char === '\n') {
    return true;
  }
  if (char !== '.' && char !== '!' && char !== '?') {
    return false;
  }

  const next = text[index + 1];
  if (isDigit(text[index - 1]) && isDigit(next)) {
    return false;
  }

  return next === undefined || /\s/.test(next);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

/** Titles are single-line: they are stored as metadata and a rename input would drop
 * the breaks anyway, gluing the surrounding words together. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function disambiguate(
  title: string,
  existingTitles: Iterable<string> | undefined,
  maxLength: number,
): string {
  if (!title || !existingTitles) {
    return title;
  }

  const taken = new Set<string>();
  for (const existing of existingTitles) {
    if (typeof existing === 'string') {
      taken.add(existing.trim());
    }
  }

  if (!taken.has(title)) {
    return title;
  }

  // ` 2`, ` 3` … is the discriminator tab duplication and forking already use.
  // Distinct counters always render distinct candidates, so a finite set of taken
  // titles cannot keep the loop running.
  for (let counter = 2; ; counter += 1) {
    const suffix = ` ${counter}`;
    const base = title.length + suffix.length <= maxLength
      ? title
      : trimDanglingSurrogate(title.slice(0, Math.max(1, maxLength - suffix.length))).trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
