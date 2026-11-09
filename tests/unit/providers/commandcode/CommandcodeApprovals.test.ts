import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import { runId } from '@/core/execution/ExecutionIds';
import { CommandcodeApprovalPresenter, CommandcodeApprovals } from '@/providers/commandcode/execution/CommandcodeApprovals';

describe('Command Code approval lifecycle', () => {
  const id = runId(`run-${'1'.repeat(32)}`);
  const tool = { toolCallId: 'edit-1', toolName: 'edit_file', input: { file_path: 'Note.md' } };
  it('resolves once and discards a late allowance after cancellation', async () => {
    const approvals = new CommandcodeApprovals();
    const events: ProviderExecutionEvent['event'][] = [];
    const abort = new AbortController();
    const answer = approvals.request(id, tool, abort.signal, event => events.push(event));
    const opened = events[0];
    if (opened.kind !== 'interaction-opened') throw new Error('Missing approval');
    expect(approvals.presentation(opened.interaction.presentationRef)).toEqual(tool);
    abort.abort();
    await approvals.resolve({ interactionId: opened.interaction.interactionId, responseId: 'allow-once', resolvedAt: Date.now() });
    expect(await answer).toBe(false);
    expect(events.filter(event => event.kind === 'interaction-resolved')).toHaveLength(1);
    expect(approvals.presentation(opened.interaction.presentationRef)).toBeUndefined();
  });

  it.each(['allow', 'deny', 'cancel'] as const)('maps the visible decision %s to a one-time response', async decision => {
    const approvals = new CommandcodeApprovals();
    let request!: InteractionRequest;
    const answer = approvals.request(id, tool, new AbortController().signal, event => {
      if (event.kind === 'interaction-opened') request = event.interaction;
    });
    const approval = jest.fn(async () => decision);
    const presenter = new CommandcodeApprovalPresenter(approvals, () => ({ approval }));
    const responseId = await presenter.present(request);
    expect(approval).toHaveBeenCalledWith('Edit', tool.input, expect.any(String), expect.objectContaining({
      decisionOptions: [expect.objectContaining({ value: 'allow-once' }), expect.objectContaining({ value: 'deny' })],
    }));
    expect(responseId).toBe(decision === 'allow' ? 'allow-once' : 'deny');
    await approvals.resolve({ interactionId: request.interactionId, responseId: responseId!, resolvedAt: Date.now() });
    expect(await answer).toBe(decision === 'allow');
  });
});
