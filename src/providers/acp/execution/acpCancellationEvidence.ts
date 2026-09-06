import type { RunRecoveryEvidence, RunRecoveryQuery } from '@/core/execution/ExecutionContracts';

/**
 * What ACP itself already answered about a run that was told to stop.
 *
 * A managed ACP turn is a `session/prompt` request, and the protocol has the
 * agent answer that request with `stopReason: "cancelled"` once it has stopped.
 * That answer arrives over the same live connection the cancel was sent on, so
 * a turn that produced it is a turn known to have ended — which is the one
 * thing a provider whose reconciler cannot read its own session store still
 * knows for certain.
 *
 * Without this, every Stop on an ACP provider ends `indeterminate`, which the
 * surface words as "Grimoire could not establish whether this run completed" —
 * for the one outcome the user themselves asked for and watched happen.
 *
 * `null` means this helper has nothing to add, not that nothing happened: the
 * provider's own reconciliation answers then, exactly as before.
 */
export function acpCancellationEvidence(query: RunRecoveryQuery): RunRecoveryEvidence | null {
  if (!query.cancellationRequested || !query.nativeStopReason) {
    return null;
  }
  return /cancel/i.test(query.nativeStopReason) ? { kind: 'stopped-safe' } : null;
}
