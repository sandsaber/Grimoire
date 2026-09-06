import type { SubagentInfo } from '@/core/types';
import {
  durableAgentsRunning,
  recordDurableSubagent,
  refreshBackgroundAgentCard,
} from '@/features/chat/tabs/tabDurableSubagents';

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
        // Answers with a promise, because the real recorder does and the
        // caller now waits for it: a stub returning nothing made the tab's
        // "recordings in flight" set hold `undefined`, which is the shape the
        // Stop hook's answer depends on.
        agentRecorder: {
          observe: async (input: unknown) => { observed.push(input); },
        },
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

  it('records a background agent the provider has named', async () => {
    const { observed, plugin, tab } = harness();

    await recordDurableSubagent(tab as never, plugin as never, subagent());

    expect(observed).toEqual([{
      conversationId: 'conv-1',
      goal: 'Summarize the vault',
      nativeAgentRef: 'agent_abc',
      providerId: 'claude',
      status: 'running',
    }]);
  });

  it('records what it answered when it ends', async () => {
    const { observed, plugin, tab } = harness();

    await recordDurableSubagent(tab as never, plugin as never, subagent({
      asyncStatus: 'completed',
      result: 'forty-two notes',
    }));

    expect(observed).toEqual([expect.objectContaining({
      status: 'completed',
      resultText: 'forty-two notes',
    })]);
  });

  describe('redrawing the card', () => {
    function readable(overrides: {
      conversationId?: string | null;
      listed?: () => Promise<unknown[]>;
    } = {}) {
      const drawn: unknown[][] = [];
      let reads = 0;
      const tab = {
        providerId: 'claude' as const,
        state: {
          currentConversationId: overrides.conversationId === undefined
            ? 'conv-1'
            : overrides.conversationId,
        },
        ui: { statusPanel: { updateBackgroundAgents: (cards: unknown[]) => { drawn.push(cards); } } },
      };
      const plugin = {
        getApplicationRuntimeOrNull: () => ({
          agentRecorder: { observe: async () => undefined },
          agents: {
            listOwnedAgents: async () => {
              reads += 1;
              return overrides.listed ? overrides.listed() : [];
            },
          },
        }),
      };
      return { drawn, plugin, readCount: () => reads, tab };
    }

    it('reports the records\' running agents for the conversation the tab is on', async () => {
      // Claude's `Stop` hook reads this to decide whether a turn may end, and
      // it is the only thing it reads now. A live per-tab view cannot see an
      // agent started before a conversation switch or in a tab that has closed.
      const asked: unknown[] = [];
      const tab = { state: { currentConversationId: 'conv-1' } };
      const plugin = {
        getApplicationRuntimeOrNull: () => ({
          agents: {
            runningOwnedAgents: (owner: unknown) => {
              asked.push(owner);
              return true;
            },
          },
        }),
      };

      await expect(durableAgentsRunning(tab as never, plugin as never)).resolves.toBe(true);
      expect(asked).toEqual([{ kind: 'conversation', ownerId: 'conv-1' }]);
    });

    it('reads the records when nothing has listed this conversation yet', async () => {
      // **`undefined` is the copy saying it has not looked, and it used to end
      // the answer at `false`** — safe only because a live map was unioned with
      // it. There is no live map, so an unknown has to be resolved rather than
      // guessed: this lists the owner, which is what makes a negative answer
      // sayable, and every write afterwards keeps the copy current.
      const tab = { state: { currentConversationId: 'conv-1' } };
      const listed: unknown[] = [];
      const plugin = {
        getApplicationRuntimeOrNull: () => ({
          agents: {
            runningOwnedAgents: () => undefined,
            listOwnedAgents: async (owner: unknown) => {
              listed.push(owner);
              return [{ terminal: undefined }];
            },
          },
        }),
      };

      await expect(durableAgentsRunning(tab as never, plugin as never)).resolves.toBe(true);
      expect(listed).toEqual([{ kind: 'conversation', ownerId: 'conv-1' }]);
    });

    it('says a turn is unsafe to end when the records cannot be read', async () => {
      // A vault that cannot be read cannot prove a turn is safe to end, and the
      // hook reads a thrown answer the same way. Ending early loses an agent's
      // work; blocking in error is undone by the agent finishing.
      const tab = { state: { currentConversationId: 'conv-1' } };
      const plugin = {
        getApplicationRuntimeOrNull: () => ({
          agents: {
            runningOwnedAgents: () => undefined,
            listOwnedAgents: async () => { throw new Error('vault is unreadable'); },
          },
        }),
      };

      await expect(durableAgentsRunning(tab as never, plugin as never)).resolves.toBe(true);
    });

    it('waits for a recording in flight before it answers', async () => {
      // **The window the live map used to cover, and the reason there were two
      // sources.** A subagent's state change fires a recording nobody waits
      // for, so a question asked between the subagent starting and its record
      // landing read the vault and found nothing — which is exactly when
      // Claude's `Stop` hook asks, and exactly the answer that ends a turn on
      // top of work that has just begun.
      let land = (): void => undefined;
      const landed = new Promise<void>(resolve => { land = resolve; });
      let running = false;
      const tab = {
        providerId: 'claude' as const,
        state: { currentConversationId: 'conv-1' },
      };
      const plugin = {
        getApplicationRuntimeOrNull: () => ({
          agentRecorder: {
            observe: async () => {
              await landed;
              running = true;
            },
          },
          agents: { runningOwnedAgents: () => running },
        }),
      };

      const recording = recordDurableSubagent(tab as never, plugin as never, subagent());
      const asked = durableAgentsRunning(tab as never, plugin as never);
      land();
      await recording;

      // Without the wait this resolves `false` — the record had not landed —
      // and the turn ends on top of a running agent.
      await expect(asked).resolves.toBe(true);
    });

    it('claims nothing for a tab that owns no conversation', async () => {
      const plugin = { getApplicationRuntimeOrNull: () => ({ agents: {} }) };

      await expect(durableAgentsRunning(
        { state: { currentConversationId: null } } as never,
        plugin as never,
      )).resolves.toBe(false);
    });

    it('clears the card for a tab that owns no conversation', async () => {
      // A blank tab shows no background work; without this the cards of the
      // conversation just left stay on screen.
      const { drawn, plugin, tab } = readable({ conversationId: null });

      await refreshBackgroundAgentCard(tab as never, plugin as never);

      expect(drawn).toEqual([[]]);
    });

    it('drops an answer that arrives after the tab has moved on', async () => {
      // The read is several file reads, and a tab can be closed or switched in
      // that window: the list belongs to a conversation nobody is looking at.
      const { drawn, plugin, tab } = readable({
        listed: async () => {
          tab.state.currentConversationId = 'conv-2';
          return [];
        },
      });

      await refreshBackgroundAgentCard(tab as never, plugin as never);

      expect(drawn).toEqual([]);
    });

    it('coalesces a burst of refreshes into one more read', async () => {
      // Every subagent state change asks for a refresh and each reads every
      // agent record in the vault. A second request arriving while one runs
      // replaces the queue rather than adding to it — the card only ever needs
      // the latest answer.
      const { plugin, readCount, tab } = readable();

      await Promise.all([
        refreshBackgroundAgentCard(tab as never, plugin as never),
        refreshBackgroundAgentCard(tab as never, plugin as never),
        refreshBackgroundAgentCard(tab as never, plugin as never),
      ]);

      expect(readCount()).toBe(2);
    });
  });

  it('records nothing for a subagent that runs inside the turn', async () => {
    // No async status and no agent id: it is drawn and finished before the turn
    // is, so there is nothing for it to survive.
    const { observed, plugin, tab } = harness();

    await recordDurableSubagent(tab as never, plugin as never, subagent({
      asyncStatus: undefined,
      agentId: undefined,
    }));

    expect(observed).toEqual([]);
  });

  it('records nothing for an orphaned one', async () => {
    // `orphaned` is what the *surface* does when a tab closes, and the whole
    // point of the record is that closing a tab stops meaning the work is
    // lost. Recording it would write the very thing this replaces.
    const { observed, plugin, tab } = harness();

    await recordDurableSubagent(tab as never, plugin as never, subagent({ asyncStatus: 'orphaned' }));

    expect(observed).toEqual([]);
  });

  it('records nothing from a tab with no conversation to own it', async () => {
    const { observed, plugin, tab } = harness({ conversationId: null });

    await recordDurableSubagent(tab as never, plugin as never, subagent());

    expect(observed).toEqual([]);
  });

  it('records nothing before the load has composed anything', async () => {
    // A tab is built while `loadSettings` is still running, and a caller that
    // only wants to record something in passing skips it rather than throws.
    const { observed, tab } = harness();

    await recordDurableSubagent(
      tab as never,
      { getApplicationRuntimeOrNull: () => null } as never,
      subagent(),
    );

    expect(observed).toEqual([]);
  });
});
