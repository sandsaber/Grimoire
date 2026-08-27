import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';
import { createMockEl } from '@test/helpers/mockElement';

import { ChatExecutionComposition } from '@/app/chat/ChatExecutionComposition';
import { ChatTabExecution } from '@/app/chat/ChatTabExecution';
import { StoredChatConversations } from '@/app/chat/StoredChatConversations';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { SessionStorage } from '@/core/bootstrap/SessionStorage';
import type { ExecutionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { RunTerminal } from '@/core/execution/ExecutionContracts';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { describeRunFailure } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatMessage, StreamChunk } from '@/core/types';
import type { ProviderId } from '@/core/types/provider';
import type { ChatExecutionLifecyclePort } from '@/features/chat/application/ChatExecutionCoordinator';
import { isChatContent } from '@/features/chat/rendering/chatContentChunks';
import type {
  ChatMessageOperations,
  ChatStreamingCursor,
  ChatStreamOperations,
} from '@/features/chat/rendering/ChatSurfaceRenderTarget';

/**
 * A tab's end of the chat projection path, over a real provider.
 *
 * Shared by every provider's projection smoke because the path is the thing
 * being certified and the path is provider-neutral: what differs per provider
 * is what its backend needs to exist at all, which stays in that provider's own
 * file. A second copy of the assembly would let the two drift, and then a row
 * that passed for one provider would be measuring something else for the next.
 *
 * Nothing here is a fake below the composition. The conversation store is
 * `SessionStorage` over a vault adapter, so the barrier's write goes through
 * the same envelope a vault in the field holds, and the column is doubled by
 * **recording** what it was asked to draw rather than by answering — an
 * assertion over it is a statement about what the surface was told to do.
 */

export interface RecordingColumn {
  /** Every chunk `StreamController` was handed, in order. */
  readonly chunks: StreamChunk[];
  /** Every piece of assistant text appended to the column, in order. */
  readonly drawn: string[];
  /** Every piece of reasoning text appended to the column, in order. */
  readonly thought: string[];
  readonly state: ChatStreamingCursor;
}

export interface ChatProjectionHarness {
  readonly column: RecordingColumn;
  readonly composition: ChatExecutionComposition;
  /** The vault's record store, for reading back what the barrier wrote. */
  readonly sessions: SessionStorage;
  readonly tab: ChatTabExecution;
  close(): Promise<void>;
  /** The half of the surface's post-turn save this path still leaves to it. */
  saveAfterTurn(): Promise<void>;
}

export interface ChatProjectionHarnessOptions {
  /** The kernel. `ExecutionKernelHost.registry` satisfies it. */
  readonly lifecycle: ChatExecutionLifecyclePort;
  /** The provider runtime this tab encodes and presents with. */
  readonly runtime: ExecutionChatRuntimeAdapter;
  readonly providerId: ProviderId;
  readonly backendId: ExecutionBackendId;
  readonly conversationId: string;
  /**
   * The vault this tab reads and writes, when a row needs it to outlive the tab.
   *
   * A reload is a new kernel, a new composition and a new tab over the *same*
   * vault, so a row that certifies one has to hand the vault across. Left out,
   * each harness gets its own.
   */
  readonly vaultAdapter?: ReturnType<typeof createDurableInMemoryVaultAdapter>;
  /**
   * Whether to tell the runtime which conversation this tab is showing.
   *
   * What `ConversationController` does when a conversation is opened, and it is
   * path-independent — a blank tab's first turn syncs on neither path. Off by
   * default so a harness says which of the two it is exercising.
   */
  readonly syncConversation?: boolean;
}

/**
 * A column that records what it was asked to draw.
 *
 * The operations are the ones `StreamController` and `MessageRenderer` perform
 * today, in the order the render target performs them.
 */
