import '@/providers';

import { createRealChatColumn } from '@test/helpers/chat/realChatColumn';

import type { RunTerminal } from '@/core/execution/ExecutionContracts';
import { type RunId, runId } from '@/core/execution/ExecutionIds';
import type { ChatContentItem, ChatMessage } from '@/core/types';
import { ChatSurfaceRenderTarget } from '@/features/chat/rendering/ChatSurfaceRenderTarget';

/**
 * What the column ends up holding after a turn, not what it was asked for.
 *
 * `ChatSurfaceRenderTarget.test.ts` asserts which operations the target
 * performs and in what order, against recording doubles, on the stated grounds
 * that what those operations then do is `StreamController`'s own behaviour and
 * is tested there. Both halves were right and neither owned the join: which
 * order of calls produces which content blocks was held by nothing, and a turn
 * spent the whole migration cutting every answer into one block per delta —
 * whole in `content`, split mid-word in `contentBlocks`, one copy button per
 * fragment, and still split after a reload because the blocks are what history
 * redraws from.
 *
 * So this file runs the real target over the real controller and asks the
 * message what it holds. It is the deterministic half of the same question the
 * live chat projection smokes now ask of a real provider's answer.
 */

const RUN_ID = runId(`run-${'1'.repeat(32)}`);

function harness() {
  const column = createRealChatColumn({ providerId: 'claude' });
  let presented: readonly ChatContentItem[] = [];
  const messages = new Map<string, ChatMessage>();
  const target = new ChatSurfaceRenderTarget({
    state: column.state,
    renderer: column.renderer,
    stream: column.stream,
    presentProviderContent: () => presented,
    createAssistantMessage: (messageId): ChatMessage => {
      const message: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: 1,
        toolCalls: [],
        contentBlocks: [],
      };
      messages.set(messageId, message);
      return message;
    },
    describeTerminal: terminal => `ended: ${terminal.reason}`,
    recordTurnUsage: () => undefined,
    getGreeting: () => '',
    getProviderId: () => 'claude',
    updateQueueIndicator: () => undefined,
    setTitle: () => undefined,
  });
  return {
    column,
    target,
    setPresented(items: readonly ChatContentItem[]) {
      presented = items;
    },
    /** The message the turn was drawn into, as the surface holds it. */
    answer: (forRunId: RunId = RUN_ID) => {
      const message = messages.get(`assistant-${forRunId}`);
      if (!message) {
        throw new Error('The turn drew no assistant message.');
      }
      return message;
    },
  };
}

function terminal(overrides: Partial<RunTerminal> = {}): RunTerminal {
  return { kind: 'succeeded', reason: 'completed', occurredAt: 10, ...overrides };
}

function beginTurn(target: ChatSurfaceRenderTarget, forRunId: RunId = RUN_ID): void {
  target.beginTurn({
    runId: forRunId,
    commandId: 'cmd-1',
    assistantMessageId: `assistant-${forRunId}`,
    startedAt: 1,
  });
}

/**
 * One whole turn, ending the way the surface ends one.
 *
 * The last block of an answer is closed by `InputController`'s `finally` block,
 * not by the target's `endTurn` and not by `finishTurn`, so a test that stops
 * at the terminal reads an answer with its final block missing — and would have
 * called the defect this file exists for a fix.
 */
async function endTurn(chat: ReturnType<typeof harness>): Promise<ChatMessage> {
  chat.target.endTurn(RUN_ID, terminal());
  await chat.target.settled();
  const answer = chat.answer();
  await chat.column.closeOpenBlocks(answer);
  return answer;
}

