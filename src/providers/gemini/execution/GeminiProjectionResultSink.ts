import { createHash } from 'node:crypto';

import type { ResultRef } from '@/core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';

import type { GeminiExecutionResultSink } from './GeminiExecutionBackend';

/**
 * The reference for a Gemini result, and deliberately not the result.
 *
 * The answer is durable once — in the conversation Grimoire persists — and D2
 * forbids a second copy of a provider transcript without exception, so this
 * commits without writing.
 *
 * Once, not twice, and that is this provider's own difference:
 * `capabilities.ts` declares `supportsNativeHistory: false` because Gemini
 * hydrates no native transcript. Grok's sink reads its session log back when a
 * turn finishes without streaming an answer; there is no equivalent to read
 * here, so this sink has no recovery port at all rather than an empty one.
 */
export class GeminiProjectionResultSink implements GeminiExecutionResultSink {
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
