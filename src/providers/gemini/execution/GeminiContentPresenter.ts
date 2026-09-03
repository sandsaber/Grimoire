import type { ChatTurnMetadata } from '@/core/runtime/types';
import type { StreamChunk } from '@/core/types';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import { buildAcpUsageInfo } from '@/providers/acp/buildAcpUsageInfo';
import type {
  AcpContentPayload,
  AcpTurnRefusal,
} from '@/providers/acp/execution/AcpContentPayload';
import type {
  AcpNewSessionResponse,
  AcpPromptResponse,
  AcpSessionConfigOption,
  AcpSessionModelState,
  AcpSessionModeState,
  AcpSessionNotification,
  AcpUsage,
  AcpUsageUpdate,
} from '@/providers/acp/types';
import { mapGeminiModeToGrimoire } from '@/providers/gemini/modes';

/**
 * What the ACP connection delivered, shared with every managed-ACP provider.
 *
 * Re-exported under this provider's name because that is what its own modules
 * and tests call it; the union itself belongs beside the backend that emits it.
 */
export type GeminiContentPayload = AcpContentPayload;

/** What a session answered with when it was created or loaded. */
export interface GeminiSessionOpening {
  readonly sessionId: string;
  readonly configOptions?: readonly AcpSessionConfigOption[] | null;
  readonly models?: AcpSessionModelState | null;
  readonly modes?: AcpSessionModeState | null;
}

export interface GeminiContentPresenterPorts {
  /** The model a usage badge is labelled with. */
  readonly displayModel: () => string | undefined;
  /** What the vendor charged, for the plan-limit indicator. */
  readonly onCost?: (cost: AcpUsageUpdate['cost']) => void;
  /** The mode the session switched to, which the user may not have chosen. */
  readonly onCurrentMode?: (modeId: string) => void;
  /**
   * What became of the saved session this dispatch tried to resume.
   *
   * `replaced` is the conversation's history ceasing to be the agent's memory,
   * which the surface says before the user types.
   */
  readonly onSessionResume?: (outcome: 'resumed' | 'replaced') => void;
  /** The model, mode and config options the open session can be set to. */
  readonly onConfigOptions?: (configOptions: readonly AcpSessionConfigOption[]) => void;
  /**
   * What the session answered with when it opened: the models and the modes a
   * tab's selectors are built from.
   *
   * Separate from `onCurrentMode` because the mode reported here is Gemini's own
   * default rather than a switch: pushing it at the toolbar would overwrite the
   * Safe/Plan/Auto the user picked, before the turn applies theirs.
   */
  readonly onSessionOpened?: (opening: GeminiSessionOpening) => void;
}

/**
 * The chunks a Gemini turn's session updates become.
 *
 * `AcpSessionUpdateNormalizer` is the piece that knows how an ACP tool call, its
 * output, a plan and a usage report are rendered, and the runtime this
 * replaces drove exactly it. The flip kept it rather than writing a second
 * opinion.
 *
 * **No tool stream adapter, and that is this provider's own difference.** Every
 * OpenCode-family runtime and Grok's normalize a tool call through one; Gemini
 * has no `normalization/` directory at all and forwards what the normalizer
 * produced. Adding one here would be a change to what a Gemini tool card looks
 * like, smuggled in as a migration.
 */
export class GeminiContentPresenter {
  private readonly normalizer = new AcpSessionUpdateNormalizer();
  private sessionId: string | undefined;
  private metadata: ChatTurnMetadata = {};
  private refusal: AcpTurnRefusal | undefined;
  private contextUsage: AcpUsageUpdate | null = null;
  private promptUsage: AcpUsage | null = null;

  constructor(private readonly ports: GeminiContentPresenterPorts) {}

