import type { ResultExpectation, ResultRef } from '../../../core/execution/ExecutionContracts';
import type {
  ExecutionInteractionRecord,
  ExecutionReconciliationRecord,
} from '../../../core/execution/ExecutionControlRecords';
import type { ExecutionEventEnvelope } from '../../../core/execution/ExecutionEvents';
import type { ExecutionSessionId, RunId } from '../../../core/execution/ExecutionIds';
import {
  applyRunReconciliation,
  createRunProjection,
  reduceRunProjection,
  type RunProjection,
} from '../../../core/execution/RunProjection';
import type { ChatMessage, Conversation } from '../../../core/types';
import type { ProviderId } from '../../../core/types/provider';

/**
 * What a conversation looks like, derived from what the kernel recorded.
 *
 * Harvested from the first attempt's Phase 7 as material and rebuilt against
 * this branch's contracts. Presentation-agnostic by construction and by gate:
 * this file is on the composition-boundary gate's strict list, so it may not
 * name a DOM type, a CSS class, an element structure, or a provider. That rule
 * is the plan's stop condition, and it is what makes a later UI redesign a
 * renderer swap rather than another architecture event.
 *
 * Dark for now, and listed as pending in the presentation parity manifest: the
 * chat surface still consumes the adapter's chunk stream. Its first consumer,
 * `ChatExecutionCoordinator`, has landed beside it and is dark for the same
 * reason — what neither of them has yet is a renderer.
 */

export interface MaterializedChatResult {
  readonly resultRef: ResultRef;
  readonly finalAssistantText?: string;
  readonly partialAssistantText?: string;
}

export interface InteractionProjection {
  readonly interactionId: string;
  readonly runId: string;
  readonly kind: ExecutionInteractionRecord['kind'];
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly status: ExecutionInteractionRecord['status'];
  readonly selectedResponseId?: string;
  readonly expiresAt?: number;
  readonly updatedAt: number;
}

export interface ReconciledChatResultProjection {
  readonly reconciliationId: string;
  readonly result: MaterializedChatResult;
}

export interface ChatTurnProjection {
  readonly commandId: string;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
  readonly run: RunProjection;
  readonly result?: MaterializedChatResult;
  readonly observedResults: readonly ReconciledChatResultProjection[];
  readonly persistence: 'pending' | 'saving' | 'saved' | 'failed';
  readonly persistenceErrorCode?: string;
  readonly assistantMessageId?: string;
  readonly startedAt: number;
  readonly completedAt?: number;
}

export interface ChatProjection {
  readonly conversationId: string;
  readonly providerId: ProviderId;
  readonly title: string;
  readonly conversationRevision: number;
  readonly messages: readonly ChatMessage[];
  readonly turns: readonly ChatTurnProjection[];
  readonly interactions: readonly InteractionProjection[];
  readonly queuedCommandIds: readonly string[];
  readonly activeRunId?: RunId;
}

export type ChatProjectionEvent =
  | {
    readonly kind: 'conversation-loaded';
    readonly conversation: Conversation;
    readonly revision: number;
  }
  | { readonly kind: 'command-queued'; readonly commandId: string }
  | { readonly kind: 'command-rejected'; readonly commandId: string }
  | {
    readonly kind: 'turn-started';
    readonly commandId: string;
    readonly executionSessionId: ExecutionSessionId;
    readonly runId: RunId;
    readonly resultExpectation: ResultExpectation;
    readonly startedAt: number;
  }
  | { readonly kind: 'run-envelope'; readonly envelope: ExecutionEventEnvelope }
  | {
    readonly kind: 'interaction-record';
    readonly record: Readonly<ExecutionInteractionRecord>;
  }
  | {
    readonly kind: 'reconciliation-record';
    readonly record: Readonly<ExecutionReconciliationRecord>;
  }
  | {
    readonly kind: 'result-materialized';
    readonly runId: RunId;
    readonly result: MaterializedChatResult;
  }
  | {
    readonly kind: 'reconciled-result-materialized';
    readonly runId: RunId;
    readonly reconciliationId: string;
    readonly result: MaterializedChatResult;
  }
  | { readonly kind: 'persistence-started'; readonly runId: RunId }
  | {
    readonly kind: 'persistence-failed';
    readonly runId: RunId;
    readonly errorCode: string;
  }
  | {
    readonly kind: 'turn-completed';
    readonly runId: RunId;
    readonly conversation: Conversation;
    readonly revision: number;
    readonly completedAt: number;
    readonly assistantMessageId?: string;
  };

