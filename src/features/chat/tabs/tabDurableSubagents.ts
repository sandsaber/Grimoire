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
): void {
  const status = durableStatus(subagent);
  const conversationId = tab.state.currentConversationId;
  if (!status || !subagent.agentId || !conversationId) {
    return;
  }
  const runtime = plugin.getApplicationRuntimeOrNull?.();
  if (!runtime) {
    return;
  }
  void runtime.agentRecorder.observe({
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
export async function refreshBackgroundAgentCard(
  tab: TabData,
  plugin: GrimoirePlugin,
): Promise<void> {
  const panel = tab.ui.statusPanel;
  const conversationId = tab.state.currentConversationId;
  const runtime = plugin.getApplicationRuntimeOrNull?.();
  if (!panel) {
    return;
  }
  if (!runtime || !conversationId) {
    panel.updateBackgroundAgents([]);
    return;
  }
  try {
    const agents = await runtime.agents.listOwnedAgents({
      kind: 'conversation',
      ownerId: conversationId,
    });
    panel.updateBackgroundAgents(toBackgroundAgentCards(agents));
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
