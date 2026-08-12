import { ClaudeInteractionPresentationBridge } from '@/providers/claude/execution/ClaudeInteractionPresentationBridge';

interface StoredPresentation {
  readonly kind: 'approval' | 'question' | 'plan-decision';
  readonly title: string;
  readonly options: readonly { readonly responseId: string; readonly label: string }[];
}

function createPresentations() {
  const stored: StoredPresentation[] = [];
  return {
    async store(input: StoredPresentation): Promise<{ readonly presentationRef: string }> {
      stored.push(input);
      return { presentationRef: `pr-${`${stored.length}`.padStart(64, '0')}` };
    },
    snapshot(): readonly StoredPresentation[] {
      return stored;
    },
  };
}

describe('ClaudeInteractionPresentationBridge', () => {
  it('maps a Bash tool approval into allow/deny responses', async () => {
    const presentations = createPresentations();
    const bridge = new ClaudeInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepare({
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /tmp/build' },
      options: {
        signal: new AbortController().signal,
        requestId: 'req-1',
        toolUseId: 'tu-1',
      },
    });

    expect(prepared.kind).toBe('approval');
    expect(prepared.responseIds).toEqual(['allow', 'deny']);
    expect(prepared.providerResolvedResponseId).toBe('deny');
    const allowed = await prepared.resolve('allow');
    expect(allowed).toMatchObject({ behavior: 'allow' });
    const denied = await prepared.cancel();
    expect(denied).toMatchObject({ behavior: 'deny' });
  });

  it('maps a plan-exit interaction into accept/reject', async () => {
    const presentations = createPresentations();
    const bridge = new ClaudeInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepare({
      toolName: 'ExitPlanMode',
      toolInput: {},
      options: {
        signal: new AbortController().signal,
        requestId: 'req-2',
        toolUseId: 'tu-2',
        title: 'Exit plan mode?',
        description: 'The plan is ready to execute.',
      },
    });

    expect(prepared.kind).toBe('plan-decision');
    expect(prepared.responseIds).toEqual(['accept', 'reject']);
  });

  it('maps a question tool into bounded option responses', async () => {
    const presentations = createPresentations();
    const bridge = new ClaudeInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepare({
      toolName: 'ask_user_question',
      toolInput: {
        question: 'Which approach?',
        options: [{ label: 'Option A' }, { label: 'Option B' }],
      },
      options: {
        signal: new AbortController().signal,
        requestId: 'req-3',
        toolUseId: 'tu-3',
        title: 'Which approach?',
      },
    });

    expect(prepared.kind).toBe('question');
    expect(prepared.responseIds).toEqual(['option-1', 'option-2']);
    expect(presentations.snapshot()[0]?.kind).toBe('question');
  });

  it('rejects empty titles', async () => {
    const bridge = new ClaudeInteractionPresentationBridge(createPresentations());
    await expect(bridge.prepare({
      toolName: 'Bash',
      toolInput: {},
      options: {
        signal: new AbortController().signal,
        requestId: 'r',
        toolUseId: 't',
        title: '   ',
      },
    })).rejects.toThrow('title');
  });
});
