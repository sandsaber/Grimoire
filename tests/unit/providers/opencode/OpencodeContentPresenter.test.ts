import { TOOL_READ } from '@/core/tools/toolNames';
import type { SlashCommand } from '@/core/types';
import type {
  AcpPromptResponse,
  AcpSessionConfigOption,
  AcpSessionNotification,
  AcpSessionUpdate,
} from '@/providers/acp/types';
import {
  type OpencodeContentPayload,
  OpencodeContentPresenter,
} from '@/providers/opencode/execution/OpencodeContentPresenter';

/**
 * What a flipped OpenCode tab draws a turn from.
 *
 * The backend carries the session updates and reports facts about them — a
 * tool started, a thought happened — and the answer's text. This is the other
 * half: the updates themselves, normalized by the code the legacy runtime
 * rendered with, minus the one copy of the answer the kernel already carries.
 */
describe('OpenCode content presenter', () => {
  interface Recorded {
    readonly commands: SlashCommand[][];
    readonly configOptions: AcpSessionConfigOption[][];
    readonly costs: unknown[];
    readonly modes: string[];
  }

  function createPresenter(): { presenter: OpencodeContentPresenter; recorded: Recorded } {
    const recorded: Recorded = { commands: [], configOptions: [], costs: [], modes: [] };
    const presenter = new OpencodeContentPresenter({
      displayModel: () => 'opencode/big-pickle',
      onCommands: commands => recorded.commands.push([...commands]),
      onConfigOptions: options => recorded.configOptions.push([...options]),
      onCost: cost => recorded.costs.push(cost),
      onCurrentMode: modeId => recorded.modes.push(modeId),
    });
    return { presenter, recorded };
  }

  function sessionUpdate(update: AcpSessionUpdate): OpencodeContentPayload {
    const notification: AcpSessionNotification = { sessionId: 'native-session', update };
    return { kind: 'session-update', notification };
  }

  function promptResult(response: AcpPromptResponse): OpencodeContentPayload {
    return { kind: 'prompt-result', response };
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

  it('renders the plan a turn is following', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read the note', priority: 'medium', status: 'in_progress' },
        { content: 'Write the answer', priority: 'medium', status: 'pending' },
      ],
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'progress',
      content: 'Read the note',
      state: 'running',
    }));
  });

  it('reports the context window the session sent', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 16_964,
      size: 200_000,
      cost: { amount: 0, currency: 'USD' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      sessionId: 'native-session',
      usage: expect.objectContaining({
        contextTokens: 16_964,
        contextWindow: 200_000,
        contextWindowIsAuthoritative: true,
        model: 'opencode/big-pickle',
        percentage: 8,
      }),
    }));
  });

  it('completes the usage with the tokens the prompt itself cost', () => {
    const { presenter } = createPresenter();
    presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 16_964,
      size: 200_000,
    } as unknown as AcpSessionUpdate));

    // The window arrives before the answer is finished, so the tokens the
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
        contextTokens: 16_964,
        contextWindow: 200_000,
        inputTokens: 15_940,
      }),
    }));
  });

  it('hands the plan indicator the cost the session reported', () => {
    const { presenter, recorded } = createPresenter();

    presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 10,
      size: 100,
      cost: { amount: 0.42, currency: 'USD' },
    } as unknown as AcpSessionUpdate));

    expect(recorded.costs).toEqual([{ amount: 0.42, currency: 'USD' }]);
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
      availableCommands: [{ name: 'brainstorming', description: 'Explore intent' }],
    } as unknown as AcpSessionUpdate));
    const options = presenter.present(sessionUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'opencode/big-pickle',
        options: [{ value: 'opencode/big-pickle', name: 'Big Pickle' }],
      }],
    } as unknown as AcpSessionUpdate));
    const mode = presenter.present(sessionUpdate({
      sessionUpdate: 'current_mode_update',
      currentModeId: 'plan',
    } as unknown as AcpSessionUpdate));

    // None of the three is content: they configure the tab, and a chunk drawn
    // from them would put the session's own settings into the transcript.
    expect([...commands, ...options, ...mode]).toEqual([]);
    expect(recorded.commands[0]?.[0]).toEqual(expect.objectContaining({ name: 'brainstorming' }));
    expect(recorded.configOptions[0]?.[0]).toEqual(expect.objectContaining({ id: 'model' }));
    expect(recorded.modes).toEqual(['plan']);
  });

  it('starts each turn without the last turn message ids', () => {
    const { presenter } = createPresenter();
    const update = sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'OK' },
    } as unknown as AcpSessionUpdate);
    presenter.present(update);

    presenter.beginTurn();
    const chunks = presenter.present(update);

    // Without the reset the second turn's answer has no start, and the surface
    // appends it to the message the first turn opened.
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'assistant_message_start',
      itemId: 'msg-1',
    }));
  });

  it('ignores a payload that carries nothing it knows', () => {
    const { presenter } = createPresenter();

    expect(presenter.present(null)).toEqual([]);
    expect(presenter.present({ kind: 'something-else' })).toEqual([]);
  });
});
