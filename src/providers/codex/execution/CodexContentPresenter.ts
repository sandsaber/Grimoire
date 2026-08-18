import type { StreamChunk } from '../../../core/types';
import { CodexNotificationRouter } from '../runtime/CodexNotificationRouter';

/** The wire notification, exactly as the daemon sent it. */
export interface CodexContentPayload {
  readonly method: string;
  readonly params: unknown;
}

/**
 * The chunks a turn's notifications become, produced by the normalization the
 * surface already reads.
 *
 * The router is the piece that knows how a Codex tool call, its result, a plan
 * update and a compaction boundary are rendered — a thousand lines of it,
 * proven against real transcripts. The flip keeps it rather than writing a
 * second opinion: the kernel carries the item, this runs the same code the
 * legacy runtime ran, and the surface cannot tell which path produced the turn.
 *
 * The two notifications the kernel mirrors as `output-delta` — the assistant's
 * deltas and the reasoning's — have their text dropped here, because that copy
 * is the one core can read and letting both through prints every sentence
 * twice. The filter is by notification and not by chunk type on purpose: a plan
 * delta is also `text`, and it is the only copy of the plan there is.
 */
/** The notifications whose text the backend already emits as `output-delta`. */
const MIRRORED_BY_THE_KERNEL = new Set([
  'item/agentMessage/delta',
  'item/reasoning/textDelta',
]);

export class CodexContentPresenter {
  private readonly chunks: StreamChunk[] = [];
  private readonly router = new CodexNotificationRouter(chunk => this.chunks.push(chunk));
  private failure: string | undefined;

  constructor(private readonly isPlanTurn: () => boolean) {}

  /**
   * What the daemon said went wrong, for the terminal to be rendered with.
   *
   * The error chunk itself is dropped: the kernel renders one error for a
   * failed run, and letting this one through prints the same failure twice.
   * Keeping the words means the run can be described in the daemon's terms
   * rather than by the neutral sentence.
   */
  lastFailure(): string | undefined {
    return this.failure;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const notification = payload as Partial<CodexContentPayload> | null;
    const method = notification?.method;
    if (typeof method !== 'string') {
      return [];
    }

    // The turn's boundaries reset what the router tracks across items, and plan
    // mode is a property of the turn being started rather than of any item in
    // it.
    if (method === 'turn/started') {
      this.router.beginTurn({ isPlanTurn: this.isPlanTurn() });
    }
    this.router.handleNotification(method, notification?.params);
    if (method === 'turn/completed') {
      this.router.endTurn();
    }

    const chunks = this.chunks.splice(0);
    for (const chunk of chunks) {
      if (chunk.type === 'error') {
        this.failure = chunk.content;
      }
    }
    // `done` closes the surface's turn, and the kernel's terminal is what
    // closes this one — a turn ended here would stop rendering before the
    // result is committed.
    const rendered = chunks.filter(chunk => chunk.type !== 'done' && chunk.type !== 'error');
    return MIRRORED_BY_THE_KERNEL.has(method)
      ? rendered.filter(chunk => chunk.type !== 'text' && chunk.type !== 'thinking')
      : rendered;
  }
}
