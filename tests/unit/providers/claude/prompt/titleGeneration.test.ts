import {
  buildTitleGenerationSystemPrompt,
  parseTitleGenerationResponse,
  resolveTitleLanguageName,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from '@/core/prompt/titleGeneration';
import { setLocale } from '@/i18n/i18n';

describe('titleGeneration', () => {
  it('exports a non-empty system prompt string', () => {
    expect(typeof TITLE_GENERATION_SYSTEM_PROMPT).toBe('string');
    expect(TITLE_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it('includes the max character constraint', () => {
    expect(TITLE_GENERATION_SYSTEM_PROMPT).toContain('max 50 chars');
  });

  it('instructs to start with a strong verb', () => {
    expect(TITLE_GENERATION_SYSTEM_PROMPT).toContain('strong verb');
  });

  it('instructs to return only the raw title text', () => {
    expect(TITLE_GENERATION_SYSTEM_PROMPT).toContain('ONLY the raw title text');
  });

  describe('buildTitleGenerationSystemPrompt', () => {
    afterEach(() => {
      setLocale('en');
    });

    it('resolves a locale to its English language name', () => {
      expect(resolveTitleLanguageName('ru')).toBe('Russian');
      expect(resolveTitleLanguageName('en')).toBe('English');
    });

    it('falls back to English for an unknown locale', () => {
      expect(resolveTitleLanguageName('xx' as never)).toBe('English');
    });

    it('keeps the base rules and appends the current locale language directive', () => {
      setLocale('ru');
      const prompt = buildTitleGenerationSystemPrompt();
      expect(prompt).toContain(TITLE_GENERATION_SYSTEM_PROMPT);
      expect(prompt).toContain('Write the title in Russian');
    });

    it('honours an explicit locale argument', () => {
      expect(buildTitleGenerationSystemPrompt('ja')).toContain('Write the title in Japanese');
    });
  });

  describe('parseTitleGenerationResponse', () => {
    it('returns a clean title unchanged', () => {
      expect(parseTitleGenerationResponse('Fix the title parser')).toBe('Fix the title parser');
    });

    it('strips a leading "Generated" prefix from weak models', () => {
      expect(parseTitleGenerationResponse('generated: Fix the title parser'))
        .toBe('Fix the title parser');
      expect(parseTitleGenerationResponse('Generated title - Fix the title parser'))
        .toBe('Fix the title parser');
    });

    it('strips a leading "Title:" / localized label prefix', () => {
      expect(parseTitleGenerationResponse('Title: Debug Python script')).toBe('Debug Python script');
      expect(parseTitleGenerationResponse('Заголовок: Настроить Klipper')).toBe('Настроить Klipper');
    });

    it('strips leading markdown noise and conversational preambles', () => {
      expect(parseTitleGenerationResponse('- Fix the parser')).toBe('Fix the parser');
      expect(parseTitleGenerationResponse('## Fix the parser')).toBe('Fix the parser');
      expect(parseTitleGenerationResponse("Here is the title: Fix the parser")).toBe('Fix the parser');
    });

    it('takes the real title when a label sits on its own line', () => {
      expect(parseTitleGenerationResponse('Generated title:\n\nFix the parser')).toBe('Fix the parser');
    });

    it('still trims wrapping quotes and trailing punctuation', () => {
      expect(parseTitleGenerationResponse('"Fix the parser."')).toBe('Fix the parser');
    });

    it('returns null when nothing survives stripping', () => {
      expect(parseTitleGenerationResponse('   ')).toBeNull();
      expect(parseTitleGenerationResponse('Title:')).toBeNull();
    });

    it('strips a preamble whatever determiner it uses', () => {
      expect(parseTitleGenerationResponse('Here is your title: Fix the parser')).toBe('Fix the parser');
      expect(parseTitleGenerationResponse('Here is my title: Fix the parser')).toBe('Fix the parser');
      expect(parseTitleGenerationResponse('Here is the title: Fix the parser')).toBe('Fix the parser');
    });

    it('skips an announcement that sits on its own line', () => {
      // Stripping cannot know every phrasing; taking the first line regardless
      // would promote the announcement and lose the title under it.
      expect(parseTitleGenerationResponse('Here is your suggestion:\nFix the parser'))
        .toBe('Fix the parser');
    });

    it('keeps a title that merely ends in a colon when it is all there is', () => {
      expect(parseTitleGenerationResponse('Debugging:')).toBe('Debugging');
    });

    it('does not skip a colon line long enough to be a title in its own right', () => {
      const long = 'Diagnose the failing deployment pipeline and its cascading effects:';

      const title = parseTitleGenerationResponse(`${long}\nsecond line`);

      expect(title).toMatch(/^Diagnose the failing deployment/);
      expect(title).not.toBe('second line');
    });
  });
});
