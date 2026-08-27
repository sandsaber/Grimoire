import { createMockEl } from '@test/helpers/mockElement';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ChatExecutionComposition } from '@/app/chat/ChatExecutionComposition';
import { StoredChatConversations } from '@/app/chat/StoredChatConversations';
import type { SessionStorage } from '@/core/bootstrap/SessionStorage';
import { ConversationRepository } from '@/core/conversations/ConversationRepository';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { InteractionRequest, RunTerminal } from '@/core/execution/ExecutionContracts';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import { interactionId, sessionInstanceId } from '@/core/execution/ExecutionIds';
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
        noteTurnActivity: () => undefined,
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

  it('names the session a conversation\'s turns are running in', async () => {
    // **Anything keyed by a session rather than a run asks for this** — rewind,
    // so far. The provider runtime opens a session of its own when a tab is
    // primed, and that one holds no runs at all; rewinding against it found a
    // session with nothing in it on every provider, since the flip.
    const app = await createComposition();
    expect(app.composition.coordinator.executionSessionFor(CONVERSATION_ID)).toBeNull();

    const ticket = await app.composition.coordinator.submitTurn({
      commandId: 'cmd-session',
      conversationId: CONVERSATION_ID,
      backendId: executionBackendId('internal-deterministic-fake'),
      requestRef: 'req-session',
      resultExpectation: 'optional',
      userMessage: { id: 'msg-user-session', role: 'user', content: 'Hi', timestamp: 1 },
    });
    const started = await ticket.started;

    expect(app.composition.coordinator.executionSessionFor(CONVERSATION_ID))
      .toBe(started.executionSessionId);
    app.composition.dispose();
  });

  describe('steering a turn that is already running', () => {
    /**
     * **The one feature the flip took away without saying so.** Typing while a
     * turn runs and sending goes to `steer` for a provider that declares it —
     * Codex is the only one that does — and the adapter's `steer` reads the run
     * *it* started. On this path the coordinator starts the run, so the adapter
     * had nothing active, `steer` answered `false`, and the controller quietly
     * put the message back in the queue. A feature loss that looks exactly like
     * a provider that never supported steering.
     */
    it('sends the input to the run the conversation has going', async () => {
      const app = await createComposition();
      const ticket = await app.composition.coordinator.submitTurn({
        commandId: 'cmd-steered',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        requestRef: 'req-steered',
        resultExpectation: 'optional',
        userMessage: { id: 'msg-user-steered', role: 'user', content: 'First', timestamp: 1 },
      });
      await ticket.started;

      const accepted = await app.composition.coordinator.steerActive(
        CONVERSATION_ID,
        'req-steer-1',
        { id: 'msg-user-steer', role: 'user', content: 'And also this', timestamp: 2 },
      );

      expect(accepted).toBe(true);
      // Drawn and kept, the way a first message is. Steered input that reaches
      // the provider but never the transcript is a question the answer refers
      // to and nobody can see — and on the legacy path the provider's echo of
      // it is what put it on screen, which this path filters out as framing.
      const stored = await app.repository.read(CONVERSATION_ID);
      expect(stored.kind === 'present' ? stored.metadata.messages?.map(m => m.content) : [])
        .toEqual(['First', 'And also this']);
      // Asked of the session rather than the backend: a steer is delivered to
      // the one the run is on, and a backend-level counter would pass for a
      // steer sent to any session at all.
      expect([...app.backend.sessions.values()].flatMap(session => session.steeredRefs))
        .toEqual(['req-steer-1']);
      app.composition.dispose();
    });

    it('answers false when nothing is running, so the input is queued instead', async () => {
      // What the controller does with `false` is put the message back, which is
      // exactly right when there is no turn to join. Saying `true` here would
      // swallow it.
      const app = await createComposition();

      const accepted = await app.composition.coordinator.steerActive(
        CONVERSATION_ID,
        'req-steer-2',
        { id: 'msg-user-unsteered', role: 'user', content: 'Nowhere to go', timestamp: 2 },
      );

      expect(accepted).toBe(false);
      // And nothing is written. A message the provider never received must stay
      // in the queue, not appear in the transcript as if it had been sent.
      const stored = await app.repository.read(CONVERSATION_ID);
      expect(stored.kind === 'present' ? stored.metadata.messages ?? [] : []).toHaveLength(0);
      expect([...app.backend.sessions.values()].flatMap(session => session.steeredRefs))
        .toHaveLength(0);
      app.composition.dispose();
    });
  });

  describe('an interaction the provider opens', () => {
    /**
     * **The one thing a turn cannot do without.** A provider that stops to ask
     * waits for an answer, and on this path nobody was listening: the bridge
     * that presents an interaction and resolves it was built in
     * `ExecutionChatRuntimeAdapter.attachSideChannels`, which only runs when
     * the *adapter* opens the session or runs a query. The coordinator opens
     * its own, so a Claude turn that asked before writing a file hung for five
     * minutes and was killed by a suite timeout. Found by the flip's live row,
     * which is the only thing that could have found it: a fake that never asks
     * proves an answer nobody gives.
     */
    const INTERACTION_ID = interactionId(`ix-${'a'.repeat(32)}`);

    async function openInteraction(app: Awaited<ReturnType<typeof createComposition>>) {
      const ticket = await app.composition.coordinator.submitTurn({
        commandId: 'cmd-ask',
        conversationId: CONVERSATION_ID,
        backendId: executionBackendId('internal-deterministic-fake'),
        requestRef: 'req-ask',
        resultExpectation: 'optional',
        userMessage: { id: 'msg-user-ask', role: 'user', content: 'Write it', timestamp: 1 },
      });
      const started = await ticket.started;
      app.backend.emit(started.runId, {
        kind: 'interaction-opened',
        interaction: {
          interactionId: INTERACTION_ID,
          runId: started.runId,
          kind: 'approval',
          presentationRef: 'approval-write',
          responseIds: ['allow', 'deny'],
        },
      });
      return { interactionId: INTERACTION_ID, started, ticket };
    }

    it('presents it through the provider and resolves what came back', async () => {
      const app = await createComposition();
      const presented: string[] = [];
      const release = app.composition.coordinator.attachInteractionPresenter(
        CONVERSATION_ID,
        () => ({
          present: async (request: InteractionRequest) => {
            presented.push(request.presentationRef);
            return 'allow';
          },
        }),
      );

      const started = await openInteraction(app);
      await flush(app.registry);

      expect(presented).toEqual(['approval-write']);
      // Resolved through the kernel, not merely shown: the run is what has to
      // stop waiting, and only the registry can tell it to.
      // Resolved through the kernel and forwarded to the provider, not merely
      // shown: the run is what has to stop waiting, and only the backend can
      // let it. The record is `resolving` rather than `resolved` because the
      // fake never confirms — which provider does is the provider's business,
      // and the kernel's part ends at having told it.
      expect(app.backend.resolutions.map(entry => entry.responseId)).toEqual(['allow']);
      expect(app.registry.getInteraction(started.interactionId)).toMatchObject({
        selectedResponseId: 'allow',
        status: 'resolving',
      });
      release();
      app.composition.dispose();
    });

    it('asks one presenter when two surfaces are open on the conversation', async () => {
      // The bridge belongs to the conversation, like the turn does. Two tabs
      // each presenting would put the same approval on screen twice and race
      // to answer it.
      const app = await createComposition();
      const first: string[] = [];
      const second: string[] = [];
      const releaseFirst = app.composition.coordinator.attachInteractionPresenter(
        CONVERSATION_ID,
        () => ({ present: async () => { first.push('asked'); return 'allow'; } }),
      );
      const releaseSecond = app.composition.coordinator.attachInteractionPresenter(
        CONVERSATION_ID,
        () => ({ present: async () => { second.push('asked'); return 'deny'; } }),
      );

      await openInteraction(app);
      await flush(app.registry);

      expect(first).toEqual(['asked']);
      expect(second).toEqual([]);
      releaseFirst();
      releaseSecond();
      app.composition.dispose();
    });

    it('promotes the next surface when the one presenting is released', async () => {
      // A split view whose first tab closes. The surviving tab is still open
      // and still visible, and before this it could not answer anything: the
      // coordinator kept one bridge and discarded every later attach, so
      // releasing the first left the conversation with no presenter at all.
      const app = await createComposition();
      const first: string[] = [];
      const second: string[] = [];
      const releaseFirst = app.composition.coordinator.attachInteractionPresenter(
        CONVERSATION_ID,
        () => ({ present: async () => { first.push('asked'); return 'allow'; } }),
      );
      app.composition.coordinator.attachInteractionPresenter(
        CONVERSATION_ID,
        () => ({ present: async () => { second.push('asked'); return 'deny'; } }),
      );
      releaseFirst();

      await openInteraction(app);
      await flush(app.registry);

      expect(first).toHaveLength(0);
      expect(second).toEqual(['asked']);
      app.composition.dispose();
    });

    it('asks the presenter the tab has now, not the one it had when it opened', async () => {
      // The warm-runtime cap evicts a background tab's runtime and its
      // presenter with it, and nothing re-opens the conversation when the tab
      // comes back — so a captured presenter answers `null` for every request
      // the *new* runtime raised, which the bridge reads as nobody being there
      // and the turn waits forever. The same hang, a tab switch later.
      const app = await createComposition();
      const answered: string[] = [];
      let live: { present: () => Promise<string> } | null = null;
      app.composition.coordinator.attachInteractionPresenter(CONVERSATION_ID, () => live);
      live = { present: async () => { answered.push('rebuilt'); return 'allow'; } };

      await openInteraction(app);
      await flush(app.registry);

      expect(answered).toEqual(['rebuilt']);
      expect(app.backend.resolutions.map(entry => entry.responseId)).toEqual(['allow']);
      app.composition.dispose();
    });

    it('leaves it open when the presenter is released', async () => {
      // A tab that closed answers nothing. Resolving it with an invented
      // answer would be the UI deciding on the user's behalf, which is the one
      // thing an approval prompt must never do.
      const app = await createComposition();
      const presented: string[] = [];
      const release = app.composition.coordinator.attachInteractionPresenter(
        CONVERSATION_ID,
        () => ({
          present: async (request: InteractionRequest) => {
            presented.push(request.presentationRef);
            return 'allow';
          },
        }),
      );
      release();

      const started = await openInteraction(app);
      await flush(app.registry);

      expect(presented).toHaveLength(0);
      expect(app.registry.getInteraction(started.interactionId)?.status).toBe('open');
      expect(app.registry.getRun(started.started.runId)?.openInteractionIds).toHaveLength(1);
      app.composition.dispose();
    });
  });
});

/**
 * Lets the kernel record the interaction and the bridge answer it.
 *
 * `waitForIdle` is the kernel's own answer to "is there work outstanding"; the
 * microtask turns on either side are the bridge's `await presenter.present` and
 * its `await resolveInteraction`, neither of which the kernel knows about.
 */
async function flush(registry: ExecutionLifecycleRegistry): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
    await registry.waitForIdle();
  }
}
