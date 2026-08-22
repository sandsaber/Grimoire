import type { BoundConversation } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { Conversation } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { KimicodeConversationHistoryService } from '@/providers/kimicode/history/KimicodeConversationHistoryService';
import type { KimicodeWorkspaceContext } from '@/providers/kimicode/KimicodeProviderModule';
import { getKimicodeState } from '@/providers/kimicode/types';
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
export type KimicodeBoundConversation = () => BoundConversation | null;

/**
 * The module's context over the running plugin, for the runtime's features.
 *
 * Only the history slots are wired. Kimi Code's workspace is still registered
 * the legacy way through `KimicodeWorkspaceServices`, and moving it is a later
 * checkpoint — so the rest throw by name rather than answering emptily, because
 * a settings surface that silently lists nothing is worse than one that fails
 * where it was wired.
 */
export interface KimicodeModuleContextPorts {
  /**
   * The database the last launch resolved for this tab, which is what the
   * conversation is saved pointing at.
   */
  readonly databasePath: () => string | null;
}

export function createKimicodeModuleContext(
  plugin: GrimoirePlugin,
  conversation: KimicodeBoundConversation,
  ports: KimicodeModuleContextPorts,
): KimicodeWorkspaceContext {
  const history = new KimicodeConversationHistoryService();

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
    readDatabasePath: conversationId => {
      const bound = matching(conversation, conversationId);
      if (!bound) {
        return null;
      }
      // What this tab's last launch resolved comes first; the conversation's
      // own is what a tab that has not launched yet still knows.
      return ports.databasePath() ?? getKimicodeState(bound.providerState).databasePath ?? null;
    },
    listCommands: () => notWired('listCommands'),
    listSessionCommands: () => notWired('listSessionCommands'),
    listAgentMentions: () => notWired('listAgentMentions'),
    refreshAgentMentions: () => notWired('refreshAgentMentions'),
    resolveCliPath: () => notWired('resolveCliPath'),
    listModels: () => notWired('listModels'),
    refreshModels: () => notWired('refreshModels'),
    readPlanUsage: () => notWired('readPlanUsage'),
    loadMcpServers: () => notWired('loadMcpServers'),
    saveMcpServers: () => notWired('saveMcpServers'),
    startMcpServer: () => notWired('startMcpServer'),
    stopMcpServer: () => notWired('stopMcpServer'),
    shouldKeepWarm: () => false,
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
  conversation: KimicodeBoundConversation,
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
    `Kimi Code workspace slot "${slot}" is served by the legacy workspace registration, `
    + 'not by this context.',
  ));
}
