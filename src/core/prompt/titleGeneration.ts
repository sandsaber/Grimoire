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

export function buildTitleGenerationPrompt(userMessage: string): string {
  const truncated = userMessage.length > MAX_TITLE_INPUT_LENGTH
    ? `${userMessage.slice(0, MAX_TITLE_INPUT_LENGTH)}...`
    : userMessage;
  return `User's request:\n"""\n${truncated}\n"""\n\nGenerate a title for this conversation:`;
}

export function parseTitleGenerationResponse(responseText: string): string | null {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return null;
  }

  let title = trimmed;
  if (
    (title.startsWith('"') && title.endsWith('"'))
    || (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }

  title = title.replace(/[.!?:;,]+$/, '');

  title = truncateTitleOnWordBoundary(title, MAX_TITLE_LENGTH);

  return title || null;
}