export function createChatProjection(
  conversation: Conversation,
  revision: number,
): ChatProjection {
  return {
    conversationId: conversation.id,
    providerId: conversation.providerId,
    title: conversation.title,
    conversationRevision: revision,
    messages: [...conversation.messages],
    turns: [],
    interactions: [],
    queuedCommandIds: [],
  };
}

export function reduceChatProjection(
  projection: ChatProjection,
  event: ChatProjectionEvent,
): ChatProjection {
  switch (event.kind) {
    case 'conversation-loaded':
      if (event.conversation.id !== projection.conversationId
        || event.revision < projection.conversationRevision) {
        return projection;
      }
      if (event.revision === projection.conversationRevision
        && sameConversationProjection(projection, event.conversation)) {
        return projection;
      }
      return {
        ...projection,
        providerId: event.conversation.providerId,
        title: event.conversation.title,
        conversationRevision: event.revision,
        messages: [...event.conversation.messages],
      };
    case 'command-queued':
      if (projection.queuedCommandIds.includes(event.commandId)) return projection;
      return {
        ...projection,
        queuedCommandIds: [...projection.queuedCommandIds, event.commandId],
      };
    case 'command-rejected':
      if (!projection.queuedCommandIds.includes(event.commandId)) return projection;
      return {
        ...projection,
        queuedCommandIds: projection.queuedCommandIds.filter(id => id !== event.commandId),
      };
    case 'turn-started': {
      if (projection.turns.some(turn => turn.runId === event.runId)) return projection;
      const turn: ChatTurnProjection = {
        commandId: event.commandId,
        executionSessionId: event.executionSessionId,
        runId: event.runId,
        run: createRunProjection(event.runId, event.resultExpectation),
        observedResults: [],
        persistence: 'pending',
        startedAt: event.startedAt,
      };
      return {
        ...projection,
        turns: [...projection.turns, turn],
        queuedCommandIds: projection.queuedCommandIds.filter(id => id !== event.commandId),
        activeRunId: event.runId,
      };
    }
    case 'run-envelope':
      return updateTurn(projection, event.envelope.scope.kind === 'session'
        ? projection.activeRunId
        : event.envelope.scope.runId, turn => {
        const run = reduceRunProjection(turn.run, event.envelope);
        return run === turn.run ? turn : { ...turn, run };
      });
    case 'interaction-record': {
      if (!projection.turns.some(turn => turn.runId === event.record.runId)) return projection;
      const interaction = projectInteraction(event.record);
      const existingIndex = projection.interactions.findIndex(item => (
        item.interactionId === interaction.interactionId
      ));
      const existing = projection.interactions[existingIndex];
      if (existing && sameInteraction(existing, interaction)) return projection;
      const interactions = existingIndex < 0
        ? [...projection.interactions, interaction]
        : projection.interactions.map((item, index) => (
          index === existingIndex && interaction.updatedAt >= item.updatedAt ? interaction : item
        ));
      return { ...projection, interactions };
    }
    case 'reconciliation-record':
      return updateTurn(projection, event.record.runId as RunId, turn => ({
        ...turn,
        run: applyRunReconciliation(turn.run, event.record),
      }));
    case 'result-materialized':
      return updateTurn(projection, event.runId, turn => (
        sameResult(turn.result, event.result) ? turn : { ...turn, result: event.result }
      ));
    case 'reconciled-result-materialized':
      return updateTurn(projection, event.runId, turn => {
        const existing = turn.observedResults.find(item => (
          item.reconciliationId === event.reconciliationId
        ));
        if (existing && sameResult(existing.result, event.result)) return turn;
        const materialized = {
          reconciliationId: event.reconciliationId,
          result: event.result,
        };
        return {
          ...turn,
          observedResults: existing
            ? turn.observedResults.map(item => (
              item.reconciliationId === event.reconciliationId ? materialized : item
            ))
            : [...turn.observedResults, materialized],
        };
      });
    case 'persistence-started':
      return updateTurn(projection, event.runId, turn => (
        turn.persistence === 'saving' && turn.persistenceErrorCode === undefined
          ? turn
          : { ...turn, persistence: 'saving', persistenceErrorCode: undefined }
      ));
    case 'persistence-failed':
      return updateTurn(projection, event.runId, turn => (
        turn.persistence === 'failed' && turn.persistenceErrorCode === event.errorCode
          ? turn
          : {
            ...turn,
            persistence: 'failed',
            persistenceErrorCode: event.errorCode,
          }
      ));
    case 'turn-completed': {
      const withConversation = reduceChatProjection(projection, {
        kind: 'conversation-loaded',
        conversation: event.conversation,
        revision: event.revision,
      });
      const completed = updateTurn(withConversation, event.runId, turn => ({
        ...turn,
        persistence: 'saved',
        persistenceErrorCode: undefined,
        completedAt: event.completedAt,
        ...(event.assistantMessageId
          ? { assistantMessageId: event.assistantMessageId }
          : {}),
      }));
      return completed.activeRunId === event.runId
        ? { ...completed, activeRunId: undefined }
        : completed;
    }
    default: {
      // Two jobs, and both are needed. `noImplicitReturns` is off, so a kind
      // added to the union without a case would fall out of the switch and
      // return `undefined` — the whole conversation erased, with nothing to
      // catch it. The `never` assignment turns that into a compile error, and
      // the return turns a malformed event from outside TypeScript into a
      // no-op rather than a blank chat.
      const unhandled: never = event;
      void unhandled;
      return projection;
    }
  }
}

