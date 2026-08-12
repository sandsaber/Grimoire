import type { ExecutionInteractionRecord } from '../../core/execution/ExecutionControlRecords';
import type { RunId } from '../../core/execution/ExecutionIds';
import type { ExecutionRunSnapshot } from '../../core/execution/ExecutionLifecycleRegistry';
import type {
  InteractionPresentationRecoveryResult,
} from './ExecutionInteractionPresentationStore';

export interface InteractionPresentationLifecycleInventory {
  getRunSnapshots(): readonly ExecutionRunSnapshot[];
  getInteractionsForRun(runId: RunId): readonly Readonly<ExecutionInteractionRecord>[];
}

export interface InteractionPresentationRecoveryStore {
  recover(retainedPresentationRefs: readonly string[]): Promise<InteractionPresentationRecoveryResult>;
}

/** Derives presentation retention exclusively from durable lifecycle ownership. */
export class ExecutionInteractionPresentationRecovery {
  constructor(
    private readonly lifecycle: InteractionPresentationLifecycleInventory,
    private readonly presentations: InteractionPresentationRecoveryStore,
  ) {}

  recover(): Promise<InteractionPresentationRecoveryResult> {
    const retained = new Set<string>();
    for (const snapshot of this.lifecycle.getRunSnapshots()) {
      for (const interaction of this.lifecycle.getInteractionsForRun(
        snapshot.record.runId as RunId,
      )) {
        retained.add(interaction.presentationRef);
      }
    }
    return this.presentations.recover([...retained].sort());
  }
}
