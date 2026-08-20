import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { OpencodeInteractionBridge } from '@/providers/opencode/execution/OpencodeInteractionBridge';

/**
 * What a flipped OpenCode tab asks before it edits anything.
 *
 * ACP asks the client for permission before a write or a command, so a bridge
 * that refuses everything is fail-closed and useless. This is the real one:
 * the legacy handler's presentation, kept, and the agent's own options carried
 * as ids the kernel is allowed to record.
 */
describe('OpenCode interaction bridge', () => {
  function request(
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

  it('describes the permission in OpenCode own words', async () => {
    const bridge = new OpencodeInteractionBridge();

    const prepared = await bridge.prepare(request());

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      kind: 'approval',
      toolName: 'bash',
      description: 'OpenCode wants to run a shell command.',
      decisionReason: 'Command execution permission required',
      input: { command: 'ls' },
    }));
  });

  it('names the path a write is blocked on', async () => {
    const bridge = new OpencodeInteractionBridge();

    const prepared = await bridge.prepare(request({
      toolCall: {
        toolCallId: 'tool-2',
        title: 'edit',
        rawInput: {},
        locations: [{ path: 'notes/today.md' }],
      },
    }));

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      toolName: 'edit',
      blockedPath: 'notes/today.md',
    }));
  });

  it('carries every option the agent offered as an id the kernel accepts', async () => {
    const bridge = new OpencodeInteractionBridge();

    const prepared = await bridge.prepare(request({
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
    expect(prepared.responseIds).toContain(prepared.providerResolvedResponseId);
    expect(bridge.presentation(prepared.presentationRef)?.options).toEqual([
      { responseId: 'allow-once', label: 'Allow', presentation: 'allow' },
      { responseId: 'reject-always', label: 'Never', presentation: 'reject' },
    ]);
  });

  it('answers with the option its response id stands for', async () => {
    const bridge = new OpencodeInteractionBridge();
    const prepared = await bridge.prepare(request());

    await expect(prepared.resolve('allow-always')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'always' },
    });
  });

  it('keeps two options of the same kind apart', async () => {
    const bridge = new OpencodeInteractionBridge();

    const prepared = await bridge.prepare(request({
      options: [
        { optionId: 'first', kind: 'allow_once', name: 'Allow this' },
        { optionId: 'second', kind: 'allow_once', name: 'Allow that' },
        { optionId: 'no', kind: 'reject_once', name: 'Deny' },
      ],
    }));

    // Duplicate ids are rejected by the control store, and an id that stood
    // for two options would answer with whichever was found first.
    await expect(prepared.resolve('allow-once')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'first' },
    });
    const second = await bridge.prepare(request({
      options: [
        { optionId: 'first', kind: 'allow_once', name: 'Allow this' },
        { optionId: 'second', kind: 'allow_once', name: 'Allow that' },
        { optionId: 'no', kind: 'reject_once', name: 'Deny' },
      ],
    }));
    await expect(second.resolve('allow-once-2')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'second' },
    });
  });

  it('cancels when the prompt was taken down rather than answered', async () => {
    const bridge = new OpencodeInteractionBridge();
    const prepared = await bridge.prepare(request());

    await expect(prepared.resolve('cancel')).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });
    const dismissed = await bridge.prepare(request());
    await expect(dismissed.cancel()).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('refuses rather than guessing when an id it never offered arrives', async () => {
    const bridge = new OpencodeInteractionBridge();
    const prepared = await bridge.prepare(request());

    // A defect upstream, and the safe way to be wrong is the refusal the agent
    // offered rather than an allowance nobody chose.
    await expect(prepared.resolve('nonsense')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'no' },
    });
  });

  it('cancels a request that offered no refusal at all', async () => {
    const bridge = new OpencodeInteractionBridge();
    const prepared = await bridge.prepare(request({
      options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow' }],
    }));

    await expect(prepared.resolve('nonsense')).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it('forgets what the request was about once it is over', async () => {
    const bridge = new OpencodeInteractionBridge();
    const settled: string[] = [];
    bridge.onSettled(presentationRef => settled.push(presentationRef));
    const prepared = await bridge.prepare(request());

    await prepared.resolve('allow-once');

    // The presentation carries a command line and a path; none of it outlives
    // the request it described, and the surface has to hear that the prompt is
    // over or it keeps a dead one on screen.
    expect(bridge.presentation(prepared.presentationRef)).toBeUndefined();
    expect(settled).toEqual([prepared.presentationRef]);
  });

  it('opens one interaction per request', async () => {
    const bridge = new OpencodeInteractionBridge();

    const first = await bridge.prepare(request());
    const second = await bridge.prepare(request());

    expect(first.kind).toBe('approval');
    expect(first.presentationRef).not.toBe(second.presentationRef);
  });
});
