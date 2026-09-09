import { TOOL_READ } from '@/core/tools/toolNames';
import type {
  AcpNewSessionResponse,
  AcpPromptResponse,
  AcpSessionNotification,
  AcpSessionUpdate,
} from '@/providers/acp/types';
import {
  type DevinContentPayload,
  DevinContentPresenter,
  type DevinSessionOpening,
} from '@/providers/devin/execution/DevinContentPresenter';

/**
 * What a Devin tab draws a turn from. The shapes are the recording's:
 * `tests/fixtures/provider-traces/wire/devin-wire.json`.
 */
describe('Devin content presenter', () => {
  interface Recorded {
    readonly commands: unknown[];
    readonly configOptions: unknown[];
    readonly costs: unknown[];
    readonly modes: string[];
    readonly opened: DevinSessionOpening[];
  }

  function createPresenter(): { presenter: DevinContentPresenter; recorded: Recorded } {
    const recorded: Recorded = { commands: [], configOptions: [], costs: [], modes: [], opened: [] };
    const presenter = new DevinContentPresenter({
      displayModel: () => 'devin:swe-1-6-slow',
      onCommands: commands => recorded.commands.push(...commands),
      onConfigOptions: options => recorded.configOptions.push(options),
      onCost: cost => recorded.costs.push(cost),
      onCurrentMode: modeId => recorded.modes.push(modeId),
      onSessionOpened: opened => recorded.opened.push(opened),
    });
    return { presenter, recorded };
  }

  function sessionUpdate(update: AcpSessionUpdate): DevinContentPayload {
    const notification: AcpSessionNotification = { sessionId: 'prickly-conga', update };
    return { kind: 'session-update', notification };
  }

  function promptResult(response: AcpPromptResponse): DevinContentPayload {
    return { kind: 'prompt-result', response };
  }

  function sessionConfig(session: AcpNewSessionResponse): DevinContentPayload {
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
      _meta: { 'cognition.ai/inferenceToolName': 'exec' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'call_5e4c9ce1e5d245ad98a99409',
      name: 'Ran echo',
      input: { command: 'echo grimoire-probe' },
    }));
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === TOOL_READ)).toBe(false);
  });

  it('remembers a tool call for the permission request that follows it', () => {
    const recorded: unknown[] = [];
    const presenter = new DevinContentPresenter({
      displayModel: () => 'devin:swe-1-6-slow',
      onToolCall: call => recorded.push(call),
    });

    presenter.present(sessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_a0ee957950984567aa8eecfd',
      title: 'Wrote /vault/plan.md',
      kind: 'edit',
      content: [{ type: 'diff', path: '/vault/plan.md', newText: '# plan' }],
      _meta: { 'cognition.ai/inferenceToolName': 'write' },
    } as unknown as AcpSessionUpdate));

    expect(recorded).toEqual([expect.objectContaining({
      toolCallId: 'call_a0ee957950984567aa8eecfd',
      title: 'Wrote /vault/plan.md',
      kind: 'edit',
      diffPath: '/vault/plan.md',
    })]);
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
        model: 'devin:swe-1-6-slow',
      }),
    }));
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
