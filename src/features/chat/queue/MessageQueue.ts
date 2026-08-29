import type { QueuedMessage } from '../state/types';

export type QueuePauseReason = 'failed' | 'cancelled';

/**
 * The queue of follow-ups typed while a turn is still running.
 *
 * Each entry keeps the turn snapshot it was captured with, which is what
 * separates this from the single slot it replaces: two follow-ups about two
 * different notes stay two turns about two different notes.
 *
 * Deliberately free of DOM, async and provider knowledge - the controller owns
 * when to drain, this owns only what is waiting and whether draining is held.
 */
export class MessageQueue {
  private messages: QueuedMessage[] = [];
  private paused: QueuePauseReason | null = null;

  get size(): number {
    return this.messages.length;
  }

  get items(): readonly QueuedMessage[] {
    return this.messages;
  }

  get isPaused(): boolean {
    return this.paused !== null;
  }

  get pauseReason(): QueuePauseReason | null {
    return this.paused;
  }

  enqueue(message: QueuedMessage): void {
    this.messages.push(message);
  }

  /**
   * The head, left in place. Lets a caller decide on a message before it is
   * committed to sending it, so a deferred send that turns out to be stale can
   * abort without the message already being gone.
   */
  peek(): QueuedMessage | null {
    return this.messages[0] ?? null;
  }

  dequeue(): QueuedMessage | null {
    const message = this.messages.shift() ?? null;
    this.syncPause();
    return message;
  }

  unshift(message: QueuedMessage): void {
    this.messages.unshift(message);
  }

  remove(index: number): QueuedMessage | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.messages.length) {
      return null;
    }

    const [message] = this.messages.splice(index, 1);
    this.syncPause();
    return message ?? null;
  }

  /**
   * Insert a message at a specific position, shifting subsequent entries.
   * Clamps to valid range: 0..length (append if index >= length).
   */
  insertAt(index: number, message: QueuedMessage): void {
    const clamped = Math.max(0, Math.min(index, this.messages.length));
    this.messages.splice(clamped, 0, message);
  }

  takeAll(): QueuedMessage[] {
    const messages = this.messages;
    this.messages = [];
    this.syncPause();
    return messages;
  }

  pause(reason: QueuePauseReason): void {
    // A pause with nothing held back is a pause the user can never see or
    // clear, and it would silently swallow the next follow-up they type.
    if (this.messages.length === 0) {
      return;
    }
    this.paused = reason;
  }

  resume(): void {
    this.paused = null;
  }

  /** An empty queue has nothing to hold back, so it cannot stay paused. */
  private syncPause(): void {
    if (this.messages.length === 0) {
      this.paused = null;
    }
  }
}
