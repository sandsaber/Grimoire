import { createMockEl } from '@test/helpers/mockElement';

import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '@/features/chat/rendering/InlineAskUserQuestion';

beforeAll(() => {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  (globalThis as any).document = { activeElement: null };
});

function makeInput(
  questions: Array<{
    question: string;
    options?: unknown[] | null;
    multiSelect?: boolean;
    header?: string;
    isOther?: boolean;
    isSecret?: boolean;
    id?: string;
  }>,
): Record<string, unknown> {
  return { questions };
}

function renderWidget(
  input: Record<string, unknown>,
  configOrSignal?: InlineAskQuestionConfig | AbortSignal,
): { container: any; resolve: jest.Mock; widget: InlineAskUserQuestion } {
  const container = createMockEl();
  const resolve = jest.fn();
  const isSignal = configOrSignal instanceof AbortSignal;
  const signal = isSignal ? configOrSignal : undefined;
  const config = isSignal ? undefined : configOrSignal;
  const widget = new InlineAskUserQuestion(container, input, resolve, signal, config);
  widget.render();
  return { container, resolve, widget };
}

function fireKeyDown(
  root: any,
  key: string,
  opts: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {},
): void {
  const event = {
    type: 'keydown',
    key,
    shiftKey: opts.shiftKey ?? false,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  };
  root.dispatchEvent(event);
}

function findRoot(container: any): any {
  return container.querySelector('.grimoire-ask-anchor');
}

function getBlocks(container: any): any[] {
  return container.querySelectorAll('.grimoire-ask-qblock');
}

function getOptRows(container: any, blockIdx: number): any[] {
  const blocks = getBlocks(container);
  if (!blocks[blockIdx]) return [];
  return blocks[blockIdx].querySelectorAll('.grimoire-ask-opt');
}

function getFreeform(container: any, blockIdx: number): any {
  const blocks = getBlocks(container);
  if (!blocks[blockIdx]) return null;
  return blocks[blockIdx].querySelector('.grimoire-ask-freeform');
}

function getSubmitBtn(container: any): any {
  return container.querySelector('.grimoire-ask-btn--submit');
}

function getSkipBtn(container: any): any {
  return container.querySelector('.grimoire-ask-btn--skip');
}

function getCollapseBtn(container: any): any {
  return container.querySelector('.grimoire-ask-collapse-toggle');
}

