import {
  agentInstanceId,
  agentResultId,
  agentRunId,
} from '@/core/agents/AgentIds';
import type { AgentWorkCardProjection } from '@/features/chat/projections/AgentProjection';
import {
  AgentWorkCardRenderer,
  toAgentWorkCardRenderModel,
} from '@/features/chat/rendering/AgentWorkCard';

describe('AgentWorkCardRenderer', () => {
  it('keeps original and reconciled results, provenance, artifacts, and missing references distinct', () => {
    const model = toAgentWorkCardRenderModel(card());

    expect(model.attempts[0]).toMatchObject({
      results: [{
        finalText: 'primary',
        reconciled: false,
        provenance: { kind: 'provider-native' },
        artifacts: [{ artifactId: 'artifact-1', kind: 'diff' }],
      }],
      reconciledResults: [{
        finalText: 'observed later',
        reconciled: true,
        provenance: { kind: 'reconciled' },
      }],
      missingResultIds: [`ares-${'4'.repeat(32)}`],
      missingReconciledResultIds: [`ares-${'5'.repeat(32)}`],
    });
  });

  it('only replaces a render target and exposes durable actions as data', () => {
    const replace = jest.fn();
    const renderer = new AgentWorkCardRenderer({ replace });

    renderer.render({
      agentCards: [card()],
      workNodes: [{
        workGraphId: 'graph-1',
        workGraphExecutionId: 'execution-1',
        workNodeId: 'node-1',
        kind: 'agent',
        goalRef: 'review',
        dependencyNodeIds: ['dependency-1'],
        blockedByNodeIds: ['dependency-1'],
        assignment: { kind: 'managed-provider', providerId: 'provider-1' },
        synthesisInputResultIds: [],
        state: 'blocked',
        attempt: 0,
        resultIds: [
          agentResultId(`ares-${'6'.repeat(32)}`),
          agentResultId(`ares-${'7'.repeat(32)}`),
        ],
        results: [
          workResult(`ares-${'6'.repeat(32)}`, 'provider-native'),
          workResult(`ares-${'7'.repeat(32)}`, 'reconciled'),
        ],
        missingResultIds: [],
        terminalCode: 'dependency-failed',
        updatedAt: 3,
      }],
    });

    expect(replace).toHaveBeenCalledWith({
      agentCards: [expect.objectContaining({ actions: ['focus', 'retry'] })],
      workNodes: [expect.objectContaining({
        workNodeId: 'node-1',
        state: 'blocked',
        blockedByNodeIds: ['dependency-1'],
        results: [
          expect.objectContaining({ finalText: 'provider-native', reconciled: false }),
          expect.objectContaining({ finalText: 'reconciled', reconciled: true }),
        ],
      })],
    });
  });
});

function card(): AgentWorkCardProjection {
  return {
    agentInstanceId: agentInstanceId(`agi-${'1'.repeat(32)}`),
    providerId: 'provider-1',
    definitionId: 'reviewer',
    executionMode: 'provider-native',
    origin: 'grimoire-dispatched',
    attachment: 'attached',
    observation: 'full',
    observationConfidence: 'exact',
    status: 'terminal',
    attempts: [{
      agentRunId: agentRunId(`agr-${'2'.repeat(32)}`),
      attempt: 1,
      state: 'indeterminate',
      goalRef: 'review',
      terminal: { kind: 'indeterminate', reason: 'effects-unknown', occurredAt: 10 },
      results: [{
        agentResultId: agentResultId(`ares-${'2'.repeat(32)}`),
        status: 'succeeded',
        finalText: 'primary',
        artifacts: [{ artifactId: 'artifact-1', kind: 'diff' }],
        changedFiles: [{ fileRef: 'file-1', change: 'modified' }],
        citations: [{ citationId: 'citation-1', sourceRef: 'source-1' }],
        childResultIds: [],
        provenance: { kind: 'provider-native', providerId: 'provider-1', observedAt: 10 },
        completedAt: 10,
      }],
      observedResults: [{
        agentResultId: agentResultId(`ares-${'3'.repeat(32)}`),
        status: 'succeeded',
        finalText: 'observed later',
        artifacts: [],
        changedFiles: [],
        citations: [],
        childResultIds: [],
        provenance: { kind: 'reconciled', providerId: 'provider-1', observedAt: 20 },
        completedAt: 20,
      }],
      missingResultIds: [agentResultId(`ares-${'4'.repeat(32)}`)],
      missingObservedResultIds: [agentResultId(`ares-${'5'.repeat(32)}`)],
      interactions: [],
      createdAt: 1,
      updatedAt: 20,
    }],
    children: [],
    expanded: false,
    actions: ['focus', 'retry'],
  };
}

function workResult(
  id: string,
  provenance: 'provider-native' | 'reconciled',
): AgentWorkCardProjection['attempts'][number]['results'][number] {
  return {
    agentResultId: agentResultId(id),
    status: 'succeeded',
    finalText: provenance,
    artifacts: [],
    changedFiles: [],
    citations: [],
    childResultIds: [],
    provenance: { kind: provenance, providerId: 'provider-1', observedAt: 10 },
    completedAt: 10,
  };
}
