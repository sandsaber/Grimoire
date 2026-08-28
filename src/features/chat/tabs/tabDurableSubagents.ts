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
  return track(tab, runtime.agentRecorder.observe({
    conversationId,
    goal: subagent.description,
    nativeAgentRef: subagent.agentId,
    providerId: tab.providerId,
    status,
    ...(subagent.result ? { resultText: subagent.result } : {}),
  }));
}

/**
 * The recordings this tab has started and not finished.
 *
 * **The one thing that made the records unusable as the single source.** A
 * subagent's state change fires a recording that nobody waits for, so a
 * question asked in the moment between the subagent starting and its record
 * landing read the vault and found nothing — which is the exact question
 * Claude's `Stop` hook asks, and the exact answer that ends a turn on top of
 * work that has just begun. Waiting for them closes that window, and it is a
 * wait of one file write.
 */
const inFlight = new WeakMap<TabData, Set<Promise<void>>>();

function track(tab: TabData, recording: Promise<void>): Promise<void> {
  const pending = inFlight.get(tab) ?? new Set<Promise<void>>();
  inFlight.set(tab, pending);
  pending.add(recording);
  return recording.finally(() => {
    pending.delete(recording);
  });
}

/** Resolves once every recording this tab has started has landed. */
export async function durableSubagentsSettled(tab: TabData): Promise<void> {
  // Re-read after each pass: a recording can start another — a terminal
  // observation appends a result — and settling has to mean settled.
  for (let pass = 0; pass < 8; pass += 1) {
    const pending = inFlight.get(tab);
    if (!pending || pending.size === 0) {
      return;
    }
    await Promise.allSettled([...pending]);
  }
}

/**
 * Whether this conversation has a background agent still going.
 *
 * **The single source, which it was not able to be until the question could be
 * awaited.** Claude's `Stop` hook decides with this whether a turn may end, and
 * ending one on top of running work is the failure the durable records exist to
 * prevent. The tab used to union this with a live map of its own subagents,
 * because two things were true at once: a record write is asynchronous, and the
 * hook's answer was typed as immediate. The second is no longer true — the hook
 * body was always `async` — so this waits for the recordings in flight and then
 * reads, and the live map is deleted.
 *
 * What the records still give that no live map could: an agent started in a tab
 * that has since closed, or before a conversation switch, is in no live map
 * anywhere and is in the vault.
 *
 * Every uncertainty answers "running". A turn that ends early on top of a live
 * subagent loses its work; a turn blocked in error is unblocked by the agent
 * finishing.
 */
export async function durableAgentsRunning(
  tab: TabData,
  plugin: GrimoirePlugin,
): Promise<boolean> {
  const runtime = plugin.getApplicationRuntimeOrNull?.();
  if (!runtime) {
    // Nothing has been recorded because there is nothing to record with. A tab
    // whose kernel has not started has run no subagents.
    return false;
  }
  // **Before reading, not after.** The window this closes is the whole reason
  // the tab used to keep a live map beside the records.
  await durableSubagentsSettled(tab);
  const conversationId = tab.state.currentConversationId;
  if (!conversationId) {
    return false;
  }
  const owner = { kind: 'conversation' as const, ownerId: conversationId };
  const cached = runtime.agents.runningOwnedAgents(owner);
  if (cached !== undefined) {
    return cached;
  }
  // Unknown means this process has not read this owner's agents. Reading them
  // is what makes the negative answer sayable, and it is asked once per
  // conversation — every write afterwards keeps the copy current.
  try {
    return (await runtime.agents.listOwnedAgents(owner)).some(agent => !agent.terminal);
  } catch {
    // A vault that cannot be read cannot prove a turn is safe to end. The hook
    // reads a thrown answer as "still running", and so does this.
    return true;
  }
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
