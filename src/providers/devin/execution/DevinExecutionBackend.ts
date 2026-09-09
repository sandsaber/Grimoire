import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpExecutionBackend,
  type ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';

export const DEVIN_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-devin'),
  association: { kind: 'provider' as const, providerId: 'devin' },
});

/**
 * Devin's execution backend: the shared managed-ACP one, under its own id.
 *
 * The seventh provider on it. What is Devin's is beside this file: `devin acp`
 * as a subcommand, models and modes read from `configOptions`, and a permission
 * request whose only content is a command line in `_meta`.
 */
export class DevinExecutionBackend extends ManagedAcpExecutionBackend {
  constructor(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>) {
    super({ ...context, descriptor: DEVIN_EXECUTION_DESCRIPTOR });
  }
}

export type DevinExecutionBackendContext =
  Omit<ManagedAcpExecutionBackendContext, 'descriptor'>;

export type {
  ManagedAcpExecutionDynamicApplier as DevinExecutionDynamicApplier,
  ManagedAcpExecutionInvocation as DevinExecutionInvocation,
  ManagedAcpExecutionResultSink as DevinExecutionResultSink,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
