/**
 * Who owns Escape while a full-size image is open.
 *
 * Escape has two meanings in the chat view: close the image viewer, and
 * cancel the streaming turn. The viewer's meaning must win while it is open,
 * and the first attempt to arrange that - a capture-phase document listener
 * that called `preventDefault` - did not, because it still depended on
 * running before Obsidian's own document listener, which is registered when
 * the app boots and which this plugin does not control.
 *
 * Racing that listener is the wrong shape of solution: whoever wins is a
 * property of registration order rather than of what the key means. So every
 * Escape handler - the viewers' own included - asks this module instead. The
 * outcome no longer depends on which listener runs first: whoever gets there
 * closes the topmost viewer, and a cancel path that finds one open declines
 * to cancel.
 *
 * The stack, rather than a single slot, keeps nesting honest - Escape closes
 * one viewer at a time, in reverse order of opening.
 */

type CloseViewer = () => void;

const openViewers: CloseViewer[] = [];

/**
 * Registers an open viewer and returns the function that unregisters it.
 * The returned function is safe to call more than once.
 */
export function registerOpenImageViewer(close: CloseViewer): () => void {
  openViewers.push(close);
  return () => {
    const index = openViewers.lastIndexOf(close);
    if (index !== -1) {
      openViewers.splice(index, 1);
    }
  };
}

/**
 * Closes the most recently opened viewer.
 *
 * Returns true when a viewer was closed, which the caller reads as "Escape is
 * spoken for - do not also cancel the turn".
 */
export function closeTopmostImageViewer(): boolean {
  // Popped before closing so that a `close` which fails to unregister itself
  // cannot leave a dead entry behind - one would swallow every later Escape,
  // and the turn could no longer be cancelled at all. The viewer's own
  // unregister looks the entry up by identity and finds nothing, so removing
  // it here drops no other viewer.
  const close = openViewers.pop();
  if (!close) {
    return false;
  }

  close();
  return true;
}

/** Test seam: drops any viewer left registered by a previous case. */
export function resetOpenImageViewers(): void {
  openViewers.length = 0;
}
