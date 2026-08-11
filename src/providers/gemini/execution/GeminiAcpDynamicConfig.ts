import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';

import type { GeminiExecutionDynamicApplier } from './GeminiExecutionBackend';

export interface GeminiAcpDynamicConfig {
  readonly modelId?: string;
  readonly modeId?: string;
}

export interface GeminiAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<GeminiAcpDynamicConfig>;
}

interface AppliedConfig {
  modeId?: string;
  modelId?: string;
}

/** Applies Gemini's native model and approval-mode controls before the user turn. */
export class GeminiAcpDynamicConfigApplier implements GeminiExecutionDynamicApplier {
  private readonly appliedByClient = new WeakMap<ManagedAcpClient, Map<string, AppliedConfig>>();

  constructor(private readonly resolver: GeminiAcpDynamicConfigResolver) {}

  async apply(input: Parameters<GeminiExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const requested = await this.resolver.resolve(input.dynamicRef);
    const applied = this.sessionState(input.client, input.sessionId);

    throwIfAborted(input.signal);
    const modelId = requested.modelId?.trim();
    if (modelId && modelId !== applied.modelId) {
      if (!input.client.setModel) throw new Error('Gemini ACP model selection is unavailable.');
      await input.client.setModel({ modelId, sessionId: input.sessionId });
      applied.modelId = modelId;
    }

    throwIfAborted(input.signal);
    const modeId = requested.modeId?.trim();
    if (modeId && modeId !== applied.modeId) {
      if (!input.client.setMode) throw new Error('Gemini ACP mode selection is unavailable.');
      await input.client.setMode({ modeId, sessionId: input.sessionId });
      applied.modeId = modeId;
    }
  }

  private sessionState(client: ManagedAcpClient, sessionId: string): AppliedConfig {
    let sessions = this.appliedByClient.get(client);
    if (!sessions) {
      sessions = new Map();
      this.appliedByClient.set(client, sessions);
    }
    let state = sessions.get(sessionId);
    if (!state) {
      state = {};
      sessions.set(sessionId, state);
    }
    return state;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Gemini dynamic configuration aborted.');
}
