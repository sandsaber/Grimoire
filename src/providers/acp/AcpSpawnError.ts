/**
 * A provider process Grimoire could not start.
 *
 * Classified rather than only worded. The managed backend maps everything that
 * fails before dispatch to `invalidated` / `pre-dispatch-rejected`, and the ACP
 * providers all word that reason as a saved session that may no longer exist —
 * so an uninstalled CLI reached the person as advice to start a new chat. The
 * class is what lets the run answer `spawn-failed` instead, which is the same
 * answer the local-shell and Antigravity backends already give.
 *
 * Kept in its own module so the backend can recognize it without importing the
 * filesystem check that produces its wording.
 */
export class AcpSpawnError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'AcpSpawnError';
  }
}
