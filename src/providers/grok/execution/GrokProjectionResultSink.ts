import { createHash } from 'node:crypto';

import type { ResultRef } from '@/core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';
import type { ManagedAcpExecutionResultSink } from '@/providers/acp/execution/ManagedAcpExecutionBackend';

/**
 * The reference for a Grok result, and deliberately not the result.
 *
 * The answer is already durable twice — in the conversation Grimoire persists
 * and in Grok's own session log, which this provider already reads back when a
 * turn completes without streaming its answer. D2 forbids a second copy of a
 * provider transcript without exception, so this commits without writing.
 *
 * Named by the session and the turn rather than by the run, because that is
 * what Grok itself can be asked about.
 */
export class GrokProjectionResultSink implements ManagedAcpExecutionResultSink {
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
    digest: sha256(input.output),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
