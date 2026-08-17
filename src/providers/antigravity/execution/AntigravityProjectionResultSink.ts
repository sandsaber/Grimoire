import type { ResultCommitOutcome } from '../../../core/execution/ResultCommit';
import type { AntigravityResultSink } from './AntigravityExecutionBackend';

/**
 * The result reference for a print run, and deliberately nothing more.
 *
 * `ResultRef` is `resultId` and `storage`: an identity and where the answer
 * lives, never the answer. For this provider the answer lives in the
 * conversation — the CLI keeps no transcript Grimoire could point at, and the
 * print log is deleted with the run — so `projection` is the truthful storage,
 * and the copy is the assistant message the chat surface persists from the
 * content the run emitted.
 *
 * That is why this commits without writing. D2 forbids a second copy of a
 * transcript in the control store without exception, and the conversation is
 * the only other durable place; a sink that wrote the output anywhere else
 * would be creating exactly the duplicate the boundary exists to prevent. What
 * is persisted is the reference, which is what D2 permits.
 *
 * The abort signal is still honoured, because a cancellation that arrives
 * during the commit window must not produce a result the run then has to
 * relabel.
 */
export class AntigravityProjectionResultSink implements AntigravityResultSink {
  async storeResult(input: {
    readonly runId: string;
    readonly output: string;
    readonly source: 'stdout' | 'transcript';
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome> {
    if (input.signal.aborted) {
      return { kind: 'aborted' };
    }
    return {
      kind: 'committed',
      result: { resultId: `result-${input.runId}`, storage: 'projection' },
    };
  }
}
