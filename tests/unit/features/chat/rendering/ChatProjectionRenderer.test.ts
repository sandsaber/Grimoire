import {
  CONVERSATION_ID,
  createHarness,
  turnCommand,
  waitUntil,
} from '@test/unit/features/chat/chatExecutionHarness';

import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { ExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type { ChatMessage } from '@/core/types';
import {
  type ChatProjection,
  createChatProjection,
  reduceChatProjection,
} from '@/features/chat/projections/ChatProjection';
import {
  ChatProjectionRenderer,
  type ChatRenderTarget,
} from '@/features/chat/rendering/ChatProjectionRenderer';

/**
 * The diff between two projections, as the calls a surface makes.
 *
 * Driven by projections built through the real reducer rather than by hand:
 * every assumption that makes this diff cheap is an assumption about what the
 * reducer produces — that an untouched turn is the same object, that a message
 * list survives a stream by reference — and a hand-built projection would
 * confirm them by construction.
 */

const RUN_ID = runId(`run-${'1'.repeat(32)}`);
const SESSION_ID = executionSessionId(`es-${'3'.repeat(32)}`);

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

function recordingTarget(): ChatRenderTarget & { readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };
  return {
    calls,
    reset: record('reset'),
    setTitle: record('setTitle'),
    appendMessage: record('appendMessage'),
    beginTurn: record('beginTurn'),
    openTurnBlock: record('openTurnBlock'),
    extendTurnText: record('extendTurnText'),
    setTurnState: record('setTurnState'),
    endTurn: record('endTurn'),
    setTurnPersistence: record('setTurnPersistence'),
    reconcileTurn: record('reconcileTurn'),
    showInteraction: record('showInteraction'),
    hideInteraction: record('hideInteraction'),
    setQueuedCommandCount: record('setQueuedCommandCount'),
  };
}

function methods(target: { readonly calls: readonly RecordedCall[] }): string[] {
  return target.calls.map(call => call.method);
}

