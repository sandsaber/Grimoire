/**
 * @jest-environment jsdom
 */

import {
  createInputResizeHandle,
  INPUT_WRAPPER_MAX_HEIGHT_RATIO,
  INPUT_WRAPPER_MIN_HEIGHT,
} from '@/features/chat/ui/inputResizeHandle';

describe('inputResizeHandle', () => {
  let inputWrapper: HTMLElement;
  let viewport: HTMLElement;
  let cleanup: (() => void) | null;

  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
    cleanup = null;

    viewport = document.createElement('div');
    viewport.className = 'grimoire-container';
    inputWrapper = document.createElement('div');
    viewport.appendChild(inputWrapper);
    document.body.appendChild(viewport);

    Object.defineProperty(viewport, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(inputWrapper, 'offsetHeight', {
      configurable: true,
      value: 200,
    });
  });

  afterEach(() => {
    cleanup?.();
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('creates a resize handle at the top of the input container', () => {
    cleanup = createInputResizeHandle({ inputWrapper, viewport });

    const handle = inputWrapper.firstElementChild;

    expect(handle).toBeInstanceOf(HTMLElement);
    expect(handle?.classList.contains('grimoire-input-resize-handle')).toBe(true);
    expect(handle?.getAttribute('aria-label')).toBe('Drag to resize input');
  });

  it('clamps drag height between the minimum and 70 percent of the Grimoire container height', () => {
    cleanup = createInputResizeHandle({ inputWrapper, viewport });
    const handle = inputWrapper.querySelector('.grimoire-input-resize-handle')!;

    handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 300, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 100, bubbles: true }));

    expect(inputWrapper.style.getPropertyValue('--grimoire-input-wrapper-height'))
      .toBe(`${viewport.clientHeight * INPUT_WRAPPER_MAX_HEIGHT_RATIO}px`);

    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 500, bubbles: true }));

    expect(inputWrapper.style.getPropertyValue('--grimoire-input-wrapper-height'))
      .toBe(`${INPUT_WRAPPER_MIN_HEIGHT}px`);
  });

  it('does not shrink below the intrinsic height of a wrapped toolbar', () => {
    Object.defineProperty(inputWrapper, 'scrollHeight', {
      configurable: true,
      value: 138,
    });
    cleanup = createInputResizeHandle({ inputWrapper, viewport });
    const handle = inputWrapper.querySelector('.grimoire-input-resize-handle')!;

    handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 300, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 500, bubbles: true }));

    expect(inputWrapper.style.getPropertyValue('--grimoire-input-wrapper-height')).toBe('138px');
  });

  it('toggles the body drag class during drag', () => {
    cleanup = createInputResizeHandle({ inputWrapper, viewport });
    const handle = inputWrapper.querySelector('.grimoire-input-resize-handle')!;

    handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 300, bubbles: true }));

    expect(document.body.classList.contains('grimoire-dragging-ns')).toBe(true);

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(document.body.classList.contains('grimoire-dragging-ns')).toBe(false);
  });

  it('removes document listeners, drag class, and handle on cleanup', () => {
    cleanup = createInputResizeHandle({ inputWrapper, viewport });
    const handle = inputWrapper.querySelector('.grimoire-input-resize-handle')!;

    handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 300, bubbles: true }));
    cleanup();
    cleanup = null;
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 100, bubbles: true }));

    expect(inputWrapper.querySelector('.grimoire-input-resize-handle')).toBeNull();
    expect(document.body.classList.contains('grimoire-dragging-ns')).toBe(false);
    expect(inputWrapper.style.getPropertyValue('--grimoire-input-wrapper-height')).toBe('');
  });
});
