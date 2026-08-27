import type { BoundConversation } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { Conversation } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { maybeGetGrokWorkspaceServices } from '@/providers/grok/app/GrokWorkspaceServices';
import type { GrokWorkspaceContext } from '@/providers/grok/GrokProviderModule';
import { GrokConversationHistoryService } from '@/providers/grok/history/GrokConversationHistoryService';
import { getGrokState } from '@/providers/grok/types';
import { grokChatUIConfig } from '@/providers/grok/ui/GrokChatUIConfig';
import { createWorkspaceContextSlots } from '@/providers/shared/workspaceContextSlots';
import { getVaultPath } from '@/utils/path';

/**
 * What one tab's conversation is, read when it is asked for.
 *
 * The module's history contribution is asked about a conversation *id*, and the
 * only conversation a runtime can answer for is its own — the one the adapter
 * syncs into it. An id that is not this tab's gets nothing rather than a lookup
 * across the workspace, which would answer for a conversation this runtime does
 * not serve.
 */
export type GrokBoundConversation = () => BoundConversation | null;

export interface GrokModuleContextPorts {
  /**
   * Where this tab's last session wrote its transcript, and the workspace it
   * was recorded against.
   *
   * Grok's history hydration and its usage fallback both read that directory,
   * and the conversation is saved pointing at it.
   */
  readonly sessionPaths: () => {
    readonly sessionDirPath?: string;
    readonly workspacePath?: string;
  };
}

/**
 * The module's context over the running plugin, for the runtime's features.
 *
 * Only the history slots are wired. Grok's workspace is still registered the
 * legacy way through `GrokWorkspaceServices`, and moving it is a later
 * checkpoint — so the rest throw by name rather than answering emptily, because
 * a settings surface that silently lists nothing is worse than one that fails
 * where it was wired.
 */
export function createGrokModuleContext(
  plugin: GrimoirePlugin,
  conversation: GrokBoundConversation,
  ports: GrokModuleContextPorts,
): GrokWorkspaceContext {
  const history = new GrokConversationHistoryService();
  const workspace = createWorkspaceContextSlots({
    chatUI: grokChatUIConfig,
    includeBuiltInCommands: true,
    plugin,
    providerId: 'grok',
    services: () => maybeGetGrokWorkspaceServices(),
  });

  return {
    hydrateConversation: async conversationId => {
      const bound = matching(conversation, conversationId);
      if (!bound) {
        return { outcome: 'absent' };
      }
      await history.hydrateConversationHistory(bound, getVaultPath(plugin.app));
      return { outcome: 'complete' };
    },
    deleteConversationSession: async conversationId => {
      const bound = matching(conversation, conversationId);
      if (bound) {
        await history.deleteConversationSession(bound, getVaultPath(plugin.app));
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
    readSessionPaths: conversationId => {
      const bound = matching(conversation, conversationId);
      if (!bound) {
        return {};
      }
      // What this tab's live session resolved comes first; what the
      // conversation already carries is what a tab that has not run a turn yet
      // still knows.
      const live = ports.sessionPaths();
      const saved = getGrokState(bound.providerState);
      const sessionDirPath = live.sessionDirPath ?? saved.sessionDirPath;
      const workspacePath = live.workspacePath ?? saved.workspacePath;
      return {
        ...(sessionDirPath ? { sessionDirPath } : {}),
        ...(workspacePath ? { workspacePath } : {}),
      };
    },
    ...workspace,
    // The commands a live session announces need that session, and this
    // context is not bound to one. The row that owns them takes a runtime; its
    // slot takes a session id, which is the reshape that closes this.
    listSessionCommands: () => notWired('listSessionCommands'),
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
  conversation: GrokBoundConversation,
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
    `Grok workspace slot "${slot}" is served by the legacy workspace registration, `
    + 'not by this context.',
  ));
}
