import { createMockEl } from '@test/helpers/mockElement';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ChatExecutionComposition } from '@/app/chat/ChatExecutionComposition';
import { StoredChatConversations } from '@/app/chat/StoredChatConversations';
import type { SessionStorage } from '@/core/bootstrap/SessionStorage';
import { ConversationRepository } from '@/core/conversations/ConversationRepository';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { RunTerminal } from '@/core/execution/ExecutionContracts';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import { sessionInstanceId } from '@/core/execution/ExecutionIds';
import { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';
import type { ChatTurnEncoder } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatTurnRequest } from '@/core/runtime/types';
import type { ChatContentItem, ChatMessage } from '@/core/types';
import type {
  ChatMessageOperations,
  ChatStreamingCursor,
  ChatStreamOperations,
} from '@/features/chat/rendering/ChatSurfaceRenderTarget';

/**
 * The chat execution path as an application assembles it.
 *
 * One coordinator beside the kernel and a binding per surface, over the real
 * registry and the real conversation store: what this proves that the pieces'
 * own tests cannot is that the wiring between them is the wiring they expect —
 * identities the kernel accepts, and a turn's cost finding its way back to the
 * barrier from the surface that learned it.
 */

const CONVERSATION_ID = 'conv-1';
const INSTANCE_ID = sessionInstanceId(`si-${'1'.repeat(32)}`);

function projection(): Pick<SessionStorage, 'toConversation' | 'toSessionMetadata'> {
  return {
    toConversation: (metadata, defaultProviderId) => ({
      id: metadata.id,
      providerId: metadata.providerId ?? defaultProviderId,
      title: metadata.title,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      sessionId: metadata.sessionId ?? null,
      messages: metadata.messages ? [...metadata.messages] : [],
      usage: metadata.usage,
    }),
    toSessionMetadata: conversation => ({
      id: conversation.id,
      providerId: conversation.providerId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      sessionId: conversation.sessionId,
      messages: [...conversation.messages],
      usage: conversation.usage,
    }),
  };
}

function surface() {
  const calls: { method: string; args: readonly unknown[] }[] = [];
  const element = createMockEl();
  element.querySelector = jest.fn().mockReturnValue(createMockEl());
  const state: ChatStreamingCursor = {
    messages: [],
    usage: null,
    currentContentEl: null,
    currentTextEl: null,
    currentTextContent: '',
    currentThinkingState: null,
    addMessage(message) {
      this.messages.push(message);
    },
  };
  let presented: readonly ChatContentItem[] = [];
  return {
    calls,
    state,
    setPresented(items: readonly ChatContentItem[]) {
      presented = items;
    },
    binding: {
      state,
      renderer: {
        addMessage: () => element as unknown as HTMLElement,
        renderMessages: () => element as unknown as HTMLElement,
      } as unknown as ChatMessageOperations,
      stream: {
        handleStreamChunk: (chunk: { type: string }) => {
          calls.push({ method: `chunk:${chunk.type}`, args: [] });
          return Promise.resolve();
        },
        appendText: (text: string) => {
          calls.push({ method: 'appendText', args: [text] });
          return Promise.resolve();
        },
        appendThinking: () => Promise.resolve(),
        finalizeCurrentTextBlock: () => Promise.resolve(),
        finalizeCurrentThinkingBlock: () => Promise.resolve(),
        flushPendingToolsForPermission: () => undefined,
        showThinkingIndicator: () => undefined,
        hideThinkingIndicator: () => undefined,
        startTurnSilenceIndicator: () => undefined,
        pauseTurnSilenceIndicator: () => undefined,
        stopTurnSilenceIndicator: () => undefined,
      } as unknown as ChatStreamOperations,
      presentProviderContent: () => presented,
      createAssistantMessage: (messageId: string): ChatMessage => ({
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: 1,
      }),
      describeTerminal: (terminal: RunTerminal) => `ended: ${terminal.reason}`,
      getGreeting: () => 'Hello',
      getProviderId: () => 'claude',
      updateQueueIndicator: () => undefined,
      setTitle: () => undefined,
    },
  };
}

