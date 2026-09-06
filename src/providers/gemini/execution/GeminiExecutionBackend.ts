import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpExecutionBackend,
  type ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';

export const GEMINI_EXECUTION_DESCRIPTOR = Object.freeze({
  backendId: executionBackendId('provider-gemini'),
  association: { kind: 'provider' as const, providerId: 'gemini' },
});

/**
 * Gemini CLI's execution backend: the shared managed-ACP one, under its own id.
 *
 * The fifth provider on it. What is Gemini's is beside this file, and it is not
 * what the OpenCode family's is: this CLI is spoken to through a `--acp` flag
 * rather than a subcommand, it configures a session through `session/set_mode`
 * and `session/set_model` rather than `session/set_config_option`, and it names
 * its modes itself — `default`, `autoEdit`, `yolo`, `plan`. Grok is the sibling
 * this resembles, and the recording says so.
 */
export class GeminiExecutionBackend extends ManagedAcpExecutionBackend {
  constructor(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>) {
    super({ ...context, descriptor: GEMINI_EXECUTION_DESCRIPTOR });
  }
}

/**
 * What this backend is built from, minus the descriptor it supplies itself.
 *
 * The module's execution slot is typed on it, and a provider that names its own
 * backend id twice would be one place for the two to disagree.
 */
export type GeminiExecutionBackendContext =
  Omit<ManagedAcpExecutionBackendContext, 'descriptor'>;

export type {
  ManagedAcpExecutionDynamicApplier as GeminiExecutionDynamicApplier,
  ManagedAcpExecutionInvocation as GeminiExecutionInvocation,
  ManagedAcpExecutionResultSink as GeminiExecutionResultSink,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
