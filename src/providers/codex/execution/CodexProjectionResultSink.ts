import { createHash } from 'node:crypto';

import type { ResultRef } from '../../../core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '../../../core/execution/ResultCommit';
import type { CodexExecutionResultSink } from './CodexExecutionBackend';

/**
 * The reference for a Codex result, and deliberately not the result.
 *
 * The answer is already durable twice — in the conversation Grimoire persists
 * and in Codex's own JSONL transcript — and D2 forbids a second copy of a
 * provider transcript without exception. So this commits without writing: what
 * is persisted is the reference, which is what D2 permits.
 *
 * `projection` is the truthful storage even though a provider-native transcript
 * exists, because a `provider-native` reference has to *locate* the answer and
 * this sink is told only the run. Naming a store it cannot point into would be
 * a claim nothing can act on.
 *
 * A run can commit more than one result: its own answer, and one for every
 * native agent that finishes inside it. So the identity is per source, not per
 * run — one identity for two different answers is the failure this exists to
 * prevent.
 */
export class CodexProjectionResultSink implements CodexExecutionResultSink {
  async storeResult(input: {
    readonly runId: string;
    readonly output: string;
    readonly source: 'assistant' | 'native-agent';
    readonly nativeAgentKey?: string;
    readonly signal: AbortSignal;
  }): Promise<ResultCommitOutcome> {
    if (input.signal.aborted) {
      return { kind: 'aborted' };
    }
    return { kind: 'committed', result: resultRef(input) };
  }
}

function resultRef(input: {
  readonly runId: string;
  readonly output: string;
  readonly nativeAgentKey?: string;
}): ResultRef {
  return {
    resultId: input.nativeAgentKey
      // Derived rather than embedded: the key is named by the model and reaches
      // us off the wire, while a result id the control store accepts is a
      // constrained identifier. A reference the store refuses is a run that
      // cannot record its own result.
      ? `result-${input.runId}-agent-${sha256(input.nativeAgentKey).slice(0, 32)}`
      : `result-${input.runId}`,
    storage: 'projection',
    // What distinguishes the same result observed twice — which is how the
    // daemon reports a finished native agent — from a second, different one
    // committed under the same identity.
    digest: sha256(input.output),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
