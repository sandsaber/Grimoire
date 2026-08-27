import type { ProviderCommandDescriptor } from '../../../core/providers/ProviderModule';
import type { BoundConversation } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { Conversation } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import type { ClaudeWorkspaceContext } from '../ClaudeProviderModule';
import type { ClaudeRewindResult } from '../execution/ClaudeExecutionBackend';
import { ClaudeConversationHistoryService } from '../history/ClaudeConversationHistoryService';
import { getClaudeModelOptions } from '../modelOptions';
import { claudePlanUsageStore } from './ClaudePlanUsageStore';
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
  const history = new ClaudeConversationHistoryService();

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
    readPlanUsage: async () => {
      const usage = claudePlanUsageStore.getCachedUsage({
        plugin,
        providerId: 'claude',
        settings: plugin.settings,
      });
      return usage ? { label: usage.plan } : null;
    },
    resolveCliPath: async () => plugin.getResolvedProviderCliPath('claude'),
    listCommands: async () => {
      const catalog = maybeGetClaudeWorkspaceServices()?.commandCatalog;
      // Built-ins included: for Claude a slash command is as much the CLI's own
      // as a vault file, and the dropdown offers both.
      const entries = await catalog?.listDropdownEntries({ includeBuiltIns: true }) ?? [];
      return entries.map((entry): ProviderCommandDescriptor => ({
        name: entry.name,
        ...(entry.description ? { description: entry.description } : {}),
        source: entry.source === 'builtin' ? 'built-in' : 'project',
      }));
    },
    // The commands a live session announces are the runtime's, and this context
    // is not bound to one. Claude announces none: its command inventory is the
    // catalog above, which is why the capability says `static`.
    listSessionCommands: async () => [],
    listAgentMentions: async () => {
      const mentions = maybeGetClaudeWorkspaceServices()?.agentMentionProvider;
      // An empty query is how the mention UI asks a provider for everything it
      // knows; the provider owns what matching means.
      return (mentions?.searchAgents('') ?? []).map(agent => ({
        id: agent.id,
        label: agent.name,
        ...(agent.description ? { description: agent.description } : {}),
      }));
    },
    refreshAgentMentions: async () => {
      await maybeGetClaudeWorkspaceServices()?.refreshAgentMentions?.();
    },
    listModels: async () => claudeModels(plugin),
    refreshModels: async () => {
      const catalog = maybeGetClaudeWorkspaceServices()?.modelCatalog;
      await catalog?.refreshModels({ plugin, settings: plugin.settings });
      return claudeModels(plugin);
    },
    loadMcpServers: async () => {
      const stored = await maybeGetClaudeWorkspaceServices()?.mcpStorage?.load() ?? [];
      return stored.map(server => ({
        id: server.name,
        label: server.name,
        enabled: server.enabled,
      }));
    },
    saveMcpServers: async servers => {
      const storage = maybeGetClaudeWorkspaceServices()?.mcpStorage;
      if (!storage) {
        return;
      }
      // The port carries identity and enablement; everything else about a
      // server — its command, its transport, its disabled tools — is the
      // stored record's, and a save that rebuilt the record from three fields
      // would erase it.
      const stored = await storage.load();
      const enabled = new Map(servers.map(server => [server.id, server.enabled]));
      await storage.save(stored.map(server => (
        enabled.has(server.name)
          ? { ...server, enabled: enabled.get(server.name) as boolean }
          : server
      )));
    },
    renderSettingsTab: () => {
      void notWired('renderSettingsTab');
    },
    dispose: async () => {
      // Nothing is created here that outlives a turn: the history service and
      // the interpreter are stateless readers, and every other service reached
      // above is owned by the workspace registration.
    },
  };
}

/**
 * The models the settings and the picker offer, as the module's slot describes
 * them. Nothing without a workspace: an unregistered workspace has discovered
 * no models, and inventing the built-ins would list a model the user cannot
 * have chosen.
 */
function claudeModels(plugin: GrimoirePlugin): readonly { id: string; label: string }[] {
  if (!maybeGetClaudeWorkspaceServices()) {
    return [];
  }
  return getClaudeModelOptions(plugin.settings).map(option => ({
    id: option.value,
    label: option.label,
  }));
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

function notWired(slot: string): Promise<never> {
  return Promise.reject(new Error(
    `Claude workspace slot "${slot}" is served by the legacy workspace registration, `
    + 'not by this context.',
  ));
}
