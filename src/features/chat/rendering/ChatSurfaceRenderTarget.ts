import type { RunState, RunTerminal } from '../../../core/execution/ExecutionContracts';
import type { RunId } from '../../../core/execution/ExecutionIds';
import type { ReconciledOutcomeProjection } from '../../../core/execution/RunProjection';
import type { ProviderHistoryHydration } from '../../../core/providers/ProviderModule';
import type {
  AssistantTextPhase,
  ChatContentItem,
  ChatMessage,
  UsageInfo,
} from '../../../core/types';
import type { ProviderId } from '../../../core/types/provider';
import type { ChatLiveItem, InteractionProjection } from '../projections/ChatProjection';
import type {
  ChatConversationView,
  ChatRenderTarget,
  ChatTurnView,
} from './ChatProjectionRenderer';

/**
 * The chat column, as the renderer's port.
 *
 * The first piece of M5's chat path allowed to touch a DOM, and it touches one
 * only through the machinery that already draws this column: every call below
 * is an operation `StreamController` and `MessageRenderer` perform today, in
 * the order they perform it. Nothing here decides *what* changed — the renderer
 * did that — so what is left is a translation, which is the shape the plan asks
 * for when it calls the renderer a thin replaceable layer.
 *
 * **The one thing it synthesizes is `done`.** The legacy controller closes a
 * turn on that chunk and its finalization is private, so a terminal from the
 * kernel becomes one here. That is the opposite direction from a provider
 * emitting `done` — which each content presenter filters out, because a
 * provider claiming a turn ended is a second opinion about the fact the kernel
 * owns. Here the kernel's fact is the source and the chunk is the call.
 *
 * **What it deliberately does not own**: `ChatState.messages` beyond the two
 * operations the surface already pairs (`addMessage` on the state and on the
 * renderer), and the interaction dialog. The dialog is provider-owned and
 * already on screen — see `showInteraction` on the port — so this flushes what
 * a permission prompt needs to appear above and presents nothing.
 *
 * Built for every surface the chat composition binds, which is every tab whose
 * provider is listed in `projectionChatProviders`.
 */

/**
 * What the target needs from the controller that owns the streaming cursor.
 *
 * `handleStreamChunk` takes content plus **two named lifecycle chunks and no
 * others**. `done` closes the legacy turn, whose finalization is private, and
 * `error` renders the failed ending the surface already shows; both are
 * synthesized here *from the kernel's terminal*, which is the opposite
 * direction from a provider claiming a turn ended. `status` and the two
 * message-start boundaries are absent because a projection-driven surface takes
 * those from the run's state and the turn's own beginning.
 */
export interface ChatStreamOperations {
  handleStreamChunk(
    chunk: ChatContentItem | { type: 'done' } | { type: 'error'; content: string },
    msg: ChatMessage,
  ): Promise<void>;
  appendText(text: string, phase?: AssistantTextPhase): Promise<void>;
  appendThinking(content: string): Promise<void>;
  finalizeCurrentTextBlock(msg?: ChatMessage): Promise<void>;
  finalizeCurrentThinkingBlock(msg?: ChatMessage): Promise<void>;
  flushPendingToolsForPermission(): void;
  /**
   * Resets the "this provider has gone quiet" timer.
   *
   * `handleStreamChunk` does this itself, so only the two text paths need it
   * asked for — and they are the ones a turn made entirely of prose takes.
   * `InputController` used to call it once per chunk from the generator loop;
   * that loop is gone, and this is where the same duty landed.
   */
  noteTurnActivity(): void;
  showThinkingIndicator(overrideText?: string, overrideCls?: string): void;
  hideThinkingIndicator(): void;
  startTurnSilenceIndicator(providerId: ProviderId): void;
  pauseTurnSilenceIndicator(paused: boolean): void;
  stopTurnSilenceIndicator(): void;
}

/** What the target needs from the renderer that owns the message elements. */
export interface ChatMessageOperations {
  addMessage(msg: ChatMessage): HTMLElement;
  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string,
    hydration?: ProviderHistoryHydration,
  ): HTMLElement;
}

