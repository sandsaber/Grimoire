import type { ProviderCommandDescriptor } from '@/core/providers/ProviderModule';
import type { BoundConversation } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { Conversation } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { maybeGetQwenWorkspaceServices } from '@/providers/qwen/app/QwenWorkspaceServices';
import { QwenConversationHistoryService } from '@/providers/qwen/history/QwenConversationHistoryService';
import type { QwenWorkspaceContext } from '@/providers/qwen/QwenProviderModule';
import { qwenChatUIConfig } from '@/providers/qwen/ui/QwenChatUIConfig';
import { createWorkspaceContextSlots } from '@/providers/shared/workspaceContextSlots';

import type {
  ProviderSettingsTabRenderer,
} from '../../../providers/shared/providerHostContracts';

/**
 * What one tab's conversation is, read when it is asked for.
 *
 * The module's history contribution is asked about a conversation *id*, and the
 * only conversation a runtime can answer for is its own — the one the adapter
 * syncs into it. An id that is not this tab's gets nothing rather than a lookup
 * across the workspace, which would answer for a conversation this runtime does
 * not serve.
 */
export type QwenBoundConversation = () => BoundConversation | null;

export interface QwenModuleContextPorts {
  /**
   * The commands the tab's open session announced.
   *
   * A port rather than a lookup, and the difference from Gemini's context: this
   * provider surfaces what a session offers, and only the tab holding that
   * session knows what it said.
   */
  readonly sessionCommands: () => readonly ProviderCommandDescriptor[];
}

/**
 * The module's context over the running plugin, for the runtime's features.
 *
 * Only the history slots and the session commands are wired. Qwen's workspace is
 * still registered the legacy way through `QwenWorkspaceServices`, and moving it
 * is a later checkpoint — so the rest throw by name rather than answering
 * emptily, because a settings surface that silently lists nothing is worse than
 * one that fails where it was wired.
 */
export function createQwenModuleContext(
  plugin: GrimoirePlugin,
  conversation: QwenBoundConversation,
  ports: QwenModuleContextPorts,
): QwenWorkspaceContext {
  const history = new QwenConversationHistoryService();
  const workspace = createWorkspaceContextSlots({
    chatUI: qwenChatUIConfig,
    plugin,
    providerId: 'qwen',
    services: () => maybeGetQwenWorkspaceServices(plugin),
  });

  return {
    /**
     * Nothing to hydrate, which is this provider's own answer and Gemini's.
     *
     * `capabilities.ts` declares `supportsNativeHistory: false`: Qwen keeps no
     * transcript Grimoire can read a conversation back out of. `absent` is what
     * the conversation actually has, where a `complete` would tell the surface a
     * hydration happened.
     */
    hydrateConversation: async () => ({ outcome: 'absent' }),
    deleteConversationSession: async conversationId => {
      const bound = matching(conversation, conversationId);
      if (bound) {
        // Inert today — this provider has no session file to remove — and
        // called anyway, so the day it does the deletion is already wired.
        await history.deleteConversationSession(bound, null);
      }
    },
    // Answered from this tab's own conversation: these two are asked on every
    // turn, and the session a turn resumes is the one the tab is bound to.
    resolveSessionId: conversationId => {
      const bound = matching(conversation, conversationId);
      return bound ? history.resolveSessionIdForConversation(bound) : null;
    },
    isPendingFork: conversationId => {
      const bound = matching(conversation, conversationId);
      return bound ? history.isPendingForkConversation(bound) : false;
    },
    // The open session's own, which the catalog cannot know: they arrive as an
    // update rather than as an answer to anything.
    listSessionCommands: async () => ports.sessionCommands(),
    ...workspace,
    renderSettingsTab: host => {
      const rendered = host as {
        container: HTMLElement;
        context: Parameters<ProviderSettingsTabRenderer['render']>[1];
      };
      maybeGetQwenWorkspaceServices(plugin)?.settingsTabRenderer
        ?.render(rendered.container, rendered.context);
    },
    dispose: async () => {
      // Nothing here outlives a turn: the history service is a stateless
      // reader, and every other service reached above is owned by the
      // workspace registration.
    },
  };
}

/** This tab's conversation, when the question is about it. */
function matching(
  conversation: QwenBoundConversation,
  conversationId: string,
): Conversation | null {
  const bound = conversation();
  if (!bound || bound.id !== conversationId) {
    return null;
  }
  // The adapter's binding is the conversation, narrowed to what execution
  // needs; the history service reads the same fields off the whole one.
  return bound as unknown as Conversation;
}

