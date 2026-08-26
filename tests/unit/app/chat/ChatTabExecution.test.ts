import { createMockEl } from '@test/helpers/mockElement';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ChatExecutionComposition } from '@/app/chat/ChatExecutionComposition';
import { ChatTabExecution } from '@/app/chat/ChatTabExecution';
import { StoredChatConversations } from '@/app/chat/StoredChatConversations';
import type { SessionStorage } from '@/core/bootstrap/SessionStorage';
import { ConversationRepository } from '@/core/conversations/ConversationRepository';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import { sessionInstanceId } from '@/core/execution/ExecutionIds';
import { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';
import type { ChatTurnEncoder } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatMessage } from '@/core/types';
import type {
  ChatMessageOperations,
  ChatStreamingCursor,
  ChatStreamOperations,
} from '@/features/chat/rendering/ChatSurfaceRenderTarget';

/**
 * One tab's end of the path, over the real kernel and the real vault.
 *
 * What only a tab can hold: its attachment, the conversation it is showing, and
 * the provider identity its turns go out under. The blank-tab case is the one
 * worth composing rather than stubbing — a turn needs a conversation, and a
 * blank tab does not have one until it sends.
 */

const INSTANCE_ID = sessionInstanceId(`si-${'1'.repeat(32)}`);
const BACKEND_ID = executionBackendId('internal-deterministic-fake');

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
    }),
    toSessionMetadata: conversation => ({
      id: conversation.id,
      providerId: conversation.providerId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      sessionId: conversation.sessionId,
      messages: [...conversation.messages],
    }),
  };
}

function surface() {
  const drawn: string[] = [];
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
  return {
    drawn,
    state,
    binding: {
      state,
      renderer: {
        addMessage: () => element as unknown as HTMLElement,
        renderMessages: () => element as unknown as HTMLElement,
      } as unknown as ChatMessageOperations,
      stream: {
        handleStreamChunk: () => Promise.resolve(),
        appendText: (text: string) => {
          drawn.push(text);
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
      presentProviderContent: () => [],
      createAssistantMessage: (messageId: string): ChatMessage => ({
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: 1,
      }),
      describeTerminal: () => 'ended',
      getGreeting: () => 'Hello',
      getProviderId: () => 'claude',
      updateQueueIndicator: () => undefined,
      setTitle: () => undefined,
    },
  };
}

const encoder: ChatTurnEncoder = {
  prepareTurn: request => ({
    isCompact: false,
    mcpMentions: new Set<string>(),
    persistedContent: request.text,
    prompt: request.text,
    request,
  }),
  encodeRequestRef: () => 'req-1',
};

async function createTab(options: { readonly encoder?: ChatTurnEncoder | null } = {}) {
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
  const composition = new ChatExecutionComposition({
    lifecycle: registry,
    conversations: new StoredChatConversations({
      repository,
      projection: projection(),
      defaultProviderId: 'claude',
    }),
    now,
  });
  const drawn = surface();
  const created: string[] = [];
  let commandOrdinal = 0;
  const tab = new ChatTabExecution({
    composition,
    backendId: BACKEND_ID,
    surface: drawn.binding,
    turnEncoder: () => (options.encoder === undefined ? encoder : options.encoder),
    createConversation: async () => {
      const id = `conv-${created.length + 1}`;
      created.push(id);
      await repository.save({
        id,
        providerId: 'claude',
        title: 'New chat',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      }, null);
      return id;
    },
    nextCommandId: () => `cmd-${++commandOrdinal}`,
  });
  return { backend, composition, created, drawn, registry, repository, tab };
}

function userMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, timestamp: 1 };
}

describe('chat tab execution', () => {
  it('creates the conversation a blank tab sends its first turn into', async () => {
    const app = await createTab();

    expect(app.tab.conversationId).toBeNull();
    const { ticket: ticket } = await app.tab.send({ text: 'Hi' }, userMessage('msg-1', 'Hi'));
    const started = await ticket.started;
    app.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Hello.',
    });
    app.backend.emit(started.runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' });
    await ticket.completion;

    // The durable record exists before the run does: a crash mid-turn leaves a
    // conversation rather than a run belonging to one nobody can open.
    expect(app.created).toEqual(['conv-1']);
    expect(app.tab.conversationId).toBe('conv-1');
    expect(app.drawn.drawn).toEqual(['Hello.']);
    const stored = await app.repository.read('conv-1');
    expect(stored.kind === 'present' ? stored.metadata.messages?.map(m => m.content) : [])
      .toEqual(['Hi', 'Hello.']);
    app.composition.dispose();
  });

  it('creates one conversation however many turns follow', async () => {
    const app = await createTab();
    const { ticket: first } = await app.tab.send({ text: 'Hi' }, userMessage('msg-1', 'Hi'));
    const firstStarted = await first.started;
    app.backend.emit(firstStarted.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await first.completion;

    const { ticket: second } = await app.tab.send({ text: 'Again' }, userMessage('msg-2', 'Again'));
    await second.started;

    expect(app.created).toEqual(['conv-1']);
    app.composition.dispose();
  });

  it('refuses a turn from a tab with no runtime to encode it', async () => {
    const app = await createTab({ encoder: null });

    // Without the provider's own encoding there is no reference a backend can
    // resolve, and a guessed one fails inside the provider with nothing to
    // explain it.
    await expect(app.tab.send({ text: 'Hi' }, userMessage('msg-1', 'Hi')))
      .rejects.toThrow(/no provider runtime/);
    // And no conversation was created for a turn that never went out.
    expect(app.created).toEqual([]);
    app.composition.dispose();
  });

  it('cancels the turn the tab is showing, and nothing when it is blank', async () => {
    const app = await createTab();

    await expect(app.tab.cancel()).resolves.toBeUndefined();

    const { ticket: ticket } = await app.tab.send({ text: 'Hi' }, userMessage('msg-1', 'Hi'));
    await ticket.started;
    await app.registry.waitForIdle();
    await app.tab.cancel();
    const completed = await ticket.completion;

    expect(completed.terminal.kind).toBe('cancelled');
    app.composition.dispose();
  });

  it('stops drawing when the tab closes, and the kernel keeps the turn', async () => {
    const app = await createTab();
    const { ticket: ticket } = await app.tab.send({ text: 'Hi' }, userMessage('msg-1', 'Hi'));
    const started = await ticket.started;

    app.tab.detach();
    app.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Nobody is reading this.',
    });
    app.backend.emit(started.runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' });
    await ticket.completion;

    expect(app.drawn.drawn).toEqual([]);
    // The turn still finished and still reached the vault: closing a tab ends
    // the view of the work, not the work.
    const stored = await app.repository.read('conv-1');
    expect(stored.kind === 'present' ? stored.metadata.messages?.at(-1)?.content : null)
      .toBe('Nobody is reading this.');
    expect(app.tab.conversationId).toBeNull();
    app.composition.dispose();
  });
});
