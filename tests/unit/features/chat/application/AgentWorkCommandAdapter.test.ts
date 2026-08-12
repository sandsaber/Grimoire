import { agentInstanceId, agentRunId } from '@/core/agents/AgentIds';
import { AgentWorkCommandAdapter } from '@/features/chat/application/AgentWorkCommandAdapter';
import type { AgentWorkCardProjection } from '@/features/chat/projections/AgentProjection';

const INSTANCE_ID = agentInstanceId(`agi-${'1'.repeat(32)}`);
const OWNER = { kind: 'conversation' as const, ownerId: 'conversation-1' };

describe('AgentWorkCommandAdapter', () => {
  it('routes only actions exposed by the current durable projection', async () => {
    const cancel = jest.fn(async () => undefined);
    const retry = jest.fn(async () => undefined);
    const focus = jest.fn();
    const inspectResults = jest.fn();
    const resolveInteraction = jest.fn(async () => undefined);
    const setExpanded = jest.fn();
    const adapter = new AgentWorkCommandAdapter({
      load: async () => ({
        agentCards: [card(['cancel', 'expand-children'])],
        workNodes: [],
      }),
      setExpanded,
    }, { cancel, retry, focus, inspectResults, resolveInteraction });

    await adapter.execute({ owner: OWNER, agentInstanceId: INSTANCE_ID, action: 'cancel' });
    await adapter.execute({
      owner: OWNER,
      agentInstanceId: INSTANCE_ID,
      action: 'expand-children',
    });

    expect(cancel).toHaveBeenCalledWith(INSTANCE_ID);
    expect(setExpanded).toHaveBeenCalledWith(OWNER, INSTANCE_ID, true);
    expect(retry).not.toHaveBeenCalled();
  });

  it('fails closed when the action is stale or unavailable', async () => {
    const adapter = new AgentWorkCommandAdapter({
      load: async () => ({ agentCards: [card(['focus'])], workNodes: [] }),
      setExpanded: jest.fn(),
    }, {
      cancel: jest.fn(),
      retry: jest.fn(),
      focus: jest.fn(),
      inspectResults: jest.fn(),
      resolveInteraction: jest.fn(),
    });

    await expect(adapter.execute({
      owner: OWNER,
      agentInstanceId: INSTANCE_ID,
      action: 'retry',
    })).rejects.toThrow('unavailable');
  });

  it('resolves only an open interaction and a declared response', async () => {
    const resolveInteraction = jest.fn(async () => undefined);
    const withInteraction = card(['focus']);
    const adapter = new AgentWorkCommandAdapter({
      load: async () => ({
        agentCards: [{
          ...withInteraction,
          attempts: [{
            agentRunId: agentRunId(`agr-${'2'.repeat(32)}`),
            attempt: 1,
            state: 'waiting',
            goalRef: 'review',
            results: [],
            observedResults: [],
            missingResultIds: [],
            missingObservedResultIds: [],
            interactions: [{
              interactionId: `ix-${'3'.repeat(32)}`,
              kind: 'question',
              presentationRef: 'question-1',
              responseIds: ['answer-1'],
              status: 'open',
              updatedAt: 1,
            }],
            createdAt: 1,
            updatedAt: 1,
          }],
        }],
        workNodes: [],
      }),
      setExpanded: jest.fn(),
    }, {
      cancel: jest.fn(),
      retry: jest.fn(),
      focus: jest.fn(),
      inspectResults: jest.fn(),
      resolveInteraction,
    }, () => 10);

    await adapter.resolveInteraction({
      owner: OWNER,
      agentInstanceId: INSTANCE_ID,
      agentRunId: `agr-${'2'.repeat(32)}`,
      interactionId: `ix-${'3'.repeat(32)}`,
      responseId: 'answer-1',
    });

    expect(resolveInteraction).toHaveBeenCalledWith({
      interactionId: `ix-${'3'.repeat(32)}`,
      responseId: 'answer-1',
      resolvedAt: 10,
    });
    await expect(adapter.resolveInteraction({
      owner: OWNER,
      agentInstanceId: INSTANCE_ID,
      agentRunId: `agr-${'2'.repeat(32)}`,
      interactionId: `ix-${'3'.repeat(32)}`,
      responseId: 'not-declared',
    })).rejects.toThrow('unavailable');
  });
});

function card(actions: AgentWorkCardProjection['actions']): AgentWorkCardProjection {
  return {
    agentInstanceId: INSTANCE_ID,
    providerId: 'provider-1',
    definitionId: 'reviewer',
    executionMode: 'grimoire-managed',
    origin: 'grimoire-dispatched',
    attachment: 'attached',
    observation: 'full',
    observationConfidence: 'exact',
    status: 'active',
    attempts: [],
    children: [],
    expanded: false,
    actions,
  };
}
