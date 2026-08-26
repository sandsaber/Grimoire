import type { RunState, RunTerminal } from '../../../core/execution/ExecutionContracts';
import type { RunId } from '../../../core/execution/ExecutionIds';
import type { ReconciledOutcomeProjection } from '../../../core/execution/RunProjection';
import type { ChatMessage } from '../../../core/types';
import type {
  ChatLiveItem,
  ChatProjection,
  ChatTurnProjection,
  InteractionProjection,
} from '../projections/ChatProjection';

/**
 * Turns successive projections into the calls a surface makes to draw them.
 *
 * The plan's "thin replaceable layer that maps projections onto the current
 * DOM", with the DOM behind a port: what lives here is the part that is the
 * same whatever the surface is made of — deciding *what changed* — and what
 * lives behind `ChatRenderTarget` is the part that is specific to this
 * application's chat column. That split is what makes a later redesign a new
 * target rather than a new architecture, and it is why this file is held to the
 * same rule as the projection: no DOM types, no class names, no layout.
 *
 * **A projection is a state and a chat column is an incremental thing**, which
 * is the whole reason this class exists rather than a `replace(model)` call.
 * Redrawing a conversation on every token would lose scroll position, selection
 * and every rendered code block; the first attempt's renderer replaced
 * wholesale and, having no live content to replace with, never had to face it.
 * So this diffs, and the diff is cheap for the reason the reducer is written
 * the way it is: an unchanged turn is the *same object*, so a render during a
 * stream compares a handful of references and touches one block.
 *
 * The port's vocabulary comes from what the existing surface already does —
 * open a block, extend its text, finalize it when the next one opens — rather
 * than from what a projection happens to contain. `StreamController` decides
 * "is this a new block?" by watching the chunk type change; here the block
 * index says so, which is the same decision made where the ordering is already
 * known.
 *
 * Dark: nothing constructs one yet, and no target implements the port.
 */

export interface ChatConversationView {
  readonly conversationId: string;
  readonly title: string;
  readonly messages: readonly ChatMessage[];
}

export interface ChatTurnView {
  readonly runId: RunId;
  readonly commandId: string;
  readonly startedAt: number;
}

/**
 * Everything a surface has to do to show a conversation.
 *
 * Every method is an operation the chat column already performs today; none of
 * them is a shape invented for this port. A target may assume the calls arrive
 * in order and that a block index is opened before it is extended.
 */
export interface ChatRenderTarget {
  /**
   * Draws the conversation from nothing.
   *
   * The renderer's one recovery, used for the first render and for every change
   * it cannot express as an increment — a different conversation, a transcript
   * replaced by a rewind or a history hydration, or a turn whose content did
   * not grow the way a projection grows. Redrawing is always correct; guessing
   * an increment that fits is not.
   */
  reset(view: ChatConversationView): void;
  setTitle(title: string): void;
  appendMessage(message: ChatMessage): void;
  beginTurn(turn: ChatTurnView): void;
  /** A new block for this turn. The target finalizes whatever it had open. */
  openTurnBlock(runId: RunId, index: number, item: ChatLiveItem): void;
  /** More text into a block already open at this index. */
  extendTurnText(runId: RunId, index: number, text: string): void;
  setTurnState(runId: RunId, state: RunState): void;
  endTurn(runId: RunId, terminal: RunTerminal): void;
  /**
   * What was later established about a turn that ended indeterminate.
   *
   * Arrives after `endTurn`, sometimes much later, and never instead of it: the
   * turn did end without an answer, and this is evidence about it rather than a
   * correction of it. A surface showing "could not establish whether this run
   * completed" has this and nothing else to replace that sentence with.
   */
  reconcileTurn(runId: RunId, outcome: ReconciledOutcomeProjection): void;
  setTurnPersistence(
    runId: RunId,
    persistence: ChatTurnProjection['persistence'],
    errorCode?: string,
  ): void;
  /**
   * An interaction the turn is waiting on.
   *
   * **A target implementing this must not open a second dialog.** Today the
   * provider's own interaction presenter is what puts an approval on screen —
   * triggered by its backend when the interaction opens, rendering through the
   * legacy approval callbacks, and returning a response id the kernel records.
   * That path is live for every flipped provider. A projection-driven surface
   * wants the same thing shown from here instead, so that a tab reopened
   * mid-question shows the question; which of the two triggers survives is
   * settled by the flip that replaces the legacy callbacks, not before it.
   * Until then this says *what the turn is waiting on*, and a target may render
   * it as state without presenting the choice twice.
   */
  showInteraction(interaction: InteractionProjection): void;
  hideInteraction(interactionId: string): void;
  setQueuedCommandCount(count: number): void;
}