describe('InlineAskUserQuestion', () => {
  describe('parseQuestions', () => {
    it('resolves null when input has no questions', () => {
      const { resolve } = renderWidget({});
      expect(resolve).toHaveBeenCalledWith(null);
    });

    it('resolves null when questions is not an array', () => {
      const { resolve } = renderWidget({ questions: 'bad' });
      expect(resolve).toHaveBeenCalledWith(null);
    });

    it('resolves null when questions array is empty', () => {
      const { resolve } = renderWidget({ questions: [] });
      expect(resolve).toHaveBeenCalledWith(null);
    });

    it('filters out questions with no options when showCustomInput is false and isOther is false', () => {
      const input = makeInput([
        { question: 'Q1', options: [] },
        { question: 'Q2', options: ['A'] },
      ]);
      const { container, resolve } = renderWidget(input, { showCustomInput: false });
      expect(resolve).not.toHaveBeenCalled();
      const blocks = getBlocks(container);
      expect(blocks).toHaveLength(1);
    });

    it('resolves null when all questions are invalid and custom input is disabled', () => {
      const input = makeInput([
        { question: 'Q1', options: [] },
        { question: 'Q2', options: [] },
      ]);
      const { resolve } = renderWidget(input, { showCustomInput: false });
      expect(resolve).toHaveBeenCalledWith(null);
    });

    it('keeps questions with empty options when showCustomInput is true (default)', () => {
      const input = makeInput([
        { question: 'Q1', options: [] },
      ]);
      const { container, resolve } = renderWidget(input);
      expect(resolve).not.toHaveBeenCalled();
      expect(getFreeform(container, 0)).not.toBeNull();
    });

    it('keeps questions with isOther true even with empty options', () => {
      const input = {
        questions: [
          {
            question: 'Enter token',
            options: null,
            isOther: true,
          },
        ],
      };
      const { container, resolve } = renderWidget(input);
      expect(resolve).not.toHaveBeenCalled();
      expect(getFreeform(container, 0)).not.toBeNull();
    });

    it('filters out entries missing required fields', () => {
      const input = {
        questions: [
          { question: 'Valid', options: ['A'] },
          { options: ['B'] },
          'not an object',
          null,
        ],
      };
      const { container, resolve } = renderWidget(input);
      expect(resolve).not.toHaveBeenCalled();
      expect(getBlocks(container)).toHaveLength(1);
    });

    it('deduplicates options with the same label', () => {
      const input = makeInput([
        { question: 'Pick', options: ['A', 'A', 'B'] },
      ]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      expect(rows).toHaveLength(2);
    });

    it('treats non-boolean multiSelect values as false', () => {
      const input = {
        questions: [
          { question: 'Pick one', options: ['A', 'B'], multiSelect: 'false' },
        ],
      };
      const { container } = renderWidget(input);
      const block = getBlocks(container)[0];
      const kindEl = block.querySelector('.grimoire-ask-q-kind');
      expect(kindEl?.textContent).toBe('single');
    });

    it('shows multi kind label for multiSelect questions', () => {
      const input = makeInput([
        { question: 'Pick many', options: ['A', 'B'], multiSelect: true },
      ]);
      const { container } = renderWidget(input);
      const block = getBlocks(container)[0];
      const kindEl = block.querySelector('.grimoire-ask-q-kind');
      expect(kindEl?.textContent).toBe('multiple');
    });

    it('shows freeform kind label for questions with no options', () => {
      const input = makeInput([
        { question: 'Free', options: [] },
      ]);
      const { container } = renderWidget(input);
      const block = getBlocks(container)[0];
      const kindEl = block.querySelector('.grimoire-ask-q-kind');
      expect(kindEl?.textContent).toBe('opt.');
    });
  });

  describe('coerceOption / extractLabel', () => {
    it('handles string options', () => {
      const input = makeInput([{ question: 'Q', options: ['Yes', 'No'] }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const labels = rows.map((r: any) => r.querySelector('.grimoire-ask-opt-text')?.textContent);
      expect(labels).toEqual(['Yes', 'No']);
    });

    it('extracts label from object with label property', () => {
      const input = makeInput([
        {
          question: 'Q',
          options: [{ label: 'Option A' }],
        },
      ]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const text = rows[0]?.querySelector('.grimoire-ask-opt-text')?.textContent;
      expect(text).toBe('Option A');
    });

    it('extracts label from object with value property', () => {
      const input = makeInput([
        { question: 'Q', options: [{ value: 'Option B' }] },
      ]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const text = rows[0]?.querySelector('.grimoire-ask-opt-text')?.textContent;
      expect(text).toBe('Option B');
    });

    it('extracts label from object with text property', () => {
      const input = makeInput([
        { question: 'Q', options: [{ text: 'Option C' }] },
      ]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const text = rows[0]?.querySelector('.grimoire-ask-opt-text')?.textContent;
      expect(text).toBe('Option C');
    });

    it('extracts label from object with name property', () => {
      const input = makeInput([
        { question: 'Q', options: [{ name: 'Option D' }] },
      ]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const text = rows[0]?.querySelector('.grimoire-ask-opt-text')?.textContent;
      expect(text).toBe('Option D');
    });

    it('shows description when provided', () => {
      const input = makeInput([
        { question: 'Q', options: [{ label: 'A', description: 'Some desc' }] },
      ]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const text = rows[0]?.querySelector('.grimoire-ask-opt-text')?.textContent;
      expect(text).toBe('A');
    });

    it('coerces non-string/non-object options to string', () => {
      const input = makeInput([{ question: 'Q', options: [42] }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const text = rows[0]?.querySelector('.grimoire-ask-opt-text')?.textContent;
      expect(text).toBe('42');
    });

    it('uses option value for resolution when provided', () => {
      const input = makeInput([
        {
          question: 'Q',
          options: [{ label: 'Approve', value: 'allow_with_policy' }],
        },
      ]);
      const { container, resolve } = renderWidget(input, { immediateSelect: true, showCustomInput: false });
      const rows = getOptRows(container, 0);
      rows[0]?.click();
      expect(resolve).toHaveBeenCalledWith({ Q: 'allow_with_policy' });
    });
  });

  describe('rendering', () => {
    it('creates root element with grimoire-ask-anchor class', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const root = findRoot(container);
      expect(root).not.toBeNull();
      expect(root.hasClass('grimoire-ask-anchor')).toBe(true);
    });

    it('creates form element inside root', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const form = container.querySelector('.grimoire-ask-form');
      expect(form).not.toBeNull();
    });

    it('renders header with title and subtitle', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const head = container.querySelector('.grimoire-ask-head');
      expect(head).not.toBeNull();
      const title = container.querySelector('.grimoire-ask-title');
      expect(title?.textContent).toBe('Needs a detail');
      const subtitle = container.querySelector('.grimoire-ask-subtitle');
      expect(subtitle?.textContent).toContain('Grimoire asks 1 question');
    });

    it('renders plural subtitle for multiple questions', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container } = renderWidget(input);
      const subtitle = container.querySelector('.grimoire-ask-subtitle');
      expect(subtitle?.textContent).toContain('Grimoire asks 2 questions');
    });

    it('renders ask_user tool pill', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const pill = container.querySelector('.grimoire-ask-tool-pill');
      expect(pill).not.toBeNull();
      const spans = pill?._children?.filter((c: any) => c.tagName === 'SPAN') || [];
      expect(spans.length).toBeGreaterThanOrEqual(1);
      expect(spans[spans.length - 1]?.textContent).toBe('ask_user');
    });

    it('renders a collapse toggle in the header', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const toggle = getCollapseBtn(container);
      expect(toggle).not.toBeNull();
      expect(toggle?.getAttribute('aria-expanded')).toBe('true');
      expect(toggle?.getAttribute('aria-label')).toBe('Collapse question');
    });

    it('renders glyph with SVG icon', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const glyph = container.querySelector('.grimoire-ask-glyph');
      expect(glyph).not.toBeNull();
    });

    it('renders question blocks with correct count', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container } = renderWidget(input);
      const blocks = getBlocks(container);
      expect(blocks).toHaveLength(2);
    });

    it('renders padded question numbers', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container } = renderWidget(input);
      const blocks = getBlocks(container);
      const num0 = blocks[0].querySelector('.grimoire-ask-q-num');
      const num1 = blocks[1].querySelector('.grimoire-ask-q-num');
      expect(num0?.textContent).toBe('01');
      expect(num1?.textContent).toBe('02');
    });

    it('renders question text as title', () => {
      const input = makeInput([{ question: 'What color?', options: ['Red'] }]);
      const { container } = renderWidget(input);
      const title = container.querySelector('.grimoire-ask-q-title');
      expect(title?.textContent).toBe('What color?');
    });

    it('renders single kind label for single-select', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const kind = container.querySelector('.grimoire-ask-q-kind');
      expect(kind?.textContent).toBe('single');
    });

    it('renders radio rings for single-select options', () => {
      const input = makeInput([{ question: 'Q', options: ['A', 'B'] }]);
      const { container } = renderWidget(input);
      const rings = container.querySelectorAll('.grimoire-ask-opt-ring');
      expect(rings).toHaveLength(2);
      const boxes = container.querySelectorAll('.grimoire-ask-opt-box');
      expect(boxes).toHaveLength(0);
    });

    it('renders checkbox boxes for multi-select options', () => {
      const input = makeInput([{ question: 'Q', options: ['A', 'B'], multiSelect: true }]);
      const { container } = renderWidget(input);
      const boxes = container.querySelectorAll('.grimoire-ask-opt-box');
      expect(boxes).toHaveLength(2);
      const rings = container.querySelectorAll('.grimoire-ask-opt-ring');
      expect(rings).toHaveLength(0);
    });

    it('sets radio role on single-select rows', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      expect(rows[0]?.getAttribute('role')).toBe('radio');
    });

    it('sets checkbox role on multi-select rows', () => {
      const input = makeInput([{ question: 'Q', options: ['A'], multiSelect: true }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      expect(rows[0]?.getAttribute('role')).toBe('checkbox');
    });

    it('renders option text labels', () => {
      const input = makeInput([{ question: 'Q', options: ['Alpha', 'Beta'] }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const texts = rows.map((r: any) => r.querySelector('.grimoire-ask-opt-text')?.textContent);
      expect(texts).toEqual(['Alpha', 'Beta']);
    });

    it('renders freeform textarea by default', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      expect(getFreeform(container, 0)).not.toBeNull();
    });

    it('does not render freeform when showCustomInput is false', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input, { showCustomInput: false });
      expect(getFreeform(container, 0)).toBeNull();
    });

    it('renders freeform for questions with no options', () => {
      const input = makeInput([{ question: 'Q', options: [] }]);
      const { container } = renderWidget(input);
      expect(getFreeform(container, 0)).not.toBeNull();
    });

    it('renders freeform for questions with isOther true', () => {
      const input = makeInput([{ question: 'Q', options: ['A'], isOther: true }]);
      const { container } = renderWidget(input, { showCustomInput: false });
      expect(getFreeform(container, 0)).not.toBeNull();
    });

    it('renders actions bar with submit and skip buttons', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const actions = container.querySelector('.grimoire-ask-actions');
      expect(actions).not.toBeNull();
      expect(getSubmitBtn(container)).not.toBeNull();
      expect(getSkipBtn(container)).not.toBeNull();
    });

    it('skip button text is Decide for me', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const skip = getSkipBtn(container);
      expect(skip?.textContent).toBe('Decide for me');
    });

    it('names the action, then points where it sends you', () => {
      // The arrow used to lead, which reads as an icon button that happens to
      // carry a label rather than a verb with a direction.
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const submit = getSubmitBtn(container);
      const spans = submit?._children?.filter((c: any) => c.tagName === 'SPAN') || [];
      expect(spans[0]?.textContent).toBe('Send answers');
      expect(spans[spans.length - 1]?.hasClass('grimoire-ask-btn-arrow')).toBe(true);
    });

    it('does not render shortcut hints in the action bar', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const foot = container.querySelector('.grimoire-ask-foot');
      expect(foot).toBeNull();
      expect(container.querySelector('kbd')).toBeNull();
    });

    it('renders body element as scrollable container', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const body = container.querySelector('.grimoire-ask-body');
      expect(body).not.toBeNull();
    });

    it('renders option mark elements inside each opt row', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const mark = rows[0]?.querySelector('.grimoire-ask-opt-mark');
      expect(mark).not.toBeNull();
    });
  });

  describe('selection', () => {
    it('selects single-select option via click', () => {
      const input = makeInput([{ question: 'Pick one', options: ['A', 'B'] }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      rows[0]?.click();

      expect(rows[0]?.hasClass('is-selected')).toBe(true);
      expect(rows[0]?.getAttribute('aria-checked')).toBe('true');
      expect(rows[1]?.hasClass('is-selected')).toBe(false);
      expect(rows[1]?.getAttribute('aria-checked')).toBe('false');
    });

    it('replaces selection in single-select when clicking different option', () => {
      const input = makeInput([{ question: 'Pick one', options: ['A', 'B'] }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);

      rows[0]?.click();
      expect(rows[0]?.hasClass('is-selected')).toBe(true);

      rows[1]?.click();
      expect(rows[0]?.hasClass('is-selected')).toBe(false);
      expect(rows[0]?.getAttribute('aria-checked')).toBe('false');
      expect(rows[1]?.hasClass('is-selected')).toBe(true);
      expect(rows[1]?.getAttribute('aria-checked')).toBe('true');
    });

    it('toggles multi-select options', () => {
      const input = makeInput([{ question: 'Pick many', options: ['X', 'Y', 'Z'], multiSelect: true }]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);

      rows[0]?.click();
      rows[1]?.click();

      expect(rows[0]?.hasClass('is-selected')).toBe(true);
      expect(rows[1]?.hasClass('is-selected')).toBe(true);
      expect(rows[2]?.hasClass('is-selected')).toBe(false);

      rows[0]?.click();
      expect(rows[0]?.hasClass('is-selected')).toBe(false);
      expect(rows[1]?.hasClass('is-selected')).toBe(true);
    });

    it('clears freeform text when selecting option in single-select', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const ta = getFreeform(container, 0);
      ta.value = 'custom text';
      ta.dispatchEvent({ type: 'input' });

      const rows = getOptRows(container, 0);
      rows[0]?.click();

      expect(ta.value).toBe('');
    });
  });

  describe('collapse toggle', () => {
    it('collapses and expands without resolving the question', () => {
      const input = makeInput([{ question: 'Pick one', options: ['A', 'B'] }]);
      const { container, resolve } = renderWidget(input);
      const root = findRoot(container);
      const toggle = getCollapseBtn(container);

      toggle?.click();

      expect(root?.hasClass('is-collapsed')).toBe(true);
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      expect(toggle?.getAttribute('aria-label')).toBe('Expand question');
      expect(resolve).not.toHaveBeenCalled();

      toggle?.click();

      expect(root?.hasClass('is-collapsed')).toBe(false);
      expect(toggle?.getAttribute('aria-expanded')).toBe('true');
      expect(toggle?.getAttribute('aria-label')).toBe('Collapse question');
      expect(resolve).not.toHaveBeenCalled();
    });

    it('preserves selected answers while collapsed', () => {
      const input = makeInput([{ question: 'Pick one', options: ['A', 'B'] }]);
      const { container, resolve } = renderWidget(input);
      const rows = getOptRows(container, 0);
      const toggle = getCollapseBtn(container);

      rows[1]?.click();
      toggle?.click();
      toggle?.click();
      getSubmitBtn(container)?.click();

      expect(rows[1]?.hasClass('is-selected')).toBe(true);
      expect(resolve).toHaveBeenCalledWith({ 'Pick one': 'B' });
    });

    it('does not select hidden answers from keyboard while collapsed', () => {
      const input = makeInput([{ question: 'Pick one', options: ['A', 'B'] }]);
      const { container, resolve } = renderWidget(input);
      const root = findRoot(container);

      getCollapseBtn(container)?.click();
      fireKeyDown(root, 'Enter');

      expect(getOptRows(container, 0)[0]?.hasClass('is-selected')).toBe(false);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('only traps activation keys on the collapse toggle', () => {
      const input = makeInput([{ question: 'Pick one', options: ['A', 'B'] }]);
      const { container } = renderWidget(input);
      const toggle = getCollapseBtn(container);
      const enterEvent = { type: 'keydown', key: 'Enter', stopPropagation: jest.fn() };
      const escapeEvent = { type: 'keydown', key: 'Escape', stopPropagation: jest.fn() };

      toggle?.dispatchEvent(enterEvent);
      toggle?.dispatchEvent(escapeEvent);

      expect(enterEvent.stopPropagation).toHaveBeenCalledTimes(1);
      expect(escapeEvent.stopPropagation).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('disables submit when required blocks are not answered', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container } = renderWidget(input);
      const submit = getSubmitBtn(container);
      expect(submit?.disabled).toBe(true);
    });

    it('disables submit when only some blocks are answered', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container } = renderWidget(input);
      const rows = getOptRows(container, 0);
      rows[0]?.click();

      const submit = getSubmitBtn(container);
      expect(submit?.disabled).toBe(true);
    });

    it('enables submit when all required blocks are answered', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container } = renderWidget(input);

      getOptRows(container, 0)[0]?.click();
      getOptRows(container, 1)[0]?.click();

      const submit = getSubmitBtn(container);
      expect(submit?.disabled).toBe(false);
    });

    it('freeform text counts as answering a block', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: [] },
      ]);
      const { container } = renderWidget(input);

      getOptRows(container, 0)[0]?.click();
      const ta = getFreeform(container, 1);
      ta.value = 'my answer';
      ta.dispatchEvent({ type: 'input' });

      const submit = getSubmitBtn(container);
      expect(submit?.disabled).toBe(false);
    });
  });

  describe('submit', () => {
    it('collects answers keyed by question text', () => {
      const input = makeInput([
        { question: 'Color?', options: ['Red', 'Blue'] },
        { question: 'Size?', options: ['S', 'M'] },
      ]);
      const { container, resolve } = renderWidget(input);

      getOptRows(container, 0)[0]?.click();
      getOptRows(container, 1)[1]?.click();

      const submit = getSubmitBtn(container);
      submit?.click();

      expect(resolve).toHaveBeenCalledWith({
        'Color?': 'Red',
        'Size?': 'M',
      });
    });

    it('collects answers keyed by question id when provided', () => {
      const input = {
        questions: [
          { id: 'color_q', question: 'Color?', options: ['Red'] },
          { id: 'size_q', question: 'Size?', options: ['M'] },
        ],
      };
      const { container, resolve } = renderWidget(input);

      getOptRows(container, 0)[0]?.click();
      getOptRows(container, 1)[0]?.click();

      getSubmitBtn(container)?.click();

      expect(resolve).toHaveBeenCalledWith({
        color_q: 'Red',
        size_q: 'M',
      });
    });

    it('returns string arrays for multi-select', () => {
      const input = makeInput([
        { question: 'Pick many', options: ['X', 'Y', 'Z'], multiSelect: true },
      ]);
      const { container, resolve } = renderWidget(input, { showCustomInput: false });

      const rows = getOptRows(container, 0);
      rows[0]?.click();
      rows[1]?.click();

      getSubmitBtn(container)?.click();

      expect(resolve).toHaveBeenCalledWith({
        'Pick many': ['X', 'Y'],
      });
    });

    it('returns freeform text when no option selected', () => {
      const input = makeInput([
        { question: 'Q', options: ['A'] },
      ]);
      const { container, resolve } = renderWidget(input);

      const ta = getFreeform(container, 0);
      ta.value = 'my custom';
      ta.dispatchEvent({ type: 'input' });

      getSubmitBtn(container)?.click();

      expect(resolve).toHaveBeenCalledWith({ Q: 'my custom' });
    });

    it('does not submit when validation fails', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container, resolve } = renderWidget(input);

      getOptRows(container, 0)[0]?.click();

      getSubmitBtn(container)?.click();
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  describe('skip', () => {
    it('resolves empty answers on skip button click so the turn can continue', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container, resolve } = renderWidget(input);

      getSkipBtn(container)?.click();
      expect(resolve).toHaveBeenCalledWith({});
    });
  });

  describe('Cmd+Enter / Ctrl+Enter', () => {
    it('submits via Cmd+Enter from form level', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container, resolve } = renderWidget(input);
      const root = findRoot(container);

      getOptRows(container, 0)[0]?.click();
      fireKeyDown(root, 'Enter', { metaKey: true });

      expect(resolve).toHaveBeenCalledWith({ Q: 'A' });
    });

    it('submits via Ctrl+Enter from form level', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container, resolve } = renderWidget(input);
      const root = findRoot(container);

      getOptRows(container, 0)[0]?.click();
      fireKeyDown(root, 'Enter', { ctrlKey: true });

      expect(resolve).toHaveBeenCalledWith({ Q: 'A' });
    });

    it('does not submit via Cmd+Enter when validation fails', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container, resolve } = renderWidget(input);
      const root = findRoot(container);

      getOptRows(container, 0)[0]?.click();
      fireKeyDown(root, 'Enter', { metaKey: true });

      expect(resolve).not.toHaveBeenCalled();
    });

    it('submits via Cmd+Enter from freeform focus', () => {
      const input = makeInput([{ question: 'Q', options: [] }]);
      const { container, resolve } = renderWidget(input);
      const root = findRoot(container);

      const ta = getFreeform(container, 0);
      ta.value = 'answer';
      ta.dispatchEvent({ type: 'input' });
      ta.dispatchEvent({ type: 'focus' });

      fireKeyDown(root, 'Enter', { metaKey: true });
      expect(resolve).toHaveBeenCalledWith({ Q: 'answer' });
    });
  });

  describe('keyboard navigation', () => {
    it('Escape resolves null', () => {
      const input = makeInput([{ question: 'Q', options: ['A', 'B'] }]);
      const { container, resolve } = renderWidget(input);
      const root = findRoot(container);

      fireKeyDown(root, 'Escape');
      expect(resolve).toHaveBeenCalledWith(null);
    });

    it('ArrowDown moves focus to next option in same block', () => {
      const input = makeInput([{ question: 'Q', options: ['A', 'B'] }]);
      const { container } = renderWidget(input, { showCustomInput: false });
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');

      const rows = getOptRows(container, 0);
      expect(rows[1]?.hasClass('is-focused')).toBe(true);
    });

    it('ArrowDown crosses into next block', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container } = renderWidget(input, { showCustomInput: false });
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');

      const rows1 = getOptRows(container, 0);
      expect(rows1[0]?.hasClass('is-focused')).toBe(false);
      const rows2 = getOptRows(container, 1);
      expect(rows2[0]?.hasClass('is-focused')).toBe(true);
    });

    it('ArrowDown clamps at last option of last block', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input, { showCustomInput: false });
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');
      fireKeyDown(root, 'ArrowDown');
      fireKeyDown(root, 'ArrowDown');

      const rows = getOptRows(container, 0);
      expect(rows[0]?.hasClass('is-focused')).toBe(true);
    });

    it('ArrowUp moves focus to previous option', () => {
      const input = makeInput([{ question: 'Q', options: ['A', 'B'] }]);
      const { container } = renderWidget(input, { showCustomInput: false });
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');
      fireKeyDown(root, 'ArrowUp');

      const rows = getOptRows(container, 0);
      expect(rows[0]?.hasClass('is-focused')).toBe(true);
    });

    it('ArrowUp crosses into previous block', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container } = renderWidget(input, { showCustomInput: false });
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');
      fireKeyDown(root, 'ArrowUp');

      const rows1 = getOptRows(container, 0);
      expect(rows1[0]?.hasClass('is-focused')).toBe(true);
    });

    it('ArrowUp clamps at first option of first block', () => {
      const input = makeInput([{ question: 'Q', options: ['A', 'B'] }]);
      const { container } = renderWidget(input, { showCustomInput: false });
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowUp');
      fireKeyDown(root, 'ArrowUp');

      const rows = getOptRows(container, 0);
      expect(rows[0]?.hasClass('is-focused')).toBe(true);
    });

    it('Enter selects option', () => {
      const input = makeInput([{ question: 'Q', options: ['A', 'B'] }]);
      const { container } = renderWidget(input, { showCustomInput: false });
      const root = findRoot(container);

      fireKeyDown(root, 'Enter');

      const rows = getOptRows(container, 0);
      expect(rows[0]?.hasClass('is-selected')).toBe(true);
    });

    it('Enter on option past row count focuses freeform', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container } = renderWidget(input);
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');
      fireKeyDown(root, 'Enter');

      const ta = getFreeform(container, 0);
      const focusListeners = ta?._eventListeners?.get('focus') || [];
      expect(focusListeners.length).toBeGreaterThan(0);
    });
  });

  describe('abort signal', () => {
    it('resolves null when signal is aborted', () => {
      const controller = new AbortController();
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { resolve } = renderWidget(input, controller.signal);

      expect(resolve).not.toHaveBeenCalled();
      controller.abort();
      expect(resolve).toHaveBeenCalledWith(null);
    });

    it('does not double-resolve on abort after manual resolve', () => {
      const controller = new AbortController();
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container, resolve } = renderWidget(input, controller.signal);

      const root = findRoot(container);
      fireKeyDown(root, 'Escape');
      expect(resolve).toHaveBeenCalledTimes(1);

      controller.abort();
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('cleans up abort listener on resolve', () => {
      const controller = new AbortController();
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container, resolve } = renderWidget(input, controller.signal);

      const root = findRoot(container);
      fireKeyDown(root, 'Escape');
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith(null);
    });
  });

  describe('destroy', () => {
    it('resolves null on destroy', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { resolve, widget } = renderWidget(input);

      widget.destroy();
      expect(resolve).toHaveBeenCalledWith(null);
    });

    it('does not double-resolve if already resolved', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container, resolve, widget } = renderWidget(input);

      const root = findRoot(container);
      fireKeyDown(root, 'Escape');
      expect(resolve).toHaveBeenCalledTimes(1);

      widget.destroy();
      expect(resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe('double-resolve prevention', () => {
    it('prevents double resolve from skip then destroy', () => {
      const input = makeInput([{ question: 'Q', options: ['A'] }]);
      const { container, resolve, widget } = renderWidget(input);

      getSkipBtn(container)?.click();
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith({});

      widget.destroy();
      expect(resolve).toHaveBeenCalledTimes(1);
    });
  });
});

