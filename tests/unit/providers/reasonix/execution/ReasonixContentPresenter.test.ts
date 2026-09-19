import { TOOL_READ } from '@/core/tools/toolNames';
import type {
  AcpNewSessionResponse,
  AcpPromptResponse,
  AcpSessionNotification,
  AcpSessionUpdate,
} from '@/providers/acp/types';
import {
  type ReasonixContentPayload,
  ReasonixContentPresenter,
  type ReasonixSessionOpening,
} from '@/providers/reasonix/execution/ReasonixContentPresenter';
import {
  parseReasonixSessionNotification,
  REASONIX_STATUS_UPDATE_METHOD,
} from '@/providers/reasonix/runtime/ReasonixSessionNotifications';

/**
 * What a Reasonix tab draws a turn from. The shapes are the recording's:
 * `tests/fixtures/provider-traces/wire/reasonix-wire.json`.
 */
describe('Reasonix content presenter', () => {
  interface Recorded {
    readonly commands: unknown[];
    readonly configOptions: unknown[];
    readonly costs: unknown[];
    readonly modes: string[];
    readonly opened: ReasonixSessionOpening[];
  }

  function createPresenter(): { presenter: ReasonixContentPresenter; recorded: Recorded } {
    const recorded: Recorded = { commands: [], configOptions: [], costs: [], modes: [], opened: [] };
    const presenter = new ReasonixContentPresenter({
      displayModel: () => 'reasonix:swe-1-6-slow',
      onCommands: commands => recorded.commands.push(...commands),
      onConfigOptions: options => recorded.configOptions.push(options),
      onCost: cost => recorded.costs.push(cost),
      onCurrentMode: modeId => recorded.modes.push(modeId),
      onSessionOpened: opened => recorded.opened.push(opened),
    });
    return { presenter, recorded };
  }

  function sessionUpdate(update: AcpSessionUpdate): ReasonixContentPayload {
    const notification: AcpSessionNotification = { sessionId: 'prickly-conga', update };
    return { kind: 'session-update', notification };
  }

  function promptResult(response: AcpPromptResponse): ReasonixContentPayload {
    return { kind: 'prompt-result', response };
  }

  function sessionConfig(session: AcpNewSessionResponse): ReasonixContentPayload {
    return { kind: 'session-config', session };
  }

  it('drops the copy of the answer the kernel already carries', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'ok' },
    } as unknown as AcpSessionUpdate));

    expect(chunks.some(chunk => chunk.type === 'text')).toBe(false);
  });

  it('keeps the reasoning the kernel reports only as activity', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'The user wants' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual({ type: 'thinking', content: 'The user wants' });
  });

  it('forwards a tool call as the normalizer produced it', () => {
    const { presenter } = createPresenter();

    // Recorded: the title is a past-tense sentence and the kind is ACP's.
    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_5e4c9ce1e5d245ad98a99409',
      title: 'Ran echo',
      kind: 'execute',
      rawInput: { command: 'echo grimoire-probe' },
      _meta: { 'reasonix.io': { tool: 'bash', subject: 'ls -a' } },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'call_5e4c9ce1e5d245ad98a99409',
      name: 'Ran echo',
      input: { command: 'echo grimoire-probe' },
    }));
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === TOOL_READ)).toBe(false);
  });

  it('keeps the commands a session announces', () => {
    const { presenter, recorded } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'login', description: 'Authenticate with an API key', input: { hint: '[api-key]' } },
        { name: 'status', description: 'Check authentication status' },
      ],
    } as unknown as AcpSessionUpdate));

    expect(chunks).toEqual([]);
    expect(recorded.commands).toEqual([
      expect.objectContaining({ name: 'login' }),
      expect.objectContaining({ name: 'status' }),
    ]);
  });

  it('hands a config option update to the tab and draws nothing', () => {
    // Recorded on every `set_config_option`, and once when the session opens.
    const { presenter, recorded } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: [{
        id: 'mode', name: 'Session Mode', category: 'mode', type: 'select',
        currentValue: 'accept-edits',
        options: [{ value: 'accept-edits', name: 'Code' }],
      }],
    } as unknown as AcpSessionUpdate));

    expect(chunks).toEqual([]);
    expect(recorded.configOptions).toHaveLength(1);
  });

  it('draws nothing from a session title update', () => {
    const { presenter } = createPresenter();

    expect(presenter.present(sessionUpdate({
      sessionUpdate: 'session_info_update',
      title: 'Reply with exactly: ok',
    } as unknown as AcpSessionUpdate))).toEqual([]);
  });

  it('reports the configuration the session was opened with', () => {
    const { presenter, recorded } = createPresenter();

    const chunks = presenter.present(sessionConfig({
      sessionId: 'prickly-conga',
      modes: {
        currentModeId: 'accept-edits',
        availableModes: [
          { id: 'accept-edits', name: 'Code' },
          { id: 'bypass', name: 'Bypass Permissions' },
        ],
      },
      configOptions: [{
        id: 'model', name: 'Model', category: 'model', type: 'select',
        currentValue: 'swe-1-6-slow',
        options: [{ value: 'swe-1-6-slow', name: 'SWE-1.6 Slow' }],
      }],
    } as unknown as AcpNewSessionResponse));

    expect(chunks).toEqual([]);
    expect(recorded.opened).toEqual([expect.objectContaining({ sessionId: 'prickly-conga' })]);
    // The mode the session opened in is not pushed at the toolbar.
    expect(recorded.modes).toEqual([]);
    expect(presenter.lastSessionId()).toBe('prickly-conga');
  });

  it('completes the usage with the tokens the prompt itself cost', () => {
    // Recorded: the window rides on `usage_update`, the prompt's own tokens on
    // the `session/prompt` answer.
    const { presenter } = createPresenter();
    presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 13_652,
      size: 200_000,
    } as unknown as AcpSessionUpdate));

    const chunks = presenter.present(promptResult({
      stopReason: 'end_turn',
      usage: { totalTokens: 13_652, inputTokens: 13_622, outputTokens: 30, cachedReadTokens: 32 },
    }));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({
        contextTokens: 13_652,
        contextWindow: 200_000,
        inputTokens: 13_622,
        model: 'reasonix:swe-1-6-slow',
      }),
    }));
  });

  it('does not present aggregate turn tokens as context occupancy', () => {
    // Reasonix sends no `usage_update` of its own; the one that reaches the
    // presenter is synthesised from `_reasonix.io/session/status_update`, with
    // the turn's counts under `_meta` and no window size, because the status
    // states none.
    const { presenter, recorded } = createPresenter();
    const notification = parseReasonixSessionNotification(REASONIX_STATUS_UPDATE_METHOD, {
      sessionId: 'acp-session-1',
      event: 'usage',
      status: {
        usage: {
          turn: {
            totalTokens: 5_999,
            promptTokens: 5_996,
            completionTokens: 3,
            reasoningTokens: 0,
            cacheHitTokens: 0,
            cacheMissTokens: 5_996,
            estimatedCost: null,
            currency: null,
          },
        },
      },
    });

    const chunks = presenter.present({ kind: 'session-update', notification });

    expect(chunks).toEqual([]);
    expect(recorded.costs).toEqual([null]);
  });

  it('ignores a status that reports a turn which has not started', () => {
    // Every status carries a usage block; the first one of a turn is all zeros,
    // and a badge built from it would erase what the last turn spent.
    expect(parseReasonixSessionNotification(REASONIX_STATUS_UPDATE_METHOD, {
      sessionId: 'acp-session-1',
      event: 'usage',
      status: { usage: { turn: { totalTokens: 0, promptTokens: 0, completionTokens: 0 } } },
    })).toBeNull();
  });

  it('reports a cost only when Reasonix could price the turn', () => {
    // The recorded session prices nothing: `costQuote.incompleteReason` is
    // `no_price`, and both `estimatedCost` and `currency` are null.
    const priced = parseReasonixSessionNotification(REASONIX_STATUS_UPDATE_METHOD, {
      sessionId: 'acp-session-1',
      event: 'completion',
      status: { usage: { turn: { totalTokens: 10, estimatedCost: 0.25, currency: 'USD' } } },
    });

    expect(priced?.update).toEqual(expect.objectContaining({
      cost: { amount: 0.25, currency: 'USD' },
    }));
  });

  it('charges one turn once, however many times the status reports it', () => {
    // `usage.turn` is a running figure re-sent whole on every status, and the
    // spend store adds what it is given. Forwarding a cost before the turn ends
    // would multiply one charge by the number of statuses the turn produced.
    const status = (event: string) => parseReasonixSessionNotification(
      REASONIX_STATUS_UPDATE_METHOD,
      {
        sessionId: 'acp-session-1',
        event,
        status: { usage: { turn: { totalTokens: 10, estimatedCost: 0.25, currency: 'USD' } } },
      },
    );

    expect(status('phase')?.update).toEqual(expect.objectContaining({ cost: null }));
    expect(status('usage')?.update).toEqual(expect.objectContaining({ cost: null }));
    expect(status('completion')?.update).toEqual(expect.objectContaining({
      cost: { amount: 0.25, currency: 'USD' },
    }));
  });

  it('does not resurrect aggregate usage at the end of the turn', () => {
    // Reasonix answers `session/prompt` with `{stopReason, transcriptPath}`.
    // Clearing on that answer would drop the counts at the end of every turn.
    const { presenter } = createPresenter();
    const notification = parseReasonixSessionNotification(REASONIX_STATUS_UPDATE_METHOD, {
      sessionId: 'acp-session-1',
      event: 'completion',
      status: { usage: { turn: { totalTokens: 5_999, promptTokens: 5_996 } } },
    });
    presenter.present({ kind: 'session-update', notification });

    const chunks = presenter.present({
      kind: 'prompt-result',
      response: { stopReason: 'end_turn' },
    });

    expect(chunks).toEqual([]);
  });

  it('forgets the session a new conversation must not report as its own', () => {
    const { presenter } = createPresenter();
    presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'ok' },
    } as unknown as AcpSessionUpdate));

    presenter.forgetConversation();

    expect(presenter.lastSessionId()).toBeUndefined();
  });

  it('says why a turn was refused, once', () => {
    const { presenter } = createPresenter();

    presenter.present({ kind: 'turn-refused', message: 'Authentication required' });

    expect(presenter.consumeTurnRefusal()).toEqual({ message: 'Authentication required' });
    expect(presenter.consumeTurnRefusal()).toBeUndefined();
  });
});