/** The streaming cursor the two above share. */
export interface ChatStreamingCursor {
  messages: ChatMessage[];
  usage: UsageInfo | null;
  currentContentEl: HTMLElement | null;
  currentTextEl: HTMLElement | null;
  currentTextContent: string;
  currentThinkingState: unknown;
  addMessage(msg: ChatMessage): void;
}

export interface ChatSurfaceRenderTargetDeps {
  readonly state: ChatStreamingCursor;
  readonly renderer: ChatMessageOperations;
  readonly stream: ChatStreamOperations;
  /** Turns one opaque provider item into what the surface draws. */
  presentProviderContent(payload: unknown): readonly ChatContentItem[];
  /**
   * The message a live turn is drawn into, under the id the turn was given.
   *
   * The id is the turn's rather than this factory's, which is the difference
   * between one message and two: the barrier stores the answer under the same
   * one, so what a surface drew and what the vault holds are the same message
   * and everything that addresses it by id means one thing.
   */
  createAssistantMessage(messageId: string, runId: RunId): ChatMessage;
  /** The provider's wording for a terminal, where it has one. */
  describeTerminal(terminal: RunTerminal): string;
  /**
   * Reports the turn's token usage to whoever persists the conversation.
   *
   * Usage arrives as *content* — nothing in the kernel carries token counts,
   * and the only thing that knows them is the provider payload. So it lands
   * here first and has to travel back, which is why this is a call rather than
   * a field on the projection: a projection field would have to be fed from
   * here anyway, and then read from here again.
   *
   * The value reported is the one the controller kept, not the one the chunk
   * carried: a usage report from another session, or an aggregate that counts a
   * subagent's tokens as the parent's, is filtered there already, and a second
   * copy of those rules here is a second copy that can disagree.
   */
  recordTurnUsage(runId: RunId, usage: UsageInfo | null): void;
  getGreeting(): string;
  getProviderId(): ProviderId;
  updateQueueIndicator(): void;
  setTitle(title: string): void;
}

interface OpenBlock {
  readonly runId: RunId;
  readonly index: number;
  readonly kind: ChatLiveItem['kind'];
}

export class ChatSurfaceRenderTarget implements ChatRenderTarget {
  private readonly turnMessages = new Map<RunId, ChatMessage>();
  private readonly turnStates = new Map<RunId, RunState>();
  private open: OpenBlock | null = null;
  /**
   * The column's operations, in the order they were asked for.
   *
   * Every one of them is asynchronous and several are only *partly*
   * synchronous: finalizing a text block awaits a pending render before it
   * closes the element. Started and not awaited, an append that follows a
   * finalize can land in the block the finalize is still closing, and the
   * `done` that ends a turn can overtake the tool call before it. The renderer
   * decided the order; this is what keeps it.
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ChatSurfaceRenderTargetDeps) {}

  /**
   * Queues one column operation behind the ones already asked for.
   *
   * A failure does not stop the queue: the operations after it are a different
   * part of the same turn, and a column that stops drawing because one block
   * threw is worse than a column with one block missing.
   */
  /**
   * Resolves when the column has done everything it has been asked for.
   *
   * The work after a turn ends — the duration footer, the finalizations the
   * legacy path does itself — runs against the same column, so it has to
   * follow rather than interleave.
   */
  settled(): Promise<void> {
    return this.queue;
  }

