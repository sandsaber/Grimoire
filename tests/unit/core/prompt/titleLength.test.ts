import {
  parseTitleGenerationResponse,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from '@/core/prompt/titleGeneration';
import { MAX_TITLE_LENGTH, TITLE_PROMPT_TARGET_LENGTH, truncateTitleOnWordBoundary } from '@/core/prompt/titleLength';

describe('title length budget', () => {
  it('gives every title source the same budget as a tab title', () => {
    expect(MAX_TITLE_LENGTH).toBe(100);
  });

  it('leaves a title that fits untouched', () => {
    expect(truncateTitleOnWordBoundary('Diagnose a 500 error', 100)).toBe('Diagnose a 500 error');
  });

  it('cuts on a word boundary rather than mid-word', () => {
    const text = 'Диагностика ошибки 500 Internal server error Claude Code при запуске сессии';

    const title = truncateTitleOnWordBoundary(text, 50);

    expect(title).toBe('Диагностика ошибки 500 Internal server error...');
    expect(title.length).toBeLessThanOrEqual(50);
  });

  it('falls back to a hard cut when one word would eat the whole budget', () => {
    const text = 'Debug/a/very/long/path/that/never/breaks/anywhere/at/all short tail';

    const title = truncateTitleOnWordBoundary(text, 30);

    expect(title.endsWith('...')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(title).toBe('Debug/a/very/long/path/that...');
  });

  it('never leaves half of a surrogate pair behind', () => {
    const title = truncateTitleOnWordBoundary(`${'a'.repeat(8)}😀tail`, 10);

    expect(title).toBe('aaaaaaa...');
    expect(title.length).toBeLessThanOrEqual(10);
  });

  it('degrades gracefully when the budget cannot hold an ellipsis', () => {
    expect(truncateTitleOnWordBoundary('hello world', 3)).toBe('hel');
  });
});

describe('generated titles use the shared budget', () => {
  it('asks the model for a concise title, not for the whole budget', () => {
    // The budget is a safety net against mutilation, not a target: asking for
    // it would make every generated title twice as long for no gain, since a
    // tab and a history row ellipsise it anyway.
    expect(TITLE_GENERATION_SYSTEM_PROMPT).toContain(`max ${TITLE_PROMPT_TARGET_LENGTH} chars`);
    expect(TITLE_PROMPT_TARGET_LENGTH).toBeLessThan(MAX_TITLE_LENGTH);
  });

  it('keeps a model answer that overshoots the asked-for length', () => {
    // Weaker models ignore the instruction regularly; the budget is what stops
    // the answer being cut mid-word.
    const overshoot = 'Diagnose the failing deployment pipeline and its cascading effects on staging';

    expect(parseTitleGenerationResponse(overshoot)).toBe(overshoot);
  });

  it('keeps a model title that fits the shared budget whole', () => {
    const title = 'Диагностика ошибки 500 Internal server error Claude Code при запуске';

    expect(parseTitleGenerationResponse(title)).toBe(title);
  });

  it('cuts an over-long model title on a word boundary', () => {
    const parsed = parseTitleGenerationResponse(`${'word '.repeat(40)}tail`);

    expect(parsed).not.toBeNull();
    expect(parsed!.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(parsed!.endsWith('...')).toBe(true);
    expect(parsed!.endsWith('wor...')).toBe(false);
  });
});
