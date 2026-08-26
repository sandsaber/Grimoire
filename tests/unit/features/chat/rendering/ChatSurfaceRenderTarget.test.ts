import { createMockEl } from '@test/helpers/mockElement';

import type { RunTerminal } from '@/core/execution/ExecutionContracts';
import { type RunId, runId } from '@/core/execution/ExecutionIds';
import type { ChatContentItem, ChatMessage } from '@/core/types';
import type { StreamController } from '@/features/chat/controllers/StreamController';
import {
  type ChatMessageOperations,
  type ChatStreamingCursor,
  type ChatStreamOperations,
  ChatSurfaceRenderTarget,
} from '@/features/chat/rendering/ChatSurfaceRenderTarget';
import type { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import type { ChatState } from '@/features/chat/state/ChatState';

/**
 * The renderer's port, over the machinery that already draws this column.
 *
 * Tested against recording doubles of that machinery rather than against a DOM,
 * because the target is a *translation*: which operation, with what, in what
 * order. What those operations then do to the column is `StreamController`'s
 * own behaviour and has three thousand lines of tests of its own; re-testing it
 * through here would be testing it twice and this not at all.
 */

const RUN_ID = runId(`run-${'1'.repeat(32)}`);

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

function harness() {
  const calls: RecordedCall[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve();
  };
  const messageEl = createMockEl();
  const contentEl = createMockEl();
  messageEl.querySelector = jest.fn().mockReturnValue(contentEl);
  const state: ChatStreamingCursor = {
    messages: [],
    currentContentEl: null,
    currentTextEl: null,
    currentTextContent: '',
    currentThinkingState: null,
    addMessage(message) {
      calls.push({ method: 'state.addMessage', args: [message] });
      this.messages.push(message);
    },
  };
  const stream = {
    handleStreamChunk: record('handleStreamChunk'),
    appendText: record('appendText'),
    appendThinking: record('appendThinking'),
    finalizeCurrentTextBlock: record('finalizeCurrentTextBlock'),
    finalizeCurrentThinkingBlock: record('finalizeCurrentThinkingBlock'),
    flushPendingToolsForPermission: () => {
      calls.push({ method: 'flushPendingToolsForPermission', args: [] });
    },
    showThinkingIndicator: () => {
      calls.push({ method: 'showThinkingIndicator', args: [] });
    },
    hideThinkingIndicator: () => {
      calls.push({ method: 'hideThinkingIndicator', args: [] });
    },
    startTurnSilenceIndicator: (providerId: string) => {
      calls.push({ method: 'startTurnSilenceIndicator', args: [providerId] });
    },
    pauseTurnSilenceIndicator: (paused: boolean) => {
      calls.push({ method: 'pauseTurnSilenceIndicator', args: [paused] });
    },
    stopTurnSilenceIndicator: () => {
      calls.push({ method: 'stopTurnSilenceIndicator', args: [] });
    },
  } as unknown as ChatStreamOperations;
  const renderer = {
    addMessage: (message: ChatMessage) => {
      calls.push({ method: 'renderer.addMessage', args: [message] });
      return messageEl as unknown as HTMLElement;
    },
    renderMessages: (messages: ChatMessage[]) => {
      calls.push({ method: 'renderer.renderMessages', args: [messages] });
      return messageEl as unknown as HTMLElement;
    },
  } as unknown as ChatMessageOperations;
  let presented: readonly ChatContentItem[] = [];
  const target = new ChatSurfaceRenderTarget({
    state,
    renderer,
    stream,
    presentProviderContent: () => presented,
    createAssistantMessage: messageId => ({
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: 1,
    }),
    describeTerminal: terminal => `ended: ${terminal.reason}`,
    getGreeting: () => 'Hello',
    getProviderId: () => 'claude',
    updateQueueIndicator: () => {
      calls.push({ method: 'updateQueueIndicator', args: [] });
    },
    setTitle: title => {
      calls.push({ method: 'setTitle', args: [title] });
    },
  });
  return {
    target,
    calls,
    state,
    contentEl,
    setPresented(items: readonly ChatContentItem[]) {
      presented = items;
    },
    methods: () => calls.map(call => call.method),
    clear: () => calls.splice(0),
  };
}

function terminal(overrides: Partial<RunTerminal> = {}): RunTerminal {
  return { kind: 'succeeded', reason: 'completed', occurredAt: 10, ...overrides };
}

function beginTurn(target: ChatSurfaceRenderTarget, target_run: RunId = RUN_ID): void {
  target.beginTurn({
    runId: target_run,
    commandId: 'cmd-1',
    assistantMessageId: `assistant-${target_run}`,
    startedAt: 1,
  });
}

describe('chat surface render target', () => {
  it('is satisfied by the machinery it was written against', () => {
    // The ports are narrow views of three real classes. A method renamed on any
    // of them would leave this target compiling against a shape nothing
    // implements, and nothing would say so until the flip wired it up.
    const stream: (controller: StreamController) => ChatStreamOperations = controller => controller;
    const messages: (renderer: MessageRenderer) => ChatMessageOperations = renderer => renderer;
    const cursor: (state: ChatState) => ChatStreamingCursor = state => state;

    expect([stream, messages, cursor].every(cast => typeof cast === 'function')).toBe(true);
  });

  it('opens a turn with one bubble, a cursor into it, and both indicators', () => {
    const chat = harness();

    beginTurn(chat.target);

    // One `renderer.addMessage`, not two: getting the element back by rendering
    // the message a second time is a second bubble on screen.
    expect(chat.methods()).toEqual([
      'state.addMessage',
      'renderer.addMessage',
      'showThinkingIndicator',
      'startTurnSilenceIndicator',
    ]);
    expect(chat.state.currentContentEl).toBe(chat.contentEl);
    expect(chat.state.messages).toHaveLength(1);
  });

  it('finalizes the open block before opening the next one', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Botanic' });
    chat.target.extendTurnText(RUN_ID, 0, 'ally, ');
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'reasoning-text', text: 'Hmm.' });

    expect(chat.methods()).toEqual([
      // The legacy controller decides "new block?" by watching the chunk type
      // change; the index has already decided it here.
      'finalizeCurrentThinkingBlock',
      'finalizeCurrentTextBlock',
      'appendText',
      'appendText',
      'finalizeCurrentThinkingBlock',
      'finalizeCurrentTextBlock',
      'appendThinking',
    ]);
  });

  it('keeps the message content in step with the answer it is drawing', () => {
    const chat = harness();
    beginTurn(chat.target);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Botanic' });
    chat.target.extendTurnText(RUN_ID, 0, 'ally, yes.');
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'reasoning-text', text: 'Hmm.' });
    chat.target.extendTurnText(RUN_ID, 1, ' Still hmm.');

    // Reasoning is not the answer, on this path for the same reason it is not
    // on the legacy one: the answer is what gets persisted as the message.
    expect(chat.state.messages[0]?.content).toBe('Botanically, yes.');
  });

  it('hands provider content to the surface through the provider that owns it', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();
    chat.setPresented([
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      { type: 'tool_result', id: 'tool-1', content: 'file contents' },
    ]);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'provider-content', payload: { any: 'shape' } });

    expect(chat.calls.filter(call => call.method === 'handleStreamChunk').map(call => (
      (call.args[0] as { type: string }).type
    ))).toEqual(['tool_use', 'tool_result']);
  });

  it('ends a failed turn the way the adapter ends one, and stops both indicators', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.endTurn(RUN_ID, terminal({ kind: 'failed', reason: 'provider-failure' }));

    expect(chat.calls.filter(call => call.method === 'handleStreamChunk').map(call => call.args[0]))
      .toEqual([
        { type: 'error', content: 'ended: provider-failure' },
        { type: 'done' },
      ]);
    expect(chat.methods().slice(-2)).toEqual(['hideThinkingIndicator', 'stopTurnSilenceIndicator']);
  });

  it('says a turn ended indeterminate rather than showing it as failed', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.endTurn(RUN_ID, terminal({ kind: 'indeterminate', reason: 'cancellation-unknown' }));

    expect(chat.calls[0]?.args[0]).toEqual({
      type: 'notice',
      level: 'warning',
      content: 'ended: cancellation-unknown',
    });
  });

  it('closes a succeeded turn without adding anything to it', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.endTurn(RUN_ID, terminal());

    expect(chat.calls.filter(call => call.method === 'handleStreamChunk').map(call => call.args[0]))
      .toEqual([{ type: 'done' }]);
  });

  it('stops the silence timer counting a person who is reading a question', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.setTurnState(RUN_ID, 'running');
    chat.target.setTurnState(RUN_ID, 'waiting-interaction');
    chat.target.setTurnState(RUN_ID, 'waiting-interaction');
    chat.target.setTurnState(RUN_ID, 'running');

    // A turn waiting on a human is not a provider that has gone quiet, and the
    // repeat is not a second pause.
    expect(chat.calls).toEqual([
      { method: 'pauseTurnSilenceIndicator', args: [true] },
      { method: 'pauseTurnSilenceIndicator', args: [false] },
    ]);
  });

  it('presents no interaction, and flushes what a prompt must appear below', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.showInteraction({
      interactionId: `ix-${'a'.repeat(32)}`,
      runId: RUN_ID,
      kind: 'approval',
      presentationRef: 'approval-write',
      responseIds: ['allow', 'deny'],
      status: 'open',
      updatedAt: 1,
    });
    chat.target.hideInteraction(`ix-${'a'.repeat(32)}`);

    // The provider's own presenter already has the dialog on screen. A second
    // one here is two prompts for one question.
    expect(chat.methods()).toEqual(['flushPendingToolsForPermission']);
  });

  it('says when an answer is on screen and not in the vault', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.setTurnPersistence(RUN_ID, 'saving');
    chat.target.setTurnPersistence(RUN_ID, 'saved');
    chat.target.setTurnPersistence(RUN_ID, 'failed', 'conversation-persistence-failed');

    expect(chat.calls).toEqual([{
      method: 'handleStreamChunk',
      args: [
        {
          type: 'notice',
          level: 'warning',
          content: 'This answer could not be saved (conversation-persistence-failed).',
        },
        expect.objectContaining({ role: 'assistant' }),
      ],
    }]);
  });

  it('reports what was later established about a turn', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.reconcileTurn(RUN_ID, {
      reconciliationId: `rec-${'5'.repeat(32)}`,
      observedOutcome: 'succeeded',
      evidence: { kind: 'native-history', evidenceRef: 'thread-1' },
      recordedAt: 20,
    });

    expect((chat.calls[0]?.args[0] as { content: string }).content)
      .toBe('This turn was later established to have succeeded.');
  });

  it('draws a conversation from nothing and forgets the turns it was holding', () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.reset({
      conversationId: 'conv-1',
      title: 'Tomatoes',
      messages: [{ id: 'msg-1', role: 'user', content: 'Hi', timestamp: 1 }],
    });
    // Every call for the forgotten turn is a no-op, rather than drawing into a
    // bubble that is no longer on screen.
    chat.target.extendTurnText(RUN_ID, 0, 'orphaned');
    chat.target.endTurn(RUN_ID, terminal());

    expect(chat.methods()).toEqual(['setTitle', 'renderer.renderMessages']);
    expect(chat.state.currentContentEl).toBeNull();
    expect(chat.state.messages).toEqual([expect.objectContaining({ id: 'msg-1' })]);
  });
});
