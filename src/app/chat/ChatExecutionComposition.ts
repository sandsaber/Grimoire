import { randomUUID } from 'node:crypto';

import type { ExecutionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  executionSessionId,
  lifecycleLeaseId,
  type RunId,
  runId,
} from '@/core/execution/ExecutionIds';
import type { ChatTurnEncoder } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatRuntimeQueryOptions, ChatTurnRequest } from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import {
  type ChatConversationPort,
  ChatExecutionCoordinator,
  type ChatExecutionLifecyclePort,
  type ChatTurnTicket,
} from '@/features/chat/application/ChatExecutionCoordinator';
import {
  ChatProjectionAttachment,
  type ChatProjectionSink,
} from '@/features/chat/application/ChatProjectionAttachment';
import { ChatProjectionRenderer } from '@/features/chat/rendering/ChatProjectionRenderer';
import {
  ChatSurfaceRenderTarget,
  type ChatSurfaceRenderTargetDeps,
} from '@/features/chat/rendering/ChatSurfaceRenderTarget';

/**
 * The chat execution path, assembled.
 *
 * **One coordinator, many surfaces.** A conversation's projection belongs to the
 * conversation and not to whoever is looking at it: two tabs open on one chat,
 * or a tab and the window beside it, must see one turn rather than two, and the
 * coordinator's entries are keyed by conversation for exactly that. So this is
 * constructed once beside the kernel, and a surface asks it for a binding.
 *
 * What a surface brings is what only it knows — its own column, its own
 * streaming cursor, its provider's content presenter and failure wording. What
 * this brings is everything that must be the same for every surface: the
 * coordinator, the identities, and the route by which a turn's cost gets back to
 * the barrier that persists it.
 *
 * Dark: nothing constructs one. It is what the flip calls.
 */

export interface ChatExecutionCompositionOptions {
  /** The kernel. `ExecutionLifecycleRegistry` satisfies it. */
  readonly lifecycle: ChatExecutionLifecyclePort;
  readonly conversations: ChatConversationPort;
  readonly now?: () => number;
}

/** What a surface brings that only it knows. */
export type ChatSurfaceBinding = Omit<ChatSurfaceRenderTargetDeps, 'recordTurnUsage'>;

export class ChatExecutionComposition {
  readonly coordinator: ChatExecutionCoordinator;

  constructor(options: ChatExecutionCompositionOptions) {
    this.coordinator = new ChatExecutionCoordinator({
      lifecycle: options.lifecycle,
      conversations: options.conversations,
      nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
      nextRunId: () => runId(opaqueId('run')),
      nextLeaseId: () => lifecycleLeaseId(opaqueId('lease')),
      // Derived from the run rather than minted freshly, so the same turn is
      // the same message whoever asks — including a coordinator rebuilt after a
      // reload, which adopts a run it never dispatched and has to name the
      // answer that run is still producing.
      assistantMessageIdForRun: (forRunId: RunId) => `assistant-${forRunId}`,
      ...(options.now ? { now: options.now } : {}),
    });
  }

  /**
   * Builds one surface's view of the path: a target, a renderer over it, and an
   * attachment that has not been opened yet.
   *
   * Unopened on purpose — the caller decides which conversation, and can close
   * the tab before that decision resolves.
   */
  bindSurface(surface: ChatSurfaceBinding): ChatProjectionAttachment {
    const target = new ChatSurfaceRenderTarget({
      ...surface,
      recordTurnUsage: (forRunId, usage) => {
        this.coordinator.recordTurnUsage(forRunId, usage);
      },
    });
    const renderer: ChatProjectionSink = new ChatProjectionRenderer(target);
    return new ChatProjectionAttachment(renderer);
  }

  /**
   * Sends one message, in the provider's own terms.
   *
   * The four things the presentation adapter did on the way to a turn, kept
   * together because each was found by reading it rather than by writing this:
   *
   * - **the history excludes the turn being sent.** The legacy path passes
   *   `messages.slice(0, -2)` — everything but the user message and the
   *   assistant placeholder it just added — so the reference is encoded before
   *   the coordinator appends anything, from the conversation as it stands;
   * - **what is persisted is what the provider composed**, not what was typed.
   *   `persistedContent` is the prompt the provider will actually send, and the
   *   original input stays on `displayContent` where the surface renders it;
   * - **a compacting turn keeps no note**, because the note belongs to a
   *   message and a compaction is not one;
   * - **a compacting turn expects no result**, which is a rule of the adapter's
   *   rather than of any provider's: `isCompact` is a property of any prepared
   *   turn, and without it a compaction that did exactly what was asked ends as
   *   a failure for producing no answer.
   */
  async submitTurn(command: SubmitChatMessageCommand): Promise<ChatTurnTicket> {
    const conversation = await this.coordinator.loadConversation(command.conversationId);
    const prepared = command.encoder.prepareTurn(command.request);
    const requestRef = command.encoder.encodeRequestRef(
      prepared,
      [...conversation.messages],
      command.queryOptions,
    );
    return this.coordinator.submitTurn({
      commandId: command.commandId,
      conversationId: command.conversationId,
      backendId: command.backendId,
      requestRef,
      resultExpectation: prepared.isCompact
        ? 'none'
        : command.encoder.resultExpectation?.(prepared) ?? 'required',
      userMessage: {
        ...command.userMessage,
        content: prepared.persistedContent,
        ...(prepared.isCompact || !prepared.request.currentNotePath
          ? {}
          : { currentNote: prepared.request.currentNotePath }),
      },
      ...(command.nativeSessionRef ? { nativeSessionRef: command.nativeSessionRef } : {}),
      ...(command.resumeCheckpoint ? { resumeCheckpoint: command.resumeCheckpoint } : {}),
    });
  }

  dispose(): void {
    this.coordinator.dispose();
  }
}

export interface SubmitChatMessageCommand {
  readonly commandId: string;
  readonly conversationId: string;
  readonly backendId: ExecutionBackendId;
  /** The provider's own three steps from a message to a dispatchable turn. */
  readonly encoder: ChatTurnEncoder;
  readonly request: ChatTurnRequest;
  /**
   * The message the surface built: its id, its images, and the text as typed.
   *
   * Its `content` is replaced by what the provider composed; everything else is
   * the surface's, because only it knows what a person actually attached.
   */
  readonly userMessage: ChatMessage;
  readonly queryOptions?: ChatRuntimeQueryOptions;
  readonly nativeSessionRef?: string;
  readonly resumeCheckpoint?: string;
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}
