import { mapGrimoireModeToGemini } from '@/providers/gemini/modes';

import type { GeminiExecutionDynamicApplier } from './GeminiExecutionBackend';

/** What one Gemini turn asks its session to be set to, once the session exists. */
export interface GeminiAcpDynamicConfig {
  readonly modeId?: string;
  readonly modelId?: string;
}

export interface GeminiAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<GeminiAcpDynamicConfig>;
}

/**
 * Gemini's own ordering, over the protocol-generic ACP kernel.
 *
 * Where the OpenCode family sets everything through
 * `session/set_config_option`, Gemini has dedicated methods — `session/set_model`
 * and `session/set_mode` — which is the shape Grok has too. The recorded session
 * confirms the absence as much as the presence: it answers `session/new` with
 * `models` and `modes` and **no** `configOptions` at all, so there is no config
 * option to set anything through.
 *
 * The mode is translated here rather than forwarded. A turn is composed in
 * Grimoire's vocabulary — `normal`, `full_access`, `plan` — and those are not
 * Gemini's ids; sending one is a mode the agent does not have, and the call is
 * awaited before the prompt, so the rejection ends the turn rather than
 * degrading it. That is the same defect the fourth review found in the legacy
 * runtime, and this is the composition's half of the fix.
 *
 * No reasoning effort: `capabilities.ts` declares `reasoningControl: 'none'` for
 * this provider, so there is nothing for a third call to carry.
 */
export class GeminiAcpDynamicConfigApplier implements GeminiExecutionDynamicApplier {
  constructor(private readonly resolver: GeminiAcpDynamicConfigResolver) {}

  async apply(input: Parameters<GeminiExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const config = await this.resolver.resolve(input.dynamicRef);
    throwIfAborted(input.signal);
    if (config.modelId?.trim()) {
      await input.client.setModel({ modelId: config.modelId.trim(), sessionId: input.sessionId });
    }
    throwIfAborted(input.signal);
    const requested = config.modeId?.trim();
    if (requested) {
      await input.client.setMode({
        modeId: mapGrimoireModeToGemini(requested),
        sessionId: input.sessionId,
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
    : new Error('Gemini dynamic configuration aborted.');
}
