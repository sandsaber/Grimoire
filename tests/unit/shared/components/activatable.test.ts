import { createMockEl } from '@test/helpers/mockElement';

import { asActivatable, markDecorative } from '@/shared/components/activatable';

function control(): any {
  return createMockEl();
}

function clickEvent(): any {
  return { type: 'click', preventDefault: jest.fn(), stopPropagation: jest.fn() };
}

function keyEvent(key: string): any {
  return { type: 'keydown', key, preventDefault: jest.fn(), stopPropagation: jest.fn() };
}

describe('asActivatable', () => {
  it('gives a non-button element the role, the name and the tab stop a control needs', () => {
    const el = control();

    asActivatable(el, { label: 'Remove path', onActivate: jest.fn() });

    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-label')).toBe('Remove path');
    // The focus ring hangs on this class, so a control the primitive makes
    // cannot arrive without one.
    expect(el.hasClass('grimoire-activatable')).toBe(true);
  });

  it('activates on click, and keeps the press off a clickable ancestor', () => {
    const el = control();
    const onActivate = jest.fn();
    asActivatable(el, { label: 'Copy', onActivate });

    const event = clickEvent();
    el.dispatchEvent(event);

    expect(onActivate).toHaveBeenCalledTimes(1);
    // The row under these controls is itself clickable, so an activation that
    // bubbled would run two actions from one press.
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it.each(['Enter', ' '])('activates on "%s", which is what a button answers', key => {
    const el = control();
    const onActivate = jest.fn();
    asActivatable(el, { label: 'Copy', onActivate });

    const event = keyEvent(key);
    el.dispatchEvent(event);

    expect(onActivate).toHaveBeenCalledTimes(1);
    // Space scrolls the page otherwise, and Enter submits an enclosing form.
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('still activates when the caller carries no event', () => {
    // A programmatic `el.click()` dispatches without one, and losing the
    // activation to a missing guard is worse than losing the guard.
    const el = control();
    const onActivate = jest.fn();
    asActivatable(el, { label: 'Fork here', onActivate });

    el.dispatchEvent('click');

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('ignores a key a button does not answer', () => {
    const el = control();
    const onActivate = jest.fn();
    asActivatable(el, { label: 'Copy', onActivate });

    const event = keyEvent('a');
    el.dispatchEvent(event);

    expect(onActivate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('lets a row inside a list keep its name without becoming a tab stop', () => {
    // A listbox moves focus with the arrow keys from the container, so its rows
    // must not each be tabbed through.
    const el = control();

    asActivatable(el, { label: 'Session 3', onActivate: jest.fn(), inTabOrder: false });

    expect(el.getAttribute('tabindex')).toBeFalsy();
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('aria-label')).toBe('Session 3');
  });
});

describe('markDecorative', () => {
  it('does not announce an icon that sits beside its own label', () => {
    const el = control();

    markDecorative(el);

    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