  /**
   * The ACP session the connection is actually on.
   *
   * A new conversation learns its session from the turn that created it, and
   * the adapter reports the conversation's own binding into the kernel rather
   * than reading the backend's. Without this a tab starts a new session every
   * turn: no resume across a reload.
   */
  lastSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * What the agent said when it refused the turn.
   *
   * Read once, by the composition's `describeFailure`, so the tab renders one
   * error for one failure — the vendor's own words where there are any, and the
   * kernel's generic sentence where there are not. Every legacy ACP runtime
   * yielded this text and the flip lost it; this is where it comes back.
   *
   * Covers a refused *session* as well as a refused prompt: an agent nobody
   * has authenticated says so here, where the classification alone could only
   * guess that a saved session had gone missing. Which of the two it was rides
   * along, because a refused load is the one whose words are not the whole
   * answer — see `AcpTurnRefusalOrigin`.
   */
  consumeTurnRefusal(): AcpTurnRefusal | undefined {
    const message = this.refusal;
    this.refusal = undefined;
    return message;
  }

  /** What the finished turn was, in the provider's own terms. */
  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.metadata;
    this.metadata = {};
    return metadata;
  }

  /**
   * Forgets everything that belonged to one conversation.
   *
   * The session above all: a tab that starts a new chat must not report the
   * previous conversation's session as its own, or the new conversation is
   * saved pointing at the old session and silently continues it.
   */
  forgetConversation(): void {
    this.sessionId = undefined;
    this.metadata = {};
    this.beginTurn();
  }

  /** Resets what only holds within one turn. */
  beginTurn(): void {
    this.refusal = undefined;
    this.normalizer.reset();
    this.contextUsage = null;
    this.promptUsage = null;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const content = payload as Partial<GeminiContentPayload> | null;
    if (content?.kind === 'prompt-result') {
      return this.presentPromptResult(content.response);
    }
    if (content?.kind === 'session-config') {
      return this.presentSessionConfig(content.session);
    }
    if (content?.kind === 'turn-refused') {
      const message = content.message?.trim();
      this.refusal = message
        ? { message, ...(content.origin ? { origin: content.origin } : {}) }
        : undefined;
      return [];
    }
    if (content?.kind === 'session-resume') {
      this.ports.onSessionResume?.(content.outcome as 'resumed' | 'replaced');
      return [];
    }
    if (content?.kind === 'mode-refused' && content.modeId) {
      return [presentRefusedMode(content.modeId, content.detail)];
    }
    if (content?.kind !== 'session-update' || !content.notification) {
      return [];
    }
    return this.presentSessionUpdate(content.notification);
  }

  private presentSessionUpdate(notification: AcpSessionNotification): readonly StreamChunk[] {
    if (notification.sessionId) {
      this.sessionId = notification.sessionId;
    }
    const normalized = this.normalizer.normalize(notification.update);
    switch (normalized.type) {
      case 'current_mode':
        this.ports.onCurrentMode?.(normalized.currentModeId);
        return [];
      case 'config_options':
        this.ports.onConfigOptions?.(normalized.configOptions);
        return [];
      case 'commands':
        // Announced by the session — the recording shows
        // `available_commands_update` arriving — and dropped, because
        // `capabilities.ts` declares `supportsProviderCommands: false` for this
        // provider and no surface asks for them. Named rather than left to the
        // default branch, so the absence reads as a decision.
        return [];
      case 'message_chunk': {
        if (normalized.messageId) {
          this.metadata = normalized.role === 'user'
            ? { ...this.metadata, userMessageId: normalized.messageId }
            : { ...this.metadata, assistantMessageId: normalized.messageId };
        }
        // The backend mirrors an assistant chunk's text as `output-delta`,
        // which is the copy core can read; letting both through prints every
        // sentence twice. Only the text is dropped — the message it opens is
        // what the surface hangs the answer on, and a thought is carried by
        // nothing else.
        return normalized.role === 'assistant'
          ? normalized.streamChunks.filter(chunk => chunk.type !== 'text')
          : normalized.streamChunks;
      }
      case 'plan':
      case 'tool_call':
      case 'tool_call_update':
        return normalized.streamChunks;
      case 'usage':
        this.contextUsage = normalized.usage;
        this.ports.onCost?.(normalized.usage.cost ?? null);
        return this.usageChunks();
      default:
        return [];
    }
  }

  /**
   * What the session was opened with, which is the only answer there is.
   *
   * Gemini reports its models and its modes in the reply to `session/new` and
   * `session/load`, and never again unless something is set — the recorded
   * session answers with both at once and no config options at all. A tab whose
   * selectors were fed only from later updates would start empty on a fresh
   * vault and stay empty until the user changed something.
   */
  private presentSessionConfig(
    session: AcpNewSessionResponse | undefined,
  ): readonly StreamChunk[] {
    if (!session?.sessionId) {
      return [];
    }
    this.sessionId = session.sessionId;
    this.ports.onSessionOpened?.({
      sessionId: session.sessionId,
      ...(session.configOptions ? { configOptions: session.configOptions } : {}),
      ...(session.models ? { models: session.models } : {}),
      ...(session.modes ? { modes: session.modes } : {}),
    });
    return [];
  }

  /**
   * The answer to `session/prompt`, which is where the turn's own tokens are.
   *
   * And for this CLI it is the *only* place they are: it sends no
   * `usage_update` in a turn and no `usage` on the result, so the two fields
   * ACP defines are both empty and the numbers sit under `_meta.quota`
   * instead.
   */
  private presentPromptResult(response: AcpPromptResponse | undefined): readonly StreamChunk[] {
    if (!response) {
      return [];
    }
    const userMessageId = response.userMessageId?.trim();
    if (userMessageId) {
      this.metadata = { ...this.metadata, userMessageId };
    }
    this.promptUsage = response.usage ?? geminiQuotaUsage(response) ?? null;
    return this.usageChunks();
  }

  private usageChunks(): readonly StreamChunk[] {
    const usage = buildAcpUsageInfo({
      contextWindow: this.contextUsage,
      ...(this.ports.displayModel() ? { model: this.ports.displayModel() } : {}),
      promptUsage: this.promptUsage,
    });
    if (!usage) {
      return [];
    }
    return [{
      type: 'usage',
      usage,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    }];
  }
}

