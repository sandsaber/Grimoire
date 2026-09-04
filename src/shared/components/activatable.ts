/**
 * Turning a non-button element into a control the keyboard can reach.
 *
 * The pattern was already written by hand in twenty-four places and missing in
 * nineteen others, where a `<span>` with a click listener could be used with a
 * mouse and by nothing else. An icon-only control is the case that suffers
 * most: it has no visible word, so without a name it announces as nothing.
 *
 * See docs/design-system.md, "Icons and text".
 */

export interface ActivatableOptions {
  /** The accessible name. For an icon-only control this is the only name. */
  label: string;
  onActivate: () => void;
  /**
   * Whether the element becomes its own tab stop. A row inside a listbox that
   * the container moves through with the arrow keys must not be one, so it
   * takes the role and the name and leaves the tab order alone.
   */
  inTabOrder?: boolean;
}

/** The two keys a native button answers. */
const ACTIVATION_KEYS = new Set(['Enter', ' ']);

/**
 * The marker the focus style hangs on.
 *
 * `accessibility.css` used to enumerate every focusable control by class, so a
 * new one arrived without a focus ring until somebody remembered the list. One
 * class the primitive applies is one rule that cannot fall behind, and it stays
 * scoped to Grimoire rather than styling the host's own `[role="button"]`.
 */
export const ACTIVATABLE_CLASS = 'grimoire-activatable';

export function asActivatable(el: HTMLElement, options: ActivatableOptions): void {
  el.addClass(ACTIVATABLE_CLASS);
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', options.label);
  if (options.inTabOrder !== false) {
    el.setAttribute('tabindex', '0');
  }

  el.addEventListener('click', (event?: MouseEvent) => {
    // These controls sit inside rows that are themselves clickable, so an
    // activation that bubbles would run two actions from one press. The event
    // is optional because a programmatic `el.click()` carries none, and losing
    // the activation to that is worse than losing the guard.
    event?.stopPropagation?.();
    options.onActivate();
  });

  el.addEventListener('keydown', (event?: KeyboardEvent) => {
    if (!event || !ACTIVATION_KEYS.has(event.key)) {
      return;
    }
    // Space scrolls the page otherwise, and Enter submits an enclosing form.
    event.preventDefault?.();
    event.stopPropagation?.();
    options.onActivate();
  });
}

/**
 * Marks an icon as decoration.
 *
 * An icon that sits beside its own label carries no information a reader needs
 * announced twice, and Lucide glyphs announce as their file name when they are
 * not hidden.
 */
export function markDecorative(el: HTMLElement): void {
  el.setAttribute('aria-hidden', 'true');
}
