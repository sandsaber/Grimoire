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
  type KimicodeContentPayload,
  KimicodeContentPresenter,
  type KimicodeSessionOpening,
} from '@/providers/kimicode/execution/KimicodeContentPresenter';

/**
 * What a flipped Kimi Code tab draws a turn from.
 *
 * The backend carries the session updates and reports facts about them — a tool
 * started, a thought happened — and the answer's text. This is the other half:
 * the updates themselves, normalized by the code the legacy runtime rendered
 * with, minus the one copy of the answer the kernel already carries.
 *
 * **None of the values below are Kimi Code's own.** Its wire recording never
 * opened a session — `kimi acp` answered `session/new` with "Authentication
 * required" — so there is no observed model, mode, command list or context
 * window to build a fixture from. What is asserted is the presenter's behaviour
 * against shapes the normalizer defines, with model ids this provider's own
 * model tests already use. The live smoke harness is what will put real values
 * through it.
 */
describe('Kimi Code content presenter', () => {
  interface Recorded {
    readonly commands: SlashCommand[][];
    readonly configOptions: AcpSessionConfigOption[][];
    readonly costs: unknown[];
    readonly modes: string[];
    readonly opened: KimicodeSessionOpening[];
  }

  function createPresenter(): { presenter: KimicodeContentPresenter; recorded: Recorded } {
    const recorded: Recorded = {
      commands: [],
      configOptions: [],
      costs: [],
      modes: [],
      opened: [],
    };
    const presenter = new KimicodeContentPresenter({
      displayModel: () => 'anthropic/claude-sonnet-4',
      onCommands: commands => recorded.commands.push([...commands]),
      onConfigOptions: options => recorded.configOptions.push([...options]),
      onCost: cost => recorded.costs.push(cost),
      onCurrentMode: modeId => recorded.modes.push(modeId),
      onSessionOpened: opened => recorded.opened.push(opened),
    });
    return { presenter, recorded };
  }

  function sessionUpdate(update: AcpSessionUpdate): KimicodeContentPayload {
    const notification: AcpSessionNotification = { sessionId: 'native-session', update };
    return { kind: 'session-update', notification };
  }

  function promptResult(response: AcpPromptResponse): KimicodeContentPayload {
    return { kind: 'prompt-result', response };
  }

  function sessionConfig(session: AcpNewSessionResponse): KimicodeContentPayload {
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
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'assistant_message_start',
      itemId: 'msg-1',
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

  it('keeps a user chunk whole, because nothing else carries it', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'msg-user',
      content: { type: 'text', text: 'Reply with exactly: ok' },
    } as unknown as AcpSessionUpdate));

    // Only the assistant's chunks are filtered, and only their text: what the
    // user said reaches the surface inside the message it opens, and nothing
    // else carries it into a resumed transcript.
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'user_message_start',
      itemId: 'msg-user',
      content: 'Reply with exactly: ok',
    }));
  });

  it('reports the context window the session sent', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 16_384,
      size: 262_144,
      cost: { amount: 0, currency: 'USD' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      sessionId: 'native-session',
      usage: expect.objectContaining({
        contextTokens: 16_384,
        contextWindow: 262_144,
        contextWindowIsAuthoritative: true,
        model: 'anthropic/claude-sonnet-4',
        percentage: 6,
      }),
    }));
  });

  it('completes the usage with the tokens the prompt itself cost', () => {
    const { presenter } = createPresenter();
    presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 16_384,
      size: 262_144,
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
        contextTokens: 16_384,
        contextWindow: 262_144,
        inputTokens: 15_940,
      }),
    }));
  });

  it('hands the plan indicator the cost the session reported', () => {
    const { presenter, recorded } = createPresenter();

    presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 0,
      size: 262_144,
      cost: { amount: 0, currency: 'USD' },
    } as unknown as AcpSessionUpdate));

    // Zero is a report, not a missing one: a turn that cost nothing still says
    // so, and the indicator has to be able to show it.
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
        { name: 'review', description: 'review the diff' },
      ],
    } as unknown as AcpSessionUpdate));
    const options = presenter.present(sessionUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'anthropic/claude-sonnet-4',
        options: [{ value: 'anthropic/claude-sonnet-4', name: 'Anthropic/Claude Sonnet 4' }],
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
      sessionId: 'kimi-session-1',
      configOptions: [{
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'default',
        options: [
          { value: 'auto', name: 'Auto' },
          { value: 'default', name: 'Default' },
          { value: 'plan', name: 'Plan' },
        ],
      }] as unknown as AcpSessionConfigOption[],
      models: {
        availableModels: [{
          id: 'anthropic/claude-sonnet-4',
          name: 'Anthropic/Claude Sonnet 4',
        }],
        currentModelId: 'anthropic/claude-sonnet-4',
      },
      // Kimi Code's own mode ids, not the Grimoire-minted ones its two siblings
      // use: `modes.ts` names `auto`, `default` and `plan`.
      modes: { availableModes: [{ id: 'default', name: 'Default' }], currentModeId: 'default' },
    }));

    // The model list and the mode list are answered once, when the session is
    // created or loaded, and by nothing else afterwards — a selector fed only
    // from later updates stays empty on a fresh vault.
    expect(chunks).toEqual([]);
    expect(recorded.opened).toEqual([expect.objectContaining({
      sessionId: 'kimi-session-1',
      configOptions: [expect.objectContaining({ id: 'mode' })],
    })]);
    // The mode the session opened in is not pushed at the toolbar: it is the
    // agent's own default, not a switch the user asked for.
    expect(recorded.modes).toEqual([]);
    expect(presenter.lastSessionId()).toBe('kimi-session-1');
  });

  it('starts each turn without the ids the last one opened', () => {
    const { presenter } = createPresenter();
    presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'first' },
    } as unknown as AcpSessionUpdate));

    presenter.beginTurn();
    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'second' },
    } as unknown as AcpSessionUpdate));

    // Same message id, second turn: without the reset the normalizer treats it
    // as the message it already opened and the answer is appended to the
    // previous turn's.
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'assistant_message_start',
      itemId: 'msg-1',
    }));
  });
});