describe('chat projection renderer', () => {
  it('draws the conversation it is first given', () => {
    const target = recordingTarget();
    const projection = createChatProjection(conversation([message('msg-1', 'user', 'Hi')]), 1);

    new ChatProjectionRenderer(target).render(projection);

    expect(target.calls).toEqual([
      {
        method: 'reset',
        args: [{
          conversationId: CONVERSATION_ID,
          title: 'Tomatoes',
          messages: [expect.objectContaining({ id: 'msg-1' })],
        }],
      },
      { method: 'setQueuedCommandCount', args: [0] },
    ]);
  });

  it('opens a block, extends it, and opens the next one as the turn talks', () => {
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    let projection = started(createChatProjection(conversation([]), 1));
    renderer.render(projection);
    target.calls.splice(0);

    projection = envelope(projection, 1, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanic',
    });
    renderer.render(projection);
    projection = envelope(projection, 1, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'ally, ',
    });
    renderer.render(projection);
    projection = envelope(projection, 1, { kind: 'provider-content', payload: { tool: 'read' } });
    renderer.render(projection);

    expect(target.calls).toEqual([
      {
        method: 'openTurnBlock',
        args: [RUN_ID, 0, { kind: 'assistant-text', text: 'Botanic' }],
      },
      // The tail only. Handing the whole block back on every token is what
      // makes a chat column redraw itself a hundred times an answer.
      { method: 'extendTurnText', args: [RUN_ID, 0, 'ally, '] },
      {
        method: 'openTurnBlock',
        args: [RUN_ID, 1, { kind: 'provider-content', payload: { tool: 'read' } }],
      },
    ]);
  });

  it('says nothing at all when the projection did not change', () => {
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    const projection = started(createChatProjection(conversation([]), 1));
    renderer.render(projection);
    target.calls.splice(0);

    renderer.render(projection);

    expect(target.calls).toEqual([]);
  });

  it('reports a state change once, and the terminal once', () => {
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    let projection = started(createChatProjection(conversation([]), 1));
    renderer.render(projection);
    projection = envelope(projection, 1, { kind: 'run-started' });
    renderer.render(projection);
    projection = envelope(projection, 2, { kind: 'thinking-activity' });
    renderer.render(projection);
    target.calls.splice(0);

    projection = envelope(projection, 3, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    renderer.render(projection);
    renderer.render(projection);

    expect(target.calls).toEqual([
      { method: 'setTurnState', args: [RUN_ID, 'succeeded'] },
      {
        method: 'endTurn',
        args: [RUN_ID, expect.objectContaining({ kind: 'succeeded', reason: 'completed' })],
      },
    ]);
  });

  it('reports a reconciled outcome after the terminal, not instead of it', () => {
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    let projection = started(createChatProjection(conversation([]), 1));
    projection = envelope(projection, 1, {
      kind: 'terminal',
      terminal: 'indeterminate',
      reason: 'cancellation-unknown',
    });
    renderer.render(projection);
    target.calls.splice(0);

    projection = reduceChatProjection(projection, {
      kind: 'reconciliation-record',
      record: {
        reconciliationId: `rec-${'5'.repeat(32)}`,
        runId: RUN_ID,
        originalTerminal: 'indeterminate',
        observedOutcome: 'succeeded',
        evidence: { kind: 'native-history', evidenceRef: 'thread-1' },
        recordedAt: 20,
      },
    });
    renderer.render(projection);
    renderer.render(projection);

    expect(target.calls).toEqual([{
      method: 'reconcileTurn',
      args: [RUN_ID, expect.objectContaining({ observedOutcome: 'succeeded' })],
    }]);
  });

  it('redraws when the transcript is rewritten rather than extended', () => {
    // A rewind, a fork and a provider history hydration all replace messages
    // that are already on screen, and no increment expresses that.
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    const projection = createChatProjection(
      conversation([message('msg-1', 'user', 'Hi'), message('msg-2', 'assistant', 'Hello')]),
      1,
    );
    renderer.render(projection);
    target.calls.splice(0);

    renderer.render(reduceChatProjection(projection, {
      kind: 'conversation-loaded',
      conversation: conversation([message('msg-1', 'user', 'Hi')]),
      revision: 2,
    }));

    expect(methods(target)).toEqual(['reset', 'setQueuedCommandCount']);
  });

  it('appends a message that arrives, and never the answer it already drew', () => {
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    let projection = started(createChatProjection(conversation([message('msg-1', 'user', 'Hi')]), 1));
    projection = envelope(projection, 1, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Hello.',
    });
    projection = envelope(projection, 2, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    renderer.render(projection);
    target.calls.splice(0);

    renderer.render(reduceChatProjection(projection, {
      kind: 'turn-completed',
      runId: RUN_ID,
      conversation: conversation([
        message('msg-1', 'user', 'Hi'),
        // The id the turn was given when it started, which is what the barrier
        // stores the answer under.
        message('assistant-1', 'assistant', 'Hello.'),
        message('msg-3', 'user', 'And again?'),
      ]),
      revision: 2,
      completedAt: 20,
    }));

    // The turn's own answer is on screen block by block already; the message
    // the barrier wrote holds the same words. The next question is not.
    expect(target.calls).toEqual([
      { method: 'appendMessage', args: [expect.objectContaining({ id: 'msg-3' })] },
      { method: 'setTurnPersistence', args: [RUN_ID, 'saved', undefined] },
    ]);
  });

  it('shows an interaction while it is open and takes it away when it is answered', () => {
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    const openInteractionId = `ix-${'a'.repeat(32)}`;
    const record = {
      interactionId: openInteractionId,
      runId: RUN_ID,
      kind: 'approval' as const,
      presentationRef: 'approval-write',
      responseIds: ['allow', 'deny'],
      status: 'open' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    let projection = started(createChatProjection(conversation([]), 1));
    renderer.render(projection);
    target.calls.splice(0);

    projection = reduceChatProjection(projection, { kind: 'interaction-record', record });
    renderer.render(projection);
    projection = reduceChatProjection(projection, {
      kind: 'interaction-record',
      record: { ...record, status: 'resolved', selectedResponseId: 'allow', updatedAt: 2 },
    });
    renderer.render(projection);

    expect(methods(target)).toEqual(['showInteraction', 'hideInteraction']);
    expect(target.calls[1]?.args).toEqual([openInteractionId]);
  });

  it('redraws when a turn it is holding did not grow into the one it is given', () => {
    // Two projections of the same conversation from different lineages, which
    // is what a surface attached to a coordinator that was replaced underneath
    // it would see. The block at index 0 is not an extension of the one on
    // screen, and pretending otherwise would splice one answer into another.
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    let onScreen = started(createChatProjection(conversation([]), 1));
    onScreen = envelope(onScreen, 1, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanically, ',
    });
    renderer.render(onScreen);
    target.calls.splice(0);

    let elsewhere = started(createChatProjection(conversation([]), 1));
    elsewhere = envelope(elsewhere, 1, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Cucumbers are ',
    });
    renderer.render(elsewhere);

    expect(methods(target)).toEqual([
      'reset',
      'beginTurn',
      'openTurnBlock',
      'setTurnState',
      'setQueuedCommandCount',
    ]);
  });

  it('draws a second conversation from nothing rather than diffing against the first', () => {
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    renderer.render(started(createChatProjection(conversation([]), 1)));
    target.calls.splice(0);

    renderer.render(createChatProjection({ ...conversation([]), id: 'conv-2' }, 1));

    expect(methods(target)).toEqual(['reset', 'setQueuedCommandCount']);
  });

  it('draws what the coordinator publishes, through the kernel', async () => {
    // The seam end to end: a provider talking, the kernel ingesting, the
    // coordinator reducing, the renderer diffing. Every assumption this diff
    // makes about projection identity is an assumption about that path.
    const harness = await createHarness();
    const target = recordingTarget();
    const renderer = new ChatProjectionRenderer(target);
    const detach = await harness.coordinator.attach(CONVERSATION_ID, projection => {
      renderer.render(projection);
    });
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    target.calls.splice(0);

    harness.backend.emit(started.runId, { kind: 'run-started' });
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanically, ',
    });
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'yes.',
    });
    harness.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await ticket.completion;
    await waitUntil(() => methods(target).includes('endTurn'), 'the turn to be drawn as finished');
    detach();

    // Two openings and one extension for one answer in two deltas: no redraw of
    // the conversation, and no second copy of the answer when the message that
    // holds it is written.
    expect(methods(target).filter(method => method !== 'setTurnState')).toEqual([
      'openTurnBlock',
      'extendTurnText',
      'endTurn',
      'setTurnPersistence',
      'setTurnPersistence',
    ]);
    expect(target.calls.filter(call => call.method === 'appendMessage')).toEqual([]);
    expect(target.calls.filter(call => call.method === 'reset')).toEqual([]);
  });
});

