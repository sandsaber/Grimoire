import type { BoundConversation } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { Conversation } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { maybeGetGeminiWorkspaceServices } from '@/providers/gemini/app/GeminiWorkspaceServices';
import type { GeminiWorkspaceContext } from '@/providers/gemini/GeminiProviderModule';
import { GeminiConversationHistoryService } from '@/providers/gemini/history/GeminiConversationHistoryService';
import { geminiChatUIConfig } from '@/providers/gemini/ui/GeminiChatUIConfig';
import { createWorkspaceContextSlots } from '@/providers/shared/workspaceContextSlots';

/**
 * What one tab's conversation is, read when it is asked for.
 *
 * The module's history contribution is asked about a conversation *id*, and the
 * only conversation a runtime can answer for is its own — the one the adapter
 * syncs into it. An id that is not this tab's gets nothing rather than a lookup
 * across the workspace, which would answer for a conversation this runtime does
 * not serve.
 */
export type GeminiBoundConversation = () => BoundConversation | null;

/**
 * The module's context over the running plugin, for the runtime's features.
 *
 * Only the history slots are wired. Gemini's workspace is still registered the
 * legacy way through `GeminiWorkspaceServices`, and moving it is a later
 * checkpoint — so the rest throw by name rather than answering emptily, because
 * a settings surface that silently lists nothing is worse than one that fails
 * where it was wired.
 *
 * It takes no ports, which is the difference from every sibling's: the others
 * carry the launch's resolved database or managed home so the conversation can
 * be saved pointing at it. Gemini writes no such state — a session id is the
 * whole binding — so there is nothing for a port to answer.
 */
export function createGeminiModuleContext(
  plugin: GrimoirePlugin,
  conversation: GeminiBoundConversation,
): GeminiWorkspaceContext {
  const history = new GeminiConversationHistoryService();
  const workspace = createWorkspaceContextSlots({
    chatUI: geminiChatUIConfig,
    plugin,
    providerId: 'gemini',
    services: () => maybeGetGeminiWorkspaceServices(),
  });

  return {
    /**
     * Nothing to hydrate, and that is this provider's own answer.
     *
     * `capabilities.ts` declares `supportsNativeHistory: false`: Gemini keeps
     * no transcript Grimoire can read a conversation back out of, and the
     * service below is inert for exactly that reason. `absent` is what the
     * conversation actually has, where a `complete` would tell the surface a
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
    ...workspace,
    renderSettingsTab: () => {
      void notWired('renderSettingsTab');
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
  conversation: GeminiBoundConversation,
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

function notWired(slot: string): Promise<never> {
  return Promise.reject(new Error(
    `Gemini workspace slot "${slot}" is served by the legacy workspace registration, `
    + 'not by this context.',
  ));
}
