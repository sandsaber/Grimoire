import type { RunState, RunTerminal } from '../../../core/execution/ExecutionContracts';
import type { RunId } from '../../../core/execution/ExecutionIds';
import type { ReconciledOutcomeProjection } from '../../../core/execution/RunProjection';
import type { ProviderHistoryHydration } from '../../../core/providers/ProviderModule';
import type { AssistantTextPhase, ChatContentItem, ChatMessage } from '../../../core/types';
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
 * Dark: nothing constructs one, because the thing that would is the attachment
 * that binds a tab to a coordinator, and that is the flip.
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
  /** The message a live turn is drawn into, before the barrier writes one. */
  createAssistantMessage(runId: RunId): ChatMessage;
  /** The provider's wording for a terminal, where it has one. */
  describeTerminal(terminal: RunTerminal): string;
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

  constructor(private readonly deps: ChatSurfaceRenderTargetDeps) {}

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
    this.deps.renderer.addMessage(message);
  }

  beginTurn(turn: ChatTurnView): void {
    const message = this.deps.createAssistantMessage(turn.runId);
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
    void this.deps.stream.finalizeCurrentThinkingBlock(message);
    void this.deps.stream.finalizeCurrentTextBlock(message);
    this.open = { runId, index, kind: item.kind };
    switch (item.kind) {
      case 'assistant-text':
        message.content += item.text;
        void this.deps.stream.appendText(item.text);
        return;
      case 'reasoning-text':
        void this.deps.stream.appendThinking(item.text);
        return;
      case 'provider-content':
        for (const content of this.deps.presentProviderContent(item.payload)) {
          void this.deps.stream.handleStreamChunk(content, message);
        }
        return;
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
    if (this.open.kind === 'reasoning-text') {
      void this.deps.stream.appendThinking(text);
      return;
    }
    message.content += text;
    void this.deps.stream.appendText(text);
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
      void this.deps.stream.handleStreamChunk(
        { type: 'error', content: this.deps.describeTerminal(terminal) },
        message,
      );
    } else if (terminal.kind === 'indeterminate') {
      void this.deps.stream.handleStreamChunk(
        { type: 'notice', level: 'warning', content: this.deps.describeTerminal(terminal) },
        message,
      );
    }
    void this.deps.stream.handleStreamChunk({ type: 'done' }, message);
    this.deps.stream.hideThinkingIndicator();
    this.deps.stream.stopTurnSilenceIndicator();
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
    void this.deps.stream.handleStreamChunk(
      {
        type: 'notice',
        level: 'warning',
        content: `This answer could not be saved (${errorCode ?? 'unknown'}).`,
      },
      message,
    );
  }

  reconcileTurn(runId: RunId, outcome: ReconciledOutcomeProjection): void {
    const message = this.turnMessages.get(runId);
    if (!message) {
      return;
    }
    void this.deps.stream.handleStreamChunk(
      {
        type: 'notice',
        level: 'info',
        content: `This turn was later established to have ${outcome.observedOutcome}.`,
      },
      message,
    );
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
