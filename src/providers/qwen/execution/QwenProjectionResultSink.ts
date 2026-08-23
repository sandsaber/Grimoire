import { createHash } from 'node:crypto';

import type { ResultRef } from '@/core/execution/ExecutionContracts';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';
import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpUsageUpdate } from '@/providers/acp/types';
import type { QwenContentPayload } from '@/providers/qwen/execution/QwenContentPresenter';

import type { QwenExecutionResultSink } from './QwenExecutionBackend';

/**
 * The reference for a Qwen result, and deliberately not the result.
 *
 * The answer is durable once — in the conversation Grimoire persists — and D2
 * forbids a second copy of a provider transcript without exception, so this
 * commits without writing.
 *
 * Once, not twice, and Qwen shares that with Gemini: `capabilities.ts`
 * declares `supportsNativeHistory: false` because this CLI hydrates no native
 * transcript. Grok's sink reads its session log back when a turn finishes
 * without streaming an answer; there is no equivalent to read here, so this
 * sink has no recovery port at all rather than an empty one.
 */
export interface QwenProjectionResultSinkPorts {
  /**
   * How full the context is, which this CLI answers only when asked.
   *
   * `qwen/status/session/context_usage` is a method ACP does not define and Qwen
   * does — the legacy runtime calls it once per turn, after the prompt returns,
   * because no `usage_update` carries the parent window for this provider.
   * Asked here rather than at dispatch for the reason `noteTurnEnded` exists:
   * what it finds has to reach the turn that earned it rather than the next one.
   *
   * Takes the connection the turn ran on rather than finding one: a backend
   * holds one client per execution session and this sink serves every tab, so
   * anything remembered here would be whichever session connected last.
   */
  readonly readContextUsage: (
    client: ManagedAcpClient,
    sessionId: string,
  ) => Promise<AcpUsageUpdate | null>;
}

export class QwenProjectionResultSink implements QwenExecutionResultSink {
  constructor(private readonly ports?: QwenProjectionResultSinkPorts) {}

  /**
   * The turn is ending, and this provider's context window is a question.
   *
   * Opportunistic on every path: the extension is optional — an older Qwen
   * simply has no such method — and a window nobody could read is a badge
   * without a number, not a failed turn.
   */
  async noteTurnEnded(input: {
    readonly nativeSessionRef: string;
    readonly presentContent: (payload: unknown) => void;
    readonly client: ManagedAcpClient;
  }): Promise<void> {
    const usage = await this.ports?.readContextUsage(input.client, input.nativeSessionRef)
      .catch(() => null);
    if (usage) {
      input.presentContent({ kind: 'session-usage', usage } satisfies QwenContentPayload);
    }
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