export function recordingColumn(
  runtime: ExecutionChatRuntimeAdapter,
  providerId: ProviderId,
) {
  const chunks: StreamChunk[] = [];
  const drawn: string[] = [];
  const thought: string[] = [];
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
    chunks,
    drawn,
    state,
    thought,
    binding: {
      state,
      renderer: {
        addMessage: () => element as unknown as HTMLElement,
        renderMessages: () => element as unknown as HTMLElement,
      } as unknown as ChatMessageOperations,
      stream: {
        handleStreamChunk: (chunk: StreamChunk) => {
          chunks.push(chunk);
          return Promise.resolve();
        },
        appendText: (text: string) => {
          drawn.push(text);
          return Promise.resolve();
        },
        appendThinking: (content: string) => {
          thought.push(content);
          return Promise.resolve();
        },
        finalizeCurrentTextBlock: () => Promise.resolve(),
        finalizeCurrentThinkingBlock: () => Promise.resolve(),
        flushPendingToolsForPermission: () => undefined,
        showThinkingIndicator: () => undefined,
        hideThinkingIndicator: () => undefined,
        startTurnSilenceIndicator: () => undefined,
        pauseTurnSilenceIndicator: () => undefined,
        stopTurnSilenceIndicator: () => undefined,
      } as unknown as ChatStreamOperations,
      // Read through the runtime and filtered by the same rule, because
      // `tabProjectionExecution` is what this stands in for: a copy that left
      // the filter out drew `user_message_start` into the column on the first
      // Codex run and reported it as a finding about the product.
      presentProviderContent: (payload: unknown) => (
        runtime.surfacePorts.presentProviderContent?.(payload) ?? []
      ).filter(isChatContent),
      createAssistantMessage: (messageId: string): ChatMessage => ({
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [],
        contentBlocks: [],
      }),
      describeTerminal: (terminal: RunTerminal) => (
        runtime.surfacePorts.describeFailure?.(terminal.reason)
        ?? describeRunFailure(terminal.reason)
      ),
      getGreeting: () => '',
      getProviderId: () => providerId,
      updateQueueIndicator: () => undefined,
      setTitle: () => undefined,
    },
  };
}

/** Opens one tab on one conversation, over a vault this harness owns. */
export async function openChatProjection(
  options: ChatProjectionHarnessOptions,
): Promise<ChatProjectionHarness> {
  const adapter = options.vaultAdapter ?? createDurableInMemoryVaultAdapter();
  const sessions = new SessionStorage(adapter, new VaultDurableStorage(adapter));
  const composition = new ChatExecutionComposition({
    lifecycle: options.lifecycle,
    conversations: new StoredChatConversations({
      repository: sessions.records,
      projection: sessions,
      defaultProviderId: options.providerId,
    }),
  });
  const conversation = {
    id: options.conversationId,
    providerId: options.providerId,
    title: 'New conversation',
    createdAt: 1,
    updatedAt: 1,
    sessionId: null,
    messages: [],
  };
  // A reload opens the conversation it already has; a fresh vault makes one.
  const existing = await sessions.records.read(options.conversationId);
  if (existing.kind !== 'present') {
    await sessions.records.save(conversation, null);
  }
  if (options.syncConversation) {
    options.runtime.syncConversationState(
      existing.kind === 'present'
        ? { ...conversation, ...existing.metadata }
        : conversation,
    );
  }

  const column = recordingColumn(options.runtime, options.providerId);
  const tab = new ChatTabExecution({
    composition,
    providerId: options.providerId,
    backendId: options.backendId,
    surface: column.binding,
    turnEncoder: () => options.runtime.turnEncoder,
    createConversation: async () => options.conversationId,
    nextCommandId: () => `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await tab.open(options.conversationId);

  return {
    column,
    composition,
    sessions,
    tab,
    close: async () => {
      tab.detach();
      composition.dispose();
    },
    /**
     * What the surface writes *after* a turn, which the barrier does not.
     *
     * `InputController` runs `ConversationController.save` in its `finally`
     * block on both paths, and that is where a provider's own session binding
     * reaches the conversation — the barrier writes the answer, not the thread.
     * A harness that stops at the barrier reports a conversation with no
     * session and reads like a flip that lost session resume; the first Codex
     * run did exactly that.
     */
    saveAfterTurn: async () => {
      const { updates } = options.runtime.buildSessionUpdates({
        conversation: { id: options.conversationId },
        sessionInvalidated: false,
      });
      await sessions.records.apply(options.conversationId, current => ({
        ...current,
        ...updates,
        messages: [...column.state.messages],
        ...(column.state.usage ? { usage: column.state.usage } : {}),
      }));
    },
  };
}

/** A user message as the surface builds one, before the provider composes it. */
export function userMessage(text: string): ChatMessage {
  const timestamp = Date.now();
  return {
    id: `user-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: text,
    displayContent: text,
    timestamp,
    completedAt: timestamp,
  };
}