/**
 * What a person is told when the session would not take the mode they picked.
 *
 * On the turn it happened to, because that is the turn that ran under the wrong
 * one. Named in Grimoire's vocabulary rather than the agent's — the toolbar says
 * Auto-approve and the user never typed `yolo` — with the agent's own reason
 * behind it, which is the half that says what to do about it.
 */
function presentRefusedMode(modeId: string, detail?: string): StreamChunk {
  const asked = PERMISSION_LABELS[mapGeminiModeToGrimoire(modeId)];
  return {
    type: 'notice',
    level: 'warning',
    content: detail
      ? `Gemini did not switch to ${asked}: ${detail} This turn ran in the mode the session was `
        + 'already in.'
      : `Gemini did not switch to ${asked}. This turn ran in the mode the session was already in.`,
  };
}

/** The toolbar's own words for its three values. */
const PERMISSION_LABELS: Readonly<Record<'normal' | 'full_access' | 'plan', string>> = {
  normal: 'Safe',
  full_access: 'Auto-approve',
  plan: 'Plan',
};


/**
 * The tokens a turn cost, read out of this CLI's own `_meta`.
 *
 * Taken from `gemini-wire.json` field for field — `_meta.quota.token_count`
 * with `input_tokens` and `output_tokens`, and a `model_usage` array beside it
 * saying the same per model. Snake case, because it is the vendor's payload
 * rather than the protocol's, and no total: the agent reports the two halves
 * and leaves the addition to whoever needs it.
 *
 * Absent on an older CLI, an error result, or a turn that produced nothing, and
 * every one of those answers `null` — a badge without a number, never a wrong
 * one.
 */
function geminiQuotaUsage(response: AcpPromptResponse): AcpUsage | null {
  const quota = (response._meta as { quota?: unknown } | null | undefined)?.quota;
  const counts = (quota as { token_count?: unknown } | null | undefined)?.token_count as
    { input_tokens?: unknown; output_tokens?: unknown } | null | undefined;
  const inputTokens = typeof counts?.input_tokens === 'number' ? counts.input_tokens : null;
  const outputTokens = typeof counts?.output_tokens === 'number' ? counts.output_tokens : null;
  if (inputTokens === null && outputTokens === null) {
    return null;
  }
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
  };
}
