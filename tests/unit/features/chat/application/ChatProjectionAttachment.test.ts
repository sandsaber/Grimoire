import { createMockEl } from '@test/helpers/mockElement';
import {
  CONVERSATION_ID,
  createHarness,
  turnCommand,
  waitUntil,
} from '@test/unit/features/chat/chatExecutionHarness';

import type { RunTerminal } from '@/core/execution/ExecutionContracts';
import { interactionId,type RunId } from '@/core/execution/ExecutionIds';
import type { ChatContentItem, ChatMessage } from '@/core/types';
import {
  ChatProjectionAttachment,
  type ChatProjectionSource,
} from '@/features/chat/application/ChatProjectionAttachment';
import type { ChatProjection } from '@/features/chat/projections/ChatProjection';
import { ChatProjectionRenderer } from '@/features/chat/rendering/ChatProjectionRenderer';
import {
  type ChatMessageOperations,
  type ChatStreamingCursor,
  type ChatStreamOperations,
  ChatSurfaceRenderTarget,
} from '@/features/chat/rendering/ChatSurfaceRenderTarget';

/**
 * The whole chat path, dark, composed the way the flip will compose it.
 *
 * A provider talking, the kernel ingesting, the coordinator reducing, the
 * renderer diffing, the target calling the column's own operations. Wave 1's
 * rule is that a seam both sides stub is not covered, and this is the last seam
 * of M5's chat step: everything below the target is real here, and the two
 * fakes are the provider and the DOM — which is what a fake is for.
 *
 * It runs before the flip, which is the order that wave promised and the order
 * that found every fatal defect it had.
 */

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

function surface() {
  const calls: RecordedCall[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve();
  };
  const messageEl = createMockEl();
  messageEl.querySelector = jest.fn().mockReturnValue(createMockEl());
  const state: ChatStreamingCursor = {
    messages: [],
    currentContentEl: null,
    currentTextEl: null,
    currentTextContent: '',
    currentThinkingState: null,
    addMessage(message) {
      this.messages.push(message);
    },
  };
  const stream = {
    handleStreamChunk: (chunk: { type: string }) => {
      calls.push({ method: `chunk:${chunk.type}`, args: [chunk] });
      return Promise.resolve();
    },
    appendText: record('appendText'),
    appendThinking: record('appendThinking'),
    finalizeCurrentTextBlock: record('finalizeCurrentTextBlock'),
    finalizeCurrentThinkingBlock: record('finalizeCurrentThinkingBlock'),
    flushPendingToolsForPermission: () => undefined,
    showThinkingIndicator: () => calls.push({ method: 'showThinkingIndicator', args: [] }),
    hideThinkingIndicator: () => calls.push({ method: 'hideThinkingIndicator', args: [] }),
    startTurnSilenceIndicator: () => undefined,
    pauseTurnSilenceIndicator: (paused: boolean) => {
      calls.push({ method: 'pauseTurnSilenceIndicator', args: [paused] });
    },
    stopTurnSilenceIndicator: () => calls.push({ method: 'stopTurnSilenceIndicator', args: [] }),
  } as unknown as ChatStreamOperations;
  const renderer = {
    addMessage: (message: ChatMessage) => {
      calls.push({ method: 'addMessage', args: [message.role] });
      return messageEl as unknown as HTMLElement;
    },
    renderMessages: (messages: ChatMessage[]) => {
      calls.push({ method: 'renderMessages', args: [messages.map(message => message.id)] });
      return messageEl as unknown as HTMLElement;
    },
  } as unknown as ChatMessageOperations;
  let presented: readonly ChatContentItem[] = [];
  const target = new ChatSurfaceRenderTarget({
    state,
    renderer,
    stream,
    presentProviderContent: () => presented,
    createAssistantMessage: (forRunId: RunId) => ({
      id: `assistant-${forRunId}`,
      role: 'assistant',
      content: '',
      timestamp: 1,
    }),
    describeTerminal: (value: RunTerminal) => `ended: ${value.reason}`,
    getGreeting: () => 'Hello',
    getProviderId: () => 'claude',
    updateQueueIndicator: () => undefined,
    setTitle: () => undefined,
  });
  return {
    calls,
    state,
    sink: new ChatProjectionRenderer(target),
    methods: () => calls.map(call => call.method),
    setPresented(items: readonly ChatContentItem[]) {
      presented = items;
    },
  };
}

