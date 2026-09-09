import type { AcpContentPayload } from '@/providers/acp/execution/AcpContentPayload';
import { mapGrimoireModeToDevin } from '@/providers/devin/modes';

import type { DevinExecutionDynamicApplier } from './DevinExecutionBackend';

/** What one Devin turn asks its session to be set to, once the session exists. */
export interface DevinAcpDynamicConfig {
  readonly modeId?: string;
  readonly modelId?: string;
}

export interface DevinAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<DevinAcpDynamicConfig>;
}

/** Told when the agent would not take the mode the vault asked for. */
export type DevinModeRefusedReporter = (input: {
  readonly modeId: string;
  readonly error: unknown;
}) => void;

/**
 * Devin's own ordering, over the protocol-generic ACP kernel: model, then mode,
 * both through `session/set_config_option`.
 *
 * **Not `session/set_model`.** Probed on 2026-09-09: `devin acp` answers it
 * `-32601 Method not found`, while `set_config_option` with `configId: 'model'`
 * is what the recorded session honours. `session/set_mode` is accepted — but it
 * accepts an id the session never offered just as silently, so the mode goes
 * the same way, where a value the agent does not have is refused out loud.
 *
 * The mode is translated here rather than forwarded: a turn is composed in
 * Grimoire's vocabulary — `normal`, `full_access`, `plan` — and those are not
 * Devin's ids. The model is strict and the mode is tolerant: a model the
 * session did not offer answers `-32002 Model not found` (recorded), and a turn
 * that silently ran on another model than the badge shows is worse than a
 * failed one; a refused mode leaves the session in the stricter mode it already
 * had, which is the safe way to be wrong.
 */
export class DevinAcpDynamicConfigApplier implements DevinExecutionDynamicApplier {
  /** The sessions already told about a refusal, so a turn is not the unit. */
  private readonly reportedSessions = new Set<string>();

  constructor(
    private readonly resolver: DevinAcpDynamicConfigResolver,
    private readonly onModeRefused?: DevinModeRefusedReporter,
  ) {}

  async apply(input: Parameters<DevinExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const config = await this.resolver.resolve(input.dynamicRef);
    throwIfAborted(input.signal);
    if (config.modelId?.trim()) {
      await input.client.setConfigOption({
        configId: 'model',
        sessionId: input.sessionId,
        type: 'select',
        value: config.modelId.trim(),
      });
    }
    throwIfAborted(input.signal);
    const requested = config.modeId?.trim();
    if (requested) {
      await this.applyMode(input, mapGrimoireModeToDevin(requested));
    }
  }

  private async applyMode(
    input: Parameters<DevinExecutionDynamicApplier['apply']>[0],
    modeId: string,
  ): Promise<void> {
    try {
      await input.client.setConfigOption({
        configId: 'mode',
        sessionId: input.sessionId,
        type: 'select',
        value: modeId,
      });
      this.reportedSessions.delete(input.sessionId);
    } catch (error) {
      if (input.signal.aborted) {
        throw error;
      }
      this.onModeRefused?.({ modeId, error });
      if (this.reportedSessions.has(input.sessionId)) {
        return;
      }
      this.reportedSessions.add(input.sessionId);
      const detail = refusalDetail(error);
      input.presentContent?.({
        kind: 'mode-refused',
        modeId,
        ...(detail ? { detail } : {}),
      } satisfies AcpContentPayload);
    }
  }
}

/**
 * The sentence worth showing, out of the error the agent sent.
 *
 * Devin puts its actionable text in `data.uri` for a missing model and in the
 * message for the rest; both are read, and the generic JSON-RPC text is not.
 */
function refusalDetail(error: unknown): string | undefined {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of ['details', 'uri']) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() && message.trim() !== 'Internal error'
    ? message.trim()
    : undefined;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Devin dynamic configuration aborted.');
}
