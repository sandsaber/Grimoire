import { createHash } from 'node:crypto';

import { ManagedAcpAuxQueryRunner } from '@/app/execution/acp/ManagedAcpAuxQueryRunner';
import type { AuxQueryConfig } from '@/core/auxiliary/AuxQueryRunner';
import {
  auxiliaryRetentionKey,
  type KimicodeAuxiliaryEnvironment,
  type KimicodeAuxiliaryRequest,
  KimicodeExecutionRequests,
} from '@/providers/kimicode/execution/KimicodeExecutionRequests';

/**
 * The auxiliary half of Kimi Code's reference store, and the runner that feeds it.
 *
 * Live: titles, refinement and inline edits are answered through here, and the
 * runner that used to own a process of its own is gone.
 *
 * What the store has to get right is what that runner spent most of its lines
 * on: which process this turn belongs to, when that process is the wrong one to
 * reuse, and what the session has to be set to before the prompt.
 */
describe('Kimi Code auxiliary requests', () => {
  function createStore(
    environment: Partial<KimicodeAuxiliaryEnvironment> = {},
    observed: KimicodeAuxiliaryRequest[] = [],
  ): { requests: KimicodeExecutionRequests; seen: KimicodeAuxiliaryRequest[] } {
    let next = 0;
    const requests = new KimicodeExecutionRequests(
      () => `ref-${(next += 1)}`,
      async () => { throw new Error('chat environment is not used here'); },
      64,
      async request => {
        observed.push(request);
        return {
          executable: '/usr/bin/kimicode',
          cwd: '/vault',
          environment: { KIMICODE_CONFIG: '/vault/.grimoire/kimicode/auxiliary/title-gen/config.json' },
          launchKey: `launch:${request.systemPrompt}`,
          agentId: 'grimoire-aux-passive',
          ...environment,
        };
      },
    );
    return { requests, seen: observed };
  }

  const titleRequest: KimicodeAuxiliaryRequest = {
    purpose: 'title-gen',
    conversationId: 'aux-1',
    systemPrompt: 'Name the conversation.',
    prompt: 'The user asked about tomatoes.',
  };

  it('resolves an auxiliary turn into a launch, a conversation and a session to configure', async () => {
    const { requests } = createStore();

    const requestRef = requests.referenceAuxiliary(titleRequest);
    const invocation = await requests.resolveAuxiliary(requestRef);

    expect(invocation).toEqual({
      startupRef: 'ref-2',
      cwd: '/vault',
      prompt: [{ type: 'text', text: 'The user asked about tomatoes.' }],
      mcpServers: [],
      retentionKey: 'kimicode-auxiliary:title-gen:aux-1',
      restartFingerprint: createHash('sha256')
        .update('launch:Name the conversation.').digest('hex'),
      // The agent the generated config attaches permissions to. An auxiliary
      // turn that ran as the default agent would run with the vault's own tool
      // permissions, which is the whole reason the artifacts write one.
      sessionConfiguration: [{ configId: 'mode', value: 'grimoire-aux-passive' }],
    });
    await expect(requests.resolveLaunch('ref-2')).resolves.toEqual({
      executable: '/usr/bin/kimicode',
      arguments: ['acp'],
      cwd: '/vault',
      environment: {
        KIMICODE_CONFIG: '/vault/.grimoire/kimicode/auxiliary/title-gen/config.json',
      },
    });
  });

  it('applies the model per turn, and only when there is one to apply', async () => {
    const withModel = createStore({ modelId: 'anthropic/claude-sonnet-4' });
    const withoutModel = createStore();

    const configured = await withModel.requests.resolveAuxiliary(
      withModel.requests.referenceAuxiliary({ ...titleRequest, model: 'kimicode:anthropic:sonnet' }),
    );
    const bare = await withoutModel.requests.resolveAuxiliary(
      withoutModel.requests.referenceAuxiliary(titleRequest),
    );

    // Per turn rather than per session, because the caller passes one per query
    // and a retained session would otherwise keep the first model forever.
    expect(configured.turnConfiguration).toEqual([
      { configId: 'model', value: 'anthropic/claude-sonnet-4' },
    ]);
    // An account with no model chosen is not an account that wants the default
    // overwritten with an empty string.
    expect(bare.turnConfiguration).toBeUndefined();
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

    // Kimi Code reads its system prompt from a file the artifacts write, so a
    // changed prompt is a relaunch rather than a different request. Same
    // conversation, different process.
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
    await expect(requests.resolveAuxiliary(requestRef)).rejects.toThrow('Unknown Kimi Code auxiliary');
    await expect(requests.resolveAuxiliary('ref-borrowed')).rejects.toThrow('Unknown Kimi Code auxiliary');
  });

  it('says so when auxiliary execution has no environment behind it', async () => {
    let next = 0;
    const requests = new KimicodeExecutionRequests(
      () => `ref-${(next += 1)}`,
      async () => { throw new Error('chat environment is not used here'); },
    );

    // The state this provider is in until the flip. Refused rather than
    // answered emptily, which is the rule the whole migration is built on: an
    // auxiliary turn that silently returns nothing is the failure mode it
    // exists to remove.
    await expect(requests.resolveAuxiliary(requests.referenceAuxiliary(titleRequest)))
      .rejects.toThrow('no environment');
  });

  describe('the runner the auxiliary services keep calling', () => {
    function createRunner(): {
      released: number;
      runner: ManagedAcpAuxQueryRunner;
      runs: Array<{ requestRef: string; signal?: AbortSignal; onText?: (text: string) => void }>;
      seen: Array<{ config: AuxQueryConfig; prompt: string }>;
    } {
      const runs: Array<{
        requestRef: string;
        signal?: AbortSignal;
        onText?: (text: string) => void;
      }> = [];
      const seen: Array<{ config: AuxQueryConfig; prompt: string }> = [];
      const state = { released: 0 };
      const runner = new ManagedAcpAuxQueryRunner({
        reference: (config, prompt) => {
          seen.push({ config, prompt });
          return `aux-ref-${seen.length}`;
        },
        run: async (requestRef, options) => {
          runs.push({ requestRef, ...options });
          options.onText?.('partial');
          return 'the answer';
        },
        release: async () => { state.released += 1; },
      });
      return {
        get released() { return state.released; },
        runner,
        runs,
        seen,
      };
    }

    it('passes the caller its cancellation and its stream', async () => {
      const harness = createRunner();
      const abortController = new AbortController();
      const streamed: string[] = [];

      const answer = await harness.runner.query({
        abortController,
        model: 'kimicode:anthropic:sonnet',
        systemPrompt: 'Name the conversation.',
        onTextChunk: text => streamed.push(text),
      }, 'The user asked about tomatoes.');

      expect(answer).toBe('the answer');
      // Both are what the legacy runner does around the prompt: a dialog the
      // user closed has to stop the work rather than stop waiting for it, and
      // the refine dialog renders the answer while it arrives.
      expect(harness.runs[0].signal).toBe(abortController.signal);
      expect(streamed).toEqual(['partial']);
      expect(harness.seen[0].config.model).toBe('kimicode:anthropic:sonnet');
    });

    it('ends its own conversation on reset, without waiting for the closing', () => {
      const harness = createRunner();

      harness.runner.reset();

      // `AuxQueryRunner.reset()` is synchronous, and the caller has already
      // decided the conversation is over; finishing the close is the backend's.
      expect(harness.released).toBe(1);
    });

    it('does not fail the caller when the closing does', async () => {
      const runner = new ManagedAcpAuxQueryRunner({
        reference: () => 'aux-ref',
        run: async () => 'answer',
        release: async () => { throw new Error('the process would not confirm'); },
      });

      // A reset that threw would reach a `finally` in the title service and
      // replace a generated title with a process-management error.
      expect(() => runner.reset()).not.toThrow();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  });
});
