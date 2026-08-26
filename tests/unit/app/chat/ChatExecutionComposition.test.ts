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

describe('chat execution composition', () => {
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
