import type { ChatTurnMetadata } from '@/core/runtime/types';
import type { SlashCommand, StreamChunk } from '@/core/types';
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
import { REASONIX_TURN_USAGE_META_KEY } from '@/providers/reasonix/runtime/ReasonixSessionNotifications';

/** What the ACP connection delivered, shared with every managed-ACP provider. */
export type ReasonixContentPayload = AcpContentPayload;

/** What a session answered with when it was created or loaded. */
export interface ReasonixSessionOpening {
  readonly sessionId: string;
  readonly configOptions?: readonly AcpSessionConfigOption[] | null;
  readonly models?: AcpSessionModelState | null;
  readonly modes?: AcpSessionModeState | null;
}

export interface ReasonixContentPresenterPorts {
  /** The model a usage badge is labelled with. */
  readonly displayModel: () => string | undefined;
  /** What the vendor charged, for the plan-limit indicator. */
  readonly onCost?: (cost: AcpUsageUpdate['cost']) => void;
  /** The mode the session switched to, which the user may not have chosen. */
  readonly onCurrentMode?: (modeId: string) => void;
  /** What became of the saved session this dispatch tried to resume. */
  readonly onSessionResume?: (outcome: 'resumed' | 'replaced') => void;
  /** The model, mode and config options the open session can be set to. */
  readonly onConfigOptions?: (configOptions: readonly AcpSessionConfigOption[]) => void;
  /**
   * The commands the session offers, which arrive as an update, not an answer.
   *
   * Reasonix announces its own — `login`, `status`, `model`, and the vault's
   * skills as slash commands — and the tab lists what the open session said.
   */
  readonly onCommands?: (commands: readonly SlashCommand[]) => void;
  /** What the session answered with when it opened. */
  readonly onSessionOpened?: (opening: ReasonixSessionOpening) => void;
}

/**
 * The chunks a Reasonix turn's session updates become.
 *
 * `AcpSessionUpdateNormalizer` knows how an ACP tool call, its output, a plan
 * and a usage report are rendered, and this forwards what it produced. Reasonix
 * speaks the shared vocabulary and adds nothing to it: the probed turns sent
 * `agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
 * `tool_call_update`, `plan`, `available_commands_update`,
 * `config_option_update` and `current_mode_update`, all of which the normalizer
 * already knows.
 *
 * The tokens do not come on the standard channel. Reasonix sends no
 * `usage_update` at all; `ReasonixSessionNotifications` turns its own
 * `_reasonix.io/session/status_update` into one, with the turn's counts under
 * `_meta` and no context-window size, because the status states none. A turn
 * Reasonix could price carries its cost on the same update, already per-turn —
 * so unlike Devin's running credit total there is no difference to take.
 */
export class ReasonixContentPresenter {
  private readonly normalizer = new AcpSessionUpdateNormalizer();
  private sessionId: string | undefined;
  private metadata: ChatTurnMetadata = {};
  private refusal: AcpTurnRefusal | undefined;
  private contextUsage: AcpUsageUpdate | null = null;
  private promptUsage: AcpUsage | null = null;
  /** Whether this turn has already been charged; see `present`'s usage case. */
  private charged = false;

  constructor(private readonly ports: ReasonixContentPresenterPorts) {}

  /** The ACP session the connection is actually on. */
  lastSessionId(): string | undefined {
    return this.sessionId;
  }

  /** What the agent said when it refused the turn, read once. */
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