async function createComposition() {
  const storage = new TestDurableStorage();
  const now = () => 1_000;
  let ordinal = 0;
  const repositories = new ExecutionControlRepositories(storage, now);
  const registry = new ExecutionLifecycleRegistry({
    repositories,
    controlTransactions: new ExecutionControlTransactionCoordinator(storage, repositories, { now }),
    nextTransactionId: () => `tx-${(++ordinal).toString(16).padStart(32, '0')}`,
    now,
    scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
  });
  const backend = new DeterministicFakeBackend({
    sessionInstanceIdFactory: () => INSTANCE_ID,
    now,
  });
  registry.registerBackend({ backend, interactions: backend });
  await registry.start();

  const repository = new ConversationRepository({ storage, now });
  await repository.save({
    id: CONVERSATION_ID,
    providerId: 'claude',
    title: 'Tomatoes',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }, null);

  return {
    registry,
    backend,
    repository,
    storage,
    composition: new ChatExecutionComposition({
      lifecycle: registry,
      conversations: new StoredChatConversations({
        repository,
        projection: projection(),
        defaultProviderId: 'claude',
      }),
      now,
    }),
  };
}

function encoder(overrides: Partial<ChatTurnEncoder> = {}): ChatTurnEncoder {
  const encoded: {
    history: readonly ChatMessage[];
    options: unknown;
  }[] = [];
  const base: ChatTurnEncoder = {
    prepareTurn: request => ({
      isCompact: false,
      mcpMentions: new Set<string>(),
      persistedContent: `composed: ${request.text}`,
      prompt: `composed: ${request.text}`,
      request,
    }),
    encodeRequestRef: (_turn, history, options) => {
      encoded.push({ history: history ?? [], options });
      return `req-${encoded.length}`;
    },
    ...overrides,
  };
  return Object.assign(base, { encoded });
}

function turnRequest(text: string): ChatTurnRequest {
  return { text };
}

