import { createHash } from 'node:crypto';

import { MimocodeProjectionResultSink } from '@/providers/mimocode/execution/MimocodeProjectionResultSink';

/**
 * What a MiMoCode turn commits, and what D2 forbids it from committing.
 *
 * The answer is already durable in the conversation and in MiMoCode's own
 * session database. A control record holding a third copy would be the second
 * provider transcript D2 rules out, so what this asserts is mostly an absence.
 */
describe('MimocodeProjectionResultSink', () => {
  const commit = (overrides: Partial<{
    output: string;
    nativeSessionRef: string;
    nativeRunRef: string;
    signal: AbortSignal;
  }> = {}) => new MimocodeProjectionResultSink().storeResult({
    output: 'the answer',
    nativeSessionRef: 'ses_abc',
    nativeRunRef: 'message-1',
    signal: new AbortController().signal,
    ...overrides,
  });

  it('commits a reference and never the answer', async () => {
    const outcome = await commit();

    expect(outcome.kind).toBe('committed');
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('the answer');
    expect(serialized).not.toContain('ses_abc');
  });

  it('names the result by the session and the turn, and the same turn twice the same way', async () => {
    const first = await commit();
    const second = await commit();
    const otherTurn = await commit({ nativeRunRef: 'message-2' });

    expect(first).toEqual(second);
    expect(first).toEqual({
      kind: 'committed',
      result: {
        resultId: expect.stringMatching(/^result-[0-9a-f]{32}$/),
        storage: 'projection',
        digest: createHash('sha256').update('the answer').digest('hex'),
      },
    });
    expect(otherTurn).not.toEqual(first);
  });

  it('tells the same result observed twice apart from a different one', async () => {
    const same = await commit();
    const changed = await commit({ output: 'a different answer' });

    expect(changed.kind).toBe('committed');
    expect(changed).toMatchObject({ result: { resultId: (same as { result: { resultId: string } }).result.resultId } });
    expect((changed as { result: { digest: string } }).result.digest)
      .not.toBe((same as { result: { digest: string } }).result.digest);
  });

  it('commits nothing for a run that was already abandoned', async () => {
    const abort = new AbortController();
    abort.abort(new Error('stopped'));

    await expect(commit({ signal: abort.signal })).resolves.toEqual({ kind: 'aborted' });
  });

  it('still names a turn the provider gave no id for', async () => {
    const outcome = await new MimocodeProjectionResultSink().storeResult({
      output: 'the answer',
      nativeSessionRef: 'ses_abc',
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      kind: 'committed',
      result: { resultId: expect.stringMatching(/^result-[0-9a-f]{32}$/) },
    });
  });
});