export class ChatProjectionRenderer {
  private previous: ChatProjection | null = null;

  constructor(private readonly target: ChatRenderTarget) {}

  render(projection: ChatProjection): void {
    const previous = this.previous;
    if (previous === projection) {
      return;
    }
    if (!previous || !expressesAsIncrement(previous, projection)) {
      this.renderAll(projection);
      return;
    }
    if (previous.title !== projection.title) {
      this.target.setTitle(projection.title);
    }
    if (previous.messages !== projection.messages) {
      this.appendMessages(projection, previous.messages.length);
    }
    for (const [index, turn] of projection.turns.entries()) {
      const before = previous.turns[index];
      if (before === turn) {
        continue;
      }
      if (!before) {
        this.openTurn(turn);
        continue;
      }
      this.updateTurn(before, turn);
    }
    this.updateInteractions(previous, projection);
    if (previous.queuedCommandIds.length !== projection.queuedCommandIds.length) {
      this.target.setQueuedCommandCount(projection.queuedCommandIds.length);
    }
    this.previous = projection;
  }

  private renderAll(projection: ChatProjection): void {
    this.target.reset({
      conversationId: projection.conversationId,
      title: projection.title,
      messages: withoutTurnAnswers(projection),
    });
    for (const turn of projection.turns) {
      this.openTurn(turn);
    }
    for (const interaction of projection.interactions) {
      if (isOpenInteraction(interaction)) {
        this.target.showInteraction(interaction);
      }
    }
    this.target.setQueuedCommandCount(projection.queuedCommandIds.length);
    this.previous = projection;
  }

  private openTurn(turn: ChatTurnProjection): void {
    this.target.beginTurn({
      runId: turn.runId,
      commandId: turn.commandId,
      startedAt: turn.startedAt,
    });
    for (const [index, item] of turn.live.entries()) {
      this.target.openTurnBlock(turn.runId, index, item);
    }
    this.target.setTurnState(turn.runId, turn.run.state);
    if (turn.persistence !== 'pending') {
      this.target.setTurnPersistence(turn.runId, turn.persistence, turn.persistenceErrorCode);
    }
    if (turn.run.terminal) {
      this.target.endTurn(turn.runId, turn.run.terminal);
    }
    for (const outcome of turn.run.reconciledOutcomes) {
      this.target.reconcileTurn(turn.runId, outcome);
    }
  }

  private updateTurn(before: ChatTurnProjection, turn: ChatTurnProjection): void {
    if (before.live !== turn.live) {
      for (let index = before.live.length - 1; index < turn.live.length; index += 1) {
        const item = turn.live[index];
        const previousItem = before.live[index];
        if (!item || item === previousItem) {
          continue;
        }
        if (!previousItem) {
          this.target.openTurnBlock(turn.runId, index, item);
          continue;
        }
        this.target.extendTurnText(turn.runId, index, extendedText(previousItem, item));
      }
    }
    if (before.run.state !== turn.run.state) {
      this.target.setTurnState(turn.runId, turn.run.state);
    }
    if (before.persistence !== turn.persistence
      || before.persistenceErrorCode !== turn.persistenceErrorCode) {
      this.target.setTurnPersistence(turn.runId, turn.persistence, turn.persistenceErrorCode);
    }
    if (!before.run.terminal && turn.run.terminal) {
      this.target.endTurn(turn.runId, turn.run.terminal);
    }
    if (before.run.reconciledOutcomes !== turn.run.reconciledOutcomes) {
      for (const outcome of turn.run.reconciledOutcomes.slice(
        before.run.reconciledOutcomes.length,
      )) {
        this.target.reconcileTurn(turn.runId, outcome);
      }
    }
  }

  private appendMessages(projection: ChatProjection, from: number): void {
    // A turn drawn live already put its answer on screen, block by block. The
    // message the barrier then wrote holds the same words, and appending it
    // would show the answer twice — which is the price of a projection that
    // carries both the live view and the durable transcript, paid here.
    const answered = turnAnswerIds(projection);
    for (const message of projection.messages.slice(from)) {
      if (!answered.has(message.id)) {
        this.target.appendMessage(message);
      }
    }
  }

