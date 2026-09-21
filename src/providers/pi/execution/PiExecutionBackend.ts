import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpExecutionBackend,
  type ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';

export const PI_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-pi'),
  association: { kind: 'provider' as const, providerId: 'pi' },
});

export class PiExecutionBackend extends ManagedAcpExecutionBackend {
  constructor(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>) {
    super({ ...context, descriptor: PI_EXECUTION_DESCRIPTOR });
  }
}

export type PiExecutionBackendContext =
  Omit<ManagedAcpExecutionBackendContext, 'descriptor'>;

export type {
  ManagedAcpExecutionDynamicApplier as PiExecutionDynamicApplier,
  ManagedAcpExecutionInvocation as PiExecutionInvocation,
  ManagedAcpExecutionResultSink as PiExecutionResultSink,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
