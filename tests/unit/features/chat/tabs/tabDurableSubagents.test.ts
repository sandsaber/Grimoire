import type { SubagentInfo } from '@/core/types';
import { recordDurableSubagent } from '@/features/chat/tabs/tabDurableSubagents';

/**
 * The one call site that turns a provider's background subagent into a record.
 *
 * What it must get right is **which** subagents: a subagent that runs inside a
 * turn is drawn and finished before the turn is, and has nothing to survive.
 * The ones worth recording are the ones a person starts and walks away from.
 */
describe('recording a durable subagent', () => {
  function harness(overrides: { conversationId?: string | null } = {}) {
    const observed: unknown[] = [];
    const tab = {
      providerId: 'claude' as const,
      state: {
        currentConversationId: overrides.conversationId === undefined
          ? 'conv-1'
          : overrides.conversationId,
      },
    };
    const plugin = {
      getApplicationRuntimeOrNull: () => ({
        agentRecorder: { observe: (input: unknown) => { observed.push(input); } },
      }),
    };
    return { observed, plugin, tab };
  }

  function subagent(overrides: Partial<SubagentInfo> = {}): SubagentInfo {
    return {
      id: 'tool-1',
      description: 'Summarize the vault',
      isExpanded: false,
      status: 'running',
      toolCalls: [],
      asyncStatus: 'running',
      agentId: 'agent_abc',
      ...overrides,
    };
  }

  it('records a background agent the provider has named', () => {
    const { observed, plugin, tab } = harness();

    recordDurableSubagent(tab as never, plugin as never, subagent());

    expect(observed).toEqual([{
      conversationId: 'conv-1',
      goal: 'Summarize the vault',
      nativeAgentRef: 'agent_abc',
      providerId: 'claude',
      status: 'running',
    }]);
  });

  it('records what it answered when it ends', () => {
    const { observed, plugin, tab } = harness();

    recordDurableSubagent(tab as never, plugin as never, subagent({
      asyncStatus: 'completed',
      result: 'forty-two notes',
    }));

    expect(observed).toEqual([expect.objectContaining({
      status: 'completed',
      resultText: 'forty-two notes',
    })]);
  });

  it('records nothing for a subagent that runs inside the turn', () => {
    // No async status and no agent id: it is drawn and finished before the turn
    // is, so there is nothing for it to survive.
    const { observed, plugin, tab } = harness();

    recordDurableSubagent(tab as never, plugin as never, subagent({
      asyncStatus: undefined,
      agentId: undefined,
    }));

    expect(observed).toEqual([]);
  });

  it('records nothing for an orphaned one', () => {
    // `orphaned` is what the *surface* does when a tab closes, and the whole
    // point of the record is that closing a tab stops meaning the work is
    // lost. Recording it would write the very thing this replaces.
    const { observed, plugin, tab } = harness();

    recordDurableSubagent(tab as never, plugin as never, subagent({ asyncStatus: 'orphaned' }));

    expect(observed).toEqual([]);
  });

  it('records nothing from a tab with no conversation to own it', () => {
    const { observed, plugin, tab } = harness({ conversationId: null });

    recordDurableSubagent(tab as never, plugin as never, subagent());

    expect(observed).toEqual([]);
  });

  it('records nothing before the load has composed anything', () => {
    // A tab is built while `loadSettings` is still running, and a caller that
    // only wants to record something in passing skips it rather than throws.
    const { observed, tab } = harness();

    recordDurableSubagent(
      tab as never,
      { getApplicationRuntimeOrNull: () => null } as never,
      subagent(),
    );

    expect(observed).toEqual([]);
  });
});
