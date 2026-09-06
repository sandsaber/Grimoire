/**
 * The timer a host hands the provider-neutral adapter.
 *
 * Two rules meet here. The adapter lives in `src/core` and must not reach for
 * `window` — a boundary the execution gate enforces — while Obsidian's own
 * review prefers `window.setTimeout` so a timer scheduled from a popped-out
 * view belongs to the window it runs in. Both hold at once by putting the
 * browser call on the app side of the port, which is where every other
 * scheduler in this directory already is.
 */
export function delayThroughWindow(milliseconds: number): Promise<void> {
  return new Promise<void>(resolve => {
    window.setTimeout(resolve, milliseconds);
  });
}
