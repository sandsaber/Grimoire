import type {
  AgentAttemptProjection,
  AgentResultProjection,
  AgentWorkCardAction,
  AgentWorkCardProjection,
  AgentWorkNodeProjection,
  AgentWorkProjectionView,
  WorkNodeCardProjection,
} from '../projections/AgentProjection';

export interface AgentResultRenderModel {
  readonly agentResultId: string;
  readonly status: AgentResultProjection['status'];
  readonly summary?: string;
  readonly finalText?: string;
  readonly partialText?: string;
  readonly artifacts: AgentResultProjection['artifacts'];
  readonly changedFiles: AgentResultProjection['changedFiles'];
  readonly citations: AgentResultProjection['citations'];
  readonly childResultIds: AgentResultProjection['childResultIds'];
  readonly usage?: AgentResultProjection['usage'];
  readonly error?: AgentResultProjection['error'];
  readonly provenance: AgentResultProjection['provenance'];
  readonly completedAt: number;
  readonly reconciled: boolean;
}

export interface AgentAttemptRenderModel {
  readonly agentRunId: string;
  readonly attempt: number;
  readonly state: AgentAttemptProjection['state'];
  readonly goalRef: string;
  readonly terminal?: AgentAttemptProjection['terminal'];
  readonly results: readonly AgentResultRenderModel[];
  readonly reconciledResults: readonly AgentResultRenderModel[];
  readonly missingResultIds: readonly string[];
  readonly missingReconciledResultIds: readonly string[];
  readonly interactions: AgentAttemptProjection['interactions'];
  readonly work?: AgentWorkNodeProjection;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AgentWorkCardRenderModel {
  readonly agentInstanceId: string;
  readonly providerId: string;
  readonly definitionId: string;
  readonly executionMode: AgentWorkCardProjection['executionMode'];
  readonly origin: AgentWorkCardProjection['origin'];
  readonly attachment: AgentWorkCardProjection['attachment'];
  readonly observation: AgentWorkCardProjection['observation'];
  readonly observationConfidence: AgentWorkCardProjection['observationConfidence'];
  readonly status: AgentWorkCardProjection['status'];
  readonly nativeAgentRef?: string;
  readonly attempts: readonly AgentAttemptRenderModel[];
  readonly children: readonly AgentWorkCardRenderModel[];
  readonly expanded: boolean;
  readonly actions: readonly AgentWorkCardAction[];
}

export interface WorkNodeCardRenderModel {
  readonly workGraphId: string;
  readonly workGraphExecutionId: string;
  readonly workNodeId: string;
  readonly kind: WorkNodeCardProjection['kind'];
  readonly goalRef: string;
  readonly dependencyNodeIds: readonly string[];
  readonly blockedByNodeIds: readonly string[];
  readonly assignment: WorkNodeCardProjection['assignment'];
  readonly synthesisInputResultIds: readonly string[];
  readonly state: WorkNodeCardProjection['state'];
  readonly attempt: number;
  readonly agentRunId?: string;
  readonly agentInstanceId?: string;
  readonly resultIds: readonly string[];
  readonly results: readonly AgentResultRenderModel[];
  readonly missingResultIds: readonly string[];
  readonly terminalCode?: string;
  readonly updatedAt: number;
}

export interface AgentWorkSurfaceRenderModel {
  readonly agentCards: readonly AgentWorkCardRenderModel[];
  readonly workNodes: readonly WorkNodeCardRenderModel[];
}

export interface AgentWorkCardRenderTarget {
  replace(surface: AgentWorkSurfaceRenderModel): void;
}

export class AgentWorkCardRenderer {
  constructor(private readonly target: AgentWorkCardRenderTarget) {}

  render(view: AgentWorkProjectionView): void {
    this.target.replace({
      agentCards: view.agentCards.map(toAgentWorkCardRenderModel),
      workNodes: view.workNodes.map(toWorkNodeCardRenderModel),
    });
  }
}

export function toWorkNodeCardRenderModel(
  node: WorkNodeCardProjection,
): WorkNodeCardRenderModel {
  return {
    ...node,
    results: node.results.map(result => toResultRenderModel(
      result,
      result.provenance.kind === 'reconciled',
    )),
  };
}

export function toAgentWorkCardRenderModel(
  card: AgentWorkCardProjection,
): AgentWorkCardRenderModel {
  return {
    agentInstanceId: card.agentInstanceId,
    providerId: card.providerId,
    definitionId: card.definitionId,
    executionMode: card.executionMode,
    origin: card.origin,
    attachment: card.attachment,
    observation: card.observation,
    observationConfidence: card.observationConfidence,
    status: card.status,
    ...(card.nativeAgentRef ? { nativeAgentRef: card.nativeAgentRef } : {}),
    attempts: card.attempts.map(toAttemptRenderModel),
    children: card.children.map(toAgentWorkCardRenderModel),
    expanded: card.expanded,
    actions: card.actions,
  };
}

function toAttemptRenderModel(attempt: AgentAttemptProjection): AgentAttemptRenderModel {
  return {
    agentRunId: attempt.agentRunId,
    attempt: attempt.attempt,
    state: attempt.state,
    goalRef: attempt.goalRef,
    ...(attempt.terminal ? { terminal: attempt.terminal } : {}),
    results: attempt.results.map(result => toResultRenderModel(result, false)),
    reconciledResults: attempt.observedResults.map(result => toResultRenderModel(result, true)),
    missingResultIds: attempt.missingResultIds,
    missingReconciledResultIds: attempt.missingObservedResultIds,
    interactions: attempt.interactions,
    ...(attempt.work ? { work: attempt.work } : {}),
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

function toResultRenderModel(
  result: AgentResultProjection,
  reconciled: boolean,
): AgentResultRenderModel {
  return {
    ...result,
    reconciled,
  };
}
