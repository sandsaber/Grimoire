import type { BoundConversation } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { Conversation } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { maybeGetMimocodeWorkspaceServices } from '@/providers/mimocode/app/MimocodeWorkspaceServices';
import { MimocodeConversationHistoryService } from '@/providers/mimocode/history/MimocodeConversationHistoryService';
import type { MimocodeWorkspaceContext } from '@/providers/mimocode/MimocodeProviderModule';
import { getMimocodeState } from '@/providers/mimocode/types';
import { mimocodeChatUIConfig } from '@/providers/mimocode/ui/MimocodeChatUIConfig';
import { createWorkspaceContextSlots } from '@/providers/shared/workspaceContextSlots';
import { getVaultPath } from '@/utils/path';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';

/**
 * What one tab's conversation is, read when it is asked for.
 *
 * The module's history contribution is asked about a conversation *id*, and the
 * only conversation a runtime can answer for is its own — the one the adapter
 * syncs into it. An id that is not this tab's gets nothing rather than a lookup
 * across the workspace, which would answer for a conversation this runtime does
 * not serve.
 */
export type MimocodeBoundConversation = () => BoundConversation | null;

/**
 * The module's context over the running plugin, for the runtime's features.
 *
 * Only the history slots are wired. MiMoCode's workspace is still registered
 * the legacy way through `MimocodeWorkspaceServices`, and moving it is a later
 * checkpoint — so the rest throw by name rather than answering emptily, because
 * a settings surface that silently lists nothing is worse than one that fails
 * where it was wired.
 */
export interface MimocodeModuleContextPorts {
  /**
   * The database the last launch resolved for this tab, which is what the
   * conversation is saved pointing at.
   */
  readonly databasePath: () => string | null;
}

export function createMimocodeModuleContext(
  plugin: GrimoirePlugin,
  conversation: MimocodeBoundConversation,
  ports: MimocodeModuleContextPorts,
): MimocodeWorkspaceContext {
  const history = new MimocodeConversationHistoryService();
  const workspace = createWorkspaceContextSlots({
    chatUI: mimocodeChatUIConfig,
    plugin,
    providerId: 'mimocode',
    services: () => maybeGetMimocodeWorkspaceServices(),
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
    readDatabasePath: conversationId => {
      const bound = matching(conversation, conversationId);
      if (!bound) {
        return null;
      }
      // What this tab's last launch resolved comes first; the conversation's
      // own is what a tab that has not launched yet still knows.
      return ports.databasePath() ?? getMimocodeState(bound.providerState).databasePath ?? null;
    },
    ...workspace,
    // The commands a live session announces need that session, and this
    // context is not bound to one. The row that owns them takes a runtime; its
    // slot takes a session id, which is the reshape that closes this.
    listSessionCommands: () => notWired('listSessionCommands'),
    renderSettingsTab: host => {
      const rendered = host as {
        container: HTMLElement;
        context: Parameters<ProviderSettingsTabRenderer['render']>[1];
      };
      maybeGetMimocodeWorkspaceServices()?.settingsTabRenderer
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
  conversation: MimocodeBoundConversation,
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
    `MiMoCode workspace slot "${slot}" is served by the legacy workspace registration, `
    + 'not by this context.',
  ));
}
