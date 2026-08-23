import { TOOL_READ } from '@/core/tools/toolNames';
import type {
  AcpNewSessionResponse,
  AcpPromptResponse,
  AcpSessionNotification,
  AcpSessionUpdate,
} from '@/providers/acp/types';
import {
  type QwenContentPayload,
  QwenContentPresenter,
  type QwenSessionOpening,
} from '@/providers/qwen/execution/QwenContentPresenter';

/**
 * What a flipped Qwen tab draws a turn from.
 *
 * **None of these values were observed.** This provider's wire recording never
 * opened a session — `qwen 0.21.15` answered `session/new` with "Authentication
 * required" — so the shapes here come from `QwenChatRuntime`, which has been
 * driving the same CLI on the legacy path. What is asserted is what that runtime
 * does with them, which is the thing the flip must not change.
 */
describe('Qwen content presenter', () => {
  interface Recorded {
    readonly commands: unknown[];
    readonly costs: unknown[];
    readonly modes: string[];
    readonly opened: QwenSessionOpening[];
  }

  function createPresenter(): { presenter: QwenContentPresenter; recorded: Recorded } {
    const recorded: Recorded = { commands: [], costs: [], modes: [], opened: [] };
    const presenter = new QwenContentPresenter({
      displayModel: () => 'qwen:qwen3-coder-plus',
      onCommands: commands => recorded.commands.push(...commands),
      onCost: cost => recorded.costs.push(cost),
      onCurrentMode: modeId => recorded.modes.push(modeId),
      onSessionOpened: opened => recorded.opened.push(opened),
    });
    return { presenter, recorded };
  }

  function sessionUpdate(update: AcpSessionUpdate): QwenContentPayload {
    const notification: AcpSessionNotification = { sessionId: 'qwen-session', update };
    return { kind: 'session-update', notification };
  }

  function promptResult(response: AcpPromptResponse): QwenContentPayload {
    return { kind: 'prompt-result', response };
  }

  function sessionConfig(session: AcpNewSessionResponse): QwenContentPayload {
    return { kind: 'session-config', session };
  }

  it('drops the copy of the answer the kernel already carries', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'OK' },
    } as unknown as AcpSessionUpdate));

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
      content: { type: 'text', text: 'Considering the file' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual({ type: 'thinking', content: 'Considering the file' });
  });

  it('forwards a tool call as the normalizer produced it', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'read',
      kind: 'read',
      status: 'pending',
      rawInput: { file_path: 'note.md' },
    } as unknown as AcpSessionUpdate));

    // No tool stream adapter for this provider: it has no `normalization/`
    // directory at all. So the name on the card is the agent's own word, not
    // the canonical `Read` its siblings map to — asserted here because that is
    // what a Qwen user sees today, and changing it is a product decision
    // rather than something a migration should do quietly.
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'tool-1',
      name: 'read',
      input: { file_path: 'note.md' },
    }));
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === TOOL_READ)).toBe(false);
  });

  it('keeps the commands a session announces, where Gemini drops them', () => {
    const { presenter, recorded } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'clear', description: 'Clear the conversation' }],
    } as unknown as AcpSessionUpdate));

    // `supportsProviderCommands: true` for this provider, and the workspace
    // declares `runtimeCommandDiscovery: 'active-session-only'` — so the tab
    // lists what the open session announced, and nothing else can answer for it.
    expect(chunks).toEqual([]);
    expect(recorded.commands).toEqual([expect.objectContaining({ name: 'clear' })]);
  });

  it('refuses to draw a nested agent activity in the conversation transcript', () => {
    // This provider streams a subagent's own thoughts, messages and tool calls
    // through the *parent* session, tagged on the update. Rendered here they
    // interleave concurrently running agents into one transcript and corrupt the
    // visible answer — the parent Agent tool call stays, its children do not.
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'child-1',
      content: { type: 'text', text: 'nested' },
      _meta: { parentToolCallId: 'tool-1', subagentType: 'general' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toEqual([]);
  });

  it('draws an update that carries only half the subagent marking', () => {
    // Both halves or neither: a `_meta` with one of them is not a subagent's,
    // and dropping it would silently lose the conversation's own activity.
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'Considering the file' },
      _meta: { parentToolCallId: 'tool-1' },
    } as unknown as AcpSessionUpdate));

    expect(chunks).toContainEqual({ type: 'thinking', content: 'Considering the file' });
  });

  it('reports the configuration the session was opened with', () => {
    const { presenter, recorded } = createPresenter();

    const chunks = presenter.present(sessionConfig({
      sessionId: 'qwen-session-1',
      models: {
        availableModels: [{ id: 'qwen3-coder-plus', name: 'Qwen 2.5 Pro' }],
        currentModelId: 'qwen3-coder-plus',
      },
      modes: {
        availableModes: [
          { id: 'default', name: 'Default', description: 'Prompts for approval' },
          { id: 'autoEdit', name: 'Auto Edit', description: 'Auto-approves edit tools' },
          { id: 'yolo', name: 'YOLO', description: 'Auto-approves all tools' },
          { id: 'plan', name: 'Plan', description: 'Read-only mode' },
        ],
        currentModeId: 'default',
      },
    }));

    expect(chunks).toEqual([]);
    expect(recorded.opened).toEqual([expect.objectContaining({
      sessionId: 'qwen-session-1',
    })]);
    // The mode the session opened in is not pushed at the toolbar: `default` is
    // Qwen's own, not a switch the user asked for.
    expect(recorded.modes).toEqual([]);
    expect(presenter.lastSessionId()).toBe('qwen-session-1');
  });

  it('completes the usage with the tokens the prompt itself cost', () => {
    const { presenter } = createPresenter();
    presenter.present(sessionUpdate({
      sessionUpdate: 'usage_update',
      used: 4_096,
      size: 1_048_576,
    } as unknown as AcpSessionUpdate));

    const chunks = presenter.present(promptResult({
      stopReason: 'end_turn',
      userMessageId: 'message-1',
      usage: { inputTokens: 3_900, outputTokens: 12, totalTokens: 3_912 },
    }));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({
        contextTokens: 4_096,
        contextWindow: 1_048_576,
        inputTokens: 3_900,
        model: 'qwen:qwen3-coder-plus',
      }),
    }));
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

  it('names the messages the turn is saved from, once', () => {
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
    expect(presenter.consumeTurnMetadata()).toEqual({});
  });
});
