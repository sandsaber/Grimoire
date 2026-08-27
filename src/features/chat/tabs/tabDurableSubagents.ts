import type { SubagentInfo } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { toBackgroundAgentCards } from './tabBackgroundAgents';
import type { TabData } from './types';

/**
 * Records a background subagent as work that outlives the tab watching it.
 *
 * **Only the background ones.** A subagent that runs inside a turn is drawn and
 * finished before the turn is; there is nothing for it to survive. The ones
 * worth a durable record are the ones a person starts and walks away from,
 * which is what an async status and a provider-assigned agent id mean together.
 *
 * Fire-and-forget, and the recorder itself never throws: these records exist so
 * work survives a tab, and a tab that fell over because one could not be
 * written has survived nothing.
 */
export function recordDurableSubagent(
  tab: TabData,
  plugin: GrimoirePlugin,
  subagent: SubagentInfo,
): Promise<void> {
  const status = durableStatus(subagent);
  const conversationId = tab.state.currentConversationId;
  if (!status || !subagent.agentId || !conversationId) {
    return Promise.resolve();
  }
  const runtime = plugin.getApplicationRuntimeOrNull?.();
  if (!runtime) {
    return Promise.resolve();
  }
  return runtime.agentRecorder.observe({
    conversationId,
    goal: subagent.description,
    nativeAgentRef: subagent.agentId,
    providerId: tab.providerId,
    status,
    ...(subagent.result ? { resultText: subagent.result } : {}),
  });
}

/**
 * Redraws the card from what the vault holds for this conversation.
 *
 * **Read every time rather than kept**, because the point is the records: an
 * agent this tab never saw — started in a tab that has since closed, or before
 * a reload — is in no live map anywhere, and reading is the only way it appears
 * at all.
 */
/**
 * Refreshes in flight or queued, per tab.
 *
 * **A refresh reads every agent record in the vault**, filtering by owner
 * afterwards — several file reads per agent, for a handful of cards belonging
 * to one conversation. Every subagent state change asks for one, and a
 * sidecar hydration retry can produce a burst of them, so a second request
 * arriving while one is running replaces the queue rather than adding to it:
 * the card only ever needs the latest answer.
 */
const refreshing = new WeakMap<TabData, { running: Promise<void>; queued: boolean }>();

export function refreshBackgroundAgentCard(
  tab: TabData,
  plugin: GrimoirePlugin,
): Promise<void> {
  const inFlight = refreshing.get(tab);
  if (inFlight) {
    inFlight.queued = true;
    return inFlight.running;
  }
  const entry = { queued: false, running: Promise.resolve() };
  entry.running = readBackgroundAgents(tab, plugin).then(async () => {
    refreshing.delete(tab);
    if (entry.queued) {
      await refreshBackgroundAgentCard(tab, plugin);
    }
  });
  refreshing.set(tab, entry);
  return entry.running;
}

async function readBackgroundAgents(
  tab: TabData,
  plugin: GrimoirePlugin,
): Promise<void> {
  const conversationId = tab.state.currentConversationId;
  const runtime = plugin.getApplicationRuntimeOrNull?.();
  if (!tab.ui.statusPanel) {
    return;
  }
  if (!runtime || !conversationId) {
    tab.ui.statusPanel.updateBackgroundAgents([]);
    return;
  }
  try {
    const agents = await runtime.agents.listOwnedAgents({
      kind: 'conversation',
      ownerId: conversationId,
    });
    // **Re-read after the await, both of them.** The read is several file
    // reads, and in that window a tab can be closed or moved to another
    // conversation: the panel captured before it may be detached, and the list
    // belongs to a conversation nobody is looking at. Two overlapping refreshes
    // can also land out of order, and the conversation check is what stops the
    // older one being written over the newer.
    if (tab.state.currentConversationId !== conversationId) {
      return;
    }
    tab.ui.statusPanel?.updateBackgroundAgents(toBackgroundAgentCards(agents));
  } catch {
    // The card is an addition to a conversation, not a condition of it: a read
    // that failed leaves the panel as it was rather than taking the tab with
    // it.
  }
}

/**
 * What this subagent is, as a durable record understands it.
 *
 * `orphaned` is deliberately not one of them: it is what the *surface* does
 * today when a tab closes, and the whole point of the record is that closing a
 * tab stops meaning the work is lost. Recording it would write the very thing
 * this replaces.
 */
function durableStatus(subagent: SubagentInfo): 'running' | 'completed' | 'error' | null {
  switch (subagent.asyncStatus) {
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return null;
  }
}
