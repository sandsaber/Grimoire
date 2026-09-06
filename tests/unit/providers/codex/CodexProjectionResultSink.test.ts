import { executionRunRecordSchema } from '@/core/execution/ExecutionControlSchemas';
import { runId } from '@/core/execution/ExecutionIds';
import { CodexProjectionResultSink } from '@/providers/codex/execution/CodexProjectionResultSink';

/**
 * Where a Codex answer lives once the turn is over.
 *
 * A run can commit more than one result — its own answer, and one for every
 * native agent that finishes inside it — so unlike a provider that commits once
 * per run, the identity has to distinguish them. It also has to survive the
 * control store, which accepts only a constrained identifier, while the agent
 * key it is derived from is whatever the daemon put on the wire.
 */
describe('Codex projection result sink', () => {
  const RUN = runId('run-000000000000000000000000000000ab');

  it('commits a reference to the conversation rather than a copy of the answer', async () => {
    // D2 forbids a second copy of a provider transcript. The answer is already
    // durable twice — in the conversation Grimoire persists and in Codex's own
    // JSONL — so what is stored here is the reference, which is what D2 permits.
    const sink = new CodexProjectionResultSink();

    await expect(sink.storeResult({
      runId: RUN,
      output: 'The answer',
      source: 'assistant',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: 'committed',
      result: {
        resultId: `result-${RUN}`,
        storage: 'projection',
        digest: 'f6c2c97e47a28a76a2a56c36046ed1681593cc2c54b1337ec402794354e37fc3',
      },
    });
  });

  it('gives every native agent in a run an identity of its own', async () => {
    const sink = new CodexProjectionResultSink();

    const first = await commit(sink, { key: 'reviewer' });
    const second = await commit(sink, { key: 'implementer' });
    const assistant = await commit(sink, {});

    expect(first.resultId).not.toBe(second.resultId);
    expect(first.resultId).not.toBe(assistant.resultId);
    expect(first.resultId.startsWith(`result-${RUN}-`)).toBe(true);
  });

  it('is stable for the same agent, so a repeated observation is not a second result', async () => {
    // The daemon reports a finished agent on every `wait` that observes it, and
    // nothing upstream de-duplicates. The same agent reporting the same answer
    // twice is one result, and the digest is what says so.
    const sink = new CodexProjectionResultSink();

    const first = await commit(sink, { key: 'reviewer', output: 'The answer' });
    const again = await commit(sink, { key: 'reviewer', output: 'The answer' });
    const changed = await commit(sink, { key: 'reviewer', output: 'A different answer' });

    expect(again).toEqual(first);
    expect(changed.resultId).toBe(first.resultId);
    expect(changed.digest).toBe('1a7e733d3ed8d09f9e88f058e84cca8b8c4dd9055f4cc8b88f6575d6395545ed');
  });

  it('stays a constrained identifier when the agent key on the wire is not one', async () => {
    // The key is named by the model, not by Grimoire. A reference the control
    // store refuses is a run that cannot record its own result.
    const sink = new CodexProjectionResultSink();

    for (const key of ['code reviewer', '../escape', 'agent-\u00e9\u00e7', '🤖', 'x'.repeat(400)]) {
      const result = await commit(sink, { key });
      expect(() => decodeRunRecordWith(result)).not.toThrow();
    }
  });

  it('commits nothing once the run has been cancelled', async () => {
    // A result committed inside the cancellation window is one the run then has
    // to relabel, which is how a cancelled turn ends up looking successful.
    const controller = new AbortController();
    controller.abort();

    await expect(new CodexProjectionResultSink().storeResult({
      runId: RUN,
      output: 'The answer',
      source: 'assistant',
      signal: controller.signal,
    })).resolves.toEqual({ kind: 'aborted' });
  });

  async function commit(
    sink: CodexProjectionResultSink,
    options: { key?: string; output?: string },
  ) {
    const outcome = await sink.storeResult({
      runId: RUN,
      output: options.output ?? 'The answer',
      source: options.key ? 'native-agent' : 'assistant',
      ...(options.key ? { nativeAgentKey: options.key } : {}),
      signal: new AbortController().signal,
    });
    if (outcome.kind !== 'committed') {
      throw new Error('Expected a committed result.');
    }
    return outcome.result;
  }

  function decodeRunRecordWith(resultRef: unknown): unknown {
    return executionRunRecordSchema.decode({
      runId: RUN,
      executionSessionId: 'es-000000000000000000000000000000cd',
      owner: { kind: 'conversation', ownerId: 'conv-1' },
      resultExpectation: 'required',
      state: 'running',
      dispatchState: 'accepted',
      cancellationRequested: false,
      resultRef,
      openInteractionIds: [],
      lastSequence: 1,
      createdAt: 1,
      updatedAt: 2,
    });
  }
});
