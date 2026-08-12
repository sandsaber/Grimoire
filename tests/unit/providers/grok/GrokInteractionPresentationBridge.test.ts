import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { GrokInteractionPresentationBridge } from '@/providers/grok/execution/GrokInteractionPresentationBridge';

function createPresentations() {
  const stored: { kind: string; title: string }[] = [];
  return {
    async store(input: { kind: string; title: string }): Promise<{ readonly presentationRef: string }> {
      stored.push(input);
      return { presentationRef: `pr-${`${stored.length}`.padStart(64, '0')}` };
    },
    snapshot() { return stored; },
  };
}

describe('GrokInteractionPresentationBridge', () => {
  it('delegates approvals to the shared ACP permission bridge', async () => {
    const presentations = createPresentations();
    const bridge = new GrokInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepareApproval({
      sessionId: 'session-1',
      toolCall: { toolCallId: 'tc-1', title: 'Write file', toolName: 'write' },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    } as unknown as AcpRequestPermissionRequest);

    expect(prepared.kind).toBe('approval');
    expect(prepared.responseIds.length).toBeGreaterThanOrEqual(2);
  });

  it('maps direct questions into bounded option responses', async () => {
    const presentations = createPresentations();
    const bridge = new GrokInteractionPresentationBridge(presentations);

    const prepared = await bridge.prepareQuestion({
      questions: [
        {
          question: 'Which framework?',
          options: [{ label: 'React' }, { label: 'Vue' }],
        },
      ],
      sessionId: 'session-1',
    });

    expect(prepared.kind).toBe('question');
    expect(prepared.responseIds).toEqual(['option-1', 'option-2']);
    const answered = await prepared.resolve('option-1');
    expect(answered.outcome).toBe('accepted');
    expect(presentations.snapshot()[0]?.kind).toBe('question');
  });

  it('rejects empty questions', async () => {
    const bridge = new GrokInteractionPresentationBridge(createPresentations());
    await expect(bridge.prepareQuestion({
      questions: [],
      sessionId: 's',
    })).rejects.toThrow('no questions');
  });
});
