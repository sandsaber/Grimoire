import { createHash } from 'node:crypto';

import {
  auxiliaryRetentionKey,
  type GrokAuxiliaryEnvironment,
  type GrokAuxiliaryRequest,
  GrokExecutionRequests,
} from '@/providers/grok/execution/GrokExecutionRequests';

/**
 * The auxiliary half of Grok's reference store.
 *
 * Live: titles, refinement and inline edits are answered through here, and the
 * runner that used to own a process of its own is gone.
 *
 * What this store has to get right is what that runner spent most of its lines
 * on, and for this provider it is not what the three OpenCode forks needed.
 * There is no agent to set the session to; the policy is on the command line,
 * the model has its own ACP setter, and a permission request that arrives anyway
 * has to be refused in a way the agent can carry on from.
 */
describe('Grok auxiliary requests', () => {
  function createStore(
    environment: Partial<GrokAuxiliaryEnvironment> = {},
    observed: GrokAuxiliaryRequest[] = [],
  ): { requests: GrokExecutionRequests; seen: GrokAuxiliaryRequest[] } {
    let next = 0;
    const requests = new GrokExecutionRequests(
      () => `ref-${(next += 1)}`,
      async () => { throw new Error('chat environment is not used here'); },
      64,
      async request => {
        observed.push(request);
        return {
          executable: '/usr/bin/grok',
          arguments: ['agent', '--reasoning-effort', 'low', 'stdio'],
          cwd: '/vault',
          environment: { GROK_HOME: '/vault/.grimoire/grok/auxiliary/title-gen' },
          launchKey: `launch:${request.systemPrompt}`,
          readsFiles: false,
          ...environment,
        };
      },
    );
    return { requests, seen: observed };
  }

  const titleRequest: GrokAuxiliaryRequest = {
    purpose: 'title-gen',
    conversationId: 'aux-1',
    systemPrompt: 'Name the conversation.',
    prompt: 'The user asked about tomatoes.',
  };

  it('resolves an auxiliary turn into a launch, a conversation and a refusal', async () => {
    const { requests } = createStore();

    const requestRef = requests.referenceAuxiliary(titleRequest);
    const invocation = await requests.resolveAuxiliary(requestRef);

    expect(invocation).toEqual({
      startupRef: 'ref-2',
      cwd: '/vault',
      prompt: [{ type: 'text', text: 'The user asked about tomatoes.' }],
      mcpServers: [],
      retentionKey: 'grok-auxiliary:title-gen:aux-1',
      restartFingerprint: createHash('sha256')
        .update('launch:Name the conversation.').digest('hex'),
      // **No session configuration at all**, which is the difference from the
      // OpenCode forks: there is no managed agent to set the session to, so what
      // makes this turn safe is already in the arguments below.
      permissionRefusal: 'reject',
    });
    await expect(requests.resolveLaunch('ref-2')).resolves.toEqual({
      executable: '/usr/bin/grok',
      // The policy is here rather than on the session: a change to the mode or
      // the effort is a different process, not a reconfigured one.
      arguments: ['agent', '--reasoning-effort', 'low', 'stdio'],
      cwd: '/vault',
      environment: { GROK_HOME: '/vault/.grimoire/grok/auxiliary/title-gen' },
    });
  });

  it('carries the model as an id, because this agent has the setter', async () => {
    const withModel = createStore({ modelId: 'openai/gpt-5.4' });
    const withoutModel = createStore();

    const configured = await withModel.requests.resolveAuxiliary(
      withModel.requests.referenceAuxiliary({ ...titleRequest, model: 'grok:openai/gpt-5.4' }),
    );
    const bare = await withoutModel.requests.resolveAuxiliary(
      withoutModel.requests.referenceAuxiliary(titleRequest),
    );

    // `session/set_model`, not a `model` config option: the forks name the
    // option their agent has, and this one names the setter.
    expect(configured.modelId).toBe('openai/gpt-5.4');
    expect(configured.turnConfiguration).toBeUndefined();
    // An account with no model chosen is not an account that wants the default
    // overwritten with an empty string.
    expect(bare.modelId).toBeUndefined();
  });

  it('tells the client which launches were given a filesystem', async () => {
    const reading = createStore({ readsFiles: true });
    const blind = createStore();

    const inline = await reading.requests.resolveAuxiliary(
      reading.requests.referenceAuxiliary({ ...titleRequest, purpose: 'inline' }),
    );
    const title = await blind.requests.resolveAuxiliary(
      blind.requests.referenceAuxiliary(titleRequest),
    );

    // The client factory is handed a startup reference and nothing else, and for
    // this provider the delegate differs per purpose — there is no agent
    // definition to deny a read, so the client has to be built without one.
    expect(reading.requests.auxiliaryReadsFiles(inline.startupRef)).toBe(true);
    expect(blind.requests.auxiliaryReadsFiles(title.startupRef)).toBe(false);
    // A startup this store never minted reads nothing: the safe half of the
    // answer is the one an unknown reference gets.
    expect(blind.requests.auxiliaryReadsFiles('ref-borrowed')).toBe(false);
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
    // each when its own title is done. One key for both would put them in one
    // session and let either `reset()` close the process the other was using.
    expect(second.retentionKey).not.toBe(first.retentionKey);
    // Same launch, though: what a process is started for has nothing to do with
    // which conversation asked for it.
    expect(second.restartFingerprint).toBe(first.restartFingerprint);
  });

  it('changes the restart fingerprint when the instructions change', async () => {
    const { requests } = createStore();

    const first = await requests.resolveAuxiliary(requests.referenceAuxiliary(titleRequest));
    const second = await requests.resolveAuxiliary(requests.referenceAuxiliary({
      ...titleRequest,
      systemPrompt: 'Name the conversation, briefly.',
    }));

    // Grok reads its system prompt from a file the artifacts write into the
    // managed home, so a changed prompt is a relaunch rather than a different
    // request. Same conversation, different process.
    expect(second.retentionKey).toBe(first.retentionKey);
    expect(second.restartFingerprint).not.toBe(first.restartFingerprint);
  });

  it('refuses a reference it did not mint, and mints each one once', async () => {
    const { requests } = createStore();
    const requestRef = requests.referenceAuxiliary(titleRequest);

    await requests.resolveAuxiliary(requestRef);

    // Held until it dispatches and no longer: an auxiliary prompt is a piece of
    // the conversation, and keeping it after the turn is retention nobody asked
    // for.
    await expect(requests.resolveAuxiliary(requestRef)).rejects.toThrow('Unknown Grok auxiliary');
    await expect(requests.resolveAuxiliary('ref-borrowed')).rejects.toThrow('Unknown Grok auxiliary');
  });

  it('says so when auxiliary execution has no environment behind it', async () => {
    let next = 0;
    const requests = new GrokExecutionRequests(
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

    await expect(requests.resolveAuxiliary(requestRef)).rejects.toThrow('Unknown Grok auxiliary');
  });
});
