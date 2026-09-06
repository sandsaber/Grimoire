import { TOOL_READ } from '@/core/tools/toolNames';
import type { SlashCommand } from '@/core/types';
import type {
  AcpNewSessionResponse,
  AcpPromptResponse,
  AcpSessionConfigOption,
  AcpSessionNotification,
  AcpSessionUpdate,
} from '@/providers/acp/types';
import {
  type MimocodeContentPayload,
  MimocodeContentPresenter,
  type MimocodeSessionOpening,
} from '@/providers/mimocode/execution/MimocodeContentPresenter';

/**
 * What a flipped MiMoCode tab draws a turn from.
 *
 * The backend carries the session updates and reports facts about them — a tool
 * started, a thought happened — and the answer's text. This is the other half:
 * the updates themselves, normalized by the code the legacy runtime rendered
 * with, minus the one copy of the answer the kernel already carries.
 *
 * The values are the recorded session's own where the recording reaches them —
 * the model, the mode, the commands and the 1 MiB window `mimo acp` reported.
 * A turn's answer is not among them: that account cannot generate, so the
 * chunks below are the shapes the normalizer produces rather than lines lifted
 * from a MiMoCode transcript.
 */
describe('MiMoCode content presenter', () => {
  interface Recorded {
    readonly commands: SlashCommand[][];
    readonly configOptions: AcpSessionConfigOption[][];
    readonly costs: unknown[];
    readonly modes: string[];
    readonly opened: MimocodeSessionOpening[];
  }

  function createPresenter(): { presenter: MimocodeContentPresenter; recorded: Recorded } {
    const recorded: Recorded = {
      commands: [],
      configOptions: [],
      costs: [],
      modes: [],
      opened: [],
    };
    const presenter = new MimocodeContentPresenter({
      displayModel: () => 'xiaomi/mimo-v2.5-pro-ultraspeed',
      onCommands: commands => recorded.commands.push([...commands]),
      onConfigOptions: options => recorded.configOptions.push([...options]),
      onCost: cost => recorded.costs.push(cost),
      onCurrentMode: modeId => recorded.modes.push(modeId),
      onSessionOpened: opened => recorded.opened.push(opened),
    });
    return { presenter, recorded };
  }

  function sessionUpdate(update: AcpSessionUpdate): MimocodeContentPayload {
    const notification: AcpSessionNotification = { sessionId: 'native-session', update };
    return { kind: 'session-update', notification };
  }

  function promptResult(response: AcpPromptResponse): MimocodeContentPayload {
    return { kind: 'prompt-result', response };
  }

  function sessionConfig(session: AcpNewSessionResponse): MimocodeContentPayload {
    return { kind: 'session-config', session };
  }

  it('renders the tool call a card is drawn from', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'read',
      kind: 'read',
      status: 'pending',
      rawInput: { file_path: 'note.md' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'tool-1',
      name: TOOL_READ,
      input: { file_path: 'note.md' },
    }));
  });

  it('drops the copy of the answer the kernel already carries', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'OK' },
    } as unknown as AcpSessionUpdate));

    // The backend mirrors this text as `output-delta`, which is the copy core
    // reads; letting both through prints every sentence twice.
    expect(chunks.some(chunk => chunk.type === 'text')).toBe(false);
    // Asserted against the message id rather than an empty array, because an
    // update the presenter ignored outright would also produce no text. The
    // framing chunk that used to carry this id reached no surface and is gone;
    // the id itself still has to arrive, and turn metadata is where it lands.
    expect(presenter.consumeTurnMetadata()).toEqual(expect.objectContaining({
      assistantMessageId: 'msg-1',
    }));
  });

  it('keeps the reasoning the kernel reports only as activity', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'The user wants me' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual({ type: 'thinking', content: 'The user wants me' });
  });

  it('reports a replayed user chunk by id, and draws nothing from it', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'msg-user',
      content: { type: 'text', text: 'Reply with exactly: ok' },
    } as unknown as AcpSessionUpdate));

    // **This asserted the opposite, on a reason that was not true.** It said
    // what the user said reaches the surface inside the message this opens and
    // that nothing else carries it into a resumed transcript. The chunk it
    // named was `user_message_start`, which the tab binding filters off the
    // content channel — so it reached no surface — and a resumed transcript is
    // hydrated from the conversation the vault holds, not from a provider's
    // replay. What the presenter takes from the update is the id.
    expect(chunks.filter(chunk => chunk.type !== 'thinking')).toEqual([]);
    expect(presenter.consumeTurnMetadata()).toEqual(expect.objectContaining({
      userMessageId: 'msg-user',
    }));
  });

  it('reports the context window the session sent', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 104_857,
      size: 1_048_576,
      cost: { amount: 0, currency: 'USD' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      sessionId: 'native-session',
      usage: expect.objectContaining({
        contextTokens: 104_857,
        contextWindow: 1_048_576,
        contextWindowIsAuthoritative: true,
        model: 'xiaomi/mimo-v2.5-pro-ultraspeed',
        percentage: 10,
      }),
    }));
  });

  it('completes the usage with the tokens the prompt itself cost', () => {
    const { presenter } = createPresenter();
    presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 104_857,
      size: 1_048_576,
    } as unknown as AcpSessionUpdate));

    // The window arrives while the turn is still running, so the tokens the
    // prompt itself cost are only known from the response — and without them
    // the badge's details read zero on every turn.
    const chunks = presenter.present(promptResult({
      stopReason: 'end_turn',
      userMessageId: 'message-1',
      usage: {
        inputTokens: 15_940,
        outputTokens: 4,
        totalTokens: 16_979,
        thoughtTokens: 11,
        cachedReadTokens: 1_024,
      },
    }));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({
        cacheReadInputTokens: 1_024,
        contextTokens: 104_857,
        contextWindow: 1_048_576,
        inputTokens: 15_940,
      }),
    }));
  });

  it('hands the plan indicator the cost the session reported', () => {
    const { presenter, recorded } = createPresenter();

    presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 0,
      size: 1_048_576,
      cost: { amount: 0, currency: 'USD' },
    } as unknown as AcpSessionUpdate));

    // Zero is a report, not a missing one: MiMoCode sends it on a turn that
    // cost nothing, and the indicator has to be able to say so.
    expect(recorded.costs).toEqual([{ amount: 0, currency: 'USD' }]);
  });

  it('learns the session the conversation binds to', () => {
    const { presenter } = createPresenter();
    expect(presenter.lastSessionId()).toBeUndefined();

    presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'OK' },
    } as unknown as AcpSessionUpdate));

    expect(presenter.lastSessionId()).toBe('native-session');
  });

  it('names the messages the turn is saved and forked from', () => {
    const { presenter } = createPresenter();

    presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'OK' },
    } as unknown as AcpSessionUpdate));
    presenter.present(promptResult({ stopReason: 'end_turn', userMessageId: 'message-1' }));

    expect(presenter.consumeTurnMetadata()).toEqual(expect.objectContaining({
      assistantMessageId: 'msg-1',
      userMessageId: 'message-1',
    }));
    // Consumed once: the next turn is described by what it reports itself.
    expect(presenter.consumeTurnMetadata()).toEqual({});
  });

  it('forgets the session a new conversation must not report as its own', () => {
    const { presenter } = createPresenter();
    presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'OK' },
    } as unknown as AcpSessionUpdate));

    presenter.forgetConversation();

    expect(presenter.lastSessionId()).toBeUndefined();
  });

  it('hands the surface the commands, options and mode a session announces', () => {
    const { presenter, recorded } = createPresenter();

    const commands = presenter.present(sessionUpdate({
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'init', description: 'guided AGENTS.md setup' },
        { name: 'review', description: 'review changes [commit|branch|pr], defaults to uncommitted' },
      ],
    } as unknown as AcpSessionUpdate));
    const options = presenter.present(sessionUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'xiaomi/mimo-v2.5-pro-ultraspeed',
        options: [{ value: 'xiaomi/mimo-v2.5-pro-ultraspeed', name: 'Xiaomi/MiMo-V2.5-Pro-UltraSpeed' }],
      }],
    } as unknown as AcpSessionUpdate));
    const mode = presenter.present(sessionUpdate({
      sessionUpdate: 'current_mode_update',
      currentModeId: 'plan',
    } as unknown as AcpSessionUpdate));

    // None of the three is content: they configure the tab, and a chunk drawn
    // from them would put the session's own settings into the transcript.
    expect([...commands, ...options, ...mode]).toEqual([]);
    expect(recorded.commands[0]?.[0]).toEqual(expect.objectContaining({ name: 'init' }));
    expect(recorded.configOptions[0]?.[0]).toEqual(expect.objectContaining({ id: 'model' }));
    expect(recorded.modes).toEqual(['plan']);
  });

  it('reports the configuration the session was opened with', () => {
    const { presenter, recorded } = createPresenter();

    const chunks = presenter.present(sessionConfig({
      sessionId: 'ses_-ffe5fd9eb2b92ffe',
      configOptions: [{
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'build',
        options: [
          { value: 'build', name: 'build' },
          { value: 'plan', name: 'plan' },
        ],
      }] as unknown as AcpSessionConfigOption[],
      models: {
        availableModels: [{
          id: 'xiaomi/mimo-v2.5-pro-ultraspeed',
          name: 'Xiaomi/MiMo-V2.5-Pro-UltraSpeed',
        }],
        currentModelId: 'xiaomi/mimo-v2.5-pro-ultraspeed',
      },
      modes: { availableModes: [{ id: 'build', name: 'build' }], currentModeId: 'build' },
    }));

    // The model list and the mode list are answered once, when the session is
    // created or loaded, and by nothing else afterwards — a selector fed only
    // from later updates stays empty on a fresh vault.
    expect(chunks).toEqual([]);
    expect(recorded.opened).toEqual([expect.objectContaining({
      sessionId: 'ses_-ffe5fd9eb2b92ffe',
      configOptions: [expect.objectContaining({ id: 'mode' })],
    })]);
    // The mode the session opened in is not pushed at the toolbar: `build` is
    // MiMoCode's own default, not a switch the user asked for.
    expect(recorded.modes).toEqual([]);
    expect(presenter.lastSessionId()).toBe('ses_-ffe5fd9eb2b92ffe');
  });

  it('starts each turn without what the last one was refused with', () => {
    // **This asserted a message-start chunk the reset used to make possible.**
    // That chunk reached no surface and is gone, and the defect it stood for —
    // a provider reusing a message id, so the second answer joins the first
    // bubble — cannot happen: the projection derives a turn's assistant message
    // id from its run. What `beginTurn` still clears is per-turn state that is
    // read back, and the refusal is the one with a reader.
    const { presenter } = createPresenter();
    presenter.present({ kind: 'turn-refused', message: 'the model declined' });

    presenter.beginTurn();

    expect(presenter.consumeTurnRefusal()).toBeUndefined();
  });
});
