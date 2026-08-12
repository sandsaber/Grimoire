import type { RunId } from '../../core/execution/ExecutionIds';
import type { ResultCommitOutcome } from '../../core/execution/ResultCommit';
import type { ProviderId } from '../../core/types/provider';
import type { DurableExecutionResultStore } from './DurableExecutionResultStore';

export interface RunScopedResultInput {
  readonly runId: RunId | string;
  readonly output: string;
  readonly source: string;
  readonly nativeAgentKey?: string;
  readonly signal: AbortSignal;
}

export interface NativeScopedResultInput {
  readonly output: string;
  readonly nativeSessionRef: string;
  readonly nativeRunRef?: string;
  readonly source?: string;
  readonly nativeAgentKey?: string;
  readonly signal: AbortSignal;
}

/** Adapts run-scoped SDK/app-server results to one application result store. */
export function createRunScopedResultSink(
  providerId: ProviderId,
  results: DurableExecutionResultStore,
): { storeResult(input: RunScopedResultInput): Promise<ResultCommitOutcome> } {
  return {
    storeResult: input => results.store({
      identity: compactIdentity({
        providerId,
        runId: input.runId,
        nativeAgentKey: input.nativeAgentKey,
      }),
      output: input.output,
      source: resultSource(providerId, input.source),
      signal: input.signal,
    }),
  };
}

/** Adapts managed-session results whose provider owns the native run identity. */
export function createNativeScopedResultSink(
  providerId: ProviderId,
  results: DurableExecutionResultStore,
): { storeResult(input: NativeScopedResultInput): Promise<ResultCommitOutcome> } {
  return {
    storeResult: input => results.store({
      identity: compactIdentity({
        providerId,
        nativeSessionRef: input.nativeSessionRef,
        nativeRunRef: input.nativeRunRef,
        nativeAgentKey: input.nativeAgentKey,
      }),
      output: input.output,
      source: resultSource(providerId, input.source ?? 'assistant'),
      signal: input.signal,
    }),
  };
}

function compactIdentity(
  input: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function resultSource(providerId: ProviderId, source: string): string {
  const normalized = source.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-');
  if (!normalized) throw new Error('Provider result source is empty.');
  return `${providerId}:${normalized}`;
}
