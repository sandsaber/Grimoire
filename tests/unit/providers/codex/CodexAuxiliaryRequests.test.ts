import { createHash } from 'node:crypto';

import {
  auxiliaryRetentionKey,
  type CodexAuxiliaryEnvironment,
  type CodexAuxiliaryRequest,
  CodexExecutionRequests,
} from '@/providers/codex/execution/CodexExecutionRequests';

/**
 * The auxiliary half of Codex's reference store.
 *
 * Live: titles, refinement and inline edits are answered through here, and the
 * runner that owned a daemon of its own is gone.
 *
 * What this store has to get right is not what the ACP providers' do. There is
 * no session to configure and no launch arguments to build: everything a turn
 * runs under is on `thread/start`, so the launch key has to carry the
 * instructions too — a thread cannot be told new ones once it exists.
 */
describe('Codex auxiliary requests', () => {
  function createStore(
    environment: Partial<CodexAuxiliaryEnvironment> = {},
    observed: CodexAuxiliaryRequest[] = [],
  ): { requests: CodexExecutionRequests; seen: CodexAuxiliaryRequest[] } {
    let next = 0;
    const requests = new CodexExecutionRequests(
      () => `ref-${(next += 1)}`,
      async () => { throw new Error('chat environment is not used here'); },
      64,
      async request => {
        observed.push(request);
        return {
          thread: {
            model: 'gpt-5.4',
            cwd: '/vault',
            approvalPolicy: 'never',
            sandbox: 'read-only',
            baseInstructions: request.systemPrompt,
            experimentalRawEvents: true,
            persistExtendedHistory: false,
          },
          launchKey: `launch:${request.systemPrompt}`,
          ...environment,
        };
      },
    );
    return { requests, seen: observed };
  }

  const titleRequest: CodexAuxiliaryRequest = {
    purpose: 'title-gen',
    conversationId: 'aux-1',
    systemPrompt: 'Name the conversation.',
    prompt: 'The user asked about tomatoes.',
  };

  it('resolves an auxiliary turn into a thread, a conversation and an input', async () => {
    const { requests } = createStore();

    const requestRef = requests.referenceAuxiliary(titleRequest);
    const invocation = await requests.resolveAuxiliary(requestRef);

    expect(invocation).toEqual({
      retentionKey: 'codex-auxiliary:title-gen:aux-1',
      restartFingerprint: createHash('sha256')
        .update('launch:Name the conversation.').digest('hex'),
      // **Where an auxiliary turn is made safe for this provider.** There is no
      // agent definition and no client-side filesystem: approvals off and a
      // read-only sandbox are what stop an unattended turn from writing to the
      // vault, and the unpersisted history is what keeps it out of the
      // transcript store the chat path reads back.
      thread: {
        model: 'gpt-5.4',
        cwd: '/vault',
        approvalPolicy: 'never',
        sandbox: 'read-only',
        baseInstructions: 'Name the conversation.',
        experimentalRawEvents: true,
        persistExtendedHistory: false,
      },
      input: [{ type: 'text', text: 'The user asked about tomatoes.' }],
    });
  });

  it('names the model on the turn only where the caller named one', async () => {
    const named = createStore({ model: 'gpt-5.4-codex' });
    const bare = createStore();

    const withModel = await named.requests.resolveAuxiliary(
      named.requests.referenceAuxiliary({ ...titleRequest, model: 'gpt-5.4-codex' }),
    );
    const withoutModel = await bare.requests.resolveAuxiliary(
      bare.requests.referenceAuxiliary(titleRequest),
    );

    // The thread is already started under a model; repeating it on the turn says
    // nothing, and the legacy runner sent one only when it had been asked for.
    expect(withModel.model).toBe('gpt-5.4-codex');
    expect(withoutModel.model).toBeUndefined();
  });

  it('keeps the three purposes in three conversations', async () => {
    const { requests } = createStore();

    const keys = await Promise.all((['inline', 'instructions', 'title-gen'] as const)
      .map(async purpose => (await requests.resolveAuxiliary(
        requests.referenceAuxiliary({ ...titleRequest, purpose }),
      )).retentionKey));

    // What the legacy runners are as three separate instances, and what a
    // `reset()` on one must not do to the other two.
    expect(keys).toEqual([
      auxiliaryRetentionKey('inline', 'aux-1'),
      auxiliaryRetentionKey('instructions', 'aux-1'),
      auxiliaryRetentionKey('title-gen', 'aux-1'),
    ]);
  });

  it('gives two runners of the same purpose two conversations', async () => {
    const { requests } = createStore();

    const first = await requests.resolveAuxiliary(requests.referenceAuxiliary(titleRequest));
    const second = await requests.resolveAuxiliary(requests.referenceAuxiliary({
      ...titleRequest,
      conversationId: 'aux-2',
    }));

    // Two titles generated at once are two runners, and the title service resets
    // each when its own title is done. One key for both would put them on one
    // thread and let either `reset()` close the daemon the other was using.
    expect(second.retentionKey).not.toBe(first.retentionKey);
    expect(second.restartFingerprint).toBe(first.restartFingerprint);
  });

  it('changes the restart fingerprint when the instructions change', async () => {
    const { requests } = createStore();

    const first = await requests.resolveAuxiliary(requests.referenceAuxiliary(titleRequest));
    const second = await requests.resolveAuxiliary(requests.referenceAuxiliary({
      ...titleRequest,
      systemPrompt: 'Name the conversation, briefly.',
    }));

    // Codex takes its instructions on `thread/start` and a thread cannot be told
    // new ones, so a changed prompt has to be a new thread. Same conversation,
    // new pair.
    expect(second.retentionKey).toBe(first.retentionKey);
    expect(second.restartFingerprint).not.toBe(first.restartFingerprint);
  });

  it('keeps the system prompt out of the fingerprint it hands on', async () => {
    const { requests } = createStore();

    const invocation = await requests.resolveAuxiliary(
      requests.referenceAuxiliary(titleRequest),
    );

    // Hashed rather than kept: the retained thread holds this for as long as the
    // conversation lives, and the launch key it came from carries the prompt.
    expect(invocation.restartFingerprint).not.toContain('Name the conversation');
    expect(invocation.restartFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a reference it did not mint, and mints each one once', async () => {
    const { requests } = createStore();
    const requestRef = requests.referenceAuxiliary(titleRequest);

    await requests.resolveAuxiliary(requestRef);

    // Held until it dispatches and no longer: an auxiliary prompt is a piece of
    // the conversation, and keeping it after the turn is retention nobody asked
    // for.
    await expect(requests.resolveAuxiliary(requestRef)).rejects.toThrow('Unknown Codex auxiliary');
    await expect(requests.resolveAuxiliary('ref-borrowed')).rejects.toThrow('Unknown Codex auxiliary');
  });

  it('says so when auxiliary execution has no environment behind it', async () => {
    let next = 0;
    const requests = new CodexExecutionRequests(
      () => `ref-${(next += 1)}`,
      async () => { throw new Error('chat environment is not used here'); },
    );

    // Refused rather than answered emptily, which is the rule the whole
    // migration is built on: an auxiliary turn that silently returns nothing is
    // the failure mode it exists to remove.
    await expect(requests.resolveAuxiliary(requests.referenceAuxiliary(titleRequest)))
      .rejects.toThrow('no environment');
  });

  it('forgets the auxiliary half when it is disposed', async () => {
    const { requests } = createStore();
    const requestRef = requests.referenceAuxiliary(titleRequest);

    requests.dispose();

    await expect(requests.resolveAuxiliary(requestRef)).rejects.toThrow('Unknown Codex auxiliary');
  });
});
