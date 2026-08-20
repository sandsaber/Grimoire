import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpExecutionBackend,
  type ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';

export const GROK_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-grok'),
  association: { kind: 'provider' as const, providerId: 'grok' },
});

/**
 * Grok's execution backend: the shared managed-ACP one, under its own id.
 *
 * The second provider on it, and the first to cost only this — which is the
 * claim wave 4 made about what the remaining ACP waves should be worth. What
 * Grok owns is beside this file: its launch, the envelope it speaks its own
 * updates through, its permission vocabulary and its tool normalization.
 */
export class GrokExecutionBackend extends ManagedAcpExecutionBackend {
  constructor(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>) {
    super({ ...context, descriptor: GROK_EXECUTION_DESCRIPTOR });
  }
}
