import grokWire from '@test/fixtures/provider-traces/wire/grok-wire.json';

import type { ProviderCostValue } from '@/core/providers/ProviderSpendUsageStore';
import type { StreamChunk } from '@/core/types';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import type { AcpSessionNotification } from '@/providers/acp/types';
import { GrokContentPresenter } from '@/providers/grok/execution/GrokContentPresenter';

/**
 * What a flipped Grok tab draws a turn from.
 *
 * Half of it is the shared ACP normalization. The other half is the three
 * updates Grok sends on its own channel, and those are asserted against the
 * wire recording rather than against a shape someone typed: two of them carry
 * what the turn is worth, and the runtime this replaces reads that off disk.
 */
describe('Grok content presenter', () => {
  interface Recorded {
    readonly costs: ProviderCostValue[];
    readonly models: Array<{ modelId: string; reasoningEffort?: string }>;
    readonly commands: string[][];
    readonly modes: string[];
    readonly configOptions: unknown[];
  }

  function createPresenter(): { presenter: GrokContentPresenter; recorded: Recorded } {
    const recorded: Recorded = {
      costs: [], models: [], commands: [], modes: [], configOptions: [],
    };
    const presenter = new GrokContentPresenter({
      displayModel: () => 'grok-4.6',
      onCommands: commands => recorded.commands.push(commands.map(command => command.name)),
      onConfigOptions: options => recorded.configOptions.push(options),
      onCost: cost => recorded.costs.push(cost),
      onCurrentMode: modeId => recorded.modes.push(modeId),
      onModelChanged: change => recorded.models.push(change),
    });
    return { presenter, recorded };
  }

  /** Every notification the recording carried, in the order it carried them. */
  function recordedUpdates(): AcpSessionNotification[] {
    return grokWire.exchange.flatMap(entry => {
      const message = (entry as { message?: { method?: string; params?: unknown } }).message;
      return message?.method === 'session/update'
        || message?.method === '_x.ai/session_notification'
        ? [message.params as AcpSessionNotification]
        : [];
    });
  }

  function updateOf(sessionUpdate: string): AcpSessionNotification {
    const found = recordedUpdates().find(notification => (
      (notification.update as { sessionUpdate?: string }).sessionUpdate === sessionUpdate
    ));
    if (!found) {
      throw new Error(`The recording carries no ${sessionUpdate}.`);
    }
    return found;
  }

  function present(
    presenter: GrokContentPresenter,
    notification: AcpSessionNotification,
  ): readonly StreamChunk[] {
    return presenter.present({ kind: 'session-update', notification });
  }

  it('reports the tokens only response_completed carries', () => {
    const { presenter } = createPresenter();
    const notification = updateOf('response_completed');
    const reported = (notification.update as unknown as {
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
    }).usage;

    const chunks = present(presenter, notification);

    // Read out of the recording rather than typed in: the assertion is the
    // transformation, and the numbers are whichever turn was recorded. The
    // answer to `session/prompt` is a stop reason and no usage at all, so
    // without this the badge has nothing for the turn it just ran.
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({
        inputTokens: reported.input_tokens,
        cacheReadInputTokens: reported.cache_read_input_tokens,
      }),
    }));
  });

  it('bills the turn in the unit Grok bills in', () => {
    const { presenter, recorded } = createPresenter();
    const notification = updateOf('turn_completed');
    const ticks = (notification.update as unknown as {
      usage: { costUsdTicks: number };
    }).usage.costUsdTicks;

    present(presenter, notification);

    // `grok --help`: "`total_cost_usd_ticks` is the same value in exact integer
    // ticks (1 USD = 10^10 ticks)". The integer is what the vendor calls exact,
    // so the division happens once and the test does it the same way.
    expect(ticks).toBeGreaterThan(0);
    expect(recorded.costs).toEqual([{ amount: ticks / 10_000_000_000, currency: 'USD' }]);
  });

  it('hears the session say the model moved under the tab', () => {
    const { presenter, recorded } = createPresenter();

    const notification = updateOf('model_changed');

    const chunks = present(presenter, notification);

    const reported = notification.update as unknown as {
      model_id: string;
      reasoning_effort?: string;
    };
    expect(chunks).toEqual([]);
    expect(recorded.models).toEqual([{
      modelId: reported.model_id,
      ...(reported.reasoning_effort ? { reasoningEffort: reported.reasoning_effort } : {}),
    }]);
  });

  it('draws the answer from the standard updates, once', () => {
    const { presenter } = createPresenter();

    const chunks = present(presenter, updateOf('agent_message_chunk'));

    // The backend mirrors the text as `output-delta`; a second copy here would
    // print every sentence twice. So the presenter draws *nothing* from this
    // update — it used to return the framing chunk that opened the message, and
    // no surface received one.
    //
    // Paired with the normalizer on purpose. An empty array on its own is what
    // an update nobody understands also produces, and this recording's chunk
    // carries no message id, so there is no metadata to read instead. What
    // separates "deliberately silent" from "ignored" is that the adapter models
    // it, which is the same question `wireVocabularyCoverage` asks.
    expect(chunks).toEqual([]);
    expect(new AcpSessionUpdateNormalizer().normalize(updateOf('agent_message_chunk').update as never))
      .toMatchObject({ role: 'assistant', type: 'message_chunk' });
  });

  it('lists the commands the session announced', () => {
    const { presenter, recorded } = createPresenter();

    present(presenter, updateOf('available_commands_update'));

    expect(recorded.commands[0]?.length).toBeGreaterThan(0);
  });

  it('fills the context reading Grok never sends over the wire', () => {
    const { presenter } = createPresenter();
    const observed = grokWire.sessionUpdatesObserved as readonly string[];

    // The recording is the evidence: seven update types, none of them a
    // context window. What the tab shows comes from Grok's own session log,
    // read while the answer is committed and handed back on this channel.
    expect(observed).not.toContain('usage');
    present(presenter, updateOf('response_completed'));
    const chunks = presenter.present({
      kind: 'session-usage',
      usage: { size: 256_000, used: 12_000 },
    });

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({
        contextTokens: 12_000,
        contextWindow: 256_000,
        contextWindowIsAuthoritative: true,
      }),
    }));
  });

  it('hears the session say its mode changed', () => {
    const { presenter, recorded } = createPresenter();

    const chunks = presenter.present({
      kind: 'session-update',
      notification: {
        sessionId: 'grok-session',
        update: { sessionUpdate: 'current_mode_update', currentModeId: 'always-approve' },
      },
    });

    // A `/mode` typed into the composer changes the session under the tab. A
    // tab that never hears it keeps sending the mode it thinks the session is
    // in — and the id it sends is translated against a stale current mode.
    expect(chunks).toEqual([]);
    expect(recorded.modes).toEqual(['always-approve']);
  });

  it('hears the session say its options changed', () => {
    const { presenter, recorded } = createPresenter();
    const configOptions = [{
      category: 'thought_level',
      currentValue: 'high',
      id: 'effort',
      name: 'Effort',
      options: [{ name: 'Low', value: 'low' }, { name: 'High', value: 'high' }],
      type: 'select',
    }];

    presenter.present({
      kind: 'session-update',
      notification: {
        sessionId: 'grok-session',
        update: { sessionUpdate: 'config_option_update', configOptions },
      },
    });

    // The thinking levels a model offers arrive this way when they change
    // mid-session, and the toolbar is drawn from what the vault kept.
    expect(recorded.configOptions).toEqual([configOptions]);
  });

  it('replays the whole recording without inventing a chunk', () => {
    const { presenter } = createPresenter();

    const chunks = recordedUpdates().flatMap(notification => [...present(presenter, notification)]);

    // Every update the agent actually sent, in order: what comes out is the
    // thinking and the badge, and nothing for the updates that are not content.
    // `assistant_message_start` was in this list and is not any more — it was
    // framing, the tab binding filters framing off the content channel, and
    // what it opened a message for the projection opens per run.
    expect(chunks.map(chunk => chunk.type)).toEqual(
      expect.arrayContaining(['thinking', 'usage']),
    );
    expect(chunks.every(chunk => chunk.type !== 'assistant_message_start')).toBe(true);
    expect(chunks.some(chunk => chunk.type === 'error')).toBe(false);
  });
});
