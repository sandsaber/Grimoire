import { createRealChatColumn, type RealChatColumn } from '@test/helpers/chat/realChatColumn';
import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { ChatExecutionComposition } from '@/app/chat/ChatExecutionComposition';
import { ChatTabExecution } from '@/app/chat/ChatTabExecution';
import { StoredChatConversations } from '@/app/chat/StoredChatConversations';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { SessionStorage } from '@/core/bootstrap/SessionStorage';
import type { ExecutionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { RunTerminal } from '@/core/execution/ExecutionContracts';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { describeRunFailure } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatMessage } from '@/core/types';
import type { ProviderId } from '@/core/types/provider';
import type { ChatExecutionLifecyclePort } from '@/features/chat/application/ChatExecutionCoordinator';
import { isChatContent } from '@/features/chat/rendering/chatContentChunks';

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
 * the same envelope a vault in the field holds.
 *
 * **The column is the real one now.** It used to be a double that recorded the
 * operations it was asked for and did none of them, which made every row here a
 * statement about what the surface was *told* to do. That is one layer above
 * where the answer is assembled: `StreamController` is what turns those calls
 * into the content blocks a conversation is stored and redrawn from, and with
 * it stubbed a turn could cut an answer into one block per delta on every
 * provider without a single row noticing. So the controller, the `ChatState`
 * and the `SubagentManager` are the production ones, wired as `Tab.ts` wires
 * them, and what stays doubled is Obsidian — the elements, the markdown
 * renderer and the vault. See `tests/helpers/chat/realChatColumn.ts`.
 */

export type RecordingColumn = RealChatColumn;

export interface ChatProjectionSurface {
  readonly column: RecordingColumn;
  readonly tab: ChatTabExecution;
}

export interface ChatProjectionHarness {
  readonly column: RecordingColumn;
  readonly composition: ChatExecutionComposition;
  /** The vault's record store, for reading back what the barrier wrote. */
  readonly sessions: SessionStorage;
  readonly tab: ChatTabExecution;
  /**
   * A second surface on the same conversation, over the same composition.
   *
   * What two tabs open on one chat are, and the shape the projection was built
   * for: the run belongs to the conversation, not to whoever started it, so a
   * second surface attaches to the projection and draws the same turn. Built
   * here because it is the same assembly as the first — a copy of it in one
   * provider's file would be a second opinion about what a surface is.
   *
   * Released with the harness.
   */
  openSurface(): Promise<ChatProjectionSurface>;
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
   * The working directory the provider was launched in.
   *
   * The column makes a written file's path relative to it, which is the one
   * thing the real controller asks the Obsidian vault for.
   */
  readonly vaultPath?: string;
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
 * The tab's column, over the controller that actually draws one.
 *
 * The operations are the ones `StreamController` and `MessageRenderer` perform
 * today, in the order the render target performs them — and the first of those
 * two is real here, so what a row reads is what the column holds rather than
 * what it was asked for.
 */
export function recordingColumn(
  runtime: ExecutionChatRuntimeAdapter,
  providerId: ProviderId,
  vaultPath?: string,
) {
  const column = createRealChatColumn({
    providerId,
    // The tab's runtime, which the controller asks for the provider a chunk
    // belongs to and the model a usage report is against.
    getAgentService: () => runtime,
    ...(vaultPath ? { vaultPath } : {}),
  });
  return {
    column,
    binding: {
      state: column.state,
      renderer: column.renderer,
      stream: column.stream,
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

  /** Every surface this harness opened, so releasing it releases all of them. */
  const surfaces: ChatProjectionSurface[] = [];
  /** One tab's end of the path — the first, and every one a row opens after it. */
  const openSurface = async (): Promise<ChatProjectionSurface> => {
    const { binding, column } = recordingColumn(
      options.runtime,
      options.providerId,
      options.vaultPath,
    );
    const tab = new ChatTabExecution({
      composition,
      providerId: options.providerId,
      backendId: options.backendId,
      surface: binding,
      turnEncoder: () => options.runtime.turnEncoder,
      // Read through the runtime, exactly as `tabProjectionExecution` does. A
      // harness without this is a harness where every provider that stops to ask
      // hangs — which is how the defect this seam exists for was first seen, and
      // would be how a fixed one still looked.
      interactionPresenter: () => options.runtime.surfacePorts.interactionPresenter ?? null,
      createConversation: async () => options.conversationId,
      nextCommandId: () => `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    });
    await tab.open(options.conversationId);
    surfaces.push({ column, tab });
    return { column, tab };
  };
  const { column, tab } = await openSurface();

  return {
    column,
    composition,
    sessions,
    tab,
    openSurface,
    close: async () => {
      for (const surface of surfaces) {
        surface.tab.detach();
        // The controller keeps a turn's timers — the silence heartbeat, a
        // pending render frame — and a real one left running outlives the test
        // that started it.
        surface.column.dispose();
      }
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
     *
     * The same `finally` block closes the open thinking and text blocks first,
     * and it is the only thing that closes the *last* block of an answer —
     * neither `endTurn` nor `finishTurn` does. Saving without it stores an
     * answer missing its final block.
     */
    saveAfterTurn: async () => {
      await column.closeOpenBlocks();
      const updates = options.runtime.sessionBinding({
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