function conversation(messages: readonly ChatMessage[]) {
  return {
    id: CONVERSATION_ID,
    providerId: 'provider-1',
    title: 'Tomatoes',
    createdAt: 1,
    updatedAt: 1,
    sessionId: null,
    messages: [...messages],
  };
}

function message(id: string, role: 'user' | 'assistant', content: string): ChatMessage {
  return { id, role, content, timestamp: 1 };
}

function started(projection: ChatProjection): ChatProjection {
  return reduceChatProjection(projection, {
    kind: 'turn-started',
    commandId: 'command-1',
    executionSessionId: SESSION_ID,
    runId: RUN_ID,
    resultExpectation: 'optional',
    assistantMessageId: 'assistant-1',
    startedAt: 10,
  });
}

function envelope(
  projection: ChatProjection,
  sequence: number,
  event: ExecutionEvent,
): ChatProjection {
  return reduceChatProjection(projection, {
    kind: 'run-envelope',
    envelope: {
      schemaVersion: 1,
      backendId: executionBackendId('renderer-test'),
      backendGeneration: 1,
      executionSessionId: SESSION_ID,
      sessionInstanceId: sessionInstanceId(`si-${'4'.repeat(32)}`),
      eventId: `event-${sequence}-${event.kind}`,
      sequence,
      occurredAt: sequence,
      scope: { kind: 'run', runId: RUN_ID },
      event,
    },
  });
}
