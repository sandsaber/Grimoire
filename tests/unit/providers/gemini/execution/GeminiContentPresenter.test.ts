import { TOOL_READ } from '@/core/tools/toolNames';
import type {
  AcpNewSessionResponse,
  AcpPromptResponse,
  AcpSessionNotification,
  AcpSessionUpdate,
} from '@/providers/acp/types';
import {
  type GeminiContentPayload,
  GeminiContentPresenter,
  type GeminiSessionOpening,
} from '@/providers/gemini/execution/GeminiContentPresenter';

/**
 * What a flipped Gemini tab draws a turn from.
 *
 * The values are the recorded session's own where the recording reaches them:
 * `gemini 0.55.1` opened a session reporting four modes and a model list, took a
 * prompt and answered with `agent_message_chunk` and `agent_thought_chunk`. It
 * is the first wave-7 recording that reaches an answer at all.
 */
describe('Gemini content presenter', () => {
  interface Recorded {
    readonly costs: unknown[];
    readonly modes: string[];
    readonly opened: GeminiSessionOpening[];
  }

  function createPresenter(): { presenter: GeminiContentPresenter; recorded: Recorded } {
    const recorded: Recorded = { costs: [], modes: [], opened: [] };
    const presenter = new GeminiContentPresenter({
      displayModel: () => 'gemini:gemini-2.5-pro',
      onCost: cost => recorded.costs.push(cost),
      onCurrentMode: modeId => recorded.modes.push(modeId),
      onSessionOpened: opened => recorded.opened.push(opened),
    });
    return { presenter, recorded };
  }

  function sessionUpdate(update: AcpSessionUpdate): GeminiContentPayload {
    const notification: AcpSessionNotification = { sessionId: 'gemini-session', update };
    return { kind: 'session-update', notification };
  }

  function promptResult(response: AcpPromptResponse): GeminiContentPayload {
    return { kind: 'prompt-result', response };
  }

  function sessionConfig(session: AcpNewSessionResponse): GeminiContentPayload {
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
    // what a Gemini user sees today, and changing it is a product decision
    // rather than something a migration should do quietly.
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'tool-1',
      name: 'read',
      input: { file_path: 'note.md' },
    }));
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === TOOL_READ)).toBe(false);
  });

  it('drops the commands a session announces, because nothing asks for them', () => {
    const { presenter } = createPresenter();

    const chunks = presenter.present(sessionUpdate({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'chat', description: 'Manage conversation history' }],
    } as unknown as AcpSessionUpdate));

    // The recording shows this arriving, and `capabilities.ts` declares
    // `supportsProviderCommands: false`. Dropped on purpose rather than by
    // falling through, so the absence reads as a decision.
    expect(chunks).toEqual([]);
  });

  it('reports the configuration the session was opened with', () => {
    const { presenter, recorded } = createPresenter();

    const chunks = presenter.present(sessionConfig({
      sessionId: '480a790b-0ed2-423a-9ff1-fda99be6fb62',
      models: {
        availableModels: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
        currentModelId: 'gemini-2.5-pro',
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
      sessionId: '480a790b-0ed2-423a-9ff1-fda99be6fb62',
    })]);
    // The mode the session opened in is not pushed at the toolbar: `default` is
    // Gemini's own, not a switch the user asked for.
    expect(recorded.modes).toEqual([]);
    expect(presenter.lastSessionId()).toBe('480a790b-0ed2-423a-9ff1-fda99be6fb62');
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
        model: 'gemini:gemini-2.5-pro',
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
