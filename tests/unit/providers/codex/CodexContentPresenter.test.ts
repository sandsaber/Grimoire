import { CodexContentPresenter } from '@/providers/codex/execution/CodexContentPresenter';

/**
 * What a turn's notifications look like once the surface renders them.
 *
 * The normalization is the legacy router's, unchanged: the flip keeps the code
 * that already knows how a Codex tool call is drawn rather than writing a
 * second opinion about it.
 */
describe('Codex content presenter', () => {
  function present(
    presenter: CodexContentPresenter,
    method: string,
    params: unknown,
  ): readonly unknown[] {
    return presenter.present({ method, params });
  }

  it('renders a command execution as the tool call and result the surface reads', () => {
    const presenter = new CodexContentPresenter(() => false);

    present(presenter, 'turn/started', { threadId: 't', turn: { id: 'turn-1' } });
    const started = present(presenter, 'item/started', {
      threadId: 't',
      turnId: 'turn-1',
      item: { type: 'commandExecution', id: 'item-1', command: 'npm test', status: 'inProgress' },
    });
    const completed = present(presenter, 'item/completed', {
      threadId: 't',
      turnId: 'turn-1',
      item: {
        type: 'commandExecution',
        id: 'item-1',
        command: 'npm test',
        status: 'completed',
        aggregatedOutput: 'all green',
        exitCode: 0,
      },
    });

    expect(started).toContainEqual(expect.objectContaining({ type: 'tool_use', name: 'Bash' }));
    expect(completed).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      content: expect.stringContaining('all green'),
    }));
  });

  it('leaves the answer and the reasoning to the kernel, which already carries them', () => {
    // Both arrive as `output-delta` on the neutral channel. Rendering the
    // router's copy as well would print every sentence twice.
    const presenter = new CodexContentPresenter(() => false);

    present(presenter, 'turn/started', { threadId: 't', turn: { id: 'turn-1' } });
    const text = present(presenter, 'item/agentMessage/delta', {
      threadId: 't',
      turnId: 'turn-1',
      itemId: 'message-1',
      delta: 'the answer',
    });
    const reasoning = present(presenter, 'item/reasoning/textDelta', {
      threadId: 't',
      turnId: 'turn-1',
      itemId: 'reason-1',
      delta: 'weighing it up',
    });

    expect(text.filter((chunk: any) => chunk.type === 'text')).toEqual([]);
    expect(reasoning.filter((chunk: any) => chunk.type === 'thinking')).toEqual([]);
  });

  it('draws a reasoning summary as the widget, since the kernel does not carry it', () => {
    const presenter = new CodexContentPresenter(() => false);

    present(presenter, 'turn/started', { threadId: 't', turn: { id: 'turn-1' } });
    const summary = present(presenter, 'item/reasoning/summaryTextDelta', {
      threadId: 't',
      turnId: 'turn-1',
      itemId: 'reason-1',
      delta: 'checking the tests',
    });

    expect(summary.length).toBeGreaterThan(0);
    expect(summary.filter((chunk: any) => chunk.type === 'thinking')).toEqual([]);
  });

  it('leaves the end of the turn, and the failure, to the kernel', () => {
    // The router closes a turn with `done` and renders the daemon's own error.
    // The kernel owns both: a `done` chunk would end the surface's turn before
    // the result is committed, and the terminal already renders one error —
    // the second is the same failure printed twice.
    const presenter = new CodexContentPresenter(() => false);

    present(presenter, 'turn/started', { threadId: 't', turn: { id: 'turn-1' } });
    const completed = present(presenter, 'turn/completed', {
      threadId: 't',
      turn: {
        id: 'turn-1',
        items: [],
        status: 'failed',
        error: { message: 'the model refused' },
      },
    });

    expect(completed.filter((chunk: any) => chunk.type === 'error' || chunk.type === 'done'))
      .toEqual([]);
    // Kept, so the terminal can be rendered in the daemon's own words instead
    // of the neutral sentence.
    expect(presenter.lastFailure()).toBe('the model refused');
  });

  it('says nothing about a payload that is not a notification', () => {
    const presenter = new CodexContentPresenter(() => false);

    expect(presenter.present(null)).toEqual([]);
    expect(presenter.present({ params: {} })).toEqual([]);
  });

  it('carries a plan update, which only a plan turn produces', () => {
    const presenter = new CodexContentPresenter(() => true);

    present(presenter, 'turn/started', { threadId: 't', turn: { id: 'turn-1' } });
    const planned = present(presenter, 'item/plan/delta', {
      threadId: 't',
      turnId: 'turn-1',
      itemId: 'plan-1',
      delta: 'step one',
    });

    expect(planned.length).toBeGreaterThan(0);
  });
});
