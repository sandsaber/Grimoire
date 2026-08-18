import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import { interactionId, runId } from '@/core/execution/ExecutionIds';
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
          expect.objectContaining({ value: 'allow-once', presentation: 'allow' }),
          expect.objectContaining({ value: 'allow-always', presentation: 'always' }),
          expect.objectContaining({ value: 'deny', presentation: 'reject' }),
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
    const presenter = new CodexInteractionPresenter(bridge, () => ({
      approval: async () => ({ type: 'select-option', value: 'amendment-1' }),
    }));

    expect(await presenter.present(request)).toBe('amendment-1');
  });

  it('maps the surface\'s own decisions onto the ids this interaction offered', async () => {
    const bridge = new CodexInteractionBridge();
    const decide = async (decision: unknown): Promise<string | null> => {
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
    expect(await decide('something-else')).toBe('deny');
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
