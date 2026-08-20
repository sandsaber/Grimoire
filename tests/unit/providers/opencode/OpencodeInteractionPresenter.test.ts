import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import { interactionId, runId } from '@/core/execution/ExecutionIds';
import type { ExecutionInteractionCallbacks } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ApprovalDecision } from '@/core/types';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { OpencodeInteractionBridge } from '@/providers/opencode/execution/OpencodeInteractionBridge';
import { OpencodeInteractionPresenter } from '@/providers/opencode/execution/OpencodeInteractionPresenter';

/**
 * How an opened OpenCode approval reaches the surface, and comes back as an id
 * the run can record.
 *
 * The chat surface speaks the legacy callback contract — a tool name, an input,
 * a description, a set of decision options — and the kernel speaks response
 * ids. This is where the two meet.
 */
describe('OpenCode interaction presenter', () => {
  function permissionRequest(): AcpRequestPermissionRequest {
    return {
      sessionId: 'acp-session-1',
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
        { optionId: 'no', kind: 'reject_once', name: 'Deny' },
      ],
      toolCall: { toolCallId: 'tool-1', title: 'bash', rawInput: { command: 'ls' } },
    };
  }

  async function open(
    bridge: OpencodeInteractionBridge,
  ): Promise<InteractionRequest> {
    const prepared = await bridge.prepare(permissionRequest());
    return {
      interactionId: interactionId(`ix-${'1'.repeat(32)}`),
      runId: runId(`run-${'1'.repeat(32)}`),
      kind: prepared.kind,
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    };
  }

  function createPresenter(callbacks: ExecutionInteractionCallbacks): {
    bridge: OpencodeInteractionBridge;
    presenter: OpencodeInteractionPresenter;
  } {
    const bridge = new OpencodeInteractionBridge();
    return { bridge, presenter: new OpencodeInteractionPresenter(bridge, () => callbacks) };
  }

  it('asks the surface in the words the request was described with', async () => {
    const approval = jest.fn(async (): Promise<ApprovalDecision> => 'allow');
    const { bridge, presenter } = createPresenter({ approval });
    const request = await open(bridge);

    await presenter.present(request);

    expect(approval).toHaveBeenCalledWith(
      'bash',
      { command: 'ls' },
      'OpenCode wants to run a shell command.',
      expect.objectContaining({
        decisionReason: 'Command execution permission required',
        // No `decision` on any of them: it makes the surface answer with that
        // word instead of the option picked, and two allowances of one kind —
        // which OpenCode offers for path-scoped ones — then collapse into the
        // first.
        decisionOptions: [
          { label: 'Allow', value: 'allow-once', presentation: 'allow' },
          { label: 'Always allow', value: 'allow-always', presentation: 'always' },
          { label: 'Deny', value: 'reject-once', presentation: 'reject' },
        ],
      }),
    );
  });

  it('summarizes a workflow approval with the tools it would pre-approve', async () => {
    const approval = jest.fn(async (): Promise<ApprovalDecision> => 'allow');
    const bridge = new OpencodeInteractionBridge();
    const presenter = new OpencodeInteractionPresenter(bridge, () => ({ approval }));
    const prepared = await bridge.prepare({
      sessionId: 'acp-session-1',
      options: [{ optionId: 'approve-now', kind: 'allow_once', name: 'Allow once' }],
      toolCall: {
        kind: 'other',
        rawInput: {
          tools: [
            { name: 'bash', args: JSON.stringify({ title: 'npm test' }) },
            { name: 'edit', args: JSON.stringify({ title: 'src/app.ts' }) },
            { name: 'read', args: '{}' },
            { name: 'glob', args: '{}' },
          ],
        },
        title: 'workflow_tool_approval',
        toolCallId: 'tool-2',
      },
    });

    await presenter.present({
      interactionId: interactionId(`ix-${'2'.repeat(32)}`),
      runId: runId(`run-${'2'.repeat(32)}`),
      kind: prepared.kind,
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    });

    // A session-level pre-approval says what it would pre-approve, in the
    // vocabulary the legacy runtime built and this kept.
    expect(approval).toHaveBeenCalledWith(
      'Workflow Approval',
      expect.objectContaining({ tools: expect.any(Array) }),
      'Pre-approve workflow tools for this session: bash: npm test, edit: src/app.ts, read +1 more.',
      expect.objectContaining({
        decisionReason: 'Session-level workflow approval requested',
        decisionOptions: [
          expect.objectContaining({ label: 'Allow once', value: 'allow-once' }),
        ],
      }),
    );
  });

  it('answers with the id the option it offered stands for', async () => {
    const { bridge, presenter } = createPresenter({
      approval: async () => ({ type: 'select-option', value: 'allow-always' }),
    });
    const request = await open(bridge);

    await expect(presenter.present(request)).resolves.toBe('allow-always');
  });

  it('reads a plain decision as the option that expresses it', async () => {
    const { bridge, presenter } = createPresenter({ approval: async () => 'deny' });
    const request = await open(bridge);

    // The surface may answer in its own vocabulary rather than by picking one
    // of the options it was given, which is what a keyboard shortcut does.
    await expect(presenter.present(request)).resolves.toBe('reject-once');
  });

  it('cancels the turn when the prompt was dismissed', async () => {
    const { bridge, presenter } = createPresenter({ approval: async () => 'cancel' });
    const request = await open(bridge);

    await expect(presenter.present(request)).resolves.toBe('cancel');
  });

  it('refuses rather than hanging when no surface can ask', async () => {
    const { bridge, presenter } = createPresenter({});
    const request = await open(bridge);

    // A prompt nobody can see would hang the turn, and the agent is waiting on
    // this answer before it does anything at all.
    await expect(presenter.present(request)).resolves.toBe('reject-once');
  });

  it('refuses when the surface could not ask at all', async () => {
    const { bridge, presenter } = createPresenter({
      approval: async () => { throw new Error('detached view'); },
    });
    const request = await open(bridge);

    await expect(presenter.present(request)).resolves.toBe('reject-once');
  });

  it('says nothing for an interaction that ended somewhere else', async () => {
    let resolveApproval: ((decision: ApprovalDecision) => void) | undefined;
    const dismisser = jest.fn();
    const { bridge, presenter } = createPresenter({
      approval: () => new Promise<ApprovalDecision>(resolve => { resolveApproval = resolve; }),
      approvalDismisser: dismisser,
    });
    const request = await open(bridge);

    const presented = presenter.present(request);
    await Promise.resolve();
    presenter.dismiss(request.presentationRef);
    resolveApproval?.('allow');

    // A run cancelled mid-approval is not the user choosing to cancel it.
    await expect(presented).resolves.toBeNull();
    expect(dismisser).toHaveBeenCalledTimes(1);
  });

  it('shows nothing for a request it has no presentation for', async () => {
    const approval = jest.fn(async (): Promise<ApprovalDecision> => 'allow');
    const { bridge, presenter } = createPresenter({ approval });
    const request = await open(bridge);
    // Settled elsewhere before the surface got to it: the bridge forgot what
    // the request was about, and answering anyway would be the UI deciding on
    // the user's behalf.
    const forgotten: InteractionRequest = { ...request, presentationRef: 'ocix-missing' };

    await expect(presenter.present(forgotten)).resolves.toBeNull();
    expect(approval).not.toHaveBeenCalled();
  });

  it('takes every open prompt down when the tab closes', async () => {
    const dismisser = jest.fn();
    const { bridge, presenter } = createPresenter({
      approval: () => new Promise<ApprovalDecision>(() => undefined),
      approvalDismisser: dismisser,
    });
    const request = await open(bridge);
    void presenter.present(request);
    await Promise.resolve();

    presenter.dismissAll();

    expect(dismisser).toHaveBeenCalledTimes(1);
  });
});
