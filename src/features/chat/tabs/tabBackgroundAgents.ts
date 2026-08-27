import type { OwnedAgentSummary } from '../../../core/agents/AgentCoordinator';
import { agentFidelityFromCapabilities } from '../../../core/agents/AgentFidelity';
import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import { t } from '../../../i18n/i18n';
import type { BackgroundAgentCard } from '../ui/StatusPanel';

/**
 * Turns durable agent records into what the panel draws.
 *
 * **The thin replaceable layer the plan asks for.** Everything above this is
 * records and summaries with no DOM, no class names and no layout vocabulary;
 * everything below is the panel. Swapping the surface means rewriting this and
 * nothing behind it.
 *
 * **It says only what the provider can actually report.** Whether a card may
 * imply progress is a property of the provider, not of the work — a card that
 * showed "working…" for a provider whose fidelity is `none` would be promising
 * something nobody can deliver, and the person watching it would be waiting for
 * an update that is never coming.
 */
export function toBackgroundAgentCards(
  agents: readonly OwnedAgentSummary[],
): readonly BackgroundAgentCard[] {
  return agents.map(agent => ({
    agentInstanceId: agent.agentInstanceId,
    label: readableGoal(agent.goalRef),
    detail: describe(agent),
    state: cardState(agent),
  }));
}

function cardState(agent: OwnedAgentSummary): BackgroundAgentCard['state'] {
  if (!agent.terminal) {
    return 'running';
  }
  return agent.terminal.kind === 'succeeded' ? 'succeeded' : 'failed';
}

function describe(agent: OwnedAgentSummary): string {
  if (agent.terminal) {
    return agent.terminal.kind === 'succeeded'
      ? t('chat.agents.finishedOne')
      : t('chat.agents.failedOne');
  }
  // Read from the provider's declared capabilities rather than from this
  // agent's record: what is observable is the same for every agent a provider
  // runs, and the record would only be repeating it.
  const capabilities = providerCatalog().get(agent.providerId)?.capabilities;
  const observation = capabilities
    ? agentFidelityFromCapabilities(capabilities).observation
    : agent.observation;
  return observation === 'none' || observation === 'opaque'
    ? t('chat.agents.unobservable')
    : t('chat.agents.runningOne');
}

/**
 * The goal reference, back to something a person reads.
 *
 * The record holds a slug and a digest — a reference, never the text a person
 * typed, because a control record may hold no free text. This undoes the shape
 * of it for display and nothing more: the words are approximate by design, and
 * the transcript is where the real question lives.
 */
function readableGoal(goalRef: string): string {
  const withoutDigest = goalRef.replace(/-[0-9a-f]{8}$/, '');
  const words = withoutDigest.split('-').filter(Boolean);
  if (words.length === 0) {
    return goalRef;
  }
  const [first = '', ...rest] = words;
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(' ');
}
