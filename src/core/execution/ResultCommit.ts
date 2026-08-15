import type { ResultRef } from './ExecutionContracts';

export type ResultCommitOutcome =
  | { readonly kind: 'committed'; readonly result: ResultRef }
  | { readonly kind: 'aborted' };

export type ResultCommitSettlement =
  | ResultCommitOutcome
  | { readonly kind: 'unknown' };

export interface ResultCommitScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Bounds an abortable durable result write and preserves uncertainty honestly. */
export function settleResultCommit(
  commit: Promise<ResultCommitOutcome>,
  abort: AbortController,
  scheduler: ResultCommitScheduler,
  timeoutMs: number,
): Promise<ResultCommitSettlement> {
  return new Promise(resolve => {
    let settled = false;
    let timeout: unknown;
    const finish = (outcome: ResultCommitSettlement) => {
      if (settled) {
        return;
      }
      settled = true;
      scheduler.clearTimeout(timeout);
      resolve(outcome);
    };
    timeout = scheduler.setTimeout(() => {
      abort.abort();
      finish({ kind: 'unknown' });
    }, timeoutMs);
    void commit.then(finish, () => finish({ kind: 'unknown' }));
  });
}
