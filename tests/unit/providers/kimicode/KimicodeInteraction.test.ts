import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import { interactionId, runId } from '@/core/execution/ExecutionIds';
import type { ExecutionInteractionCallbacks } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ApprovalDecision } from '@/core/types';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { KimicodeInteractionBridge } from '@/providers/kimicode/execution/KimicodeInteractionBridge';
import { KimicodeInteractionPresenter } from '@/providers/kimicode/execution/KimicodeInteractionPresenter';

/**
 * What a flipped Kimi Code tab asks before it edits anything, and how the answer
 * gets back.
 *
 * The bridge and the presenter are the shared ACP ones, proven by OpenCode and
 * Grok; what is Kimi Code's is the sentence a person reads and the fact that
 * these two are wired to each other at all. So this covers the seam rather than
 * re-testing the protocol: a bridge built without its vocabulary would describe
 * the wrong action, and a presenter that never reached the surface would leave
 * the agent waiting for ever on a permission nobody was shown.
 */
describe('Kimi Code interactions', () => {
  function permissionRequest(
    overrides: Partial<AcpRequestPermissionRequest> = {},
  ): AcpRequestPermissionRequest {
    return {
      sessionId: 'acp-session-1',
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
        { optionId: 'no', kind: 'reject_once', name: 'Deny' },
      ],
      toolCall: { toolCallId: 'tool-1', title: 'bash', rawInput: { command: 'ls' } },
      ...overrides,
    };
  }

  async function open(
    bridge: KimicodeInteractionBridge,
    request: AcpRequestPermissionRequest = permissionRequest(),
  ): Promise<InteractionRequest> {
    const prepared = await bridge.prepare(request);
    return {
      interactionId: interactionId(`ix-${'1'.repeat(32)}`),
      runId: runId(`run-${'1'.repeat(32)}`),
      kind: prepared.kind,
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    };
  }

  function createPresenter(callbacks: ExecutionInteractionCallbacks): {
    bridge: KimicodeInteractionBridge;
    presenter: KimicodeInteractionPresenter;
  } {
    const bridge = new KimicodeInteractionBridge();
    return { bridge, presenter: new KimicodeInteractionPresenter(bridge, () => callbacks) };
  }

  it('describes the permission in Kimi Code own words', async () => {
    const bridge = new KimicodeInteractionBridge();

    const prepared = await bridge.prepare(permissionRequest());

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      kind: 'approval',
      toolName: 'bash',
      description: 'Kimi Code wants to run a shell command.',
      decisionReason: 'Command execution permission required',
      input: { command: 'ls' },
    }));
  });

  it('names the path a write is blocked on', async () => {
    const bridge = new KimicodeInteractionBridge();

    const prepared = await bridge.prepare(permissionRequest({
      toolCall: {
        toolCallId: 'tool-2',
        title: 'edit',
        rawInput: {},
        locations: [{ path: 'notes/today.md' }],
      },
    }));

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      toolName: 'edit',
      description: 'Kimi Code wants to modify this file.',
      blockedPath: 'notes/today.md',
    }));
  });

  it('carries every option the agent offered as an id the kernel accepts', async () => {
    const bridge = new KimicodeInteractionBridge();

    const prepared = await bridge.prepare(permissionRequest({
      options: [
        { optionId: 'opt one!', kind: 'allow_once', name: 'Allow' },
        { optionId: 'opt two!', kind: 'reject_always', name: 'Never' },
      ],
    }));

    // The agent picks its own option ids and the control store accepts only
    // constrained identifiers, so the id the kernel carries is minted here.
    for (const responseId of prepared.responseIds) {
      expect(responseId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    }
    await expect(prepared.resolve('reject-always')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'opt two!' },
    });
  });

  it('asks the surface in the words the request was described with', async () => {
    const approval = jest.fn(async (): Promise<ApprovalDecision> => 'allow');
    const { bridge, presenter } = createPresenter({ approval });
    const request = await open(bridge);

    await presenter.present(request);

    expect(approval).toHaveBeenCalledWith(
      'bash',
      { command: 'ls' },
      'Kimi Code wants to run a shell command.',
      expect.objectContaining({
        decisionReason: 'Command execution permission required',
        decisionOptions: [
          { label: 'Allow', value: 'allow-once', presentation: 'allow' },
          { label: 'Always allow', value: 'allow-always', presentation: 'always' },
          { label: 'Deny', value: 'reject-once', presentation: 'reject' },
        ],
      }),
    );
  });

  it('answers the agent with the option the surface picked', async () => {
    const { bridge, presenter } = createPresenter({
      approval: async (): Promise<ApprovalDecision> => 'allow-always',
    });
    const prepared = await bridge.prepare(permissionRequest());
    const answered = prepared.resolve;

    const response = await presenter.present({
      interactionId: interactionId(`ix-${'2'.repeat(32)}`),
      runId: runId(`run-${'2'.repeat(32)}`),
      kind: prepared.kind,
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    });

    expect(response).toBe('allow-always');
    await expect(answered(response ?? '')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'always' },
    });
  });
});
