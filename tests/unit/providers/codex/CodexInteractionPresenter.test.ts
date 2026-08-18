import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import { interactionId, runId } from '@/core/execution/ExecutionIds';
import type { ApprovalDecision } from '@/core/types';
import { CodexInteractionBridge } from '@/providers/codex/execution/CodexInteractionBridge';
import { CodexInteractionPresenter } from '@/providers/codex/execution/CodexInteractionPresenter';
import type { CommandApprovalRequest, UserInputRequest } from '@/providers/codex/runtime/codexAppServerTypes';

/**
 * How an opened interaction reaches the chat surface, and how the answer comes
 * back as an id the kernel can record.
 *
 * The surface still speaks the legacy callback contract — a tool name, an
 * input, a description, and a set of decision options — so this is the piece
 * that has to hold those two vocabularies together without either learning the
 * other's.
 */
describe('Codex interaction presenter', () => {
  const RUN = runId('run-000000000000000000000000000000ab');

  function commandApproval(overrides: Partial<CommandApprovalRequest> = {}): CommandApprovalRequest {
    return {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      command: 'rm -rf build',
      cwd: '/vault',
      ...overrides,
    };
  }

  async function openApproval(
    bridge: CodexInteractionBridge,
    overrides: Partial<CommandApprovalRequest> = {},
  ): Promise<InteractionRequest> {
    const prepared = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval(overrides),
    });
    return {
      interactionId: interactionId(`ix-${'1'.padStart(32, '0')}`),
      runId: RUN,
      kind: 'approval',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    };
  }

  it('renders an approval through the surface and returns what the user chose', async () => {
    const bridge = new CodexInteractionBridge();
    const seen: unknown[] = [];
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async (toolName: string, input: unknown, description: string, options: unknown) => {
        seen.push({ toolName, input, description, options });
        return 'allow-always';
      },
    }));

    const chosen = await presenter.present(await openApproval(bridge));

    expect(chosen).toBe('allow-always');
    expect(seen[0]).toMatchObject({
      toolName: 'Bash',
      description: 'Execute: rm -rf build',
      input: expect.objectContaining({ command: 'rm -rf build' }),
      options: expect.objectContaining({
        decisionOptions: [
          // `decision` is what the surface reads to answer with a decision
          // rather than with an option value, and the legacy runtime set it on
          // every standard option.
          { label: 'Allow once', value: 'allow-once', decision: 'allow', presentation: 'allow' },
          { label: 'Always allow', value: 'allow-always', decision: 'allow-always', presentation: 'always' },
          { label: 'Deny', value: 'deny', decision: 'deny', presentation: 'reject' },
        ],
      }),
    });
  });

  it('reads a picked option as the response it stands for', async () => {
    // The amendment options have no decision of their own; the surface returns
    // the option's value, and the value is the response id by construction.
    const bridge = new CodexInteractionBridge();
    const request = await openApproval(bridge, {
      availableDecisions: [
        'accept',
        { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['rm'] } },
        'decline',
      ],
    });
    const amendmentId = request.responseIds.find(id => id.includes('amendment')) ?? '';
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async () => ({ type: 'select-option', value: amendmentId }),
    }));

    expect(await presenter.present(request)).toBe(amendmentId);
  });

  it('maps the surface\'s own decisions onto the ids this interaction offered', async () => {
    const bridge = new CodexInteractionBridge();
    const decide = async (decision: ApprovalDecision): Promise<string | null> => {
      const request = await openApproval(bridge, {
        availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
      });
      return new CodexInteractionPresenter(bridge, () => ({ approval: async () => decision }))
        .present(request);
    };

    expect(await decide('allow')).toBe('allow-once');
    expect(await decide('allow-always')).toBe('allow-always');
    expect(await decide('deny')).toBe('deny');
    expect(await decide('cancel')).toBe('cancel');
    // Anything this interaction cannot express is declined rather than invented,
    // which is what the legacy runtime answered too.
    expect(await decide('something-else' as ApprovalDecision)).toBe('deny');
  });

  it('renders a permission request in its own words, not a command\'s', async () => {
    const bridge = new CodexInteractionBridge();
    const prepared = await bridge.prepare({
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'i',
        permissions: { network: { enabled: true } },
        reason: 'fetch the schema',
      },
    });
    const seen: unknown[] = [];
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async (toolName: string, input: Record<string, unknown>, description: string) => {
        seen.push({ toolName, input, description });
        return 'allow';
      },
    }));

    expect(await presenter.present({
      interactionId: interactionId(`ix-${'6'.padStart(32, '0')}`),
      runId: RUN,
      kind: 'approval',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    })).toBe('allow-once');
    expect(seen[0]).toEqual({
      toolName: 'permissions',
      description: 'Permission request: fetch the schema',
      input: { network: { enabled: true } },
    });
  });

  it('renders a file change with the reason the daemon gave', async () => {
    const bridge = new CodexInteractionBridge();
    const prepared = await bridge.prepare({
      method: 'item/fileChange/requestApproval',
      params: { threadId: 't', turnId: 'u', itemId: 'i', reason: 'rewrite the note' },
    });
    const seen: unknown[] = [];
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async (toolName: string, _input: Record<string, unknown>, description: string) => {
        seen.push({ toolName, description });
        return 'deny';
      },
    }));

    expect(await presenter.present({
      interactionId: interactionId(`ix-${'7'.padStart(32, '0')}`),
      runId: RUN,
      kind: 'approval',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    })).toBe('deny');
    expect(seen[0]).toEqual({
      toolName: 'apply_patch',
      description: 'File change: rewrite the note',
    });
  });

  it('passes on the context the surface explains a network request with', async () => {
    // Without these the prompt says which command wants to run but not why, or
    // what it is reaching for — which is the whole question being asked.
    const bridge = new CodexInteractionBridge();
    const request = await openApproval(bridge, {
      reason: 'the build needs the registry',
      networkApprovalContext: { host: 'example.com', protocol: 'https' },
      additionalPermissions: { network: { enabled: true } },
    });
    const seen: unknown[] = [];
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async (_t: string, _i: Record<string, unknown>, _d: string, options?: unknown) => {
        seen.push(options);
        return 'allow';
      },
    }));

    await presenter.present(request);

    expect(seen[0]).toMatchObject({
      decisionReason: 'the build needs the registry',
      networkApprovalContext: { host: 'example.com', protocol: 'https' },
      additionalPermissions: { network: { enabled: true } },
    });
  });

  it('cancels the turn when the prompt is dismissed and nothing else can say no', async () => {
    // The surface answers a dismissal with `cancel`, and where the daemon
    // offered no refusal that is the only answer left. Leaving it unanswered
    // would block the daemon on a request that has no UI any more.
    const bridge = new CodexInteractionBridge();
    const request = await openApproval(bridge, { availableDecisions: ['accept'] });
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async () => 'cancel',
    }));

    expect(await presenter.present(request)).toBe('cancel');
  });

  it('falls back to cancelling when the answer cannot be expressed and denial is not offered', async () => {
    // The last resort has to be an answer: an approval left open blocks the
    // daemon on a prompt that is no longer on screen.
    const bridge = new CodexInteractionBridge();
    const request = await openApproval(bridge, { availableDecisions: ['accept'] });
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async () => 'allow-always',
    }));

    expect(await presenter.present(request)).toBe('cancel');
  });

  it('declines rather than hangs when the surface throws', async () => {
    // A detached chat view rejects instead of answering. Upstream reads a
    // rejection as a dismissal and resolves nothing, so the daemon would wait
    // on a prompt that no longer exists.
    const bridge = new CodexInteractionBridge();
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async () => {
        throw new Error('Input container is detached from DOM');
      },
    }));

    expect(await presenter.present(await openApproval(bridge))).toBe('deny');
  });

  it('takes a question down when the interaction is dismissed', async () => {
    // The legacy runtime aborted the pending question on cancel and on Codex
    // resolving the request itself; without a signal the modal stays open and
    // its answers could arrive after the run is over.
    const bridge = new CodexInteractionBridge();
    const prepared = await bridge.prepare({
      method: 'item/tool/requestUserInput',
      params: { threadId: 't', turnId: 'u', itemId: 'i', questions: [] },
    });
    let observed: AbortSignal | undefined;
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      question: async (_input: unknown, signal?: AbortSignal) => {
        observed = signal;
        return new Promise(resolve => {
          signal?.addEventListener('abort', () => resolve(null));
        });
      },
    }));

    const presented = presenter.present({
      interactionId: interactionId(`ix-${'5'.padStart(32, '0')}`),
      runId: RUN,
      kind: 'question',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    });
    await Promise.resolve();
    presenter.dismissAll();

    expect(await presented).toBe('dismissed');
    expect(observed?.aborted).toBe(true);
  });

  it('takes an approval down through the dismisser the surface installed', async () => {
    const bridge = new CodexInteractionBridge();
    let dismissed = 0;
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async () => new Promise<never>(() => undefined),
      approvalDismisser: () => {
        dismissed += 1;
      },
    }));

    void presenter.present(await openApproval(bridge));
    await Promise.resolve();
    presenter.dismissAll();

    expect(dismissed).toBe(1);
  });

  it('says nothing for a request whose presentation is of another kind', async () => {
    // The kernel's view and the bridge's disagreeing is a defect, and showing a
    // command approval as a free-text question would answer the wrong request.
    const bridge = new CodexInteractionBridge();
    const approval = await openApproval(bridge);
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      question: async () => ({ any: 'thing' }),
    }));

    expect(await presenter.present({ ...approval, kind: 'question' })).toBeNull();
  });

  it('declines a picked option this interaction never offered', async () => {
    // The registry refuses a response id that was not on offer, and a refusal
    // there leaves the approval open instead of answering it. A stale option in
    // the surface — a re-render, a redelivery — must not become that.
    const bridge = new CodexInteractionBridge();
    const request = await openApproval(bridge, { availableDecisions: ['accept', 'decline'] });
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async () => ({ type: 'select-option', value: 'amendment-9' }),
    }));

    expect(await presenter.present(request)).toBe('deny');
  });

  it('declines when the surface has installed nothing to ask', async () => {
    // The legacy runtime answered a missing callback with a decline. Leaving it
    // unanswered instead would hang the turn on a prompt nobody can see.
    const bridge = new CodexInteractionBridge();

    expect(await new CodexInteractionPresenter(bridge, () => ({}))
      .present(await openApproval(bridge))).toBe('deny');
  });

  it('hands a question\'s answers back through the bridge before resolving it', async () => {
    const bridge = new CodexInteractionBridge();
    const params: UserInputRequest = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [
        { id: 'branch', header: 'Branch', question: 'Which branch?', options: null, isOther: false, isSecret: false },
      ],
    };
    const prepared = await bridge.prepare({ method: 'item/tool/requestUserInput', params });
    const asked: unknown[] = [];
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      question: async (input: unknown) => {
        asked.push(input);
        return { branch: 'main' };
      },
    }));

    const chosen = await presenter.present({
      interactionId: interactionId(`ix-${'2'.padStart(32, '0')}`),
      runId: RUN,
      kind: 'question',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    });

    expect(chosen).toBe('answered');
    expect(asked[0]).toMatchObject({ questions: params.questions });
    await expect(prepared.resolve('answered')).resolves.toEqual({
      answers: { branch: { answers: ['main'] } },
    });
  });

  it('says a question was dismissed when the user closed it without answering', async () => {
    const bridge = new CodexInteractionBridge();
    const prepared = await bridge.prepare({
      method: 'item/tool/requestUserInput',
      params: { threadId: 't', turnId: 'u', itemId: 'i', questions: [] },
    });
    const request: InteractionRequest = {
      interactionId: interactionId(`ix-${'3'.padStart(32, '0')}`),
      runId: RUN,
      kind: 'question',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    };

    expect(await new CodexInteractionPresenter(bridge, () => ({ question: async () => null }))
      .present(request)).toBe('dismissed');
    expect(await new CodexInteractionPresenter(bridge, () => ({})).present(request))
      .toBe('dismissed');
  });

  it('answers nothing at all for a presentation it cannot describe', async () => {
    // Without the presentation there is nothing to show the user, and choosing
    // on their behalf is the one thing an approval prompt must never do.
    const bridge = new CodexInteractionBridge();
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async () => 'allow',
    }));

    expect(await presenter.present({
      interactionId: interactionId(`ix-${'4'.padStart(32, '0')}`),
      runId: RUN,
      kind: 'approval',
      presentationRef: 'codexix-evicted',
      responseIds: ['allow-once', 'deny', 'provider-resolved'],
    })).toBeNull();
  });
});
