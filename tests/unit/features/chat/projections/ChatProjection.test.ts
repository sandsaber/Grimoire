import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { ExecutionEvent } from '@/core/execution/ExecutionEvents';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import {
  type ChatProjection,
  createChatProjection,
  hasMissingRequiredResult,
  liveAssistantText,
  reduceChatProjection,
} from '@/features/chat/projections/ChatProjection';

const RUN_ID = runId(`run-${'1'.repeat(32)}`);
const SESSION_ID = executionSessionId(`es-${'2'.repeat(32)}`);

describe('ChatProjection', () => {
  it('keeps visible result, thinking, tools, progress, and terminal truth separate', () => {
    let projection = createChatProjection(conversation(), 1);
    projection = reduceChatProjection(projection, {
      kind: 'turn-started',
      commandId: 'command-1',
      executionSessionId: SESSION_ID,
      runId: RUN_ID,
      resultExpectation: 'required',
      startedAt: 10,
    });
    projection = reduceChatProjection(projection, {
      kind: 'run-envelope',
      envelope: envelope(1, { kind: 'thinking-activity' }),
    });
    projection = reduceChatProjection(projection, {
      kind: 'run-envelope',
      envelope: envelope(2, { kind: 'tool-activity', toolCallId: 'tool-1' }),
    });
    projection = reduceChatProjection(projection, {
      kind: 'run-envelope',
      envelope: envelope(3, { kind: 'progress', progressId: 'progress-1' }),
    });
    projection = reduceChatProjection(projection, {
      kind: 'run-envelope',
      envelope: envelope(4, {
        kind: 'terminal',
        terminal: 'succeeded',
        reason: 'completed',
      }),
    });

    const turn = projection.turns[0];
    expect(turn?.run).toMatchObject({
      state: 'failed',
      sawThinking: true,
      toolCallIds: ['tool-1'],
      progressIds: ['progress-1'],
      terminal: { kind: 'failed', reason: 'missing-required-result' },
    });
    expect(turn && hasMissingRequiredResult(turn)).toBe(true);
    expect(turn?.result).toBeUndefined();
  });

  it('renders reconciliation as later evidence without rewriting the original terminal', () => {
    let projection = createChatProjection(conversation(), 1);
    projection = reduceChatProjection(projection, {
      kind: 'turn-started',
      commandId: 'command-1',
      executionSessionId: SESSION_ID,
      runId: RUN_ID,
      resultExpectation: 'optional',
      startedAt: 10,
    });
    // Through the run's own events rather than a durable record: this branch's
    // projection has no reducer for one, because nothing feeds recovered
    // records to a chat surface until the coordinator does.
    projection = reduceChatProjection(projection, {
      kind: 'run-envelope',
      envelope: envelope(1, {
        kind: 'terminal',
        terminal: 'indeterminate',
        reason: 'effects-unknown',
      }),
    });
    const originalTerminal = projection.turns[0]?.run.terminal;

    projection = reduceChatProjection(projection, {
      kind: 'reconciliation-record',
      record: {
        reconciliationId: `rec-${'3'.repeat(32)}`,
        runId: RUN_ID,
        originalTerminal: 'indeterminate',
        observedOutcome: 'succeeded',
        observedResult: { resultId: 'observed-1', storage: 'provider-native' },
        evidence: { kind: 'native-history', evidenceRef: 'history-1' },
        recordedAt: 30,
      },
    });

    expect(projection.turns[0]?.run.terminal).toBe(originalTerminal);
    expect(projection.turns[0]?.run.reconciledOutcomes).toEqual([
      expect.objectContaining({
        observedOutcome: 'succeeded',
        observedResult: { resultId: 'observed-1', storage: 'provider-native' },
      }),
    ]);
  });

  it('answers an event it does not know with the projection it was given', () => {
    // The compiler catches a kind added to the union without a case. This
    // catches the other half: an event that reaches the reducer from outside
    // TypeScript must not fall out of the switch and erase the conversation.
    const projection = createChatProjection(conversation(), 1);

    expect(reduceChatProjection(projection, { kind: 'not-a-kind' } as never)).toBe(projection);
  });

  it('keeps attachments read-only by reducing queued input only through commands', () => {
    const initial = createChatProjection(conversation(), 1);
    const queued = reduceChatProjection(initial, {
      kind: 'command-queued',
      commandId: 'command-1',
    });
    const duplicate = reduceChatProjection(queued, {
      kind: 'command-queued',
      commandId: 'command-1',
    });

    expect(queued.queuedCommandIds).toEqual(['command-1']);
    expect(duplicate).toBe(queued);
    expect(initial.queuedCommandIds).toEqual([]);
  });

  it('is referentially idempotent for an equal conversation and interaction record', () => {
    let projection = createChatProjection(conversation(), 1);
    expect(reduceChatProjection(projection, {
      kind: 'conversation-loaded',
      conversation: conversation(),
      revision: 1,
    })).toBe(projection);
    projection = reduceChatProjection(projection, {
      kind: 'turn-started',
      commandId: 'command-1',
      executionSessionId: SESSION_ID,
      runId: RUN_ID,
      resultExpectation: 'optional',
      startedAt: 10,
    });
    const interactionRecord = {
      interactionId: 'interaction-1',
      runId: RUN_ID,
      kind: 'approval' as const,
      presentationRef: 'approval-1',
      responseIds: ['allow', 'deny'],
      status: 'open' as const,
      createdAt: 10,
      updatedAt: 20,
    };
    projection = reduceChatProjection(projection, {
      kind: 'interaction-record',
      record: interactionRecord,
    });
    expect(reduceChatProjection(projection, {
      kind: 'interaction-record',
      record: { ...interactionRecord, responseIds: ['allow', 'deny'] },
    })).toBe(projection);
  });

  describe('live content', () => {
    /**
     * The half a run projection deliberately refuses, at the altitude where it
     * is the point. Without it the only way to render a turn while it runs is a
     * second channel of chunks beside the projection, which is the thing this
     * step replaces.
     */
    it('coalesces text and keeps it ordered against what the provider sent between', () => {
      let projection = startedTurn();
      projection = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: envelope(1, { kind: 'output-delta', channel: 'assistant', text: 'Botanic' }),
      });
      projection = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: envelope(1, { kind: 'output-delta', channel: 'assistant', text: 'ally, ' }),
      });
      projection = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: envelope(1, { kind: 'provider-content', payload: { tool: 'read_file' } }),
      });
      projection = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: envelope(1, { kind: 'output-delta', channel: 'assistant', text: 'yes.' }),
      });

      // One item per stretch of the same kind, not one per delta: a turn's worth
      // of token traffic must not become a turn's worth of array entries.
      expect(projection.turns[0]?.live).toEqual([
        { kind: 'assistant-text', text: 'Botanically, ' },
        { kind: 'provider-content', payload: { tool: 'read_file' } },
        { kind: 'assistant-text', text: 'yes.' },
      ]);
      expect(liveAssistantText(projection.turns[0])).toBe('Botanically, yes.');
    });

    it('keeps reasoning out of the answer', () => {
      let projection = startedTurn();
      projection = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: envelope(1, { kind: 'output-delta', channel: 'reasoning', text: 'Think.' }),
      });
      projection = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: envelope(1, { kind: 'output-delta', channel: 'assistant', text: 'Say.' }),
      });

      expect(projection.turns[0]?.live).toEqual([
        { kind: 'reasoning-text', text: 'Think.' },
        { kind: 'assistant-text', text: 'Say.' },
      ]);
      // The answer is what gets persisted as the message, so folding reasoning
      // into it would put the model's notes in the transcript.
      expect(liveAssistantText(projection.turns[0])).toBe('Say.');
    });

    it('says nothing and says the empty string differently', () => {
      const silent = startedTurn();
      expect(liveAssistantText(silent.turns[0])).toBeUndefined();

      const empty = reduceChatProjection(silent, {
        kind: 'run-envelope',
        envelope: envelope(1, { kind: 'output-delta', channel: 'assistant', text: '' }),
      });
      // A turn that said nothing gets no assistant message; a turn that sent an
      // empty delta is a provider worth seeing rather than one to round away.
      expect(liveAssistantText(empty.turns[0])).toBe('');
    });

    it('takes no content after the run is terminal', () => {
      let projection = startedTurn();
      projection = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: envelope(1, { kind: 'output-delta', channel: 'assistant', text: 'Done.' }),
      });
      projection = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: envelope(2, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' }),
      });
      const settled = projection;

      // The answer has been persisted by the time this could arrive, so taking
      // it would leave the projection and the message disagreeing about what
      // the turn said.
      expect(reduceChatProjection(settled, {
        kind: 'run-envelope',
        envelope: envelope(3, { kind: 'output-delta', channel: 'assistant', text: ' Late.' }),
      })).toBe(settled);
    });

    it('takes no content that is not this turn talking', () => {
      const projection = startedTurn();
      const agentScoped = reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: {
          ...envelope(1, { kind: 'output-delta', channel: 'assistant', text: 'Subagent.' }),
          scope: {
            kind: 'agent' as const,
            runId: RUN_ID,
            agentInstanceId: 'agent-1',
            agentRunId: 'agent-run-1',
          },
        },
      });

      // A subagent is a surface of its own. Its words in the parent turn's
      // answer would be persisted as the parent's answer.
      expect(agentScoped).toBe(projection);
      expect(reduceChatProjection(projection, {
        kind: 'run-envelope',
        envelope: {
          ...envelope(1, { kind: 'output-delta', channel: 'assistant', text: 'Session.' }),
          scope: { kind: 'session' as const },
        },
      })).toBe(projection);
    });
  });
});

function startedTurn(): ChatProjection {
  return reduceChatProjection(createChatProjection(conversation(), 1), {
    kind: 'turn-started',
    commandId: 'command-1',
    executionSessionId: SESSION_ID,
    runId: RUN_ID,
    resultExpectation: 'optional',
    startedAt: 10,
  });
}

function conversation() {
  return {
    id: 'conversation-1',
    providerId: 'provider-1',
    title: 'Projection test',
    createdAt: 1,
    updatedAt: 1,
    sessionId: null,
    messages: [],
  };
}

function envelope(sequence: number, event: ExecutionEvent) {
  return {
    schemaVersion: 1 as const,
    backendId: executionBackendId('projection-test'),
    backendGeneration: 1,
    executionSessionId: SESSION_ID,
    sessionInstanceId: sessionInstanceId(`si-${'4'.repeat(32)}`),
    eventId: `event-${sequence}`,
    sequence,
    occurredAt: sequence,
    scope: { kind: 'run' as const, runId: RUN_ID },
    event,
  };
}
