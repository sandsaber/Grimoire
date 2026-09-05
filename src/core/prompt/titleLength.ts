/**
 * Shared length budget for conversation titles.
 *
 * A tab title, a model-generated title and the deterministic fallback title all end up
 * in the same place, so they share one budget: a title's length must not depend on which
 * mechanism happened to produce it.
 */
export const MAX_TITLE_LENGTH = 100;

/**
 * The length the model is asked to aim for.
 *
 * Deliberately below the budget. The budget exists so a title is never
 * mutilated mid-word; asking for it as well would make every generated title
 * twice as long, and a tab or a history row ellipsises it anyway. Asking for a
 * short title and allowing a longer one is what keeps titles both concise and
 * whole.
 */
export const TITLE_PROMPT_TARGET_LENGTH = 50;

const ELLIPSIS = '...';
const NOISE_CHAR = /[\s.,;:!?—–-]/;
/**
 * A word-boundary cut is preferred, but only while it keeps a useful share of the
 * budget. Text that opens with one very long token (a path, a URL) would otherwise
 * collapse to a single word.
 */
const MIN_WORD_CUT_RATIO = 0.3;

/**
 * Trailing punctuation and whitespace, trimmed one character at a time so that
 * no amount of it can make the scan super-linear.
 *
 * A cut lands wherever the budget runs out, so without this a title ends on the
 * comma or dash it happened to stop at: `the tokenizer,...` rather than
 * `the tokenizer...`.
 */
export function trimTitleNoise(text: string): string {
  let end = text.length;
  while (end > 0 && NOISE_CHAR.test(text[end - 1])) {
    end -= 1;
  }

  return text.slice(0, end);
}

/** A cut must not leave the leading half of a surrogate pair behind. */
export function trimDanglingSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

/**
 * Cuts `text` to `maxLength`, preferring the last word boundary and marking the
 * cut with an ellipsis. Every producer gets the same result for the same input:
 * one budget is only half the point of sharing this, the other half is that a
 * title does not end differently depending on who cut it.
 */
export function truncateTitleOnWordBoundary(
  text: string,
  maxLength: number = MAX_TITLE_LENGTH,
): string {
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= ELLIPSIS.length) {
    return trimDanglingSurrogate(text.slice(0, maxLength));
  }

  const hardCut = trimDanglingSurrogate(text.slice(0, maxLength - ELLIPSIS.length)).trimEnd();
  const lastSpace = hardCut.lastIndexOf(' ');
  const wordCut = lastSpace > 0 ? trimTitleNoise(hardCut.slice(0, lastSpace)) : '';

  if (wordCut.length >= maxLength * MIN_WORD_CUT_RATIO) {
    return `${wordCut}${ELLIPSIS}`;
  }

  return `${hardCut}${ELLIPSIS}`;
}