  /** Forgets everything that belonged to one conversation. */
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
    this.charged = false;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const content = payload as Partial<ReasonixContentPayload> | null;
    if (content?.kind === 'prompt-result') {
      return this.presentPromptResult(content.response);
    }
    if (content?.kind === 'session-config') {
      return this.presentSessionConfig(content.session);
    }
    if (content?.kind === 'session-resume') {
      this.ports.onSessionResume?.(content.outcome as 'resumed' | 'replaced');
      return [];
    }
    if (content?.kind === 'turn-refused') {
      const message = content.message?.trim();
      this.refusal = message
        ? { message, ...(content.origin ? { origin: content.origin } : {}) }
        : undefined;
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
        this.ports.onCommands?.(normalized.commands);
        return [];
      case 'message_chunk': {
        if (normalized.messageId) {
          this.metadata = normalized.role === 'user'
            ? { ...this.metadata, userMessageId: normalized.messageId }
            : { ...this.metadata, assistantMessageId: normalized.messageId };
        }
        // The backend mirrors an assistant chunk's text as `output-delta`;
        // letting both through prints every sentence twice.
        return normalized.role === 'assistant'
          ? normalized.streamChunks.filter(chunk => chunk.type !== 'text')
          : normalized.streamChunks;
      }
      case 'plan':
      case 'tool_call':
      case 'tool_call_update':
        return normalized.streamChunks;
      case 'usage': {
        // A window of zero is what the synthesised update says when the status
        // stated none; taking it as the window would print a full bar.
        if (normalized.usage.size > 0) {
          this.contextUsage = normalized.usage;
        }
        const turnUsage = readTurnUsage(notification);
        if (turnUsage) {
          this.promptUsage = turnUsage;
        }
        // **At most one charge per turn.** The parser already keeps the cost off
        // every status but the completion, which is enough for an ordinary turn
        // — but `goal` mode keeps advancing a prompt until it is done or
        // blocked, and a turn that completes more than once would be charged
        // more than once against a store that only adds. Tokens are exempt
        // because they replace rather than accumulate.
        const cost = normalized.usage.cost ?? null;
        if (cost && !this.charged) {
          this.charged = true;
          this.ports.onCost?.(cost);
        } else if (!cost) {
          this.ports.onCost?.(null);
        }
        return this.usageChunks();
      }
      default:
        return [];
    }
  }

  /**
   * What the session was opened with. Reasonix reports its models and modes as
   * `configOptions` in the reply to `session/new` and `session/load`, and
   * again as a `config_option_update` on every set.
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
   * The answer to `session/prompt`, which for Reasonix carries no tokens.
   *
   * The recorded reply is `{stopReason, transcriptPath}` and nothing else, so
   * this only takes a usage it was actually given. Assigning `?? null` the way
   * Devin's presenter does would clear, at end of turn, the counts the status
   * notification had just supplied.
   */
  private presentPromptResult(response: AcpPromptResponse | undefined): readonly StreamChunk[] {
    if (!response) {
      return [];
    }
    const userMessageId = response.userMessageId?.trim();
    if (userMessageId) {
      this.metadata = { ...this.metadata, userMessageId };
    }
    if (response.usage) {
      this.promptUsage = response.usage;
    }
    return this.usageChunks();
  }

  /** Turn totals are billing data; only an explicit context update is occupancy. */
  private usageChunks(): readonly StreamChunk[] {
    if (!this.contextUsage) return [];
    const model = this.ports.displayModel();
    const usage = buildAcpUsageInfo({
      contextWindow: this.contextUsage,
      ...(model ? { model } : {}),
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

/** The turn's own token counts, as the vendor notification carried them. */
function readTurnUsage(notification: AcpSessionNotification): AcpUsage | null {
  const meta = (notification.update as { _meta?: Record<string, unknown> })._meta;
  const usage = meta?.[REASONIX_TURN_USAGE_META_KEY];
  return usage && typeof usage === 'object' && !Array.isArray(usage)
    ? usage as AcpUsage
    : null;
}

/**
 * What a person is told when the session would not take the mode they picked.
 *
 * The id here is Grimoire's, not the agent's: one Grimoire mode is two calls to
 * Reasonix and `normal` is the session mode for both Safe and Auto-approve, so
 * naming the wire value would tell somebody who asked for Auto-approve that
 * Safe was refused.
 */
function presentRefusedMode(modeId: string, detail?: string): StreamChunk {
  const asked = PERMISSION_LABELS[modeId] ?? modeId;
  return {
    type: 'notice',
    level: 'warning',
    content: detail
      ? `Reasonix did not switch to ${asked}: ${detail} This turn ran in the mode the session was `
        + 'already in.'
      : `Reasonix did not switch to ${asked}. This turn ran in the mode the session was already in.`,
  };
}

/** The toolbar's own words for its three positions. */
const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  normal: 'Safe',
  full_access: 'Auto-approve',
  plan: 'Plan',
};
