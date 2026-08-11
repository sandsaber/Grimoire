import type { RunTerminalKind, RunTerminalReason } from './ExecutionContracts';

const TERMINAL_REASONS_BY_KIND: Readonly<Record<
RunTerminalKind,
ReadonlySet<RunTerminalReason>
>> = {
  succeeded: new Set(['completed']),
  failed: new Set([
    'provider-failure',
    'missing-required-result',
    'spawn-failed',
    'nonzero-exit',
    'timeout',
    'output-limit',
  ]),
  cancelled: new Set(['cancellation-confirmed']),
  interrupted: new Set(['known-process-exit', 'recovery-exhausted-safe']),
  invalidated: new Set(['pre-dispatch-rejected', 'side-effect-free-rejection']),
  indeterminate: new Set([
    'dispatch-unknown',
    'cancellation-unknown',
    'effects-unknown',
    'shutdown-unknown',
  ]),
};

export function isTerminalReasonAllowed(
  kind: RunTerminalKind,
  reason: RunTerminalReason,
): boolean {
  return TERMINAL_REASONS_BY_KIND[kind].has(reason);
}

export function requireTerminalReason(
  kind: RunTerminalKind,
  reason: RunTerminalReason,
): void {
  if (!isTerminalReasonAllowed(kind, reason)) {
    throw new Error(`Run terminal reason "${reason}" is incompatible with kind "${kind}".`);
  }
}
