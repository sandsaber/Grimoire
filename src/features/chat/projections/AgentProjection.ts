import type {
  AgentInstanceRecord,
  AgentObservationFidelity,
  AgentResultRecord,
  AgentRunRecord,
} from '../../../core/agents/AgentContracts';
import type { AgentFidelityProfile } from '../../../core/agents/AgentFidelity';
import type { AgentInstanceId, AgentResultId, AgentRunId } from '../../../core/agents/AgentIds';
import type { ExecutionOwner } from '../../../core/execution/ExecutionContracts';
import type { ExecutionInteractionRecord } from '../../../core/execution/ExecutionControlRecords';
import type { VersionedRecord } from '../../../core/persistence/VersionedRecord';
import type { ProviderId } from '../../../core/types/provider';
import type {
  WorkGraphExecution,
  WorkGraphRevision,
  WorkNode,
  WorkNodeExecutionState,
} from '../../../core/work/WorkGraph';

interface VersionedProjectionRecord<TRecord> {
  readonly revision: number;
  readonly record: Readonly<TRecord>;
}

export interface AgentProjection {
  readonly owner: ExecutionOwner;
  readonly instances: readonly VersionedProjectionRecord<AgentInstanceRecord>[];
  readonly runs: readonly VersionedProjectionRecord<AgentRunRecord>[];
  readonly results: readonly Readonly<AgentResultRecord>[];
  readonly interactions: readonly VersionedProjectionRecord<ExecutionInteractionRecord>[];
  readonly workGraphRevisions: readonly VersionedProjectionRecord<WorkGraphRevision>[];
  readonly workExecutions: readonly VersionedProjectionRecord<WorkGraphExecution>[];
  readonly fidelityProfiles: readonly {
    readonly providerId: ProviderId;
    readonly profile: AgentFidelityProfile;
  }[];
  readonly expandedAgentIds: readonly AgentInstanceId[];
}

export type AgentProjectionEvent =
  | { readonly kind: 'instance-record'; readonly record: VersionedRecord<AgentInstanceRecord> }
  | { readonly kind: 'run-record'; readonly record: VersionedRecord<AgentRunRecord> }
  | { readonly kind: 'result-record'; readonly record: Readonly<AgentResultRecord> }
  | {
    readonly kind: 'interaction-record';
    readonly record: Readonly<ExecutionInteractionRecord>;
    readonly revision: number;
  }
  | { readonly kind: 'work-graph-record'; readonly record: VersionedRecord<WorkGraphRevision> }
  | { readonly kind: 'work-execution-record'; readonly record: VersionedRecord<WorkGraphExecution> }
  | {
    readonly kind: 'fidelity-profile';
    readonly providerId: ProviderId;
    readonly profile: AgentFidelityProfile;
  }
  | { readonly kind: 'agent-expansion-changed'; readonly agentInstanceId: AgentInstanceId; readonly expanded: boolean };

export type AgentWorkCardAction =
  | 'cancel'
  | 'retry'
  | 'focus'
  | 'expand-children'
  | 'collapse-children'
  | 'inspect-results';

export interface AgentResultProjection {
  readonly agentResultId: AgentResultId;
  readonly status: AgentResultRecord['status'];
  readonly summary?: string;
  readonly finalText?: string;
  readonly partialText?: string;
  readonly artifacts: AgentResultRecord['artifacts'];
  readonly changedFiles: AgentResultRecord['changedFiles'];
  readonly citations: AgentResultRecord['citations'];
  readonly childResultIds: AgentResultRecord['childResultIds'];
  readonly usage?: AgentResultRecord['usage'];
  readonly error?: AgentResultRecord['error'];
  readonly provenance: AgentResultRecord['provenance'];
  readonly completedAt: number;
}