  private enqueue(operation: () => Promise<unknown>): void {
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => operation())
      .then(() => undefined, () => undefined);
  }

  reset(view: ChatConversationView): void {
    this.turnMessages.clear();
    this.turnStates.clear();
    this.open = null;
    this.deps.state.messages = [...view.messages];
    this.deps.state.currentContentEl = null;
    this.deps.state.currentTextEl = null;
    this.deps.state.currentTextContent = '';
    this.deps.state.currentThinkingState = null;
    this.deps.setTitle(view.title);
    this.deps.renderer.renderMessages([...view.messages], () => this.deps.getGreeting());
  }

  setTitle(title: string): void {
    this.deps.setTitle(title);
  }

  appendMessage(message: ChatMessage): void {
    // The pair the surface already performs together: the state's copy is what
    // rewind, save and the action buttons read, and the renderer's element is
    // what a person sees. One without the other is a message that exists in
    // only half the places that look for it.
    this.deps.state.addMessage(message);
    const element = this.deps.renderer.addMessage(message);
    this.placeBeforeOpenTurn(message, element);
  }

  /**
   * Puts a message that arrived *during* a turn where the record has it.
   *
   * **Steered input is the only thing that does this**, and without it the
   * surface and the vault disagree about the order of a conversation. The
   * coordinator writes the steered question to the conversation while the turn
   * runs, so the record reads question, question, answer — the answer is
   * written last, by the barrier. The surface has already drawn the answer's
   * bubble, so appending puts the question *after* it; and
   * `ConversationController.save` then writes `state.messages` over the record,
   * which leaves the vault holding a question that follows its own answer and
   * hands the next turn a transcript in that order.
   *
   * So the message is moved to sit in front of the turn it joined, in the array
   * and in the column. What it does not do is split the answer in two — the
   * legacy path finalized the open bubble and started a new one on the
   * provider's echo, and a turn here has one assistant message by contract.
   * That is a difference in how it *looks*, not in what is stored.
   */
  private placeBeforeOpenTurn(message: ChatMessage, element: HTMLElement | null): void {
    const openTurn = this.open ? this.turnMessages.get(this.open.runId) : undefined;
    if (!openTurn || openTurn === message) {
      return;
    }
    const messages = this.deps.state.messages;
    const from = messages.lastIndexOf(message);
    const to = messages.indexOf(openTurn);
    if (from < 0 || to < 0 || to > from) {
      return;
    }
    // Spliced in place rather than reassigned: whatever else is holding this
    // array — the controller, the renderer's action buttons — is holding the
    // same one.
    messages.splice(from, 1);
    messages.splice(to, 0, message);
    // The bubble the turn is drawing into, from the content element the cursor
    // is holding. Asked through `closest` because the cursor points at the
    // content div inside the bubble, not the bubble.
    const anchor = this.deps.state.currentContentEl?.closest?.('.grimoire-message');
    if (element && anchor?.parentElement) {
      anchor.parentElement.insertBefore(element, anchor);
    }
  }

  beginTurn(turn: ChatTurnView): void {
    const message = this.deps.createAssistantMessage(turn.assistantMessageId, turn.runId);
    this.turnMessages.set(turn.runId, message);
    // The same pair `appendMessage` performs, kept open here because the turn
    // needs the element back: rendering it twice to get it is a second bubble.
    this.deps.state.addMessage(message);
    this.deps.state.currentContentEl = contentElementOf(this.deps.renderer.addMessage(message));
    this.deps.state.currentTextEl = null;
    this.deps.state.currentTextContent = '';
    this.deps.state.currentThinkingState = null;
    this.open = null;
    this.deps.stream.showThinkingIndicator();
    this.deps.stream.startTurnSilenceIndicator(this.deps.getProviderId());
  }

  openTurnBlock(runId: RunId, index: number, item: ChatLiveItem): void {
    const message = this.turnMessages.get(runId);
    if (!message) {
      return;
    }
    // A new index means the previous block is finished. The legacy controller
    // decides this by watching the chunk type change; here the renderer has
    // already decided it, which is the whole point of the index.
    this.enqueue(() => this.deps.stream.finalizeCurrentThinkingBlock(message));
    this.enqueue(() => this.deps.stream.finalizeCurrentTextBlock(message));
    this.open = { runId, index, kind: item.kind };
    this.deps.stream.noteTurnActivity();
    switch (item.kind) {
      case 'assistant-text':
        message.content += item.text;
        this.enqueue(() => this.deps.stream.appendText(item.text));
        return;
      case 'reasoning-text':
        this.enqueue(() => this.deps.stream.appendThinking(item.text));
        return;
      case 'provider-content': {
        const presented = this.deps.presentProviderContent(item.payload);
        for (const content of presented) {
          this.enqueue(() => this.deps.stream.handleStreamChunk(content, message));
        }
        if (presented.some(content => content.type === 'usage')) {
          // Behind the chunks rather than beside them: the controller is what
          // decides which usage report to keep, and it decides it while
          // handling the chunk this reads back.
          this.enqueue(async () => {
            this.deps.recordTurnUsage(runId, this.deps.state.usage);
          });
        }
        return;
      }
      default: {
        const unhandled: never = item;
        void unhandled;
      }
    }
  }

  extendTurnText(runId: RunId, index: number, text: string): void {
    const message = this.turnMessages.get(runId);
    if (!message || this.open?.runId !== runId || this.open.index !== index) {
      return;
    }
    this.deps.stream.noteTurnActivity();
    if (this.open.kind === 'reasoning-text') {
      this.enqueue(() => this.deps.stream.appendThinking(text));
      return;
    }
    message.content += text;
    this.enqueue(() => this.deps.stream.appendText(text));
  }

  setTurnState(runId: RunId, state: RunState): void {
    const previous = this.turnStates.get(runId);
    this.turnStates.set(runId, state);
    if (state === previous) {
      return;
    }
    // The silence timer measures a provider that has gone quiet. A person
    // reading a permission prompt is not a provider going quiet, and counting
    // it as one is how a turn waiting on a human reports itself as stalled.
    if (state === 'waiting-interaction') {
      this.deps.stream.pauseTurnSilenceIndicator(true);
      return;
    }
    if (previous === 'waiting-interaction') {
      this.deps.stream.pauseTurnSilenceIndicator(false);
    }
  }

  endTurn(runId: RunId, terminal: RunTerminal): void {
    const message = this.turnMessages.get(runId);
    if (!message) {
      return;
    }
    this.open = null;
    // The same three endings the presentation adapter renders, kept identical
    // because a flipped provider's turn must not end differently depending on
    // which path drew it. `invalidated` renders too: it means the turn never
    // reached the provider, and saying nothing leaves an empty assistant
    // message where the explanation belongs.
    if (terminal.kind === 'failed' || terminal.kind === 'invalidated') {
      this.enqueue(() => this.deps.stream.handleStreamChunk(
        { type: 'error', content: this.deps.describeTerminal(terminal) },
        message,
      ));
    } else if (terminal.kind === 'indeterminate') {
      this.enqueue(() => this.deps.stream.handleStreamChunk(
        { type: 'notice', level: 'warning', content: this.deps.describeTerminal(terminal) },
        message,
      ));
    }
    this.enqueue(() => this.deps.stream.handleStreamChunk({ type: 'done' }, message));
    // Behind the drawing, not beside it: an indicator that goes out while the
    // last block is still being written says the turn is over before it looks
    // over.
    this.enqueue(async () => {
      this.deps.stream.hideThinkingIndicator();
      this.deps.stream.stopTurnSilenceIndicator();
    });
  }

  setTurnPersistence(
    runId: RunId,
    persistence: 'pending' | 'saving' | 'saved' | 'failed',
    errorCode?: string,
  ): void {
    const message = this.turnMessages.get(runId);
    if (!message || persistence !== 'failed') {
      return;
    }
    // The one persistence state a person can act on: the answer is on screen
    // and not in the vault, which nothing said before this path existed.
    this.enqueue(() => this.deps.stream.handleStreamChunk(
      {
        type: 'notice',
        level: 'warning',
        content: `This answer could not be saved (${errorCode ?? 'unknown'}).`,
      },
      message,
    ));
  }

  reconcileTurn(runId: RunId, outcome: ReconciledOutcomeProjection): void {
    const message = this.turnMessages.get(runId);
    if (!message) {
      return;
    }
    this.enqueue(() => this.deps.stream.handleStreamChunk(
      {
        type: 'notice',
        level: 'info',
        content: `This turn was later established to have ${outcome.observedOutcome}.`,
      },
      message,
    ));
  }

  showInteraction(_interaction: InteractionProjection): void {
    // Presents nothing, on purpose, and the port says why: the provider's own
    // interaction presenter already has this on screen. What is left to do is
    // what the surface does before any permission prompt appears — render the
    // tool calls it has been holding, so the prompt is not above a blank.
    this.deps.stream.flushPendingToolsForPermission();
  }

  hideInteraction(_interactionId: string): void {
    // Nothing to take down, for the same reason nothing was put up.
  }

  setQueuedCommandCount(_count: number): void {
    this.deps.updateQueueIndicator();
  }
}

function contentElementOf(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>('.grimoire-message-content');
}
