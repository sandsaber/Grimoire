import { sanitizeCodexAssistantText } from '@/providers/codex/normalization/codexAssistantTextSanitizer';

describe('sanitizeCodexAssistantText', () => {
  /*
   * Taken from a real rollout: a plan-mode answer arrives wrapped in
   * `<proposed_plan>` … `</proposed_plan>`, and the plan between them is the
   * whole of what the reader wants. The markup was rendered as text, so a plan
   * opened with a stray tag and closed with another.
   */
  it('drops the proposed-plan wrapper and keeps the plan', () => {
    const text = [
      '<proposed_plan>',
      '# Improving `Maldives.md`',
      '',
      'Check the figures against sources.',
      '</proposed_plan>',
    ].join('\n');

    expect(sanitizeCodexAssistantText(text)).toBe(
      '# Improving `Maldives.md`\n\nCheck the figures against sources.',
    );
  });

  /*
   * The same text arrives as deltas, so the two tags are usually in different
   * chunks — which a paired block pattern would match in neither.
   */
  it('drops the wrapper when each tag arrives in its own chunk', () => {
    expect(sanitizeCodexAssistantText('<proposed_plan>\n# Plan')).toBe('# Plan');
    expect(sanitizeCodexAssistantText('Last step.\n</proposed_plan>')).toBe('Last step.');
  });

  it('leaves a line that merely mentions the tag alone', () => {
    const text = 'Codex wraps plans in <proposed_plan> tags.';

    expect(sanitizeCodexAssistantText(text)).toBe(text);
  });
});
