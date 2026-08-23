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

/** Told when the agent would not take the mode the vault asked for. */
export type GeminiModeRefusedReporter = (input: {
  readonly modeId: string;
  readonly error: unknown;
}) => void;

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
  constructor(
    private readonly resolver: GeminiAcpDynamicConfigResolver,
    private readonly onModeRefused?: GeminiModeRefusedReporter,
  ) {}

  async apply(input: Parameters<GeminiExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const config = await this.resolver.resolve(input.dynamicRef);
    throwIfAborted(input.signal);
    if (config.modelId?.trim()) {
      // Strict, unlike the mode below, and deliberately: no agent has been
      // observed refusing a model it advertised, and a turn that silently ran
      // on a different one than the badge shows is a question nobody asked.
      await input.client.setModel({ modelId: config.modelId.trim(), sessionId: input.sessionId });
    }
    throwIfAborted(input.signal);
    const requested = config.modeId?.trim();
    if (requested) {
      await this.applyMode(input, mapGrimoireModeToGemini(requested));
    }
  }

  /**
   * The mode the vault asked for, where the agent will take it.
   *
   * **A refused mode is not a failed turn**, and the live smoke is why this is
   * not an assumption: `gemini 0.55.1` advertises all four modes in its reply to
   * `session/new` and then answers `session/set_mode` for `yolo` and `autoEdit`
   * with `-32603 Cannot enable privileged approval modes in an untrusted
   * folder`. The call is awaited before the prompt, so a thrown rejection ended
   * every turn a user ran with Auto-approve on in a folder Gemini has not been
   * told to trust — before the prompt was ever sent, and reported as a session
   * that may no longer exist.
   *
   * What happens instead is the turn runs in the mode the session already has.
   * The refusals observed are all *toward* asking rather than away from it —
   * the privileged modes are the ones an untrusted folder withholds — so the
   * session is stricter than the toolbar promises rather than looser, which is
   * the safe way to be wrong about a permission. It is still wrong, which is
   * what the report is for.
   */
  private async applyMode(
    input: Parameters<GeminiExecutionDynamicApplier['apply']>[0],
    modeId: string,
  ): Promise<void> {
    try {
      await input.client.setMode({ modeId, sessionId: input.sessionId });
    } catch (error) {
      if (input.signal.aborted) {
        throw error;
      }
      this.onModeRefused?.({ modeId, error });
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
