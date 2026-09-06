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
export interface GrokResultSinkPorts {
  /**
   * What the surface still needs, read as the turn ends.
   *
   * Grok sends no context-window update over ACP and, for many turns, no cost
   * either; both are in its own session log. The prompt returning is the last
   * moment the turn is still open — and it returns for a cancelled turn too,
   * which still spent tokens and would otherwise never be counted.
   */
  readonly fillSurface?: (input: {
    readonly nativeSessionRef: string;
    readonly presentContent: (payload: unknown) => void;
  }) => Promise<void>;
  /**
   * The answer this turn produced without sending it.
   *
   * Grok finishes turns whose final message never reaches ACP while writing the
   * answer to its own session log. Reading it back keeps the answer instead of
   * failing a turn the provider actually completed — which is what an empty
   * response looked like before the legacy runtime read it.
   */
  readonly recoverAnswer?: (input: {
    readonly nativeSessionRef: string;
  }) => Promise<string | null>;
}

export class GrokProjectionResultSink implements ManagedAcpExecutionResultSink {
  constructor(private readonly ports: GrokResultSinkPorts = {}) {}

  async recoverOutput(input: { readonly nativeSessionRef: string }): Promise<string | null> {
    return (await this.ports.recoverAnswer?.(input)) ?? null;
  }

  async noteTurnEnded(input: {
    readonly nativeSessionRef: string;
    readonly presentContent: (payload: unknown) => void;
  }): Promise<void> {
    await this.ports.fillSurface?.(input);
  }

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
