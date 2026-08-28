import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import type { BoundConversation } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { Conversation } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { createWorkspaceContextSlots } from '../../shared/workspaceContextSlots';
import type { ClaudeWorkspaceContext } from '../ClaudeProviderModule';
import type { ClaudeRewindResult } from '../execution/ClaudeExecutionBackend';
import { ClaudeConversationHistoryService } from '../history/ClaudeConversationHistoryService';
import { claudeChatUIConfig } from '../ui/ClaudeChatUIConfig';
import { maybeGetClaudeWorkspaceServices } from './ClaudeWorkspaceServices';

/**
 * What one tab's conversation is, read when it is asked for.
 *
 * The module's history contribution is asked about a conversation *id*, and the
 * only conversation a runtime can answer for is its own — the one the adapter
 * syncs into it. An id that is not this tab's gets nothing rather than a lookup
 * across the workspace, which would answer for a conversation this runtime does
 * not serve.
 */
export type ClaudeBoundConversation = () => BoundConversation | null;

export interface ClaudeModuleContextPorts {
  /** The execution session a rewind runs against, when this tab has one. */
  readonly executionSessionId: () => string | null;
  /** The backend's rewind, which owns the SDK query the files are restored by. */
  readonly rewind: (input: {
    readonly executionSessionId: string;
    readonly userMessageId: string;
    readonly assistantMessageId: string;
    readonly mode: 'conversation' | 'code-and-conversation';
  }) => Promise<ClaudeRewindResult>;
}

/**
 * The module's context over the running plugin, for the runtime's features.
 *
 * Everything the adapter reads through `claudeProviderModule.runtimePorts(...)` is
 * wired here from services that already exist. The workspace slots are not:
 * Claude's workspace is still registered the legacy way through
 * `ClaudeWorkspaceServices`, and its flip is a separate checkpoint — so they
 * throw by name rather than answering emptily, because a settings surface that
 * silently lists nothing is worse than one that fails where it was wired.
 */
export function createClaudeModuleContext(
  plugin: GrimoirePlugin,
  conversation: ClaudeBoundConversation,
  ports: ClaudeModuleContextPorts,
): ClaudeWorkspaceContext {
  // The config dir comes from the plugin's configured Claude environment, which
  // this has and the history service does not — so it is passed rather than
  // looked up. See the constructor for what looking it up cost.
  const history = new ClaudeConversationHistoryService(
    () => maybeGetClaudeWorkspaceServices()?.getClaudeConfigDir?.(),
  );
  const workspace = createWorkspaceContextSlots({
    chatUI: claudeChatUIConfig,
    plugin,
    providerId: 'claude',
    services: () => maybeGetClaudeWorkspaceServices(),
  });

  return {
    claudeConfigDir: () => maybeGetClaudeWorkspaceServices()?.getClaudeConfigDir?.(),
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
    rewind: async input => {
      const executionSessionId = ports.executionSessionId();
      if (!executionSessionId) {
        return { outcome: 'unavailable', reason: 'This conversation has no active Claude session.' };
      }
      const result = await ports.rewind({
        executionSessionId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        mode: input.mode,
      });
      if (!result.canRewind) {
        // `unavailable` and `failed` are different facts, and the backend
        // reports the second as an error message: a rewind the SDK refused is
        // not a rewind that broke.
        return result.error
          ? { outcome: 'failed', reason: result.error }
          : { outcome: 'unavailable', reason: 'The SDK cannot rewind to this message.' };
      }
      return { outcome: 'rewound', filesChanged: [...(result.filesChanged ?? [])] };
    },
    // Assembled from what the interpreter can actually read off a subagent's
    // result, rather than invented: the agent it belongs to, the structured
    // text it carried, and whether the SDK ended it as an error.
    ...workspace,
    // Claude announces no commands from a live session: its inventory is the
    // catalog above, which is what the `static` command-discovery capability
    // says.
    listSessionCommands: async () => [],
    renderSettingsTab: host => {
      const rendered = host as {
        container: HTMLElement;
        context: Parameters<ProviderSettingsTabRenderer['render']>[1];
      };
      maybeGetClaudeWorkspaceServices()?.settingsTabRenderer
        ?.render(rendered.container, rendered.context);
    },
    dispose: async () => {
      // Nothing is created here that outlives a turn: the history service and
      // the interpreter are stateless readers, and every other service reached
      // above is owned by the workspace registration.
    },
  };
}

/** This tab's conversation, when the question is about it. */
function matching(
  conversation: ClaudeBoundConversation,
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