function renderImmediateWidget(
  input: Record<string, unknown>,
  config?: InlineAskQuestionConfig,
): { container: any; resolve: jest.Mock; widget: InlineAskUserQuestion } {
  const container = createMockEl();
  const resolve = jest.fn();
  const widget = new InlineAskUserQuestion(
    container,
    input,
    resolve,
    undefined,
    { immediateSelect: true, showCustomInput: false, ...config },
  );
  widget.render();
  return { container, resolve, widget };
}

describe('InlineAskUserQuestion - immediateSelect mode', () => {
  describe('multi-question fallback', () => {
    it('falls back to normal rendering when questions.length !== 1', () => {
      const input = makeInput([
        { question: 'Q1', options: ['A'] },
        { question: 'Q2', options: ['B'] },
      ]);
      const { container, resolve } = renderImmediateWidget(input);

      const blocks = getBlocks(container);
      expect(blocks).toHaveLength(2);

      const rows = getOptRows(container, 0);
      rows[0]?.click();
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  describe('rendering', () => {
    it('does not render tab bar', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container } = renderImmediateWidget(input);
      expect(container.querySelector('.grimoire-ask-tab-bar')).toBeNull();
    });

    it('does not render custom input row when showCustomInput false', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container } = renderImmediateWidget(input);
      expect(getFreeform(container, 0)).toBeNull();
    });

    it('renders question blocks and options normally', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container } = renderImmediateWidget(input);
      const blocks = getBlocks(container);
      expect(blocks).toHaveLength(1);
      const rows = getOptRows(container, 0);
      expect(rows).toHaveLength(2);
    });
  });

  describe('selection', () => {
    it('resolves immediately on click', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container, resolve } = renderImmediateWidget(input);

      const rows = getOptRows(container, 0);
      rows[0]?.click();

      expect(resolve).toHaveBeenCalledWith({ Pick: 'A' });
    });

    it('resolves with second option on click', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container, resolve } = renderImmediateWidget(input);

      const rows = getOptRows(container, 0);
      rows[1]?.click();

      expect(resolve).toHaveBeenCalledWith({ Pick: 'B' });
    });

    it('keys immediate-select result by id when provided', () => {
      const input = {
        questions: [
          { id: 'approval_q', question: 'Allow?', options: ['Yes', 'No'] },
        ],
      };
      const { container, resolve } = renderImmediateWidget(input);

      const rows = getOptRows(container, 0);
      rows[0]?.click();

      expect(resolve).toHaveBeenCalledWith({ approval_q: 'Yes' });
    });
  });

  describe('keyboard navigation', () => {
    it('ArrowDown/Up navigates focus', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B', 'C'] }]);
      const { container } = renderImmediateWidget(input);
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');
      const rows = getOptRows(container, 0);
      expect(rows[1]?.hasClass('is-focused')).toBe(true);

      fireKeyDown(root, 'ArrowUp');
      const rows2 = getOptRows(container, 0);
      expect(rows2[0]?.hasClass('is-focused')).toBe(true);
    });

    it('Enter selects and resolves immediately', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container, resolve } = renderImmediateWidget(input);
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');
      fireKeyDown(root, 'Enter');

      expect(resolve).toHaveBeenCalledWith({ Pick: 'B' });
    });

    it('Escape cancels', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container, resolve } = renderImmediateWidget(input);
      const root = findRoot(container);

      fireKeyDown(root, 'Escape');
      expect(resolve).toHaveBeenCalledWith(null);
    });

    it('Tab is a no-op in immediateSelect', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container, resolve } = renderImmediateWidget(input);
      const root = findRoot(container);

      fireKeyDown(root, 'Tab');
      expect(resolve).not.toHaveBeenCalled();
    });

    it('ArrowDown clamps at last option', () => {
      const input = makeInput([{ question: 'Pick', options: ['A', 'B'] }]);
      const { container } = renderImmediateWidget(input);
      const root = findRoot(container);

      fireKeyDown(root, 'ArrowDown');
      fireKeyDown(root, 'ArrowDown');
      fireKeyDown(root, 'ArrowDown');

      const rows = getOptRows(container, 0);
      expect(rows[1]?.hasClass('is-focused')).toBe(true);
    });
  });
});
