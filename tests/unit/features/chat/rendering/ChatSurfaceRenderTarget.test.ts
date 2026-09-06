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
  // `jest.fn` rather than a plain arrow, so a test can make one of the column's
  // operations slow — which is the only way to see that the order is kept.
  const record = (method: string) => jest.fn((...args: unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve();
  });
  const messageEl = createMockEl();
  const contentEl = createMockEl();
  messageEl.querySelector = jest.fn().mockReturnValue(contentEl);
  const state: ChatStreamingCursor = {
    messages: [],
    usage: null,
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
    renderTurnFailure: record('renderTurnFailure'),
    finishTurn: record('finishTurn'),
    appendText: record('appendText'),
    appendThinking: record('appendThinking'),
    finalizeCurrentTextBlock: record('finalizeCurrentTextBlock'),
    finalizeCurrentThinkingBlock: record('finalizeCurrentThinkingBlock'),
    flushPendingToolsForPermission: () => {
      calls.push({ method: 'flushPendingToolsForPermission', args: [] });
    },
    // Recorded but not asserted on in the ordering rows: it fires on every
    // block, so listing it beside them would say more about this double than
    // about the order the renderer asked for.
    noteTurnActivity: () => undefined,
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
    recordTurnUsage: (forRunId, usage) => {
      calls.push({ method: 'recordTurnUsage', args: [forRunId, usage] });
    },
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
    stream,
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
  /** The column's work is queued, so a caller lets it drain before reading. */
  async function drained(target: ChatSurfaceRenderTarget): Promise<void> {
    await target.settled();
  }

  it('is satisfied by the machinery it was written against', async () => {
    // The ports are narrow views of three real classes. A method renamed on any
    // of them would leave this target compiling against a shape nothing
    // implements, and nothing would say so until the flip wired it up.
    const stream: (controller: StreamController) => ChatStreamOperations = controller => controller;
    const messages: (renderer: MessageRenderer) => ChatMessageOperations = renderer => renderer;
    const cursor: (state: ChatState) => ChatStreamingCursor = state => state;

    expect([stream, messages, cursor].every(cast => typeof cast === 'function')).toBe(true);
  });

  it('opens a turn with one bubble, a cursor into it, and both indicators', async () => {
    const chat = harness();

    beginTurn(chat.target);

    // One `renderer.addMessage`, not two: getting the element back by rendering
    // the message a second time is a second bubble on screen.
    await drained(chat.target);
    expect(chat.methods()).toEqual([
      'state.addMessage',
      'renderer.addMessage',
      'showThinkingIndicator',
      'startTurnSilenceIndicator',
    ]);
    await drained(chat.target);
    expect(chat.state.currentContentEl).toBe(chat.contentEl);
    await drained(chat.target);
    expect(chat.state.messages).toHaveLength(1);
  });

  it('draws in the order it was asked to, however slowly each part draws', async () => {
    // Every column operation is asynchronous and several are only partly
    // synchronous: finalizing a text block awaits a pending render before it
    // closes the element. Started and not awaited, the append that follows a
    // finalize lands in the block the finalize is still closing, and the `done`
    // that ends a turn overtakes the tool call before it.
    const chat = harness();
    const slow = <T>(value: T) => new Promise<T>(resolve => {
      setTimeout(() => resolve(value), 0);
    });
    // Recorded when it *finishes*, not when it is called: a caller that starts
    // each operation without waiting produces the same call order and a
    // different draw order, and only the second one is what a person sees.
    (chat.stream.finalizeCurrentTextBlock as jest.Mock).mockImplementation(() => (
      slow(undefined).then(() => {
        chat.calls.push({ method: 'finalizeCurrentTextBlock', args: [] });
      })
    ));
    beginTurn(chat.target);
    chat.clear();

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'first' });
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'reasoning-text', text: 'second' });
    chat.target.endTurn(RUN_ID, terminal());

    await drained(chat.target);
    expect(chat.methods()).toEqual([
      'finalizeCurrentThinkingBlock',
      'appendText',
      'finalizeCurrentTextBlock',
      'appendThinking',
      'finishTurn',
      'hideThinkingIndicator',
      'stopTurnSilenceIndicator',
    ]);
  });

  it('puts a message that arrives mid-turn in front of the turn it joined', async () => {
    // **Steered input is the only thing that does this.** The coordinator
    // writes the steered question to the conversation while the turn runs, so
    // the record reads question, question, answer — the answer is written last,
    // by the barrier. Appended, the question lands *after* the answer's bubble,
    // and `ConversationController.save` then writes `state.messages` over the
    // record: the vault ends up holding a question that follows its own answer,
    // and the next turn is handed that transcript.
    const chat = harness();
    chat.state.messages = [{ id: 'user-1', role: 'user', content: 'first', timestamp: 1 }];
    beginTurn(chat.target);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'counting' });
    chat.target.appendMessage({ id: 'user-steer', role: 'user', content: 'stop', timestamp: 2 });

    await drained(chat.target);
    expect(chat.state.messages.map(message => message.id))
      .toEqual(['user-1', 'user-steer', `assistant-${RUN_ID}`]);
  });

  it('leaves a message that arrives between turns where it was appended', async () => {
    // Nothing is open, so there is nothing to sit in front of: the ordinary
    // case must not be reordered by the rule above.
    const chat = harness();
    chat.state.messages = [{ id: 'user-1', role: 'user', content: 'first', timestamp: 1 }];

    chat.target.appendMessage({ id: 'user-2', role: 'user', content: 'second', timestamp: 2 });

    await drained(chat.target);
    expect(chat.state.messages.map(message => message.id)).toEqual(['user-1', 'user-2']);
  });

  it('keeps the silence timer awake while the provider is still producing', async () => {
    // The timer says "this provider has gone quiet", and something has to tell
    // it otherwise. `handleStreamChunk` resets it itself, so the two text paths
    // are the ones that need asking — and a turn made entirely of prose takes
    // only those. `InputController` did this once per chunk from the generator
    // loop it no longer has.
    const chat = harness();
    const noted: string[] = [];
    (chat.stream.noteTurnActivity as jest.Mock | undefined)?.mockImplementation?.(() => undefined);
    chat.stream.noteTurnActivity = jest.fn(() => { noted.push('noted'); }) as never;
    beginTurn(chat.target);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'one ' });
    chat.target.extendTurnText(RUN_ID, 0, 'two ');
    chat.target.extendTurnText(RUN_ID, 0, 'three');

    await drained(chat.target);
    expect(noted).toHaveLength(3);
  });

  it('closes the block the next one displaces, and only that one', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Botanic' });
    chat.target.extendTurnText(RUN_ID, 0, 'ally, ');
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'reasoning-text', text: 'Hmm.' });

    await drained(chat.target);
    expect(chat.methods()).toEqual([
      // Prose closes the reasoning block it replaces on screen and nothing
      // else; reasoning closes the prose block. Closing both for every item is
      // what cut an answer into one block per delta.
      'finalizeCurrentThinkingBlock',
      'appendText',
      'appendText',
      'finalizeCurrentTextBlock',
      'appendThinking',
    ]);
  });

  it('does not break a sentence in two over a payload that draws nothing', async () => {
    // Every backend emits the provider's own message *and* the text deltas of
    // that same message, so a `provider-content` lands between two deltas on
    // every turn. Most of those payloads draw nothing — a session config, a
    // resume outcome, an SDK message whose text already arrived as deltas — and
    // closing the open text block for one of them cuts the answer at the delta
    // boundary. A saved conversation showed it: `content` held the whole
    // sentence while `contentBlocks` held "Hel", "lo! Wh" and the rest, each
    // its own block with its own copy button.
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();
    chat.setPresented([]);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Hel' });
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'provider-content', payload: {} });
    chat.target.openTurnBlock(RUN_ID, 2, { kind: 'assistant-text', text: 'lo!' });

    await drained(chat.target);
    // The rule, not the whole call list: the prose reaches the same open block.
    // Closing the reasoning block is a no-op here and says nothing either way.
    expect(chat.methods()).not.toContain('finalizeCurrentTextBlock');
    expect(chat.methods().filter(method => method === 'appendText')).toHaveLength(2);
  });

  it('hands a payload to the column without closing anything first', async () => {
    // **The other half of the same defect.** A payload that draws does displace
    // what is open — a tool card lands after the prose it follows — but
    // `handleStreamChunk` is what closes it, per chunk, by the rule for that
    // chunk. Closing both here as well cut a provider whose *reasoning* arrives
    // as `provider-content`, one payload per delta: OpenCode drew eight thinking
    // blocks for one stretch of reasoning on a live run, because each payload
    // closed the block the next one was about to continue.
    //
    // What the column then holds is asserted where the column is real, in
    // `ChatSurfaceColumnBlocks.test.ts` — the card between two prose blocks and
    // the reasoning in one.
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();
    chat.setPresented([{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }]);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Reading' });
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'provider-content', payload: {} });

    await drained(chat.target);
    expect(chat.methods()).toEqual([
      'finalizeCurrentThinkingBlock',
      'appendText',
      'handleStreamChunk',
    ]);
  });

  it('keeps the message content in step with the answer it is drawing', async () => {
    const chat = harness();
    beginTurn(chat.target);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Botanic' });
    chat.target.extendTurnText(RUN_ID, 0, 'ally, yes.');
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'reasoning-text', text: 'Hmm.' });
    chat.target.extendTurnText(RUN_ID, 1, ' Still hmm.');

    // Reasoning is not the answer, on this path for the same reason it is not
    // on the legacy one: the answer is what gets persisted as the message.
    await drained(chat.target);
    expect(chat.state.messages[0]?.content).toBe('Botanically, yes.');
  });

  it('hands provider content to the surface through the provider that owns it', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();
    chat.setPresented([
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      { type: 'tool_result', id: 'tool-1', content: 'file contents' },
    ]);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'provider-content', payload: { any: 'shape' } });

    await drained(chat.target);
    expect(chat.calls.filter(call => call.method === 'handleStreamChunk').map(call => (
      (call.args[0] as { type: string }).type
    ))).toEqual(['tool_use', 'tool_result']);
  });

  it('reports the usage the controller kept, not the one the chunk carried', async () => {
    // The controller filters a report from another session and an aggregate
    // that counts a subagent's tokens as the parent's. A second copy of those
    // rules here is a second copy that can disagree, so what is reported is
    // what the controller was left holding.
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();
    chat.setPresented([
      { type: 'text', content: 'Answer.' },
      { type: 'usage', usage: usageOf(10) },
    ]);
    chat.state.usage = { ...usageOf(10), model: 'kept-by-the-controller' };

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'provider-content', payload: {} });
    await Promise.resolve();
    await Promise.resolve();

    await drained(chat.target);
    expect(chat.calls.filter(call => call.method === 'recordTurnUsage')).toEqual([{
      method: 'recordTurnUsage',
      args: [RUN_ID, { ...usageOf(10), model: 'kept-by-the-controller' }],
    }]);
  });

  it('reports nothing for provider content that carried no usage', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();
    chat.setPresented([{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }]);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'provider-content', payload: {} });
    await Promise.resolve();
    await Promise.resolve();

    await drained(chat.target);
    expect(chat.methods()).not.toContain('recordTurnUsage');
  });

  it('ends a failed turn the way the adapter ends one, and stops both indicators', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.endTurn(RUN_ID, terminal({ kind: 'failed', reason: 'provider-failure' }));

    await drained(chat.target);
    // Asked by name rather than as chunks: a turn's ending is a fact the
    // projection states, and it used to say so by handing the column an `error`
    // chunk and a `done` chunk, dressed as things a provider sent.
    expect(chat.calls.filter(call => call.method === 'renderTurnFailure').map(call => call.args[0]))
      .toEqual(['ended: provider-failure']);
    expect(chat.calls.filter(call => call.method === 'finishTurn')).toHaveLength(1);
    await drained(chat.target);
    expect(chat.methods().slice(-2)).toEqual(['hideThinkingIndicator', 'stopTurnSilenceIndicator']);
  });

  it('says a turn ended indeterminate rather than showing it as failed', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.endTurn(RUN_ID, terminal({ kind: 'indeterminate', reason: 'cancellation-unknown' }));

    await drained(chat.target);
    expect(chat.calls.find(call => call.method === 'handleStreamChunk')?.args[0]).toEqual({
      type: 'notice',
      level: 'warning',
      content: 'ended: cancellation-unknown',
    });
  });

  it('closes a succeeded turn without adding anything to it', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.endTurn(RUN_ID, terminal());

    await drained(chat.target);
    // Nothing is drawn into it, and the turn is still closed. Asserted as both,
    // because "no chunks" alone is what a target that did nothing at all would
    // also report.
    expect(chat.calls.filter(call => call.method === 'handleStreamChunk')).toEqual([]);
    expect(chat.calls.filter(call => call.method === 'finishTurn')).toHaveLength(1);
  });

  it('stops the silence timer counting a person who is reading a question', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.setTurnState(RUN_ID, 'running');
    chat.target.setTurnState(RUN_ID, 'waiting-interaction');
    chat.target.setTurnState(RUN_ID, 'waiting-interaction');
    chat.target.setTurnState(RUN_ID, 'running');

    // A turn waiting on a human is not a provider that has gone quiet, and the
    // repeat is not a second pause.
    await drained(chat.target);
    expect(chat.calls).toEqual([
      { method: 'pauseTurnSilenceIndicator', args: [true] },
      { method: 'pauseTurnSilenceIndicator', args: [false] },
    ]);
  });

  it('presents no interaction, and flushes what a prompt must appear below', async () => {
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
    await drained(chat.target);
    expect(chat.methods()).toEqual(['flushPendingToolsForPermission']);
  });

  it('says when an answer is on screen and not in the vault', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.setTurnPersistence(RUN_ID, 'saving');
    chat.target.setTurnPersistence(RUN_ID, 'saved');
    chat.target.setTurnPersistence(RUN_ID, 'failed', 'conversation-persistence-failed');

    await drained(chat.target);
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

  it('reports what was later established about a turn', async () => {
    const chat = harness();
    beginTurn(chat.target);
    chat.clear();

    chat.target.reconcileTurn(RUN_ID, {
      reconciliationId: `rec-${'5'.repeat(32)}`,
      observedOutcome: 'succeeded',
      evidence: { kind: 'native-history', evidenceRef: 'thread-1' },
      recordedAt: 20,
    });

    await drained(chat.target);
    expect((chat.calls.find(call => call.method === 'handleStreamChunk')
      ?.args[0] as { content: string }).content)
      .toBe('This turn was later established to have succeeded.');
  });

  it('draws a conversation from nothing and forgets the turns it was holding', async () => {
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

    await drained(chat.target);
    expect(chat.methods()).toEqual(['setTitle', 'renderer.renderMessages']);
    await drained(chat.target);
    expect(chat.state.currentContentEl).toBeNull();
    await drained(chat.target);
    expect(chat.state.messages).toEqual([expect.objectContaining({ id: 'msg-1' })]);
  });
});

function usageOf(inputTokens: number) {
  return {
    inputTokens,
    contextWindow: 200_000,
    contextTokens: inputTokens,
    percentage: 0,
  };
}
