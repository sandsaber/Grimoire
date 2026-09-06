import { getLocaleInfo } from '../../i18n/constants';
import { getLocale } from '../../i18n/i18n';
import type { Locale } from '../../i18n/types';
import {
  MAX_TITLE_LENGTH,
  TITLE_PROMPT_TARGET_LENGTH,
  truncateTitleOnWordBoundary,
} from './titleLength';

const MAX_TITLE_INPUT_LENGTH = 500;

export const TITLE_GENERATION_SYSTEM_PROMPT = `You are a specialist in summarizing user intent.

**Task**: Generate a **concise, descriptive title** (max ${TITLE_PROMPT_TARGET_LENGTH} chars) summarizing the user's task/request.

**Rules**:
1.  **Format**: Sentence case. No periods/quotes.
2.  **Structure**: Start with a **strong verb** (e.g., Create, Fix, Debug, Explain, Analyze).
3.  **Forbidden**: "Conversation with...", "Help me...", "Question about...", "I need...".
4.  **Tech Context**: Detect and include the primary language/framework if code is present (e.g., "Debug Python script", "Refactor React hook").

**Output**: Return ONLY the raw title text.`;

/**
 * Resolve the human-readable (English) name of a locale, e.g. `ru` -> `Russian`.
 * Falls back to English for unknown locales.
 */
export function resolveTitleLanguageName(locale: Locale = getLocale()): string {
  return getLocaleInfo(locale)?.englishName ?? 'English';
}

/**
 * Build the title-generation system prompt for the plugin's current locale.
 * The base instructions stay in English (models follow them more reliably),
 * but an explicit directive forces the generated title into the UI language so
 * a Russian vault does not get English tab titles.
 */
export function buildTitleGenerationSystemPrompt(locale: Locale = getLocale()): string {
  const language = resolveTitleLanguageName(locale);
  return `${TITLE_GENERATION_SYSTEM_PROMPT}

**Language**: Write the title in ${language}. This overrides any language implied by the examples above; only the final title text is translated, the rules are unchanged.`;
}

export function buildTitleGenerationPrompt(userMessage: string): string {
  const truncated = userMessage.length > MAX_TITLE_INPUT_LENGTH
    ? `${userMessage.slice(0, MAX_TITLE_INPUT_LENGTH)}...`
    : userMessage;
  return `User's request:\n"""\n${truncated}\n"""\n\nGenerate a title for this conversation:`;
}

// Weaker local models tend to ignore "return ONLY the raw title" and prepend a
// label ("Generated title:", "Title -", "Заголовок:") or wrap the answer in a
// conversational preamble / markdown heading. Strip those before using the text.
const TITLE_NOISE_PREFIXES: readonly RegExp[] = [
  /^\s*(?:#{1,6}\s+|>\s+|[-*•]\s+)/,
  /^\s*(?:(?:here(?:'s| is)|this is)\s+(?:a|the|your|my|one)\s+)?(?:(?:auto[-\s]?)?generated|suggested|proposed|conversation|chat)?\s*(?:title|name|заголовок|название|тема)\s*[:：\-–—]\s*/i,
  /^\s*(?:auto[-\s]?)?generated\s*[:：\-–—]\s*/i,
];

/**
 * One pass per prefix that can stack ahead of the title (`## Generated title:`
 * is already three), plus one that finds nothing and ends the loop.
 */
const MAX_NOISE_STRIP_PASSES = TITLE_NOISE_PREFIXES.length + 1;

function stripTitleNoise(text: string): string {
  let out = text.trim();
  for (let pass = 0; pass < MAX_NOISE_STRIP_PASSES; pass += 1) {
    let changed = false;
    for (const pattern of TITLE_NOISE_PREFIXES) {
      const next = out.replace(pattern, '');
      if (next !== out) {
        out = next.trim();
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return out;
}

/**
 * A line that only announces the title, such as `Here is your title:`.
 *
 * Stripping cannot recognise every phrasing a model invents, and taking the
 * first line on its own would then promote the announcement over the title
 * below it - losing the answer entirely, where before it at least survived
 * inside the text.
 */
function isLabelOnlyLine(line: string): boolean {
  return /[:：]$/.test(line) && line.length <= 60;
}

export function parseTitleGenerationResponse(responseText: string): string | null {
  const stripped = stripTitleNoise(responseText);
  if (!stripped) {
    return null;
  }

  const lines = stripped.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines.find((line, index) => !(isLabelOnlyLine(line) && index < lines.length - 1))
    ?? lines[0];
  if (!firstLine) {
    return null;
  }

  let title = firstLine;
  if (
    (title.startsWith('"') && title.endsWith('"'))
    || (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim();
  }

  title = title.replace(/[.!?:;,]+$/, '').trim();

  title = truncateTitleOnWordBoundary(title, MAX_TITLE_LENGTH);

  return title || null;
}
