import { createHash } from 'node:crypto';

import type { ResultRef } from '@/core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';

import type { KimicodeExecutionResultSink } from './KimicodeExecutionBackend';

export interface KimicodeProjectionResultSinkPorts {
  /**
   * Waits for the window this turn's own usage update carries.
   *
   * Unlike Qwen's, which *asks* for a window ACP never sends it, this CLI does
   * send one — one frame too late. `kimicode-wire.json` has the answer to
   * `session/prompt` at seq 26 and the `usage_update` at seq 27, and a session
   * notification is attributed to the live run, so the update that describes a
   * turn arrived after that turn had no run to receive it: dropped when the
   * user stopped there, and counted against the *next* turn when they did not.
   *
   * So the turn waits, here, for the reason `noteTurnEnded` exists — what it
   * finds has to reach the turn that earned it. Resolves as soon as the update
   * lands, and gives up quietly: a window nobody could read is a badge without
   * a number, not a failed turn.
   */
  readonly awaitContextUsage: (sessionId: string) => Promise<void>;
}

/**
 * The reference for a Kimi Code result, and deliberately not the result.
 *
 * The answer is already durable twice — in the conversation Grimoire persists
 * and in Kimi Code's own session database, which this provider already reads
 * back for a session's cost — and D2 forbids a second copy of a provider
 * transcript without exception. So this commits without writing: what is
 * persisted is the reference, which is what D2 permits.
 *
 * Named by the session and the turn rather than by the run, because that is
 * what Kimi Code itself can be asked about: a run id means nothing to a database
 * this sink does not write.
 */
export class KimicodeProjectionResultSink implements KimicodeExecutionResultSink {
  constructor(private readonly ports?: KimicodeProjectionResultSinkPorts) {}

  /**
   * The turn is ending, and this provider's window has not arrived yet.
   *
   * Opportunistic, like Qwen's: the wait is bounded by whoever supplies the
   * port, and a turn is never failed for a number.
   */
  async noteTurnEnded(input: {
    readonly nativeSessionRef: string;
  }): Promise<void> {
    await this.ports?.awaitContextUsage(input.nativeSessionRef).catch(() => undefined);
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
    // What distinguishes the same result observed twice from a second,
    // different one committed under the same identity.
    digest: sha256(input.output),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
