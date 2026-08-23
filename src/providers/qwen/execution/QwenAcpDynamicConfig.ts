import type { AcpContentPayload } from '@/providers/acp/execution/AcpContentPayload';
import { mapGrimoireModeToQwen } from '@/providers/qwen/modes';

import type { QwenExecutionDynamicApplier } from './QwenExecutionBackend';

/** What one Qwen turn asks its session to be set to, once the session exists. */
export interface QwenAcpDynamicConfig {
  readonly modeId?: string;
  readonly modelId?: string;
  /**
   * The reasoning level, which this provider sets by *talking to it*.
   *
   * Not a config option and not a dedicated method: `QwenChatRuntime` sends
   * `/effort <level>` as a `session/prompt` of its own before the turn's, so
   * applying it costs a whole round trip the vendor charges for. That is why it
   * is skipped when the session is already on it, and why the state forgets it
   * with the session rather than after it.
   */
  readonly effortLevel?: string;
}

export interface QwenAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<QwenAcpDynamicConfig>;
}

/** Told when the agent would not take the mode the vault asked for. */
export type QwenModeRefusedReporter = (input: {
  readonly modeId: string;
  readonly error: unknown;
}) => void;

/**
 * Qwen's own ordering, over the protocol-generic ACP kernel.
 *
 * Model, then mode, then effort — Gemini's two with a third behind them, and the
 * third is this provider's alone: `/effort <level>` sent as a prompt. Its
 * session has never been observed, so unlike Gemini's this ordering stands on
 * `QwenChatRuntime` rather than on a recording.
 *
 * The mode is translated here rather than forwarded. A turn is composed in
 * Grimoire's vocabulary — `normal`, `full_access`, `plan` — and those are not
 * Qwen's ids; sending one is a mode the agent does not have, and the call is
 * awaited before the prompt, so the rejection ends the turn rather than
 * degrading it. That is the same defect the fourth review found in the legacy
 * runtime, and this is the composition's half of the fix.
 *
 * The effort goes **last**, after the mode, which is the order the legacy
 * runtime applies them in — and it matters more here than ordering usually does,
 * because sending it is a turn: a mode change that failed should not have cost
 * one first.
 */
export class QwenAcpDynamicConfigApplier implements QwenExecutionDynamicApplier {
  /**
   * The sessions already told about a refusal, so a turn is not the unit.
   *
   * The reason Qwen refuses is a property of the folder, not of the turn — it
   * will refuse every turn of the session in the same way — so a notice per turn
   * would be noise the user learns to skip past. Once per session is what makes
   * it read as information.
   */
  private readonly reportedSessions = new Set<string>();

  constructor(
    private readonly resolver: QwenAcpDynamicConfigResolver,
    private readonly onModeRefused?: QwenModeRefusedReporter,
  ) {}

  async apply(input: Parameters<QwenExecutionDynamicApplier['apply']>[0]): Promise<void> {
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
      await this.applyMode(input, mapGrimoireModeToQwen(requested));
    }
    throwIfAborted(input.signal);
    const effortLevel = config.effortLevel?.trim();
    if (effortLevel) {
      // A prompt, not a setting. The agent answers it like any other turn, so
      // this is awaited before the real one — which is what the legacy runtime
      // does, and what makes an unknown level a turn spent on a command the
      // agent will not understand.
      await input.client.prompt({
        prompt: [{ text: `/effort ${effortLevel}`, type: 'text' }],
        sessionId: input.sessionId,
      });
    }
  }

  /**
   * The mode the vault asked for, where the agent will take it.
   *
   * **A refused mode is not a failed turn.** Gemini's live smoke is the evidence
   * — `gemini 0.55.1` advertises four modes and then refuses the privileged two
   * in a folder it has not been told to trust, and a thrown rejection ended
   * every turn a user ran with Auto-approve on. Whether *this* CLI does the same
   * is unobserved, which is the argument for the tolerance rather than against
   * it: a mode that cannot be set is never a reason to lose the turn.
   *
   * What happens instead is the turn runs in the mode the session already has.
   * The refusals observed on the sibling are all *toward* asking rather than
   * away from it, so the session ends up stricter than the toolbar promises
   * rather than looser — the safe way to be wrong about a permission. It is
   * still wrong, which is what the report and the notice are for.
   */
  private async applyMode(
    input: Parameters<QwenExecutionDynamicApplier['apply']>[0],
    modeId: string,
  ): Promise<void> {
    try {
      await input.client.setMode({ modeId, sessionId: input.sessionId });
      // A session that took it is one a later refusal is worth reporting on
      // again — the folder can be trusted between turns.
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
 * `-32603 Internal error` names nothing a person can act on; this CLI puts the
 * actionable half in `data.details` — "Cannot enable privileged approval modes
 * in an untrusted folder", which says exactly what to do about it. Read
 * defensively, because it is one observed shape rather than a contract.
 */
function refusalDetail(error: unknown): string | undefined {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const details = (data as { details?: unknown }).details;
    if (typeof details === 'string' && details.trim()) {
      return details.trim();
    }
  }
  const message = (error as { message?: unknown } | null)?.message;
  // "Internal error" is the generic JSON-RPC text and says nothing; anything
  // else the agent chose to write is worth more than nothing.
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
    : new Error('Qwen dynamic configuration aborted.');
}
