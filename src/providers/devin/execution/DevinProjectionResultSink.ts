import { createHash } from 'node:crypto';

import type { ResultRef } from '@/core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';

import type { DevinExecutionResultSink } from './DevinExecutionBackend';

/**
 * The reference for a Devin result, and deliberately not the result.
 *
 * The answer is durable once — in the conversation Grimoire persists — and D2
 * forbids a second copy of a provider transcript, so this commits without
 * writing. No recovery port and no turn-end hook: Devin's `usage_update`
 * carries the context window on the wire, so unlike Qwen there is nothing to
 * ask the agent for as the turn ends.
 */
export class DevinProjectionResultSink implements DevinExecutionResultSink {
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
    resultId: `result-${sha256(`${input.nativeSessionRef}:${turn}`).slice(0, 32)}`,
    storage: 'projection',
    digest: sha256(input.output),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