describe('chat execution composition', () => {
  describe('sending a message', () => {
    it('hands back the message it persisted, and draws it once', async () => {
      // The surface has its own copy of the question on screen. What the
      // provider composed is what the conversation keeps, so the caller is
      // handed it to match its copy to — the same line the legacy path writes
      // as `userMsg.content = preparedTurn.persistedContent`.
      //
      // And it reaches the column exactly once: the conversation grows by the
      // user message *before* the turn exists, so a renderer has no turn to ask
      // whether it was already drawn. A surface on this path therefore does not
      // draw its own — the projection does.
      const app = await createComposition();
      const drawn = surface();
      const attachment = app.composition.bindSurface(drawn.binding);
      await attachment.open(CONVERSATION_ID, app.composition.coordinator);
      const turns = encoder();

      const submitted = await app.composition.submitTurn({
        commandId: 'cmd-1',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        encoder: turns,
        request: turnRequest('are tomatoes a fruit?'),
        userMessage: {
          id: 'msg-user-1',
          role: 'user',
          content: 'are tomatoes a fruit?',
          timestamp: 1,
        },
      });
      await submitted.ticket.started;

      expect(submitted.userMessage.content).toBe('composed: are tomatoes a fruit?');
      expect(submitted.userMessage.id).toBe('msg-user-1');
      expect(drawn.state.messages.filter(message => message.id === 'msg-user-1')).toHaveLength(1);
      app.composition.dispose();
    });

    it('persists what the provider composed and shows what was typed', async () => {
      const app = await createComposition();
      const drawn = surface();
      const attachment = app.composition.bindSurface(drawn.binding);
      await attachment.open(CONVERSATION_ID, app.composition.coordinator);
      const turns = encoder();

      const { ticket: ticket } = await app.composition.submitTurn({
        commandId: 'cmd-1',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        encoder: turns,
        request: turnRequest('are tomatoes a fruit?'),
        userMessage: {
          id: 'msg-user-1',
          role: 'user',
          content: 'are tomatoes a fruit?',
          displayContent: 'are tomatoes a fruit?',
          timestamp: 1,
        },
      });
      const started = await ticket.started;
      app.backend.emit(started.runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' });
      await ticket.completion;

      const stored = await app.repository.read(CONVERSATION_ID);
      const userMessage = stored.kind === 'present' ? stored.metadata.messages?.[0] : undefined;
      // What the provider will actually send is what the conversation keeps;
      // the original input stays where the surface renders it.
      expect(userMessage?.content).toBe('composed: are tomatoes a fruit?');
      expect(userMessage?.displayContent).toBe('are tomatoes a fruit?');
      app.composition.dispose();
    });

    it('encodes the reference from the conversation before this turn joins it', async () => {
      // The legacy path passes everything but the message it just added and the
      // placeholder beside it. Encoding after the coordinator appends would send
      // the provider the turn it is being asked to answer.
      const app = await createComposition();
      const turns = encoder();
      const { ticket: first } = await app.composition.submitTurn({
        commandId: 'cmd-1',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        encoder: turns,
        request: turnRequest('first'),
        userMessage: { id: 'msg-user-1', role: 'user', content: 'first', timestamp: 1 },
      });
      const firstStarted = await first.started;
      app.backend.emit(firstStarted.runId, {
        kind: 'output-delta',
        channel: 'assistant',
        text: 'Answer.',
      });
      app.backend.emit(firstStarted.runId, {
        kind: 'terminal',
        terminal: 'succeeded',
        reason: 'completed',
      });
      await first.completion;

      const { ticket: second } = await app.composition.submitTurn({
        commandId: 'cmd-2',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        encoder: turns,
        request: turnRequest('second'),
        userMessage: { id: 'msg-user-2', role: 'user', content: 'second', timestamp: 2 },
      });
      await second.started;

      const encoded = (turns as ChatTurnEncoder & { encoded: { history: ChatMessage[] }[] }).encoded;
      expect(encoded[0]?.history.map(message => message.id)).toEqual([]);
      expect(encoded[1]?.history.map(message => message.id)).toEqual(['msg-user-1', 'assistant-' + firstStarted.runId]);
      app.composition.dispose();
    });

    it('encodes the history the vault has, not the one the coordinator last saw', async () => {
      // This coordinator is not the only writer: a surface saves what it drew,
      // with the tool calls and content blocks the barrier does not carry. A
      // projection built from an earlier read has none of it, and encoding the
      // history from that sends the provider a poorer transcript than the one
      // on screen.
      const app = await createComposition();
      const turns = encoder();
      const first = await app.composition.submitTurn({
        commandId: 'cmd-1',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        encoder: turns,
        request: turnRequest('first'),
        userMessage: { id: 'msg-user-1', role: 'user', content: 'first', timestamp: 1 },
      });
      const started = await first.ticket.started;
      app.backend.emit(started.runId, {
        kind: 'terminal',
        terminal: 'succeeded',
        reason: 'completed',
      });
      await first.ticket.completion;

      // Somebody else writes the conversation — which is exactly what the chat
      // surface does when it saves the messages it drew.
      await app.repository.apply(CONVERSATION_ID, current => ({
        ...current,
        messages: [
          ...(current.messages ?? []),
          { id: 'msg-from-elsewhere', role: 'assistant', content: 'richer', timestamp: 3 },
        ],
      }));

      const second = await app.composition.submitTurn({
        commandId: 'cmd-2',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        encoder: turns,
        request: turnRequest('second'),
        userMessage: { id: 'msg-user-2', role: 'user', content: 'second', timestamp: 4 },
      });
      await second.ticket.started;

      const encoded = (turns as ChatTurnEncoder & { encoded: { history: ChatMessage[] }[] }).encoded;
      expect(encoded.at(-1)?.history.map(message => message.id)).toContain('msg-from-elsewhere');
      app.composition.dispose();
    });

    it('expects no answer of a compacting turn, and keeps no note on it', async () => {
      // `isCompact` is a property of any prepared turn, and the rule is the
      // adapter's rather than any provider's: without it a compaction that did
      // exactly what was asked ends as a failure for producing no answer.
      const app = await createComposition();
      const turns = encoder({
        prepareTurn: request => ({
          isCompact: true,
          mcpMentions: new Set<string>(),
          persistedContent: '/compact',
          prompt: '/compact',
          request: { ...request, currentNotePath: 'Note.md' },
        }),
      });

      const { ticket: ticket } = await app.composition.submitTurn({
        commandId: 'cmd-1',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        encoder: turns,
        request: turnRequest('/compact'),
        userMessage: { id: 'msg-user-1', role: 'user', content: '/compact', timestamp: 1 },
      });
      const started = await ticket.started;
      app.backend.emit(started.runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' });
      const completed = await ticket.completion;

      expect(completed.terminal.kind).toBe('succeeded');
      const projected = app.composition.coordinator.getProjection(CONVERSATION_ID);
      expect(projected?.turns[0]?.run.resultExpectation).toBe('none');
      const stored = await app.repository.read(CONVERSATION_ID);
      expect(stored.kind === 'present' ? stored.metadata.messages?.[0]?.currentNote : 'unset')
        .toBeUndefined();
      app.composition.dispose();
    });

    it('takes the provider\'s answer about what a turn expects', async () => {
      const app = await createComposition();
      const turns = encoder({ resultExpectation: () => 'optional' });

      const { ticket: ticket } = await app.composition.submitTurn({
        commandId: 'cmd-1',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        encoder: turns,
        request: turnRequest('plan this'),
        userMessage: { id: 'msg-user-1', role: 'user', content: 'plan this', timestamp: 1 },
      });
      await ticket.started;

      expect(app.composition.coordinator.getProjection(CONVERSATION_ID)?.turns[0]?.run
        .resultExpectation).toBe('optional');
      app.composition.dispose();
    });
  });

  it('runs a turn from a bound surface and leaves it in the vault', async () => {
    const app = await createComposition();
    const drawn = surface();
    const attachment = app.composition.bindSurface(drawn.binding);
    await attachment.open(CONVERSATION_ID, app.composition.coordinator);

    const ticket = await app.composition.coordinator.submitTurn({
      commandId: 'cmd-1',
      conversationId: CONVERSATION_ID,
      backendId: executionBackendId('internal-deterministic-fake'),
      requestRef: 'req-1',
      resultExpectation: 'optional',
      userMessage: { id: 'msg-user-1', role: 'user', content: 'Are tomatoes a fruit?', timestamp: 1 },
    });
    const started = await ticket.started;
    app.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanically, yes.',
    });
    app.backend.emit(started.runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' });
    await ticket.completion;
    attachment.detach();

    // The identities this mints are the ones the kernel accepts: a malformed
    // one is refused deep inside `startRun`, and the turn above got that far.
    expect(started.runId).toMatch(/^run-[0-9a-f]{32}$/);
    expect(started.executionSessionId).toMatch(/^es-[0-9a-f]{32}$/);

    const stored = await app.repository.read(CONVERSATION_ID);
    expect(stored.kind === 'present' ? stored.metadata.messages?.at(-1)?.content : null)
      .toBe('Botanically, yes.');

    // And a different identity each time, which the shape alone cannot see: the
    // kernel refuses a run id it already knows, so a constant would end the
    // conversation at its first turn.
    const second = await app.composition.coordinator.submitTurn({
      commandId: 'cmd-2',
      conversationId: CONVERSATION_ID,
      backendId: executionBackendId('internal-deterministic-fake'),
      requestRef: 'req-2',
      resultExpectation: 'optional',
      userMessage: { id: 'msg-user-2', role: 'user', content: 'And a vegetable?', timestamp: 2 },
    });
    const secondStarted = await second.started;
    expect(secondStarted.runId).not.toBe(started.runId);
    // One session for the conversation, so the provider resumes its own thread.
    expect(secondStarted.executionSessionId).toBe(started.executionSessionId);
    expect(drawn.calls.filter(call => call.method === 'appendText'))
      .toEqual([{ method: 'appendText', args: ['Botanically, yes.'] }]);
    app.composition.dispose();
  });

  it('carries a turn\'s cost from the surface that learned it to the barrier', async () => {
    const app = await createComposition();
    const drawn = surface();
    drawn.setPresented([{
      type: 'usage',
      usage: { inputTokens: 42, contextWindow: 200_000, contextTokens: 42, percentage: 0 },
    }]);
    const attachment = app.composition.bindSurface(drawn.binding);
    await attachment.open(CONVERSATION_ID, app.composition.coordinator);

    const ticket = await app.composition.coordinator.submitTurn({
      commandId: 'cmd-1',
      conversationId: CONVERSATION_ID,
      backendId: executionBackendId('internal-deterministic-fake'),
      requestRef: 'req-1',
      resultExpectation: 'optional',
      userMessage: { id: 'msg-user-1', role: 'user', content: 'How much?', timestamp: 1 },
    });
    const started = await ticket.started;
    // The controller is what filters a usage report, so what it was left
    // holding is what the surface reports back.
    drawn.state.usage = { inputTokens: 42, contextWindow: 200_000, contextTokens: 42, percentage: 0 };
    app.backend.emit(started.runId, { kind: 'provider-content', payload: { any: 'shape' } });
    app.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Forty-two.',
    });
    await new Promise(resolve => setImmediate(resolve));
    app.backend.emit(started.runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' });
    await ticket.completion;
    attachment.detach();

    // Nothing but this route carries it: the kernel has no token counts, and
    // the surface that learned them is not what writes the conversation.
    const stored = await app.repository.read(CONVERSATION_ID);
    expect(stored.kind === 'present' ? stored.metadata.usage : null).toEqual({
      inputTokens: 42,
      contextWindow: 200_000,
      contextTokens: 42,
      percentage: 0,
    });
    app.composition.dispose();
  });

  it('shows two surfaces on one conversation the same turn', async () => {
    // A conversation's projection belongs to the conversation, not to whoever
    // is looking at it. Two tabs on one chat that each ran their own turn would
    // be two answers interleaved into one transcript.
    const app = await createComposition();
    const first = surface();
    const second = surface();
    const firstAttachment = app.composition.bindSurface(first.binding);
    const secondAttachment = app.composition.bindSurface(second.binding);
    await firstAttachment.open(CONVERSATION_ID, app.composition.coordinator);
    await secondAttachment.open(CONVERSATION_ID, app.composition.coordinator);

    const ticket = await app.composition.coordinator.submitTurn({
      commandId: 'cmd-1',
      conversationId: CONVERSATION_ID,
      backendId: executionBackendId('internal-deterministic-fake'),
      requestRef: 'req-1',
      resultExpectation: 'optional',
      userMessage: { id: 'msg-user-1', role: 'user', content: 'Hi', timestamp: 1 },
    });
    const started = await ticket.started;
    app.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Hello.',
    });
    app.backend.emit(started.runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' });
    await ticket.completion;

    expect(second.calls.filter(call => call.method === 'appendText'))
      .toEqual(first.calls.filter(call => call.method === 'appendText'));
    expect(app.backend.dispatchedRequests.size).toBe(1);
    firstAttachment.detach();
    secondAttachment.detach();
    app.composition.dispose();
  });
});
