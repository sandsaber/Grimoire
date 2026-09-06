import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpExecutionBackend,
  type ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';

export const QWEN_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-qwen'),
  association: { kind: 'provider' as const, providerId: 'qwen' },
});

/**
 * Qwen Code's execution backend: the shared managed-ACP one, under its own id.
 *
 * The sixth provider on it, and the last on the legacy path. What is Qwen's is
 * beside this file: `qwen --acp` as a flag rather than a subcommand, dedicated
 * `session/set_model` and `session/set_mode` rather than
 * `session/set_config_option`, and a reasoning effort applied as a `/effort`
 * prompt of its own — a mechanism no sibling on this transport uses.
 *
 * Gemini is the provider this resembles, and the two runtimes were measured
 * against each other rather than assumed alike: Qwen's method surface is a
 * strict superset of Gemini's.
 */
export class QwenExecutionBackend extends ManagedAcpExecutionBackend {
  constructor(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>) {
    super({ ...context, descriptor: QWEN_EXECUTION_DESCRIPTOR });
  }
}

/**
 * What this backend is built from, minus the descriptor it supplies itself.
 *
 * The module's execution slot is typed on it, and a provider that names its own
 * backend id twice would be one place for the two to disagree.
 */
export type QwenExecutionBackendContext =
  Omit<ManagedAcpExecutionBackendContext, 'descriptor'>;

export type {
  ManagedAcpExecutionDynamicApplier as QwenExecutionDynamicApplier,
  ManagedAcpExecutionInvocation as QwenExecutionInvocation,
  ManagedAcpExecutionResultSink as QwenExecutionResultSink,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
