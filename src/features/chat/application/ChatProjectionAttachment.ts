import type { ChatProjection } from '../projections/ChatProjection';

/**
 * One tab's subscription to one conversation's projection.
 *
 * Small on purpose — the work is `coordinator.attach` and `renderer.render`,
 * and this exists for the two things that one line cannot express.
 *
 * **A tab can close while its conversation is still loading.** `attach` reads
 * the conversation from the store, so it awaits; a tab closed in that window
 * has nothing to detach yet and would be subscribed a moment later, rendering
 * into a column that is gone. So detaching before the subscription arrives is
 * recorded and honoured when it does.
 *
 * **A tab outlives the conversation it is showing.** Switching conversations is
 * a detach and an attach on the same object, and the two must not overlap: a
 * projection of the old conversation delivered after the new one is attached
 * would be drawn as if it were the new one — which the renderer would recover
 * from by redrawing, but only after having drawn it.
 */

export interface ChatProjectionSource {
  attach(
    conversationId: string,
    listener: (projection: ChatProjection) => void,
  ): Promise<() => void>;
}

export interface ChatProjectionSink {
  render(projection: ChatProjection): void;
  /** Resolves when everything rendered into it has actually been drawn. */
  settled?(): Promise<void>;
}

export class ChatProjectionAttachment {
  private generation = 0;
  private release: (() => void) | null = null;

  /**
   * Constructed synchronously, opened asynchronously, and that is the point.
   *
   * A factory returning the attachment only once the conversation had loaded
   * would leave the caller with nothing to close during the load — the window
   * this class exists for. The tab holds the object from the moment it opens.
   */
  constructor(private readonly sink: ChatProjectionSink) {}

  async open(conversationId: string, source: ChatProjectionSource): Promise<void> {
    this.detach();
    const generation = this.generation;
    const release = await source.attach(conversationId, projection => {
      if (generation === this.generation) {
        this.sink.render(projection);
      }
    });
    if (generation !== this.generation) {
      // Closed, or moved to another conversation, while this one was loading.
      // The subscription arrived for a tab that is no longer showing it, so it
      // is released rather than held.
      release();
      return;
    }
    this.release = release;
  }

  /** Resolves when the sink has drawn everything this attachment gave it. */
  settled(): Promise<void> {
    return this.sink.settled?.() ?? Promise.resolve();
  }

  detach(): void {
    this.generation += 1;
    this.release?.();
    this.release = null;
  }
}
