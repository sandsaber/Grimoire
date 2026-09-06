import { CodexInteractionBridge } from '@/providers/codex/execution/CodexInteractionBridge';
import type {
  CommandApprovalRequest,
  PermissionsApprovalRequest,
  UserInputRequest,
} from '@/providers/codex/runtime/codexAppServerTypes';

/**
 * What the user is asked, and what Codex is told they said.
 *
 * The kernel's model is "choose one of these response ids", and it accepts only
 * constrained identifiers — while Codex's own decisions include whole objects
 * (a policy amendment) and whole answer sets (a question). Everything the daemon
 * needs beyond the id therefore has to stay on this side of the boundary.
 */
describe('Codex interaction bridge', () => {
  const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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

  it('offers the decisions the daemon says are available, as identifiers', async () => {
    const prepared = await new CodexInteractionBridge().prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval({ availableDecisions: ['accept', 'decline', 'cancel'] }),
    });

    expect(prepared.responseIds).toEqual(['allow-once', 'deny', 'cancel', 'provider-resolved']);
    for (const responseId of prepared.responseIds) {
      expect(responseId).toMatch(IDENTIFIER);
    }
    expect(prepared.presentationRef).toMatch(IDENTIFIER);
    // The backend refuses a presentation whose provider-resolved id is not one
    // of the offered ones, because the control record refuses it too.
    expect(prepared.responseIds).toContain(prepared.providerResolvedResponseId);
  });

  it('falls back to the three decisions the daemon offers by default', async () => {
    const prepared = await new CodexInteractionBridge().prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval(),
    });

    expect(prepared.responseIds).toEqual([
      'allow-once',
      'allow-always',
      'deny',
      'cancel',
      'provider-resolved',
    ]);
  });

  it('can always be refused, and refusing is not the same as cancelling the turn', async () => {
    // The daemon says which decisions to *offer*; it does not decide whether the
    // user may say no. Where it offers no refusal, dismissing the prompt has to
    // answer something, and cancelling the turn is what the legacy runtime sent.
    const bridge = new CodexInteractionBridge();
    const prepared = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval({ availableDecisions: ['accept'] }),
    });

    expect(prepared.responseIds).toEqual(['allow-once', 'cancel', 'provider-resolved']);
    const presentation = bridge.presentation(prepared.presentationRef);
    // Answerable, but not something the surface renders as a button of its own.
    expect(presentation).toMatchObject({ options: [expect.objectContaining({ responseId: 'allow-once' })] });
    await expect(prepared.resolve('cancel')).resolves.toEqual({ decision: 'cancel' });
  });

  it('lets a file change be cancelled as well as denied', async () => {
    const prepared = await new CodexInteractionBridge().prepare({
      method: 'item/fileChange/requestApproval',
      params: { threadId: 't', turnId: 'u', itemId: 'i' },
    });

    expect(prepared.responseIds).toContain('cancel');
    await expect(prepared.resolve('cancel')).resolves.toEqual({ decision: 'cancel' });
  });

  it('gives each interaction its own amendment ids', async () => {
    // Two approvals that both offered `amendment-1` would let a stale answer
    // from one resolve the other into a policy change nobody chose.
    const bridge = new CodexInteractionBridge();
    const params = commandApproval({
      availableDecisions: [
        'accept',
        { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['rm'] } },
      ],
    });

    const first = await bridge.prepare({ method: 'item/commandExecution/requestApproval', params });
    const second = await bridge.prepare({ method: 'item/commandExecution/requestApproval', params });

    const amendmentOf = (ids: readonly string[]) => ids.find(id => id.includes('amendment'));
    expect(amendmentOf(first.responseIds)).not.toBe(amendmentOf(second.responseIds));
  });

  it('forgets a presentation once its interaction is settled', async () => {
    // It carries the command, the working directory and the reason, and the
    // interaction it described is over.
    const bridge = new CodexInteractionBridge();
    const resolved = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval(),
    });
    const cancelled = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval(),
    });

    await resolved.resolve('deny');
    await cancelled.cancel();

    expect(bridge.presentation(resolved.presentationRef)).toBeUndefined();
    expect(bridge.presentation(cancelled.presentationRef)).toBeUndefined();
  });

  it('carries a policy amendment as an id, and answers with the amendment itself', async () => {
    // The decision Codex wants back is an object. It cannot be a response id —
    // the control store takes identifiers — so the id stands for it and the
    // bridge keeps the object.
    const amendment = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['rm'] } };
    const bridge = new CodexInteractionBridge();
    const prepared = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval({ availableDecisions: ['accept', amendment, 'decline'] }),
    });

    const amendmentId = prepared.responseIds.find(id => id.includes('amendment'));
    expect(amendmentId).toMatch(IDENTIFIER);
    await expect(prepared.resolve(amendmentId ?? '')).resolves.toEqual({ decision: amendment });
  });

  it('maps each offered id to the decision Codex understands', async () => {
    const bridge = new CodexInteractionBridge();
    const prepare = async () => bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval({
        availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
      }),
    });

    await expect((await prepare()).resolve('allow-once')).resolves.toEqual({ decision: 'accept' });
    await expect((await prepare()).resolve('allow-always'))
      .resolves.toEqual({ decision: 'acceptForSession' });
    await expect((await prepare()).resolve('deny')).resolves.toEqual({ decision: 'decline' });
    await expect((await prepare()).resolve('cancel')).resolves.toEqual({ decision: 'cancel' });
    // An id this interaction never offered is a defect upstream; declining is
    // what the legacy runtime answered with, and it is the safe direction.
    await expect((await prepare()).resolve('made-up')).resolves.toEqual({ decision: 'decline' });
  });

  it('declines a command or file change that is cancelled before it is answered', async () => {
    const bridge = new CodexInteractionBridge();

    await expect((await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval(),
    })).cancel()).resolves.toEqual({ decision: 'decline' });

    await expect((await bridge.prepare({
      method: 'item/fileChange/requestApproval',
      params: { threadId: 't', turnId: 'u', itemId: 'i', reason: 'rewrite the note' },
    })).cancel()).resolves.toEqual({ decision: 'decline' });
  });

  it('grants the permissions that were asked for, for as long as the answer says', async () => {
    const permissions: PermissionsApprovalRequest = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      permissions: { network: { enabled: true } },
      reason: 'fetch the schema',
    };
    const bridge = new CodexInteractionBridge();
    const prepare = async () => bridge.prepare({
      method: 'item/permissions/requestApproval',
      params: permissions,
    });

    await expect((await prepare()).resolve('allow-once'))
      .resolves.toEqual({ permissions: { network: { enabled: true } }, scope: 'turn' });
    await expect((await prepare()).resolve('allow-always'))
      .resolves.toEqual({ permissions: { network: { enabled: true } }, scope: 'session' });
    // Denied grants nothing, and says so for this turn rather than the session.
    await expect((await prepare()).resolve('deny'))
      .resolves.toEqual({ permissions: {}, scope: 'turn' });
    await expect((await prepare()).cancel())
      .resolves.toEqual({ permissions: {}, scope: 'turn' });
  });

  it('answers a question with what the presenter collected', async () => {
    const request: UserInputRequest = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [
        { id: 'branch', header: 'Branch', question: 'Which branch?', options: null, isOther: false, isSecret: false },
        { id: 'tags', header: 'Tags', question: 'Which tags?', options: null, isOther: false, isSecret: false },
      ],
    };
    const bridge = new CodexInteractionBridge();
    const prepared = await bridge.prepare({ method: 'item/tool/requestUserInput', params: request });

    // A free-text answer cannot be a response id, so the id says *that* it was
    // answered and the answers travel beside it.
    expect(prepared.responseIds).toEqual(['answered', 'dismissed', 'provider-resolved']);

    bridge.submitAnswers(prepared.presentationRef, { branch: 'main', tags: ['a', '  ', 'b'] });

    await expect(prepared.resolve('answered')).resolves.toEqual({
      answers: {
        branch: { answers: ['main'] },
        tags: { answers: ['a', 'b'] },
      },
    });
  });

  it('answers nothing for a question that was dismissed, cancelled, or never collected', async () => {
    const request: UserInputRequest = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [],
    };
    const bridge = new CodexInteractionBridge();

    const dismissed = await bridge.prepare({ method: 'item/tool/requestUserInput', params: request });
    await expect(dismissed.resolve('dismissed')).resolves.toEqual({ answers: {} });

    const cancelled = await bridge.prepare({ method: 'item/tool/requestUserInput', params: request });
    await expect(cancelled.cancel()).resolves.toEqual({ answers: {} });

    const unanswered = await bridge.prepare({ method: 'item/tool/requestUserInput', params: request });
    await expect(unanswered.resolve('answered')).resolves.toEqual({ answers: {} });
  });

  it('keeps what the surface has to render, one presentation per request', async () => {
    const bridge = new CodexInteractionBridge();
    const first = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval(),
    });
    const second = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval({ command: 'ls' }),
    });

    expect(first.presentationRef).not.toBe(second.presentationRef);
    expect(bridge.presentation(first.presentationRef)).toMatchObject({
      kind: 'approval',
      toolName: 'Bash',
      description: 'Execute: rm -rf build',
      input: expect.objectContaining({ command: 'rm -rf build', cwd: '/vault' }),
    });
    expect(bridge.presentation('codexix-never-minted')).toBeUndefined();
  });

  it('describes a network request by the host it wants, not by the command', async () => {
    const bridge = new CodexInteractionBridge();
    const prepared = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: commandApproval({ networkApprovalContext: { host: 'example.com', protocol: 'https' } }),
    });

    expect(bridge.presentation(prepared.presentationRef)).toMatchObject({
      description: 'Allow https access to example.com',
    });
  });

  it('refuses a server request it does not know how to present', async () => {
    // Answering one the wrong way is worse than failing: the daemon acts on it.
    await expect(new CodexInteractionBridge().prepare({
      method: 'item/something/new',
      params: {},
    })).rejects.toThrow(/Unsupported server request/);
  });
});
