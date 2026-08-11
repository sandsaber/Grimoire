import type { OpencodeExecutionDynamicApplier } from './OpencodeExecutionBackend';

export interface OpencodeAcpDynamicConfig {
  readonly modeId?: string;
  readonly modelId?: string;
  readonly effort?: {
    readonly configId: string;
    readonly value: string;
  };
}

export interface OpencodeAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<OpencodeAcpDynamicConfig>;
}

/** Provider-owned config ordering layered over the protocol-generic ACP kernel. */
export class OpencodeAcpDynamicConfigApplier implements OpencodeExecutionDynamicApplier {
  constructor(private readonly resolver: OpencodeAcpDynamicConfigResolver) {}

  async apply(input: Parameters<OpencodeExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const config = await this.resolver.resolve(input.dynamicRef);
    throwIfAborted(input.signal);
    if (config.modeId?.trim()) {
      await input.client.setConfigOption({
        configId: 'mode',
        sessionId: input.sessionId,
        type: 'select',
        value: config.modeId.trim(),
      });
    }
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
    if (config.effort?.configId.trim() && config.effort.value.trim()) {
      await input.client.setConfigOption({
        configId: config.effort.configId.trim(),
        sessionId: input.sessionId,
        type: 'select',
        value: config.effort.value.trim(),
      });
    }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('OpenCode dynamic configuration aborted.');
}
