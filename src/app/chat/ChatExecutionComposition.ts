import { randomUUID } from 'node:crypto';

import {
  executionSessionId,
  lifecycleLeaseId,
  type RunId,
  runId,
} from '@/core/execution/ExecutionIds';
import {
  type ChatConversationPort,
  ChatExecutionCoordinator,
  type ChatExecutionLifecyclePort,
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

  dispose(): void {
    this.coordinator.dispose();
  }
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}
