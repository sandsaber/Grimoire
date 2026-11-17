/** @jest-environment jsdom */

import { createMockEl } from '@test/helpers/mockElement';

import { BrowserSelectionController } from '@/features/chat/controllers/BrowserSelectionController';

function createMockIndicator() {
  const indicatorEl = createMockEl();
  indicatorEl.addClass('grimoire-browser-selection-indicator');
  indicatorEl.addClass('grimoire-hidden');
  return indicatorEl;
}

function createMockContextRow(browserIndicator: HTMLElement) {
  const editorIndicator = createMockEl();
  editorIndicator.addClass('grimoire-selection-indicator');
  editorIndicator.addClass('grimoire-hidden');
  const canvasIndicator = createMockEl();
  canvasIndicator.addClass('grimoire-canvas-indicator');
  canvasIndicator.addClass('grimoire-hidden');
  const fileIndicator = createMockEl();
  fileIndicator.addClass('grimoire-file-indicator');
  fileIndicator.addClass('grimoire-hidden');
  const imagePreview = createMockEl();
  imagePreview.addClass('grimoire-image-preview');
  imagePreview.addClass('grimoire-hidden');
  const elements: Record<string, any> = {
    '.grimoire-selection-indicator': editorIndicator,
    '.grimoire-browser-selection-indicator': browserIndicator,
    '.grimoire-canvas-indicator': canvasIndicator,
    '.grimoire-file-indicator': fileIndicator,
    '.grimoire-image-preview': imagePreview,
  };
  const contextRow = createMockEl();
  const toggle = contextRow.classList.toggle;
  contextRow.classList.toggle = jest.fn((cls: string, force?: boolean) => toggle(cls, force));

  contextRow.querySelector = jest.fn((selector: string) => elements[selector] ?? null);
  return contextRow;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('BrowserSelectionController', () => {
  let controller: BrowserSelectionController;
  let app: any;
  let indicatorEl: any;
  let inputEl: HTMLTextAreaElement;
  let contextRowEl: any;
  let containerEl: HTMLElement;
  let selectionText = 'selected web snippet';
  let getSelectionSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    selectionText = 'selected web snippet';

    indicatorEl = createMockIndicator();
    inputEl = document.createElement('textarea');
    document.body.appendChild(inputEl);
    contextRowEl = createMockContextRow(indicatorEl);
    containerEl = document.createElement('div');
    const selectionAnchor = document.createElement('span');
    containerEl.appendChild(selectionAnchor);

    getSelectionSpy = jest.spyOn(document, 'getSelection').mockImplementation(() => ({
      toString: () => selectionText,
      anchorNode: selectionAnchor,
      focusNode: selectionAnchor,
    } as unknown as Selection));

    const view = {
      getViewType: () => 'surfing-view',
      getDisplayText: () => 'Surfing',
      containerEl,
      currentUrl: 'https://example.com',
    };

    app = {
      workspace: {
        activeLeaf: { view },
        getMostRecentLeaf: jest.fn(() => ({ view })),
      },
    };

    controller = new BrowserSelectionController(app, indicatorEl, inputEl, contextRowEl);
  });

  afterEach(() => {
    controller.stop();
    inputEl.remove();
    getSelectionSpy.mockRestore();
    jest.useRealTimers();
  });

  it('captures browser selection and updates indicator', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.getContext()).toEqual({
      source: 'browser:https://example.com',
      selectedText: 'selected web snippet',
      title: 'Surfing',
      url: 'https://example.com',
    });
    expect(indicatorEl.style.display).toBe('block');
    expect(indicatorEl.textContent).toBe('1 line selected');
    expect(indicatorEl.textContent).not.toContain('source=');
    expect(indicatorEl.getAttribute('title')).toContain('chars selected');
    expect(indicatorEl.getAttribute('title')).toContain('source=browser:https://example.com');
    expect(indicatorEl.getAttribute('title')).toContain('title=Surfing');
    expect(indicatorEl.getAttribute('title')).toContain('https://example.com');
  });

  it('shows line-based indicator text for multi-line browser selection', async () => {
    selectionText = 'line 1\nline 2';
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(indicatorEl.textContent).toBe('2 lines selected');
  });

  it('captures selection from a browser view owned by another window', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    try {
      const frameDocument = frame.contentDocument!;
      const foreignContainer = frameDocument.createElement('div');
      foreignContainer.textContent = 'popout selection';
      frameDocument.body.appendChild(foreignContainer);
      frameDocument.getSelection()!.selectAllChildren(foreignContainer);
      expect(foreignContainer instanceof HTMLElement).toBe(false);
      app.workspace.getMostRecentLeaf.mockReturnValue({
        view: { ...app.workspace.activeLeaf.view, containerEl: foreignContainer },
      });

      controller.start();
      jest.advanceTimersByTime(250);
      await flushMicrotasks();

      expect(controller.getContext()?.selectedText).toBe('popout selection');
    } finally {
      frame.remove();
    }
  });

  it('clears selection when text is deselected and input is not focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(false);
    expect(indicatorEl.style.display).toBe('none');
  });

  it('keeps selection while input is focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    inputEl.focus();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(true);
  });

  it('reads selected active input text without requiring Obsidian instanceOf helpers', async () => {
    selectionText = '';
    const browserInput = document.createElement('textarea');
    browserInput.value = 'alpha beta gamma';
    browserInput.setSelectionRange(6, 10);
    containerEl.appendChild(browserInput);
    document.body.appendChild(containerEl);
    browserInput.focus();

    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.getContext()).toEqual({
      source: 'browser:https://example.com',
      selectedText: 'beta',
      title: 'Surfing',
      url: 'https://example.com',
    });

    containerEl.remove();
  });

  it('clears selection when clear is called', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    controller.clear();

    expect(controller.hasSelection()).toBe(false);
    expect(indicatorEl.style.display).toBe('none');
  });

  it('handles polling errors without unhandled rejection', async () => {
    const extractSpy = jest.spyOn(controller as any, 'extractSelectedText')
      .mockRejectedValueOnce(new Error('poll failed'));

    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(extractSpy).toHaveBeenCalled();
    expect(controller.hasSelection()).toBe(false);
  });
});