function deferredAttach(): {
  readonly source: ChatProjectionSource;
  deliver(projection: ChatProjection): void;
  settle(): void;
  readonly released: number;
} {
  let listener: ((projection: ChatProjection) => void) | undefined;
  let settle: (() => void) | undefined;
  const state = { released: 0 };
  const source: ChatProjectionSource = {
    attach: (_conversationId, subscriber) => new Promise(resolve => {
      listener = subscriber;
      settle = () => resolve(() => {
        state.released += 1;
      });
    }),
  };
  return {
    source,
    deliver: projection => listener?.(projection),
    settle: () => settle?.(),
    get released() {
      return state.released;
    },
  };
}

describe('chat projection attachment', () => {
  it('draws a whole turn, from the provider to the column', async () => {
    const harness = await createHarness();
    const drawn = surface();
    drawn.setPresented([{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }]);
    const attachment = new ChatProjectionAttachment(drawn.sink);
    await attachment.open(CONVERSATION_ID, harness.coordinator);

    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    harness.backend.emit(started.runId, { kind: 'run-started' });
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanically, ',
    });
    harness.backend.emit(started.runId, { kind: 'provider-content', payload: { any: 'shape' } });
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
    await waitUntil(() => drawn.methods().includes('chunk:done'), 'the turn to be drawn as finished');
    attachment.detach();

    // The turn as the column receives it: one bubble, the user's question
    // rendered from the conversation, two text stretches with the provider's
    // own item between them in the place the model put it, and one ending.
    expect(drawn.methods()).toEqual([
      'renderMessages',
      'addMessage',
      'addMessage',
      'showThinkingIndicator',
      'finalizeCurrentThinkingBlock',
      'finalizeCurrentTextBlock',
      'appendText',
      'finalizeCurrentThinkingBlock',
      'finalizeCurrentTextBlock',
      'chunk:tool_use',
      'finalizeCurrentThinkingBlock',
      'finalizeCurrentTextBlock',
      'appendText',
      'chunk:done',
      'hideThinkingIndicator',
      'stopTurnSilenceIndicator',
    ]);
    // The answer the column drew and the answer the vault holds are the same
    // one, which is the property the whole path exists to keep.
    expect(drawn.state.messages.at(-1)?.content).toBe('Botanically, yes.');
    const stored = await harness.conversations.read(CONVERSATION_ID);
    expect(stored.kind === 'present' ? stored.metadata.messages?.at(-1)?.content : null)
      .toBe('Botanically, yes.');
  });

  it('draws one answer when the stored message has an id of its own', async () => {
    // The live bubble is minted by the target and the durable message is named
    // by the provider's own result id, so the two differ whenever the run
    // commits a result. The column must still show one answer: the renderer
    // skips the message the turn already drew, by the turn's own record of what
    // it drew rather than by comparing ids that were never required to match.
    const harness = await createHarness();
    const drawn = surface();
    const attachment = new ChatProjectionAttachment(drawn.sink);
    await attachment.open(CONVERSATION_ID, harness.coordinator);
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;

    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Yes.',
    });
    harness.backend.emit(started.runId, {
      kind: 'result',
      result: { resultId: `result-${started.runId}`, storage: 'projection' },
    });
    harness.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await ticket.completion;
    await waitUntil(() => drawn.methods().includes('chunk:done'), 'the turn to be drawn as finished');
    attachment.detach();

    // Two bubbles: the question and the answer. A third would be the stored
    // message drawn beside the answer it holds.
    expect(drawn.calls.filter(call => call.method === 'addMessage').map(call => call.args[0]))
      .toEqual(['user', 'assistant']);
    const stored = await harness.conversations.read(CONVERSATION_ID);
    const storedId = stored.kind === 'present' ? stored.metadata.messages?.at(-1)?.id : null;
    // Recorded rather than asserted equal: the ids differ by construction, and
    // what a rewind addresses before a reload is not what it addresses after.
    expect(storedId).toBe(`result-${started.runId}`);
    expect(drawn.state.messages.at(-1)?.id).toBe(`assistant-${started.runId}`);
  });

  it('draws a turn the kernel was already running when the tab opened', async () => {
    // The reload, end to end. The run outlives the column that was watching it,
    // and a tab opened onto the conversation afterwards has to show a turn in
    // progress and then finish drawing it — including the barrier, which no
    // ticket is waiting on because nobody in this process asked for the turn.
    const harness = await createHarness();
    const abandoned = await harness.coordinator.submitTurn(turnCommand());
    const started = await abandoned.started;
    harness.backend.emit(started.runId, { kind: 'run-started' });
    await harness.registry.waitForIdle();
    harness.coordinator.dispose();
    await expect(abandoned.completion).rejects.toThrow(/detached/);

    const reopened = harness.createCoordinator();
    const drawn = surface();
    const attachment = new ChatProjectionAttachment(drawn.sink);
    await attachment.open(CONVERSATION_ID, reopened);

    // The question is in the transcript, the turn has a bubble of its own, and
    // it is drawn as running rather than as finished.
    expect(drawn.methods()).toEqual([
      'renderMessages',
      'addMessage',
      'showThinkingIndicator',
    ]);

    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Picked up.',
    });
    harness.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await waitUntil(() => drawn.methods().includes('chunk:done'), 'the adopted turn to finish');
    attachment.detach();

    const stored = await harness.conversations.read(CONVERSATION_ID);
    expect(stored.kind === 'present' ? stored.metadata.messages?.at(-1)?.content : null)
      .toBe('Picked up.');
    reopened.dispose();
  });

  it('stops the silence timer while a question is on screen', async () => {
    const harness = await createHarness();
    const drawn = surface();
    const attachment = new ChatProjectionAttachment(drawn.sink);
    await attachment.open(CONVERSATION_ID, harness.coordinator);
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;

    harness.backend.emit(started.runId, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: interactionId(`ix-${'a'.repeat(32)}`),
        runId: started.runId,
        kind: 'approval',
        presentationRef: 'approval-write',
        responseIds: ['allow', 'deny'],
      },
    });
    await waitUntil(
      () => drawn.methods().includes('pauseTurnSilenceIndicator'),
      'the silence timer to be paused',
    );

    expect(drawn.calls.filter(call => call.method === 'pauseTurnSilenceIndicator'))
      .toEqual([{ method: 'pauseTurnSilenceIndicator', args: [true] }]);
    attachment.detach();
    harness.coordinator.dispose();
  });

  it('draws nothing after the tab it belongs to is gone', async () => {
    const harness = await createHarness();
    const drawn = surface();
    const attachment = new ChatProjectionAttachment(drawn.sink);
    await attachment.open(CONVERSATION_ID, harness.coordinator);
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    attachment.detach();
    const afterDetach = drawn.calls.length;

    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Nobody is reading this.',
    });
    harness.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await ticket.completion;

    expect(drawn.calls).toHaveLength(afterDetach);
    harness.coordinator.dispose();
  });

  it('releases a subscription that arrives for a tab already closed', async () => {
    // A conversation is read from the store, so attaching awaits. A tab closed
    // in that window would otherwise be subscribed a moment later and render
    // into a column that is gone — which is why the attachment is constructed
    // before it is opened, and why this test can call `detach` mid-load at all.
    const pending = deferredAttach();
    const drawn = surface();
    const attachment = new ChatProjectionAttachment(drawn.sink);
    const opening = attachment.open(CONVERSATION_ID, pending.source);

    attachment.detach();
    pending.settle();
    await opening;
    pending.deliver({ conversationId: CONVERSATION_ID } as ChatProjection);

    expect(pending.released).toBe(1);
    expect(drawn.calls).toEqual([]);
  });

  it('drops the conversation it was showing when it is opened on another', async () => {
    const first = deferredAttach();
    const second = deferredAttach();
    const drawn = surface();
    const attachment = new ChatProjectionAttachment(drawn.sink);
    await (async () => {
      const opening = attachment.open(CONVERSATION_ID, first.source);
      first.settle();
      await opening;
    })();

    const switching = attachment.open('conv-2', second.source);
    second.settle();
    await switching;
    // The old conversation's projection, delivered after the switch. Drawing it
    // would show one conversation's turn inside another's column.
    first.deliver({ conversationId: CONVERSATION_ID } as ChatProjection);

    expect(first.released).toBe(1);
    expect(drawn.calls).toEqual([]);
    attachment.detach();
  });
});