  private updateInteractions(previous: ChatProjection, projection: ChatProjection): void {
    if (previous.interactions === projection.interactions) {
      return;
    }
    for (const interaction of projection.interactions) {
      const before = previous.interactions.find(candidate => (
        candidate.interactionId === interaction.interactionId
      ));
      if (before === interaction) {
        continue;
      }
      if (isOpenInteraction(interaction)) {
        this.target.showInteraction(interaction);
      } else if (!before || isOpenInteraction(before)) {
        // Hidden on the way out of `open`, and only then: a resolution that
        // arrives for an interaction this renderer never showed has nothing to
        // take off the screen.
        this.target.hideInteraction(interaction.interactionId);
      }
    }
  }
}

function isOpenInteraction(interaction: InteractionProjection): boolean {
  return interaction.status === 'open' || interaction.status === 'resolving';
}

/**
 * Whether every difference between two projections is something to *add*.
 *
 * Asked once, before anything is drawn, so the pass that follows is
 * straight-line: it cannot discover halfway through that a change had no
 * increment and leave the column half updated. Everything it refuses is
 * something a redraw handles correctly — which is why the answer is a boolean
 * rather than a repair.
 */
function expressesAsIncrement(previous: ChatProjection, next: ChatProjection): boolean {
  if (previous.conversationId !== next.conversationId
    || !extendsMessages(previous.messages, next.messages)
    || !turnsGrewInPlace(previous, next)) {
    return false;
  }
  return previous.turns.every((turn, index) => {
    const after = next.turns[index];
    return !after || turn.live === after.live || liveGrewInPlace(turn.live, after.live);
  });
}

/**
 * Whether a turn's content grew the way a projection grows.
 *
 * Every block but the last is finished and never changes again; the last one
 * may gain text of its own kind. Anything else means the two projections are
 * not the same lineage, whatever their conversation ids say.
 */
function liveGrewInPlace(
  previous: readonly ChatLiveItem[],
  next: readonly ChatLiveItem[],
): boolean {
  if (next.length < previous.length) {
    return false;
  }
  return previous.every((item, index) => {
    const after = next[index];
    if (item === after) {
      return true;
    }
    if (!after || index !== previous.length - 1 || item.kind !== after.kind) {
      return false;
    }
    return item.kind !== 'provider-content'
      && after.kind !== 'provider-content'
      && after.text.startsWith(item.text);
  });
}

/**
 * Whether the transcript grew rather than changed.
 *
 * A rewind, a fork, and a provider history hydration all replace messages that
 * were already on screen, and there is no increment that expresses that. The
 * comparison is by identity and then by id: the reducer copies the array on
 * every conversation load, so a fresh array is not by itself a rewrite.
 */
function extendsMessages(
  previous: readonly ChatMessage[],
  next: readonly ChatMessage[],
): boolean {
  if (previous === next) {
    return true;
  }
  if (next.length < previous.length) {
    return false;
  }
  return previous.every((message, index) => message.id === next[index]?.id);
}

/** Whether every turn on screen is still the turn it was, in the same place. */
function turnsGrewInPlace(previous: ChatProjection, next: ChatProjection): boolean {
  if (previous.turns === next.turns) {
    return true;
  }
  if (next.turns.length < previous.turns.length) {
    return false;
  }
  return previous.turns.every((turn, index) => turn.runId === next.turns[index]?.runId);
}

/** The text a block gained. `expressesAsIncrement` has already allowed it. */
function extendedText(previous: ChatLiveItem, next: ChatLiveItem): string {
  return previous.kind === 'provider-content' || next.kind === 'provider-content'
    ? ''
    : next.text.slice(previous.text.length);
}

function turnAnswerIds(projection: ChatProjection): Set<string> {
  const ids = new Set<string>();
  for (const turn of projection.turns) {
    if (turn.assistantMessageId) {
      ids.add(turn.assistantMessageId);
    }
  }
  return ids;
}

function withoutTurnAnswers(projection: ChatProjection): readonly ChatMessage[] {
  const answered = turnAnswerIds(projection);
  return answered.size === 0
    ? projection.messages
    : projection.messages.filter(message => !answered.has(message.id));
}
