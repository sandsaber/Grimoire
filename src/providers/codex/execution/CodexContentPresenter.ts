import type { ChatTurnMetadata } from '../../../core/runtime/types';
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
  private readonly router = new CodexNotificationRouter(
    chunk => this.chunks.push(chunk),
    metadata => {
      this.metadata = { ...this.metadata, ...metadata };
    },
  );
  private failure: string | undefined;
  private threadId: string | undefined;
  private metadata: ChatTurnMetadata = {};

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

  /**
   * The thread the daemon is actually on.
   *
   * A conversation learns its thread id from the finished turn, and before the
   * flip that id came from the runtime, which knew it. The adapter reports the
   * conversation's own binding instead, which is empty until something writes
   * it — so without this a new conversation never learns its thread, and every
   * turn after the first starts a new one: no resume, and nothing to fork from.
   */
  lastThreadId(): string | undefined {
    return this.threadId;
  }

  /**
   * Forgets everything that belonged to one conversation.
   *
   * The thread above all: a tab that starts a new chat must not report the
   * previous conversation's thread as its own, or the new conversation is
   * saved pointing at the old thread and silently continues it.
   */
  forgetConversation(): void {
    this.threadId = undefined;
    this.failure = undefined;
    this.metadata = {};
  }

  /**
   * What the finished turn was, in the provider's own terms.
   *
   * The native id of the answer above all: the tab copies it onto the message
   * and a fork asks the daemon to resume at it, so a reference minted anywhere
   * else names nothing the daemon can find.
   */
  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.metadata;
    this.metadata = {};
    return metadata;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const notification = payload as Partial<CodexContentPayload> | null;
    const method = notification?.method;
    if (typeof method !== 'string') {
      return [];
    }

    const threadId = (notification?.params as { threadId?: unknown } | undefined)?.threadId;
    if (typeof threadId === 'string' && threadId) {
      this.threadId = threadId;
    }
    // The turn's boundaries reset what the router tracks across items, and plan
    // mode is a property of the turn being started rather than of any item in
    // it.
    if (method === 'turn/started') {
      // A new turn carries none of the last one's failure: without this a turn
      // that fails for a reason the daemon does not describe is reported in the
      // words of the one before it.
      this.failure = undefined;
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
