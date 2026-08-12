import { executionSessionId, runId } from '@/core/execution/ExecutionIds';
import { createRunProjection } from '@/core/execution/RunProjection';
import type { ChatProjection } from '@/features/chat/projections/ChatProjection';
import {
  ChatProjectionRenderer,
  toChatProjectionRenderModel,
} from '@/features/chat/rendering/ChatProjectionRenderer';

describe('ChatProjectionRenderer', () => {
  it('renders final text, partial text, thinking, tools, progress, and reconciliation separately', () => {
    const projection = fixtureProjection();
    const model = toChatProjectionRenderModel(projection);

    expect(model.turns[0]).toMatchObject({
      finalAssistantText: 'final',
      partialAssistantText: 'partial',
      thinkingObserved: true,
      toolCallIds: ['tool-1'],
      progressIds: ['progress-1'],
      resultId: 'result-1',
      terminal: { kind: 'indeterminate' },
      reconciledOutcomes: [{
        observedOutcome: 'succeeded',
        observedResultId: 'observed-result-1',
        finalAssistantText: 'later final',
      }],
      persistence: 'failed',
      persistenceErrorCode: 'conversation-write-failed',
    });
  });

  it('only replaces a render target and exposes no lifecycle command surface', () => {
    const replace = jest.fn();
    const renderer = new ChatProjectionRenderer({ replace });

    renderer.render(fixtureProjection());

    expect(replace).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      queuedCommandCount: 1,
    }));
  });
});

function fixtureProjection(): ChatProjection {
  const id = runId(`run-${'1'.repeat(32)}`);
  return {
    conversationId: 'conversation-1',
    providerId: 'provider-1',
    title: 'Projection',
    conversationRevision: 1,
    messages: [],
    turns: [{
      commandId: 'command-1',
      executionSessionId: executionSessionId(`es-${'2'.repeat(32)}`),
      runId: id,
      run: {
        ...createRunProjection(id, 'optional'),
        state: 'indeterminate',
        sawThinking: true,
        toolCallIds: ['tool-1'],
        progressIds: ['progress-1'],
        result: { resultId: 'result-1', storage: 'projection' },
        terminal: {
          kind: 'indeterminate',
          reason: 'effects-unknown',
          occurredAt: 10,
        },
        reconciledOutcomes: [{
          reconciliationId: 'reconciliation-1',
          observedOutcome: 'succeeded',
          observedResult: { resultId: 'observed-result-1', storage: 'provider-native' },
          evidence: { kind: 'status-query', evidenceRef: 'status-1' },
          recordedAt: 20,
        }],
      },
      result: {
        resultRef: { resultId: 'result-1', storage: 'projection' },
        finalAssistantText: 'final',
        partialAssistantText: 'partial',
      },
      observedResults: [{
        reconciliationId: 'reconciliation-1',
        result: {
          resultRef: { resultId: 'observed-result-1', storage: 'provider-native' },
          finalAssistantText: 'later final',
        },
      }],
      persistence: 'failed',
      persistenceErrorCode: 'conversation-write-failed',
      startedAt: 1,
      completedAt: 10,
    }],
    interactions: [],
    queuedCommandIds: ['command-2'],
  };
}
