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
   * What the surface still needs, read before the turn closes.
   *
   * Grok sends no context-window update over ACP and, for many turns, no cost
   * either; both are in its own session log. Committing is the last moment the
   * turn is still open, so this is where the tab that owns the session goes and
   * reads them. A failure here is not a failed turn: the answer is committed
   * either way, and the badge is what goes without.
   */
  readonly fillSurface?: (input: {
    readonly nativeSessionRef: string;
    readonly presentContent: (payload: unknown) => void;
  }) => Promise<void>;
}

export class GrokProjectionResultSink implements ManagedAcpExecutionResultSink {
  constructor(private readonly ports: GrokResultSinkPorts = {}) {}

  async storeResult(input: {
    readonly output: string;
    readonly nativeSessionRef: string;
    readonly nativeRunRef?: string;
    readonly signal: AbortSignal;
    readonly presentContent: (payload: unknown) => void;
  }): Promise<ResultCommitOutcome> {
    if (input.signal.aborted) {
      return { kind: 'aborted' };
    }
    await this.ports.fillSurface?.({
      nativeSessionRef: input.nativeSessionRef,
      presentContent: input.presentContent,
    }).catch(() => undefined);
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
