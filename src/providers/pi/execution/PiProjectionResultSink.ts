import { createHash } from 'node:crypto';

import type { ResultRef } from '@/core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';

import type { PiExecutionResultSink } from './PiExecutionBackend';

export class PiProjectionResultSink implements PiExecutionResultSink {
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
