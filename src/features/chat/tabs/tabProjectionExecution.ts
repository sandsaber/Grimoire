import { ChatTabExecution } from '../../../app/chat/ChatTabExecution';
import { usesProjectionChat } from '../../../app/chat/projectionChatProviders';
import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import type { ExecutionChatRuntimeAdapter } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import { describeRunFailure } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatMessage } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { isChatContent } from '../rendering/chatContentChunks';
import { buildAssistantResponseMetadata } from '../utils/assistantResponseMetadata';
import { getTabSettingsSnapshot } from './tabSettings';
import type { TabData } from './types';

/**
 * A tab's end of the projection path for the provider it is on *now*.
 *
 * Resolved on every use rather than built once, because a tab's provider is not
 * fixed: a blank tab derives it from the model that is picked, and a bound one
 * changes with the conversation. Built once, a tab that started on a provider
 * not on the path would stay on the legacy path after switching to one that is
 * — and worse, a tab that switched *away* would keep submitting turns under the
 * provider it left. Which provider a tab is on is the whole of what decides
 * whether it takes this path, so it is asked each time.
 */
export function resolveTabProjectionExecution(
  tab: TabData,
  plugin: GrimoirePlugin,
): ChatTabExecution | null {
  const current = tab.execution;
  if (current && current.providerId === tab.providerId) {
    return current;
  }
  current?.detach();
  tab.execution = createTabProjectionExecution(tab, plugin);
  if (tab.execution && tab.conversationId) {
    void tab.execution.open(tab.conversationId);
  }
  return tab.execution;
}

/**
 * A tab's end of the projection path, where its provider is on that path.
 *
 * `null` for every provider not listed in `projectionChatProviders`, which is
 * how the flip stays one provider at a time: the whole path is built and in the
 * bundle, and this is the only place that decides whether a given tab takes it.
 *
 * What it assembles is what only a tab knows — its own column, its own
 * streaming cursor, and the provider ports its runtime was built with. Every
 * one of those is read *late*, through the tab, because a cold tab has no
 * runtime until it first sends and a conversation switch replaces the renderer.
 */
export function createTabProjectionExecution(
  tab: TabData,
  plugin: GrimoirePlugin,
): ChatTabExecution | null {
  if (!usesProjectionChat(tab.providerId)) {
    return null;
  }
  const module = providerCatalog().get(tab.providerId);
  if (!module) {
    return null;
  }
  const backendId = module.execution.descriptor.backendId;
  // A tab can be created before the kernel has started — a restored workspace
  // builds its tabs while `loadSettings` is still running — and asking for a
  // composition that does not exist yet throws. A tab without one runs the
  // legacy path, which is what it would have done anyway.
  const composition = chatExecutionOrNull(plugin);
  if (!composition) {
    return null;
  }
  return new ChatTabExecution({
    composition,
    providerId: tab.providerId,
    backendId,
    surface: {
      state: tab.state,
      // Read through the tab rather than captured: a conversation switch
      // replaces the renderer, and a binding holding the old one would draw
      // into a column that is no longer mounted.
      get renderer() {
        return requireRenderer(tab);
      },
      get stream() {
        return requireStream(tab);
      },
      // Content only. The presenter still returns the whole `StreamChunk` union
      // because `InputController` reads turn framing off that channel on the
      // legacy path — and a turn's shape is what the projection states here, so
      // framing that arrived as content would be a second opinion about where
      // this turn begins and ends.
      presentProviderContent: payload => (
        adapterOf(tab)?.surfacePorts.presentProviderContent?.(payload) ?? []
      ).filter(isChatContent),
      createAssistantMessage: (messageId): ChatMessage => ({
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [],
        contentBlocks: [],
        responseMetadata: buildAssistantResponseMetadata(
          tab.providerId,
          getTabSettingsSnapshot(tab, plugin),
          {},
        ),
      }),
      describeTerminal: terminal => (
        adapterOf(tab)?.surfacePorts.describeFailure?.(terminal.reason)
        ?? describeRunFailure(terminal.reason)
      ),
      getGreeting: () => tab.controllers.conversationController?.getGreeting() ?? '',
      getProviderId: () => tab.providerId,
      updateQueueIndicator: () => tab.controllers.inputController?.updateQueueIndicator(),
      setTitle: () => undefined,
    },
    turnEncoder: () => adapterOf(tab)?.turnEncoder ?? null,
    createConversation: async () => {
      // Whatever already bound this tab wins. Title generation creates the
      // conversation before the first turn is sent — that is where the fallback
      // title comes from — and creating a second one here would leave the turn
      // running in a conversation the tab is not showing.
      const existing = tab.conversationId ?? tab.state.currentConversationId;
      if (existing) {
        return existing;
      }
      const conversation = await plugin.createConversation({
        providerId: tab.providerId,
        ...(tab.service?.getSessionId?.() ? { sessionId: tab.service.getSessionId() as string } : {}),
      });
      tab.conversationId = conversation.id;
      tab.state.currentConversationId = conversation.id;
      return conversation.id;
    },
    nextCommandId: () => `turn-${tab.id}-${Date.now().toString(36)}`,
  });
}

/**
 * The tab's runtime as the adapter it is, or `null` while the tab is cold.
 *
 * Asked by shape rather than by class: the runtime a tab holds is typed as the
 * legacy `ChatRuntime`, which does not carry these — and must not, because it
 * is frozen. A provider on this path always has an adapter behind that type;
 * one that somehow does not is refused rather than guessed at.
 */
function adapterOf(tab: TabData): ExecutionChatRuntimeAdapter | null {
  const service = tab.service as ExecutionChatRuntimeAdapter | null;
  return service && 'turnEncoder' in service && 'surfacePorts' in service ? service : null;
}

function chatExecutionOrNull(plugin: GrimoirePlugin) {
  try {
    return plugin.getChatExecution();
  } catch {
    return null;
  }
}

function requireRenderer(tab: TabData) {
  const renderer = tab.renderer;
  if (!renderer) {
    throw new Error('This tab has no renderer to draw a turn into.');
  }
  return renderer;
}

function requireStream(tab: TabData) {
  const stream = tab.controllers.streamController;
  if (!stream) {
    throw new Error('This tab has no stream controller to draw a turn with.');
  }
  return stream;
}
