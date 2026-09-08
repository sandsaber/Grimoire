import { createMockEl } from '@test/helpers/mockElement';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { InlineExitPlanMode } from '@/features/chat/rendering/InlineExitPlanMode';

beforeAll(() => {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  (globalThis as any).document = { activeElement: null };
});

function fireKeyDown(root: any, key: string): void {
  root.dispatchEvent({
    type: 'keydown',
    key,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  });
}

function findRoot(container: any): any {
  return container.querySelector('.grimoire-plan-approval-inline');
}

function findItems(root: any): any[] {
  return root.querySelectorAll('grimoire-ask-item');
}

describe('InlineExitPlanMode', () => {
  it('renders readable plan content and resolves with current-session approval by default', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-'));
    const plansDir = path.join(tmpDir, '.claude', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    const planFilePath = path.join(plansDir, 'plan.md');
    fs.writeFileSync(planFilePath, 'Step 1\nStep 2\n', 'utf8');

    const container = createMockEl();
    const resolve = jest.fn();
    const renderContent = jest.fn().mockResolvedValue(undefined);

    const widget = new InlineExitPlanMode(
      container,
      {
        planFilePath,
        allowedPrompts: [
          { tool: 'Edit', prompt: 'Edit files under Index/' },
          { tool: 'Read', prompt: 'Read every note under Fieldnotes/' },
        ],
      },
      resolve,
      undefined,
      renderContent,
      '/.claude/plans/',
    );

    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();
    expect(root.getEventListenerCount('keydown')).toBe(1);
    // What the plan asks to be allowed reads as one line under its label. It
    // was a bulleted list, which gave two short phrases the vertical weight of
    // the plan they belong to.
    expect(container.querySelector('.grimoire-plan-permissions-list')).toBeNull();
    expect(container.querySelector('.grimoire-plan-permissions-line')?.textContent)
      .toBe('Edit files under Index/ \u00B7 Read every note under Fieldnotes/');
    expect(renderContent).toHaveBeenCalled();

    fireKeyDown(root, 'Enter');

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ type: 'approve' });
    expect(root.getEventListenerCount('keydown')).toBe(0);
  });

  it('does not render a new-session approval option', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    const root = findRoot(container);
    const labels = root
      .querySelectorAll('grimoire-ask-item-label')
      .map((label: any) => label.textContent);

    expect(labels).toEqual(['Approve for this session']);
    expect(labels).not.toContain('Approve (new session)');
  });

  it('shows a read error when plan file cannot be read', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(
      container,
      { planFilePath: '/path/.claude/plans/does-not-exist.md' },
      resolve,
      undefined,
      undefined,
      '/.claude/plans/',
    );

    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();
    expect(container.querySelector('.grimoire-plan-read-error')).toBeTruthy();

    fireKeyDown(root, 'Enter');
    expect(resolve).toHaveBeenCalledWith({ type: 'approve' });
  });

  it('rejects plan file paths outside .claude/plans/', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(
      container,
      { planFilePath: '/etc/passwd' },
      resolve,
      undefined,
      undefined,
      '/.claude/plans/',
    );

    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();
    expect(container.querySelector('.grimoire-plan-read-error')).toBeTruthy();

    fireKeyDown(root, 'Enter');
    expect(resolve).toHaveBeenCalledWith({ type: 'approve' });
  });

  it('supports keyboard navigation for feedback', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();

    fireKeyDown(root, 'ArrowDown');
    fireKeyDown(root, 'Enter');

    expect(resolve).not.toHaveBeenCalled();
    expect((widget as any).isInputFocused).toBe(true);
  });

  it('renders plan header chrome with a collapse toggle', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    expect(container.querySelector('.grimoire-plan-glyph')).toBeTruthy();
    expect(container.querySelector('.grimoire-plan-title')).toBeTruthy();
    expect(container.querySelector('.grimoire-plan-tool-label')?.textContent).toBe('plan');

    const collapseToggle = container.querySelector('.grimoire-plan-collapse-toggle');
    expect(collapseToggle).toBeTruthy();
    expect(collapseToggle?.getAttribute('aria-label')).toBe('Collapse plan');
    expect(collapseToggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses and expands without resolving the plan decision', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    const root = findRoot(container);
    const collapseToggle = container.querySelector('.grimoire-plan-collapse-toggle');

    collapseToggle?.click();

    expect(root.hasClass('is-collapsed')).toBe(true);
    expect(collapseToggle?.getAttribute('aria-label')).toBe('Expand plan');
    expect(collapseToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(resolve).not.toHaveBeenCalled();

    collapseToggle?.click();

    expect(root.hasClass('is-collapsed')).toBe(false);
    expect(collapseToggle?.getAttribute('aria-label')).toBe('Collapse plan');
    expect(collapseToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('still resolves null on Escape while collapsed', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    const root = findRoot(container);
    container.querySelector('.grimoire-plan-collapse-toggle')?.click();

    fireKeyDown(root, 'Escape');

    expect(resolve).toHaveBeenCalledWith(null);
  });

  it('supports feedback flow and Escape when input is focused', () => {
    const container = createMockEl();
    const resolve = jest.fn();

    const widget = new InlineExitPlanMode(container, {}, resolve);
    widget.render();

    const root = findRoot(container);
    expect(root).toBeTruthy();

    fireKeyDown(root, 'ArrowDown');
    fireKeyDown(root, 'Enter');

    const items = findItems(root);
    const feedbackRow = items[1];
    const feedbackInput = feedbackRow.querySelector('grimoire-ask-custom-text');

    expect(resolve).not.toHaveBeenCalled();

    feedbackInput.dispatchEvent('focus');

    fireKeyDown(root, 'Escape');
    expect(resolve).not.toHaveBeenCalled();

    feedbackInput.value = 'Please revise the plan';
    feedbackInput.dispatchEvent('focus');

    fireKeyDown(root, 'Enter');
    expect(resolve).toHaveBeenCalledWith({ type: 'feedback', text: 'Please revise the plan' });
  });

  it('resolves null on abort and does not resolve twice', () => {
    const container = createMockEl();
    const resolve = jest.fn();
    const controller = new AbortController();

    const widget = new InlineExitPlanMode(container, {}, resolve, controller.signal);
    widget.render();

    controller.abort();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(null);

    widget.destroy();
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
