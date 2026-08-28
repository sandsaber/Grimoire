import { ChatTabExecution } from '../../../app/chat/ChatTabExecution';
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
 * changes with the conversation. Built once, a tab that switched provider would
 * keep submitting turns under the provider it left — its composition, its
 * ports, its backend. Which provider a tab is on is the whole of what this
 * builds from, so it is asked each time.
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
 * A tab's end of the projection path.
 *
 * **There is no switch any more.** `projectionChatProviders` gated this one
 * provider at a time until all nine were on it, and by then the list was a
 * lever that could no longer do what it claimed: with the legacy send path
 * gone, removing a provider from it did not revert that provider's flip, it
 * stopped the provider from sending at all. A flag whose only remaining setting
 * is `true` is deleted rather than left as a trap.
 *
 * `null` only where the kernel has not started yet — see below.
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
  const module = providerCatalog().get(tab.providerId);
  if (!module) {
    return null;
  }
  const backendId = module.execution.descriptor.backendId;
  // A tab can be created before the kernel has started — a restored workspace
  // builds its tabs while `loadSettings` is still running — and asking for a
  // composition that does not exist yet throws. **There is no legacy path to
  // fall back to any more**: a tab without one refuses to send, with the
  // message it was already typed into restored to the composer, and resolves on
  // the next attempt because this is asked again every time.
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
      // Content only. The presenter returns the whole `StreamChunk` union and
      // two normalizers still put framing in it; a turn's shape is what the
      // projection states here, so framing arriving as content would be a
      // second opinion about where this turn begins and ends. Why the emission
      // is still there rather than deleted is written at `isChatContent`.
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
    // The provider's own dialog, read through the tab for the same reason as
    // the encoder: a cold tab has no runtime until it first sends. Handed to
    // the coordinator rather than driven here, because the question belongs to
    // the conversation and two tabs on one chat must not both present it.
    interactionPresenter: () => adapterOf(tab)?.surfacePorts.interactionPresenter ?? null,
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
 * The tab's runtime, or `null` while the tab is cold.
 *
 * **It used to ask by shape.** The field was typed as the frozen `ChatRuntime`,
 * which carries none of what this path needs, so a provider's adapter had to be
 * recognized by two members it happens to have. The seam deletion typed the
 * field as the adapter — all nine compositions build one — so the question is
 * just whether the tab has a runtime.
 */
function adapterOf(tab: TabData): ExecutionChatRuntimeAdapter | null {
  return tab.service;
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
