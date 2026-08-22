import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpExecutionBackend,
  type ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';

export const KIMICODE_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-kimicode'),
  association: { kind: 'provider' as const, providerId: 'kimicode' },
});

/**
 * Kimi Code's execution backend: the shared managed-ACP one, under its own id.
 *
 * The whole of it. OpenCode's flip put the client's lifetime, the session
 * binding, the dispatch, the recovery, the interactions and the result into
 * `ManagedAcpExecutionBackend`, and Grok's proved that a second provider on the
 * same transport needs nothing added to it. What is left for a provider is the
 * descriptor, which is what this is — and the id has to differ, because two
 * providers sharing one would share a backend generation and fence each other's
 * sessions.
 */
export class KimicodeExecutionBackend extends ManagedAcpExecutionBackend {
  constructor(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>) {
    super({ ...context, descriptor: KIMICODE_EXECUTION_DESCRIPTOR });
  }
}

/**
 * What this backend is built from, minus the descriptor it supplies itself.
 *
 * The module's execution slot is typed on it, and a provider that names its own
 * backend id twice would be one place for the two to disagree.
 */
export type KimicodeExecutionBackendContext =
  Omit<ManagedAcpExecutionBackendContext, 'descriptor'>;

export type {
  ManagedAcpAuxiliaryPort as KimicodeAuxiliaryPort,
  ManagedAcpExecutionDynamicApplier as KimicodeExecutionDynamicApplier,
  ManagedAcpExecutionInvocation as KimicodeExecutionInvocation,
  ManagedAcpExecutionRequestResolver as KimicodeExecutionRequestResolver,
  ManagedAcpExecutionResultSink as KimicodeExecutionResultSink,
  ManagedAcpExecutionScheduler as KimicodeExecutionScheduler,
  ManagedAcpInteractionBridge as KimicodeInteractionBridge,
  ManagedAcpPreparedInteraction as KimicodePreparedInteraction,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
