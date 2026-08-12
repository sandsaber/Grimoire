import {
  CodexInteractionPresentationBridge,
} from '@/providers/codex/execution/CodexInteractionPresentationBridge';

interface StoredPresentation {
  readonly kind: 'approval' | 'question' | 'plan-decision';
  readonly title: string;
  readonly options: readonly { readonly responseId: string; readonly label: string }[];
}

function createPresentations() {
  const stored: StoredPresentation[] = [];
  const port = {
    async store(input: StoredPresentation): Promise<{ readonly presentationRef: string }> {
      stored.push(input);
      const index = stored.length;
      return { presentationRef: `pr-${`${index}`.padStart(64, '0')}` };
    },
    snapshot(): readonly StoredPresentation[] {
      return stored;
    },
  };
  return port;
}

describe('CodexInteractionPresentationBridge', () => {
  it('maps command approval decisions to bounded responses and stores one presentation', async () => {
    const presentations = createPresentations();
    const bridge = new CodexInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        command: 'rm -rf /tmp/build',
        availableDecisions: ['accept', 'decline'],
      },
    });

    expect(prepared.presentationRef).toMatch(/^pr-/);
    expect(prepared.responseIds).toEqual(['accept', 'decline', 'cancel']);
    expect(prepared.providerResolvedResponseId).toBe('cancel');
    const accepted = await prepared.resolve('accept') as { decision: string };
    expect(accepted.decision).toBe('accept');
    const cancelled = await prepared.cancel() as { decision: string };
    expect(cancelled.decision).toBe('cancel');
    expect(presentations.snapshot()).toHaveLength(1);
    expect(presentations.snapshot()[0]?.kind).toBe('approval');
  });

  it('maps file change approvals with default decisions when none are supplied', async () => {
    const presentations = createPresentations();
    const bridge = new CodexInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepare({
      method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', reason: 'Edit note' },
    });

    expect(prepared.responseIds).toEqual([
      'accept',
      'accept-for-session',
      'decline',
      'cancel',
    ]);
    const declined = await prepared.resolve('decline') as { decision: string };
    expect(declined.decision).toBe('decline');
  });

  it('maps permission approval requests into turn/session grants', async () => {
    const presentations = createPresentations();
    const bridge = new CodexInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepare({
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        permissions: { fileSystem: { write: ['/vault/notes'] } },
      },
    });

    expect(prepared.responseIds).toEqual(['grant-turn', 'grant-session', 'decline']);
    const granted = await prepared.resolve('grant-session') as {
      permissions: unknown;
      scope?: string;
    };
    expect(granted.scope).toBe('session');
    expect(granted.permissions).toMatchObject({ fileSystem: { write: ['/vault/notes'] } });
  });

  it('maps user input questions into bounded option responses', async () => {
    const presentations = createPresentations();
    const bridge = new CodexInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepare({
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        questions: [
          {
            id: 'q1',
            header: 'Which framework?',
            question: 'Pick one',
            options: [
              { label: 'React', description: 'React app' },
              { label: 'Vue', description: 'Vue app' },
            ],
            isOther: false,
            isSecret: false,
          },
        ],
      },
    });

    expect(prepared.responseIds).toEqual(['option-1', 'option-2']);
    expect(prepared.providerResolvedResponseId).toBe('option-1');
    const answered = await prepared.resolve('option-2') as { answers: Record<string, unknown> };
    expect(answered.answers.q1).toMatchObject({ answers: ['Vue'] });
    expect(presentations.snapshot()[0]?.kind).toBe('question');
  });

  it('rejects unsupported interaction methods and empty user input', async () => {
    const bridge = new CodexInteractionPresentationBridge(createPresentations());
    await expect(bridge.prepare({ method: 'item/unknown', params: {} }))
      .rejects.toThrow('unsupported');
    await expect(bridge.prepare({
      method: 'item/tool/requestUserInput',
      params: { threadId: 't', turnId: 'x', questions: [] },
    })).rejects.toThrow('no questions');
  });
});
