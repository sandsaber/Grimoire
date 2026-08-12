import { ExecutionInteractionPresentationRecovery } from '@/app/runtime/ExecutionInteractionPresentationRecovery';
import type { ExecutionInteractionRecord } from '@/core/execution/ExecutionControlRecords';

describe('ExecutionInteractionPresentationRecovery', () => {
  it('retains exactly presentations referenced by durable lifecycle interactions', async () => {
    const recovered: string[][] = [];
    const recovery = new ExecutionInteractionPresentationRecovery(
      {
        getRunSnapshots: () => [
          { record: { runId: 'run-one' }, revision: 1 },
          { record: { runId: 'run-two' }, revision: 1 },
        ] as never,
        getInteractionsForRun: runId => runId === 'run-one'
          ? [interaction('pr-b'), interaction('pr-a')]
          : [interaction('pr-a')],
      },
      {
        recover: async refs => {
          recovered.push([...refs]);
          return { retained: refs.length, removed: 3, totalBytes: 128 };
        },
      },
    );

    await expect(recovery.recover()).resolves.toEqual({
      retained: 2,
      removed: 3,
      totalBytes: 128,
    });
    expect(recovered).toEqual([['pr-a', 'pr-b']]);
  });
});

function interaction(presentationRef: string): ExecutionInteractionRecord {
  return { presentationRef } as ExecutionInteractionRecord;
}