export interface AgentAttemptProjection {
  readonly agentRunId: AgentRunId;
  readonly attempt: number;
  readonly state: AgentRunRecord['state'];
  readonly goalRef: string;
  readonly terminal?: AgentRunRecord['terminal'];
  readonly results: readonly AgentResultProjection[];
  readonly observedResults: readonly AgentResultProjection[];
  readonly missingResultIds: readonly AgentResultId[];
  readonly missingObservedResultIds: readonly AgentResultId[];
  readonly interactions: readonly AgentInteractionProjection[];
  readonly work?: AgentWorkNodeProjection;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AgentInteractionProjection {
  readonly interactionId: string;
  readonly kind: ExecutionInteractionRecord['kind'];
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly status: ExecutionInteractionRecord['status'];
  readonly selectedResponseId?: string;
  readonly expiresAt?: number;
  readonly updatedAt: number;
}

export interface AgentWorkNodeProjection {
  readonly workGraphExecutionId: string;
  readonly workNodeId: string;
  readonly kind: WorkNode['kind'];
  readonly dependencyNodeIds: readonly string[];
  readonly state: WorkNodeExecutionState['state'];
  readonly terminalCode?: string;
  readonly resultIds: readonly AgentResultId[];
}

export interface WorkNodeCardProjection {
  readonly workGraphId: string;
  readonly workGraphExecutionId: string;
  readonly workNodeId: string;
  readonly kind: WorkNode['kind'];
  readonly goalRef: string;
  readonly dependencyNodeIds: readonly string[];
  readonly blockedByNodeIds: readonly string[];
  readonly assignment: WorkNode['assignment'];
  readonly synthesisInputResultIds: readonly AgentResultId[];
  readonly state: WorkNodeExecutionState['state'];
  readonly attempt: number;
  readonly agentRunId?: AgentRunId;
  readonly agentInstanceId?: AgentInstanceId;
  readonly resultIds: readonly AgentResultId[];
  readonly results: readonly AgentResultProjection[];
  readonly missingResultIds: readonly AgentResultId[];
  readonly terminalCode?: string;
  readonly updatedAt: number;
}

export interface AgentWorkProjectionView {
  readonly agentCards: readonly AgentWorkCardProjection[];
  readonly workNodes: readonly WorkNodeCardProjection[];
}

export interface AgentWorkCardProjection {
  readonly agentInstanceId: AgentInstanceId;
  readonly providerId: ProviderId;
  readonly definitionId: string;
  readonly executionMode: AgentInstanceRecord['executionMode'];
  readonly origin: AgentInstanceRecord['origin'];
  readonly attachment: AgentInstanceRecord['attachment'];
  readonly observation: AgentObservationFidelity;
  readonly observationConfidence: 'exact' | 'aggregate' | 'terminal-only' | 'opaque' | 'unavailable';
  readonly status: AgentInstanceRecord['status'];
  readonly nativeAgentRef?: string;
  readonly attempts: readonly AgentAttemptProjection[];
  readonly children: readonly AgentWorkCardProjection[];
  readonly expanded: boolean;
  readonly actions: readonly AgentWorkCardAction[];
}

export function createAgentProjection(owner: ExecutionOwner): AgentProjection {
  return {
    owner,
    instances: [],
    runs: [],
    results: [],
    interactions: [],
    workGraphRevisions: [],
    workExecutions: [],
    fidelityProfiles: [],
    expandedAgentIds: [],
  };
}

export function reduceAgentProjection(
  projection: AgentProjection,
  event: AgentProjectionEvent,
): AgentProjection {
  switch (event.kind) {
    case 'instance-record':
      return replaceVersioned(
        projection,
        'instances',
        event.record,
        record => record.agentInstanceId,
      );
    case 'run-record':
      return replaceVersioned(projection, 'runs', event.record, record => record.agentRunId);
    case 'result-record': {
      const existing = projection.results.find(result => (
        result.agentResultId === event.record.agentResultId
      ));
      if (existing) return projection;
      return { ...projection, results: [...projection.results, event.record] };
    }
    case 'interaction-record': {
      const existing = projection.interactions.find(interaction => (
        interaction.record.interactionId === event.record.interactionId
      ));
      if (existing && existing.revision >= event.revision) return projection;
      const next = { record: event.record, revision: event.revision };
      return {
        ...projection,
        interactions: existing
          ? projection.interactions.map(interaction => (
            interaction.record.interactionId === event.record.interactionId
              ? next
              : interaction
          ))
          : [...projection.interactions, next],
      };
    }
    case 'work-graph-record':
      return replaceVersioned(
        projection,
        'workGraphRevisions',
        event.record,
        record => record.workGraphRevisionId,
      );
    case 'work-execution-record':
      return replaceVersioned(
        projection,
        'workExecutions',
        event.record,
        record => record.workGraphExecutionId,
      );
    case 'fidelity-profile': {
      const existing = projection.fidelityProfiles.find(entry => (
        entry.providerId === event.providerId
      ));
      if (existing?.profile === event.profile) return projection;
      const entry = { providerId: event.providerId, profile: event.profile };
      return {
        ...projection,
        fidelityProfiles: existing
          ? projection.fidelityProfiles.map(candidate => (
            candidate.providerId === event.providerId ? entry : candidate
          ))
          : [...projection.fidelityProfiles, entry],
      };
    }
    case 'agent-expansion-changed': {
      const expanded = projection.expandedAgentIds.includes(event.agentInstanceId);
      if (expanded === event.expanded) return projection;
      return {
        ...projection,
        expandedAgentIds: event.expanded
          ? [...projection.expandedAgentIds, event.agentInstanceId]
          : projection.expandedAgentIds.filter(id => id !== event.agentInstanceId),
      };
    }
  }
}

export function selectAgentWorkCards(
  projection: AgentProjection,
): readonly AgentWorkCardProjection[] {
  const instances = new Map(projection.instances.map(entry => [
    entry.record.agentInstanceId,
    entry.record,
  ]));
  const children = new Map<AgentInstanceId, AgentInstanceRecord[]>();
  const roots: AgentInstanceRecord[] = [];
  for (const instance of instances.values()) {
    const parentId = instance.parentAgentInstanceId;
    if (!parentId || !instances.has(parentId)) {
      roots.push(instance);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(instance);
    children.set(parentId, siblings);
  }
  const visiting = new Set<AgentInstanceId>();
  const project = (instance: AgentInstanceRecord): AgentWorkCardProjection => {
    if (visiting.has(instance.agentInstanceId)) {
      return projectCard(projection, instance, []);
    }
    visiting.add(instance.agentInstanceId);
    const childCards = sortInstances(children.get(instance.agentInstanceId) ?? [])
      .map(child => project(child));
    visiting.delete(instance.agentInstanceId);
    return projectCard(projection, instance, childCards);
  };
  return sortInstances(roots).map(project);
}

export function selectWorkNodeCards(
  projection: AgentProjection,
): readonly WorkNodeCardProjection[] {
  const runs = new Map(projection.runs.map(entry => [entry.record.agentRunId, entry.record]));
  const resultIds = new Set(projection.results.map(result => result.agentResultId));
  return projection.workExecutions.flatMap(executionEntry => {
    const execution = executionEntry.record;
    const graph = projection.workGraphRevisions.find(entry => (
      entry.record.workGraphRevisionId === execution.workGraphRevisionId
    ))?.record;
    if (!graph) return [];
    const states = new Map(execution.nodeStates.map(state => [state.workNodeId, state]));
    return graph.nodes.flatMap(node => {
      const state = states.get(node.workNodeId);
      if (!state) return [];
      const run = state.agentRunId ? runs.get(state.agentRunId) : undefined;
      const blockedByNodeIds = node.dependencyNodeIds.filter(dependencyId => {
        const dependency = states.get(dependencyId);
        return dependency?.state === 'failed'
          || dependency?.state === 'cancelled'
          || dependency?.state === 'blocked'
          || dependency?.state === 'indeterminate';
      });
      return [{
        workGraphId: graph.workGraphId,
        workGraphExecutionId: execution.workGraphExecutionId,
        workNodeId: node.workNodeId,
        kind: node.kind,
        goalRef: node.goalRef,
        dependencyNodeIds: node.dependencyNodeIds,
        blockedByNodeIds,
        assignment: node.assignment,
        synthesisInputResultIds: state.inputResultIds ?? node.synthesisInputResultIds,
        state: state.state,
        attempt: state.attempt,
        ...(state.agentRunId ? { agentRunId: state.agentRunId } : {}),
        ...(run ? { agentInstanceId: run.agentInstanceId } : {}),
        resultIds: state.resultIds,
        results: state.resultIds
          .map(id => projection.results.find(result => result.agentResultId === id))
          .filter((result): result is Readonly<AgentResultRecord> => result !== undefined)
          .map(projectResult),
        missingResultIds: state.resultIds.filter(id => !resultIds.has(id)),
        ...(state.terminalCode ? { terminalCode: state.terminalCode } : {}),
        updatedAt: state.updatedAt,
      } satisfies WorkNodeCardProjection];
    });
  }).sort((left, right) => (
    left.updatedAt - right.updatedAt || left.workNodeId.localeCompare(right.workNodeId)
  ));
}

export function selectAgentWorkProjection(
  projection: AgentProjection,
): AgentWorkProjectionView {
  return {
    agentCards: selectAgentWorkCards(projection),
    workNodes: selectWorkNodeCards(projection),
  };
}

function projectCard(
  projection: AgentProjection,
  instance: AgentInstanceRecord,
  children: readonly AgentWorkCardProjection[],
): AgentWorkCardProjection {
  const attempts = projection.runs
    .filter(entry => entry.record.agentInstanceId === instance.agentInstanceId)
    .map(entry => projectAttempt(projection, entry.record))
    .sort((left, right) => left.attempt - right.attempt);
  const latest = attempts.at(-1);
  const profile = projection.fidelityProfiles.find(entry => (
    entry.providerId === instance.providerId
  ))?.profile;
  const observation = instance.executionMode === 'provider-native' && profile
    ? conservativeObservation(instance.observation, profile.observation)
    : instance.observation;
  const expanded = projection.expandedAgentIds.includes(instance.agentInstanceId);
  const actions: AgentWorkCardAction[] = ['focus'];
  if (children.length > 0) actions.push(expanded ? 'collapse-children' : 'expand-children');
  if (attempts.some(attempt => attempt.results.length + attempt.observedResults.length > 0)) {
    actions.push('inspect-results');
  }
  if (latest && !latest.terminal && canCancel(instance, profile)) actions.push('cancel');
  if (latest?.terminal && instance.origin === 'grimoire-dispatched') actions.push('retry');
  return {
    agentInstanceId: instance.agentInstanceId,
    providerId: instance.providerId,
    definitionId: instance.definition.definitionId,
    executionMode: instance.executionMode,
    origin: instance.origin,
    attachment: instance.attachment,
    observation,
    observationConfidence: observationConfidence(observation),
    status: instance.status,
    ...(instance.nativeAgentRef
      && (instance.executionMode !== 'provider-native' || profile?.stableIdentity !== false)
      ? { nativeAgentRef: instance.nativeAgentRef }
      : {}),
    attempts,
    children,
    expanded,
    actions,
  };
}

function projectAttempt(
  projection: AgentProjection,
  run: Readonly<AgentRunRecord>,
): AgentAttemptProjection {
  const resultMap = new Map(projection.results.map(result => [result.agentResultId, result]));
  const projectResults = (ids: readonly AgentResultId[]): AgentResultProjection[] => ids
    .map(id => resultMap.get(id))
    .filter((result): result is Readonly<AgentResultRecord> => result !== undefined)
    .map(projectResult);
  const work = projectWorkNode(projection, run);
  return {
    agentRunId: run.agentRunId,
    attempt: run.attempt,
    state: run.state,
    goalRef: run.goalRef,
    ...(run.terminal ? { terminal: run.terminal } : {}),
    results: projectResults(run.resultIds),
    observedResults: projectResults(run.observedResultIds),
    missingResultIds: run.resultIds.filter(id => !resultMap.has(id)),
    missingObservedResultIds: run.observedResultIds.filter(id => !resultMap.has(id)),
    interactions: run.executionRunId
      ? projection.interactions
        .filter(interaction => interaction.record.runId === run.executionRunId)
        .map(interaction => projectInteraction(interaction.record))
      : [],
    ...(work ? { work } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function projectInteraction(
  interaction: Readonly<ExecutionInteractionRecord>,
): AgentInteractionProjection {
  return {
    interactionId: interaction.interactionId,
    kind: interaction.kind,
    presentationRef: interaction.presentationRef,
    responseIds: interaction.responseIds,
    status: interaction.status,
    ...(interaction.selectedResponseId
      ? { selectedResponseId: interaction.selectedResponseId }
      : {}),
    ...(interaction.expiresAt !== undefined ? { expiresAt: interaction.expiresAt } : {}),
    updatedAt: interaction.updatedAt,
  };
}

function projectResult(result: Readonly<AgentResultRecord>): AgentResultProjection {
  return {
    agentResultId: result.agentResultId,
    status: result.status,
    ...(result.summary !== undefined ? { summary: result.summary } : {}),
    ...(result.finalText !== undefined ? { finalText: result.finalText } : {}),
    ...(result.partialText !== undefined ? { partialText: result.partialText } : {}),
    artifacts: result.artifacts,
    changedFiles: result.changedFiles,
    citations: result.citations,
    childResultIds: result.childResultIds,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.error ? { error: result.error } : {}),
    provenance: result.provenance,
    completedAt: result.completedAt,
  };
}

function projectWorkNode(
  projection: AgentProjection,
  run: Readonly<AgentRunRecord>,
): AgentWorkNodeProjection | undefined {
  if (!run.workGraphExecutionRef || !run.workNodeRef) return undefined;
  const execution = projection.workExecutions.find(entry => (
    entry.record.workGraphExecutionId === run.workGraphExecutionRef
  ))?.record;
  if (!execution) return undefined;
  const graph = projection.workGraphRevisions.find(entry => (
    entry.record.workGraphRevisionId === execution.workGraphRevisionId
  ))?.record;
  const node = graph?.nodes.find(candidate => candidate.workNodeId === run.workNodeRef);
  const state = execution.nodeStates.find(candidate => candidate.workNodeId === run.workNodeRef);
  if (!node || !state) return undefined;
  return {
    workGraphExecutionId: execution.workGraphExecutionId,
    workNodeId: node.workNodeId,
    kind: node.kind,
    dependencyNodeIds: node.dependencyNodeIds,
    state: state.state,
    ...(state.terminalCode ? { terminalCode: state.terminalCode } : {}),
    resultIds: state.resultIds,
  };
}

function canCancel(
  instance: AgentInstanceRecord,
  profile: AgentFidelityProfile | undefined,
): boolean {
  if (instance.executionMode === 'grimoire-managed') return true;
  return profile?.cancellation !== undefined && profile.cancellation !== 'unsupported';
}

function observationConfidence(
  observation: AgentObservationFidelity,
): AgentWorkCardProjection['observationConfidence'] {
  if (observation === 'full') return 'exact';
  if (observation === 'aggregate') return 'aggregate';
  if (observation === 'terminal-only') return 'terminal-only';
  if (observation === 'opaque') return 'opaque';
  return 'unavailable';
}

function conservativeObservation(
  observed: AgentObservationFidelity,
  supported: AgentObservationFidelity,
): AgentObservationFidelity {
  const order: readonly AgentObservationFidelity[] = [
    'none',
    'opaque',
    'terminal-only',
    'aggregate',
    'full',
  ];
  return order[Math.min(order.indexOf(observed), order.indexOf(supported))] ?? 'none';
}

function sortInstances(instances: readonly AgentInstanceRecord[]): AgentInstanceRecord[] {
  return [...instances].sort((left, right) => (
    left.createdAt - right.createdAt
    || left.agentInstanceId.localeCompare(right.agentInstanceId)
  ));
}

function replaceVersioned<
  TKey extends 'instances' | 'runs' | 'workGraphRevisions' | 'workExecutions',
  TRecord extends AgentInstanceRecord | AgentRunRecord | WorkGraphRevision | WorkGraphExecution,
>(
  projection: AgentProjection,
  key: TKey,
  record: VersionedRecord<TRecord>,
  identity: (payload: TRecord) => string,
): AgentProjection {
  const entries = projection[key] as readonly VersionedProjectionRecord<TRecord>[];
  const recordId = identity(record.payload);
  const existing = entries.find(entry => identity(entry.record) === recordId);
  if (existing && existing.revision >= record.revision) return projection;
  const next = { revision: record.revision, record: record.payload };
  return {
    ...projection,
    [key]: existing
      ? entries.map(entry => identity(entry.record) === recordId ? next : entry)
      : [...entries, next],
  };
}
