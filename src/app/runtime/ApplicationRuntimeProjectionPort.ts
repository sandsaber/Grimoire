/**
 * Aggregates projection lifecycle disposal for the application runtime.
 * Each projection coordinator (chat, agent, work) subscribes to lifecycle
 * and coordinator feeds; this port disposes them all at shutdown.
 */
export class ApplicationRuntimeProjectionPort {
  private readonly disposers: readonly (() => void)[];

  constructor(disposers: readonly (() => void)[] = []) {
    this.disposers = Object.freeze([...disposers]);
  }

  dispose(): void {
    for (const dispose of this.disposers) {
      dispose();
    }
  }
}
