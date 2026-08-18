import type { ProviderCommandDescriptor } from '../../../core/providers/ProviderModule';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import type { BoundConversation } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { Conversation } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import type { CodexWorkspaceContext } from '../CodexProviderModule';
import { readCodexConversationBinding } from '../execution/CodexConversationBinding';
import { CodexConversationHistoryService } from '../history/CodexConversationHistoryService';
import { getCodexModelOptions } from '../modelOptions';
import { codexSubagentLifecycleAdapter } from '../normalization/codexSubagentNormalization';
import { codexPlanUsageStore } from './CodexPlanUsageStore';
import { maybeGetCodexWorkspaceServices } from './CodexWorkspaceServices';

/**
 * What one tab's conversation is, read when it is asked for.
 *
 * The module's history contribution is asked about a conversation *id*, and the
 * only conversation a runtime can answer for is its own — the one the adapter
 * syncs into it. An id that is not this tab's gets `null` rather than a lookup
 * across the workspace, which would answer for a conversation this runtime does
 * not serve.
 */
export type CodexBoundConversation = () => BoundConversation | null;

/**
 * The module's context over the running plugin.
 *
 * Everything here already exists as a provider-owned service; this is the
 * wiring that lets `codexProviderModule` reach it without taking a plugin
 * itself. The workspace services may be absent — before their registration, or
 * in a test — and every slot then answers as if the provider had nothing to
 * offer, which is what an unregistered workspace is.
 */
export function createCodexModuleContext(
  plugin: GrimoirePlugin,
  conversation: CodexBoundConversation,
): CodexWorkspaceContext {
  const history = new CodexConversationHistoryService();

  return {
    listSkills: async () => {
      const catalog = maybeGetCodexWorkspaceServices()?.commandCatalog;
      // The dropdown is the same list the composer offers, which is what a
      // provider command *is* for Codex: a vault skill, not a built-in.
      const entries = await catalog?.listDropdownEntries({ includeBuiltIns: false }) ?? [];
      return entries.map((entry): ProviderCommandDescriptor => ({
        name: entry.name,
        ...(entry.description ? { description: entry.description } : {}),
        source: 'project',
      }));
    },
    listAgentMentions: async () => {
      const mentions = maybeGetCodexWorkspaceServices()?.agentMentionProvider;
      // The provider searches; an empty query is how the mention UI asks for
      // everything it knows about.
      return (mentions?.searchAgents('') ?? []).map(agent => ({
        id: agent.id,
        label: agent.name,
        ...(agent.description ? { description: agent.description } : {}),
      }));
    },
    refreshAgentMentions: async () => {
      await maybeGetCodexWorkspaceServices()?.refreshAgentMentions?.();
    },
    resolveCliPath: async () => plugin.getResolvedProviderCliPath('codex'),
    listModels: async () => codexModels(plugin),
    refreshModels: async () => {
      const catalog = maybeGetCodexWorkspaceServices()?.modelCatalog;
      await catalog?.refreshModels({ plugin, settings: plugin.settings });
      return codexModels(plugin);
    },
    readPlanUsage: async () => {
      const usage = codexPlanUsageStore.getCachedUsage({
        plugin,
        providerId: 'codex',
        settings: plugin.settings,
      });
      // The store speaks plans and windows; the module's slot wants a label and
      // a fraction, and a plan with no window is still worth showing.
      return usage ? { label: usage.plan } : null;
    },
    // Codex keeps a daemon per tab, which is what its warmup policy reports
    // unconditionally; asking the policy here would need a tab and a
    // conversation this context has no business holding.
    shouldKeepWarm: () => true,
    renderSettingsTab: host => {
      const rendered = host as {
        container: HTMLElement;
        context: Parameters<ProviderSettingsTabRenderer['render']>[1];
      };
      maybeGetCodexWorkspaceServices()?.settingsTabRenderer
        ?.render(rendered.container, rendered.context);
    },
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
    // Answered from the binding rather than the whole conversation: these two
    // are asked on every turn, and a session id is exactly what a binding is.
    resolveSessionId: conversationId => {
      const bound = bindingFor(conversation, conversationId);
      return bound?.kind === 'thread' ? bound.threadId : null;
    },
    isPendingFork: conversationId => bindingFor(conversation, conversationId)?.kind === 'fork',
    recognizesSubagentTool: toolName => (
      codexSubagentLifecycleAdapter.isSpawnTool(toolName)
      || codexSubagentLifecycleAdapter.isWaitTool(toolName)
      || codexSubagentLifecycleAdapter.isCloseTool(toolName)
    ),
    parseSubagentDisplay: () => null,
    dispose: async () => {
      // Nothing is created here: every service reached above is owned by the
      // workspace registration, which disposes them itself.
    },
  };
}

/**
 * This tab's conversation, when the question is about it.
 *
 * Core narrows the conversation to `BoundConversation` — an id, a session, and
 * an opaque provider state — but the object the tab hands over is the whole
 * conversation, and provider code is allowed to read the provider's own fields.
 * The shape is checked rather than assumed, because a caller that syncs a
 * binding it built by hand is not one of those objects.
 */
function matching(
  conversation: CodexBoundConversation,
  conversationId: string,
): Conversation | null {
  const bound = conversation();
  if (!bound || bound.id !== conversationId) {
    return null;
  }
  return Array.isArray((bound as Partial<Conversation>).messages)
    ? bound as Conversation
    : null;
}

function bindingFor(
  conversation: CodexBoundConversation,
  conversationId: string,
): ReturnType<typeof readCodexConversationBinding> | null {
  const bound = conversation();
  return bound && bound.id === conversationId ? readCodexConversationBinding(bound) : null;
}

function codexModels(plugin: GrimoirePlugin): readonly { id: string; label: string }[] {
  const discovered = maybeGetCodexWorkspaceServices();
  if (!discovered) {
    return [];
  }
  return getCodexModelOptions(plugin.settings).map(option => ({
    id: option.value,
    label: option.label,
  }));
}
