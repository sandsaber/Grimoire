import type { ChatMessage } from '../../../core/types';
import type {
  ChatProjection,
  ChatTurnProjection,
  InteractionProjection,
} from '../projections/ChatProjection';
import { hasMissingRequiredResult } from '../projections/ChatProjection';

export interface ChatTurnRenderModel {
  readonly runId: string;
  readonly state: ChatTurnProjection['run']['state'];
  readonly finalAssistantText?: string;
  readonly partialAssistantText?: string;
  readonly thinkingObserved: boolean;
  readonly toolCallIds: readonly string[];
  readonly progressIds: readonly string[];
  readonly interactionIds: readonly string[];
  readonly resultId?: string;
  readonly missingRequiredResult: boolean;
  readonly terminal?: ChatTurnProjection['run']['terminal'];
  readonly reconciledOutcomes: readonly ReconciledOutcomeRenderModel[];
  readonly persistence: ChatTurnProjection['persistence'];
  readonly persistenceErrorCode?: string;
}

export interface ReconciledOutcomeRenderModel {
  readonly reconciliationId: string;
  readonly observedOutcome: ChatTurnProjection['run']['reconciledOutcomes'][number]['observedOutcome'];
  readonly observedResultId?: string;
  readonly finalAssistantText?: string;
  readonly partialAssistantText?: string;
  readonly evidence: ChatTurnProjection['run']['reconciledOutcomes'][number]['evidence'];
  readonly recordedAt: number;
}

export interface ChatProjectionRenderModel {
  readonly conversationId: string;
  readonly title: string;
  readonly messages: readonly ChatMessage[];
  readonly turns: readonly ChatTurnRenderModel[];
  readonly interactions: readonly InteractionProjection[];
  readonly queuedCommandCount: number;
  readonly activeRunId?: string;
}

export interface ChatProjectionRenderTarget {
  replace(model: ChatProjectionRenderModel): void;
}

export class ChatProjectionRenderer {
  constructor(private readonly target: ChatProjectionRenderTarget) {}

  render(projection: ChatProjection): void {
    this.target.replace(toChatProjectionRenderModel(projection));
  }
}

export function toChatProjectionRenderModel(
  projection: ChatProjection,
): ChatProjectionRenderModel {
  return {
    conversationId: projection.conversationId,
    title: projection.title,
    messages: projection.messages,
    turns: projection.turns.map(toTurnRenderModel),
    interactions: projection.interactions,
    queuedCommandCount: projection.queuedCommandIds.length,
    ...(projection.activeRunId ? { activeRunId: projection.activeRunId } : {}),
  };
}

function toTurnRenderModel(turn: ChatTurnProjection): ChatTurnRenderModel {
  return {
    runId: turn.runId,
    state: turn.run.state,
    ...(turn.result?.finalAssistantText !== undefined
      ? { finalAssistantText: turn.result.finalAssistantText }
      : {}),
    ...(turn.result?.partialAssistantText !== undefined
      ? { partialAssistantText: turn.result.partialAssistantText }
      : {}),
    thinkingObserved: turn.run.sawThinking,
    toolCallIds: turn.run.toolCallIds,
    progressIds: turn.run.progressIds,
    interactionIds: turn.run.interactionIds,
    ...(turn.run.result ? { resultId: turn.run.result.resultId } : {}),
    missingRequiredResult: hasMissingRequiredResult(turn),
    ...(turn.run.terminal ? { terminal: turn.run.terminal } : {}),
    reconciledOutcomes: turn.run.reconciledOutcomes.map(outcome => {
      const materialized = turn.observedResults.find(item => (
        item.reconciliationId === outcome.reconciliationId
      ))?.result;
      return {
        reconciliationId: outcome.reconciliationId,
        observedOutcome: outcome.observedOutcome,
        ...(outcome.observedResult
          ? { observedResultId: outcome.observedResult.resultId }
          : {}),
        ...(materialized?.finalAssistantText !== undefined
          ? { finalAssistantText: materialized.finalAssistantText }
          : {}),
        ...(materialized?.partialAssistantText !== undefined
          ? { partialAssistantText: materialized.partialAssistantText }
          : {}),
        evidence: outcome.evidence,
        recordedAt: outcome.recordedAt,
      };
    }),
    persistence: turn.persistence,
    ...(turn.persistenceErrorCode
      ? { persistenceErrorCode: turn.persistenceErrorCode }
      : {}),
  };
}
