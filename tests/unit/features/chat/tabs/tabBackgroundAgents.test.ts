import '@/providers';

import type { OwnedAgentSummary } from '@/core/agents/AgentCoordinator';
import { toBackgroundAgentCards } from '@/features/chat/tabs/tabBackgroundAgents';

/**
 * Durable records, as the panel draws them.
 *
 * The thin replaceable layer: everything above is records with no DOM, no class
 * names and no layout vocabulary, and everything below is the panel. What it
 * must get right is **not promising more than the provider can report** — a
 * card showing "working…" for a provider whose fidelity is `none` leaves
 * someone waiting for an update that is never coming.
 */
describe('background agent cards', () => {
  function summary(overrides: Partial<OwnedAgentSummary> = {}): OwnedAgentSummary {
    return {
      agentInstanceId: 'agi-1' as never,
      agentRunId: 'agr-1' as never,
      providerId: 'claude',
      goalRef: 'summarize-the-vault-ab12cd34',
      state: 'running',
      attempt: 1,
      observation: 'full',
      startedAt: 1,
      updatedAt: 2,
      ...overrides,
    };
  }

  it('reads a goal reference back into something a person can read', () => {
    // The record holds a slug and a digest — a reference, never the text a
    // person typed, because a control record may hold no free text. This undoes
    // the shape of it for display and nothing more.
    expect(toBackgroundAgentCards([summary()])[0]).toMatchObject({
      label: 'Summarize the vault',
    });
  });

  it('says a provider reports progress only when it does', () => {
    // Claude observes `full`; Qwen and the ACP family observe `none`. Read from
    // the provider's declared capabilities rather than the record, because what
    // is observable is the same for every agent that provider runs.
    const [claude] = toBackgroundAgentCards([summary({ providerId: 'claude' })]);
    const [qwen] = toBackgroundAgentCards([summary({ providerId: 'qwen' })]);

    expect(claude?.detail).not.toBe(qwen?.detail);
    expect(qwen?.detail).toContain('progress');
  });

  it('shows how it ended once it has', () => {
    const cards = toBackgroundAgentCards([
      summary({
        state: 'succeeded',
        terminal: { kind: 'succeeded', reason: 'completed', occurredAt: 3 },
      }),
      summary({
        agentInstanceId: 'agi-2' as never,
        state: 'failed',
        terminal: { kind: 'failed', reason: 'provider-failure', occurredAt: 3 },
      }),
    ]);

    expect(cards.map(card => card.state)).toEqual(['succeeded', 'failed']);
  });

  it('treats a run with no terminal as still going, whatever its state says', () => {
    // The terminal is the fact; a state without one is a run that has not
    // ended, and a card that called it finished would be claiming an ending
    // nobody recorded.
    expect(toBackgroundAgentCards([summary({ state: 'waiting' })])[0]?.state).toBe('running');
  });
});
