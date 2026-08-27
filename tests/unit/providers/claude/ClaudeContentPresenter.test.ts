import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeContentPresenter } from '@/providers/claude/execution/ClaudeContentPresenter';

/**
 * What a flipped Claude tab draws a turn from.
 *
 * The backend was harvested before the kernel had a content channel, so it
 * reported facts and the answer's text and nothing else. This is the other
 * half: the SDK's own messages, normalized by the code the legacy runtime
 * rendered with, minus the one copy of the text the kernel already carries.
 */
describe('Claude content presenter', () => {
  function createPresenter(overrides: {
    onPlanModeEntered?: () => void;
    onUsageMessage?: (message: unknown) => void;
  } = {}): ClaudeContentPresenter {
    return new ClaudeContentPresenter({
      settings: () => ({ intendedModel: 'claude-opus-5' }),
      ...overrides,
    });
  }

  function assistantMessage(content: unknown[], uuid = 'assistant-1'): SDKMessage {
    return {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { role: 'assistant', content },
      uuid,
      session_id: 'native-session',
    } as unknown as SDKMessage;
  }

  function textDelta(text: string): SDKMessage {
    return {
      type: 'stream_event',
      session_id: 'native-session',
      uuid: `delta-${text}`,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      },
    } as unknown as SDKMessage;
  }

  it('hands every message to whatever counts what a turn cost', async () => {
    const seen: unknown[] = [];
    const presenter = createPresenter({ onUsageMessage: message => seen.push(message) });
    const result = {
      type: 'result',
      subtype: 'success',
      session_id: 'native-session',
      uuid: 'result-1',
      modelUsage: { 'claude-opus-5': { costUSD: 0.42 } },
    } as unknown as SDKMessage;

    presenter.present(result);

    // The plan indicator is fed from the SDK's own result and rate-limit
    // messages, and nothing else carries them. Wave 2 found this exact gap for
    // Codex; Claude kept it — the store had no caller at all.
    expect(seen).toEqual([result]);
  });

  it('renders the tool call a card is drawn from', () => {
    const presenter = createPresenter();

    const chunks = presenter.present(assistantMessage([
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'note.md' } },
    ]));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'tool-1',
      name: 'Read',
    }));
  });

  it('drops the copy of the answer the kernel already carries', () => {
    // The SDK reports the answer twice — as deltas while it runs, and whole in
    // the assistant message — and the backend mirrors the deltas as
    // `output-delta`, which is the copy core can read. Letting either through
    // here prints every sentence twice, which is exactly what the live Codex
    // matrix caught on its first row.
    const presenter = createPresenter();

    const streamed = presenter.present(textDelta('the '));
    const alsoStreamed = presenter.present(textDelta('answer'));
    const whole = presenter.present(assistantMessage([{ type: 'text', text: 'the answer' }]));

    expect(streamed.filter(chunk => chunk.type === 'text')).toEqual([]);
    expect(alsoStreamed.filter(chunk => chunk.type === 'text')).toEqual([]);
    expect(whole.filter(chunk => chunk.type === 'text')).toEqual([]);
  });

  it('renders an answer that never streamed', () => {
    // The dedup is against a delta that arrived, not against the possibility of
    // one: a turn answered in a single message would otherwise render nothing.
    const presenter = createPresenter();

    const chunks = presenter.present(assistantMessage([{ type: 'text', text: 'the answer' }]));

    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text', content: 'the answer' }));
  });

  it('forgets the streamed answer between turns', () => {
    const presenter = createPresenter();
    presenter.present(textDelta('first turn'));

    presenter.beginTurn();
    const chunks = presenter.present(assistantMessage([{ type: 'text', text: 'second turn' }]));

    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text', content: 'second turn' }));
  });

  it('learns the session a conversation has to resume with', () => {
    // The kernel reports the tab's own answer to this question into the
    // registry rather than reading the backend's, so without this a tab starts
    // a new session every turn: no resume across a reload, nothing to fork.
    const presenter = createPresenter();

    presenter.present({
      type: 'system',
      subtype: 'init',
      session_id: 'native-session',
      uuid: 'init-1',
    });

    expect(presenter.lastSessionId()).toBe('native-session');
  });

  it('names the assistant message a fork rewinds to', () => {
    const presenter = createPresenter();

    presenter.present(assistantMessage([{ type: 'text', text: 'hi' }], 'assistant-9'));

    expect(presenter.consumeTurnMetadata()).toMatchObject({ assistantMessageId: 'assistant-9' });
    // Consumed once: the next turn's metadata is its own.
    expect(presenter.consumeTurnMetadata()).toEqual({});
  });

  it('reports the plan mode the SDK entered on its own', () => {
    // `EnterPlanMode` is approved by the SDK itself, so `canUseTool` is never
    // called and the tool call in the stream is the only sign the turn began
    // planning.
    const entered: number[] = [];
    const presenter = createPresenter({ onPlanModeEntered: () => entered.push(1) });

    presenter.present(assistantMessage([
      { type: 'tool_use', id: 'tool-plan', name: 'EnterPlanMode', input: {} },
    ]));

    expect(entered).toHaveLength(1);
  });

  it('keeps a non-fatal error as a notice and remembers the words', () => {
    // The SDK attaches rate limits and billing errors to an *assistant*
    // message, on a turn that often finishes anyway. On the projection path an
    // `error` chunk is turn framing and is filtered out before the column sees
    // it, so this used to vanish with nothing shown — a regression the legacy
    // path did not have, because there `error` rendered inline.
    const presenter = createPresenter();

    const chunks = presenter.present({
      type: 'assistant',
      parent_tool_use_id: null,
      error: 'rate_limit_error: slow down',
      message: { role: 'assistant', content: [] },
      uuid: 'assistant-err',
      session_id: 'native-session',
    });

    expect(chunks).toEqual([
      { type: 'notice', level: 'warning', content: 'rate_limit_error: slow down' },
    ]);
    expect(presenter.lastFailure()).toBe('rate_limit_error: slow down');
  });

  it('leaves a failed result to the terminal, and keeps its words for it', () => {
    // The other half: a result-level error *is* how the turn ended, and the
    // kernel owns that fact. Rendering it as content too would put the failure
    // on screen twice — once from the provider and once from the terminal — so
    // the chunk is dropped and `describeFailure` reads the words back.
    const presenter = createPresenter();

    const chunks = presenter.present({
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['Credit balance is too low'],
      session_id: 'native-session',
      uuid: 'result-err',
    });

    expect(chunks.filter(chunk => chunk.type === 'error')).toHaveLength(0);
    expect(chunks.filter(chunk => chunk.type === 'notice')).toHaveLength(0);
    expect(presenter.lastFailure()).toContain('Credit balance is too low');
  });

  it('drops the session of a conversation the tab has left', () => {
    const presenter = createPresenter();
    presenter.present(assistantMessage([{ type: 'text', text: 'hi' }]));

    presenter.forgetConversation();

    expect(presenter.lastSessionId()).toBeUndefined();
    expect(presenter.consumeTurnMetadata()).toEqual({});
  });
});
