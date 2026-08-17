/**
 * What one Antigravity print request needs, held while the kernel carries a
 * reference to it.
 *
 * Only what the turn decided lives here — prompt and model. Everything ambient
 * at dispatch time (the resolved CLI path, the vault directory, the
 * environment, the permission mode) is read when the run is resolved, not
 * frozen when it was queued.
 */
export interface AntigravityRequest {
  readonly prompt: string;
  readonly model: string | null;
}

/** How many un-dispatched turns may accumulate before the oldest is dropped. */
const DEFAULT_LIMIT = 64;

/**
 * References the kernel can carry, and the requests behind them.
 *
 * `requestRef` is validated as a constrained identifier — 128 characters, no
 * whitespace — because core carries references, not provider payloads. So the
 * reference names the request and this store holds it; a prompt encoded into
 * the reference is refused by the registry before a run starts.
 *
 * In memory on purpose. A reference that outlived a restart would promise a
 * re-dispatch print mode cannot make, and D3 forbids relaunching an unknown
 * dispatch on its own. An unresolvable reference becomes
 * `pre-dispatch-rejected`, which is the honest answer.
 */
export class AntigravityRequestStore {
  private readonly pending = new Map<string, AntigravityRequest>();

  constructor(
    private readonly nextReference: () => string,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Holds a request and returns the reference the kernel will carry. */
  reference(request: AntigravityRequest): string {
    // Bounded because a turn rejected before dispatch never comes back for its
    // request, and an unbounded map of prompts is a memory leak made of the
    // most sensitive thing this provider handles.
    while (this.pending.size >= this.limit) {
      const oldest = this.pending.keys().next();
      if (oldest.done) {
        break;
      }
      this.pending.delete(oldest.value);
    }
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  /**
   * Takes the request back, once.
   *
   * Removed on resolve rather than kept: a run dispatches once, and holding the
   * prompt after that is retention nobody asked for.
   */
  resolve(reference: string): AntigravityRequest {
    const request = this.pending.get(reference);
    if (!request) {
      throw new Error('Antigravity request reference is unknown.');
    }
    this.pending.delete(reference);
    return request;
  }

  /** Test and diagnostic view of how many requests are still waiting. */
  get pendingCount(): number {
    return this.pending.size;
  }
}