describe('the column after a turn', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds one text block for an answer that arrived as deltas', async () => {
    // The shape of every real turn: each backend emits the provider's own
    // message *and* the text deltas of that same message, so a
    // `provider-content` the projection could not merge lands between two
    // deltas — Claude one per SDK message, the ACP backends one per session
    // update. Most of those payloads draw nothing at all.
    const chat = harness();
    beginTurn(chat.target);
    chat.setPresented([]);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Hel' });
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'provider-content', payload: {} });
    chat.target.openTurnBlock(RUN_ID, 2, { kind: 'assistant-text', text: 'lo! Wh' });
    chat.target.openTurnBlock(RUN_ID, 3, { kind: 'provider-content', payload: {} });
    chat.target.extendTurnText(RUN_ID, 3, 'at can I do?');

    const answer = await endTurn(chat);

    expect(chat.column.thrown).toEqual([]);
    // The answer is one block, and it is the whole answer — not "Hel", "lo! Wh"
    // and the rest, each its own block with its own copy button.
    expect(chat.column.textBlocks(answer).map(block => block.content))
      .toEqual(['Hello! What can I do?']);
    // And the block says the same thing the message does, which is what makes a
    // reloaded conversation read like the one that was on screen.
    expect(answer.content).toBe('Hello! What can I do?');
  });

  it('closes the text block the card that follows it displaces', async () => {
    // The other half of the same rule: a payload that draws something has to
    // land *after* the prose it follows, so that prose is closed first — and a
    // turn that then keeps talking starts a second block, which is what a
    // person sees.
    const chat = harness();
    beginTurn(chat.target);

    chat.setPresented([]);
    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Reading the note.' });
    chat.setPresented([{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }]);
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'provider-content', payload: {} });
    chat.setPresented([]);
    chat.target.openTurnBlock(RUN_ID, 2, { kind: 'assistant-text', text: 'It has one line.' });

    const answer = await endTurn(chat);

    expect(chat.column.thrown).toEqual([]);
    expect(chat.column.textBlocks(answer).map(block => block.content))
      .toEqual(['Reading the note.', 'It has one line.']);
    // The card is between them rather than after both, which is the order the
    // turn happened in.
    expect(chat.column.blocks(answer).map(block => block.type))
      .toEqual(['text', 'tool_use', 'text']);
  });

  it('puts a message that joined a running turn ahead of the turn it joined', async () => {
    // **Steered input is the only thing that does this**, and the cursor is why
    // it is here rather than beside the target's other rows: `ChatState.messages`
    // answers with a *copy*, so a reorder performed on what it hands back is
    // performed on a temporary array and the tab keeps the order it had. The
    // target's own suite doubles the cursor with a plain array, where splicing in
    // place works — so the seam that made the reorder a no-op in every real tab
    // was the double.
    //
    // What it costs: the coordinator writes the steered question to the
    // conversation while the turn runs, so the record reads question, question,
    // answer — and `ConversationController.save` then writes `state.messages`
    // over it, leaving the vault holding a question that follows its own answer
    // and handing the next turn a transcript in that order.
    const chat = harness();
    beginTurn(chat.target);
    chat.setPresented([]);
    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'assistant-text', text: 'Counting: 1, 2' });

    const steered: ChatMessage = {
      id: 'user-steered',
      role: 'user',
      content: 'Stop counting.',
      timestamp: 2,
    };
    chat.target.appendMessage(steered);

    await endTurn(chat);

    expect(chat.column.state.messages.map(message => message.id))
      .toEqual(['user-steered', `assistant-${RUN_ID}`]);
  });

  it('holds one thinking block for reasoning that arrived as provider content', async () => {
    // **Not every provider's reasoning arrives as a `reasoning-text` item.**
    // OpenCode's comes through `provider-content`, one payload per delta, each
    // presented as a `thinking` chunk — and a live row drew eight thinking
    // blocks for one stretch of reasoning, each its own collapsed card, which is
    // the defect this file exists for wearing its other face.
    const chat = harness();
    beginTurn(chat.target);

    for (const [index, content] of ['Think', 'ing about', ' the note.'].entries()) {
      chat.setPresented([{ type: 'thinking', content }]);
      chat.target.openTurnBlock(RUN_ID, index, { kind: 'provider-content', payload: {} });
    }
    chat.setPresented([]);
    chat.target.openTurnBlock(RUN_ID, 3, { kind: 'assistant-text', text: 'It has one line.' });

    const answer = await endTurn(chat);

    expect(chat.column.thrown).toEqual([]);
    expect(chat.column.blocks(answer).map(block => block.type)).toEqual(['thinking', 'text']);
    // Read off the block rather than off the recorder: reasoning that arrives
    // this way never passes through `appendThinking` on the column's port — the
    // controller reaches its own from inside `handleStreamChunk` — so what the
    // block holds is the only witness that all three deltas landed in one.
    const [reasoning] = chat.column.blocks(answer);
    expect(reasoning?.type === 'thinking' && reasoning.content)
      .toBe('Thinking about the note.');
  });

  it('keeps reasoning and prose as one block each', async () => {
    // Reasoning closes the prose block and prose closes the reasoning block,
    // because each replaces the other on screen. The defect cut both.
    const chat = harness();
    beginTurn(chat.target);
    chat.setPresented([]);

    chat.target.openTurnBlock(RUN_ID, 0, { kind: 'reasoning-text', text: 'Think' });
    chat.target.openTurnBlock(RUN_ID, 1, { kind: 'provider-content', payload: {} });
    chat.target.openTurnBlock(RUN_ID, 2, { kind: 'reasoning-text', text: 'ing about it.' });
    chat.target.openTurnBlock(RUN_ID, 3, { kind: 'assistant-text', text: 'The answer ' });
    chat.target.openTurnBlock(RUN_ID, 4, { kind: 'provider-content', payload: {} });
    chat.target.openTurnBlock(RUN_ID, 5, { kind: 'assistant-text', text: 'is 42.' });

    const answer = await endTurn(chat);

    expect(chat.column.thrown).toEqual([]);
    expect(chat.column.textBlocks(answer).map(block => block.content)).toEqual(['The answer is 42.']);
    expect(chat.column.thought.join('')).toBe('Thinking about it.');
    expect(chat.column.blocks(answer).map(block => block.type)).toEqual(['thinking', 'text']);
  });
});
