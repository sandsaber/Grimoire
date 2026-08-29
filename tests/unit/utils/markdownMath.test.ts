import {
  escapeMathDelimitersForStreaming,
  hasStreamingMathDelimiters,
  normalizeLatexDelimiters,
} from '@/utils/markdownMath';

describe('markdownMath', () => {
  describe('escapeMathDelimitersForStreaming', () => {
    it('escapes inline and display math delimiters outside code', () => {
      expect(escapeMathDelimitersForStreaming('Use $x + y$ and $$z^2$$.')).toBe(
        'Use \\$x + y\\$ and \\$\\$z^2\\$\\$.'
      );
    });

    it('preserves inline code and fenced code dollars', () => {
      const markdown = [
        'Text $x$',
        '`echo $PATH`',
        '```bash',
        'echo "$HOME"',
        '```',
        'Done $$y$$',
      ].join('\n');

      expect(escapeMathDelimitersForStreaming(markdown)).toBe([
        'Text \\$x\\$',
        '`echo $PATH`',
        '```bash',
        'echo "$HOME"',
        '```',
        'Done \\$\\$y\\$\\$',
      ].join('\n'));
    });

    it('keeps already escaped dollars unchanged', () => {
      expect(escapeMathDelimitersForStreaming('Cost is \\$5, math is $x$.')).toBe(
        'Cost is \\$5, math is \\$x\\$.'
      );
    });

    it('does not alter dollars inside raw html tag attributes', () => {
      expect(escapeMathDelimitersForStreaming('<span title="$x$">value $y$</span>')).toBe(
        '<span title="$x$">value \\$y\\$</span>'
      );
    });
  });

  describe('normalizeLatexDelimiters', () => {
    it('rewrites paired display and inline delimiters into dollar math', () => {
      expect(normalizeLatexDelimiters('\\[\nx^2 = 1\n\\]')).toBe('$$\nx^2 = 1\n$$');
      expect(normalizeLatexDelimiters('point \\((x,y)\\neq(0,0)\\) holds')).toBe(
        'point $(x,y)\\neq(0,0)$ holds'
      );
    });

    it('absorbs the padding LaTeX authors leave inside inline delimiters', () => {
      expect(normalizeLatexDelimiters('value \\( \\lambda \\) here')).toBe(
        'value $\\lambda$ here'
      );
    });

    it('leaves unpaired delimiters alone', () => {
      expect(normalizeLatexDelimiters('an escaped bracket \\[ stays put')).toBe(
        'an escaped bracket \\[ stays put'
      );
      expect(normalizeLatexDelimiters('closing only \\) here')).toBe('closing only \\) here');
    });

    it('keeps delimiters inside code spans and fenced code', () => {
      const markdown = [
        '`\\(x\\)`',
        '```tex',
        '\\[y\\]',
        '```',
        'and \\(z\\)',
      ].join('\n');

      expect(normalizeLatexDelimiters(markdown)).toBe([
        '`\\(x\\)`',
        '```tex',
        '\\[y\\]',
        '```',
        'and $z$',
      ].join('\n'));
    });

    it('treats a doubled backslash as a LaTeX line break, not a delimiter', () => {
      expect(normalizeLatexDelimiters('\\[\na \\\\[2pt] b\n\\]')).toBe('$$\na \\\\[2pt] b\n$$');
    });

    it('keeps parentheses inside display math out of the pairing', () => {
      expect(normalizeLatexDelimiters('\\[\nf\\(x\\) = 1\n\\]')).toBe('$$\nf\\(x\\) = 1\n$$');
    });
  });

  describe('hasStreamingMathDelimiters', () => {
    it('detects unescaped dollars outside code', () => {
      expect(hasStreamingMathDelimiters('math $x$')).toBe(true);
      expect(hasStreamingMathDelimiters('`echo $PATH`')).toBe(false);
      expect(hasStreamingMathDelimiters('\\$5')).toBe(false);
    });

    it('detects latex delimiters that only become dollars after normalization', () => {
      expect(hasStreamingMathDelimiters('math \\(x\\)')).toBe(true);
      expect(hasStreamingMathDelimiters('unpaired \\( x')).toBe(false);
    });

    it('answers the same for a backslash-heavy message with the cheap guard in front', () => {
      // The guard exists for cost: this is asked for the whole accumulated
      // message on every stream frame, and the normalizer's own check only asks
      // for a backslash — so a code block full of them walked the entire text
      // per frame. What a test can hold is that the shortcut did not change any
      // answer, including the one that is only math after normalizing.
      const backslashes = '```js\nconst re = /\\d+\\s\\w/;\n```\n'.repeat(200);

      expect(hasStreamingMathDelimiters(backslashes)).toBe(false);
      // The two shapes it must still see, one raw and one only after normalizing.
      expect(hasStreamingMathDelimiters(`${backslashes}and $x$`)).toBe(true);
      expect(hasStreamingMathDelimiters(`${backslashes}and \\(x\\)`)).toBe(true);
    });
  });
});
