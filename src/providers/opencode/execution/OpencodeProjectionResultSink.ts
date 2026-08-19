import { createHash } from 'node:crypto';

import type { ResultRef } from '../../../core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '../../../core/execution/ResultCommit';
import type { OpencodeExecutionResultSink } from './OpencodeExecutionBackend';

/**
 * The reference for an OpenCode result, and deliberately not the result.
 *
 * The answer is already durable twice — in the conversation Grimoire persists
 * and in OpenCode's own session database — and D2 forbids a second copy of a
 * provider transcript without exception. So this commits without writing: what
 * is persisted is the reference, which is what D2 permits.
 *
 * Named by the session and the turn rather than by the run, because that is
 * what OpenCode itself can be asked about: a run id means nothing to a database
 * this sink does not write.
 */
export class OpencodeProjectionResultSink implements OpencodeExecutionResultSink {
  async storeResult(input: {
    readonly output: string;
    readonly nativeSessionRef: string;
    readonly nativeRunRef?: string;
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome> {
    if (input.signal.aborted) {
      return { kind: 'aborted' };
    }
    return { kind: 'committed', result: resultRef(input) };
  }
}

function resultRef(input: {
  readonly output: string;
  readonly nativeSessionRef: string;
  readonly nativeRunRef?: string;
}): ResultRef {
  const turn = input.nativeRunRef ?? 'turn';
  return {
    // Derived rather than embedded: a session id reaches us off the wire, and a
    // result id the control store accepts is a constrained identifier.
    resultId: `result-${sha256(`${input.nativeSessionRef}:${turn}`).slice(0, 32)}`,
    storage: 'projection',
    // What distinguishes the same result observed twice from a second,
    // different one committed under the same identity.
    digest: sha256(input.output),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