/**
 * A durable run record has no event here yet, on purpose.
 *
 * The first attempt's projection also folded in `ExecutionRunRecord`, so a run
 * recovered at startup could reach the surface without replaying its events.
 * `RunProjection` on this branch has no reducer for that, and adding one now
 * would still be a slot with no producer — the coordinator has landed and does
 * not feed one, because the registry answers `getRun` for a run you can name
 * and has no query for the runs an owner has. Startup restore is what needs
 * that query, and this event arrives with it.
 */
export function getActiveChatTurn(projection: ChatProjection): ChatTurnProjection | undefined {
  return projection.turns.find(turn => turn.runId === projection.activeRunId);
}

export function hasMissingRequiredResult(turn: ChatTurnProjection): boolean {
  return turn.run.terminal?.reason === 'missing-required-result';
}

function updateTurn(
  projection: ChatProjection,
  targetRunId: RunId | undefined,
  mutation: (turn: ChatTurnProjection) => ChatTurnProjection,
): ChatProjection {
  if (!targetRunId) return projection;
  let changed = false;
  const turns = projection.turns.map(turn => {
    if (turn.runId !== targetRunId) return turn;
    const next = mutation(turn);
    changed ||= next !== turn;
    return next;
  });
  return changed ? { ...projection, turns } : projection;
}

function projectInteraction(
  record: Readonly<ExecutionInteractionRecord>,
): InteractionProjection {
  return {
    interactionId: record.interactionId,
    runId: record.runId,
    kind: record.kind,
    presentationRef: record.presentationRef,
    responseIds: [...record.responseIds],
    status: record.status,
    ...(record.selectedResponseId ? { selectedResponseId: record.selectedResponseId } : {}),
    ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
    updatedAt: record.updatedAt,
  };
}

function sameResult(
  current: MaterializedChatResult | undefined,
  next: MaterializedChatResult,
): boolean {
  return current?.resultRef.resultId === next.resultRef.resultId
    && current?.resultRef.storage === next.resultRef.storage
    && current?.resultRef.digest === next.resultRef.digest
    && current.finalAssistantText === next.finalAssistantText
    && current.partialAssistantText === next.partialAssistantText;
}

function sameConversationProjection(
  projection: ChatProjection,
  conversation: Conversation,
): boolean {
  return projection.providerId === conversation.providerId
    && projection.title === conversation.title
    && projection.messages.length === conversation.messages.length
    && projection.messages.every((message, index) => (
      message === conversation.messages[index]
      || JSON.stringify(message) === JSON.stringify(conversation.messages[index])
    ));
}

function sameInteraction(
  left: InteractionProjection,
  right: InteractionProjection,
): boolean {
  return left.runId === right.runId
    && left.kind === right.kind
    && left.presentationRef === right.presentationRef
    && left.status === right.status
    && left.selectedResponseId === right.selectedResponseId
    && left.expiresAt === right.expiresAt
    && left.updatedAt === right.updatedAt
    && left.responseIds.length === right.responseIds.length
    && left.responseIds.every((responseId, index) => responseId === right.responseIds[index]);
}
