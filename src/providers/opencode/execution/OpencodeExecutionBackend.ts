import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpExecutionBackend,
  type ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';

export const OPENCODE_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-opencode'),
  association: { kind: 'provider' as const, providerId: 'opencode' },
});

/**
 * OpenCode's execution backend: the shared managed-ACP one, under its own id.
 *
 * Everything this used to contain is now in
 * `ManagedAcpExecutionBackend` — the client's lifetime, the session binding,
 * the dispatch, the recovery, the interactions, the result. What made it
 * OpenCode's was the descriptor, and that is what is left.
 */
export class OpencodeExecutionBackend extends ManagedAcpExecutionBackend {
  constructor(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>) {
    super({ ...context, descriptor: OPENCODE_EXECUTION_DESCRIPTOR });
  }
}

/**
 * What this backend is built from, minus the descriptor it supplies itself.
 *
 * The module's execution slot is typed on it, and a provider that names its own
 * backend id twice would be one place for the two to disagree.
 */
export type OpencodeExecutionBackendContext =
  Omit<ManagedAcpExecutionBackendContext, 'descriptor'>;

export type {
  ManagedAcpExecutionDynamicApplier as OpencodeExecutionDynamicApplier,
  ManagedAcpExecutionInvocation as OpencodeExecutionInvocation,
  ManagedAcpExecutionResultSink as OpencodeExecutionResultSink,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
