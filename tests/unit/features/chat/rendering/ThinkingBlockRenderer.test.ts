import { createMockEl } from '@test/helpers/mockElement';

import {
  createThinkingBlock,
  finalizeThinkingBlock,
  renderStoredThinkingBlock,
} from '@/features/chat/rendering/ThinkingBlockRenderer';

// Mock renderContent function
const mockRenderContent = jest.fn().mockResolvedValue(undefined);

describe('ThinkingBlockRenderer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createThinkingBlock', () => {
    it('should show timer label', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);

      expect(state.labelEl.textContent).toContain('Thinking');
    });

    it('should clean up timer on finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);

      expect(state.timerInterval).not.toBeNull();

      finalizeThinkingBlock(state);

      expect(state.timerInterval).toBeNull();
    });
  });

  describe('finalizeThinkingBlock', () => {
    it('should collapse the block when finalized', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);

      // Manually expand first
      state.wrapperEl.addClass('expanded');
      state.contentEl.style.display = 'block';

      finalizeThinkingBlock(state);

      expect(state.wrapperEl.hasClass('expanded')).toBe(false);
      expect(state.contentEl.style.display).toBe('none');
    });

    it('should update label with final duration', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);

      // Advance time by 5 seconds
      jest.advanceTimersByTime(5000);

      const duration = finalizeThinkingBlock(state);

      expect(duration).toBeGreaterThanOrEqual(5);
      expect(state.labelEl.textContent).toContain('Thought for');
    });

    it('should sync isExpanded state so toggle works correctly after finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);
      const header = (state.wrapperEl as any)._children[0];

      // Expand the block
      const clickHandlers = header._eventListeners.get('click') || [];
      clickHandlers[0]();
      expect(state.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);

      // Finalize (which collapses)
      finalizeThinkingBlock(state);
      expect(state.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);

      // Now click once - should expand (not require two clicks)
      clickHandlers[0]();
      expect(state.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);
      expect((state.contentEl as any).hasClass('grimoire-hidden')).toBe(false);
    });

    it('should update aria-expanded on finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);
      state.content = 'Reasoning the reader can open.';
      const header = (state.wrapperEl as any)._children[0];

      // Expand first
      const clickHandlers = header._eventListeners.get('click') || [];
      clickHandlers[0]();
      expect(header.getAttribute('aria-expanded')).toBe('true');

      // Finalize
      finalizeThinkingBlock(state);
      expect(header.getAttribute('aria-expanded')).toBe('false');
    });

    /*
     * Claude redacts reasoning routinely, and the row's duration is then the
     * whole of what it says. A chevron promising a body it does not have is
     * worse than no promise, so the row becomes a caption — and stops claiming
     * to be a button, which is the half a keyboard would otherwise land on.
     */
    it('turns a redacted block into a caption rather than a control', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);
      const header = (state.wrapperEl as any)._children[0];

      finalizeThinkingBlock(state);

      expect((state.wrapperEl as any).hasClass('is-caption')).toBe(true);
      expect(header.getAttribute('role')).toBeNull();
      expect(header.getAttribute('tabindex')).toBeNull();
    });
  });

  describe('renderStoredThinkingBlock', () => {
    it('should render stored block with duration label', () => {
      const parentEl = createMockEl();

      const wrapperEl = renderStoredThinkingBlock(parentEl, 'thinking content', 10, mockRenderContent);

      expect(wrapperEl).toBeDefined();
    });
  });
});
