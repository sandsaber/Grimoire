import { PiContentPresenter } from '@/providers/pi/execution/PiContentPresenter';

describe('Pi terminal output', () => {
  it('accumulates terminal deltas and retains the result when completion has only exit metadata', () => {
    const presenter = new PiContentPresenter(() => undefined, () => undefined);
    const emit = (update: unknown) => presenter.present({ kind: 'session-update', notification: { sessionId: 'pi', update } });
    expect(emit({ sessionUpdate: 'tool_call', toolCallId: 't', kind: 'execute', title: 'printf hello', status: 'in_progress',
      content: [{ type: 'terminal', terminalId: 't' }], _meta: { terminal_info: { terminal_id: 't', cwd: '/vault' } } }))
      .toContainEqual(expect.objectContaining({ type: 'tool_use', input: { command: 'printf hello' } }));
    expect(emit({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'in_progress',
      _meta: { terminal_output: { terminal_id: 't', data: 'hel' } } }))
      .toContainEqual({ type: 'tool_output', id: 't', content: 'hel' });
    emit({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'in_progress',
      _meta: { terminal_output: { terminal_id: 't', data: 'lo' } } });
    expect(emit({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed',
      _meta: { terminal_exit: { terminal_id: 't', exit_code: 0, signal: null } } }))
      .toContainEqual({ type: 'tool_result', id: 't', content: 'hello', isError: false });
    presenter.beginTurn();
    emit({ sessionUpdate: 'tool_call', toolCallId: 't', kind: 'execute', title: 'false',
      content: [{ type: 'terminal', terminalId: 't' }] });
    const next = emit({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'failed',
      _meta: { terminal_output: { terminal_id: 't', data: 'failure' } } });
    expect(next).toContainEqual({ type: 'tool_result', id: 't', content: 'failure', isError: true });
  });
});
