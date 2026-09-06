import type { ChatTurnMetadata } from '@/core/runtime/types';
import type { SlashCommand, StreamChunk } from '@/core/types';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import type { AcpToolStreamAdapter } from '@/providers/acp/AcpToolStreamAdapter';
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
import { createMimocodeToolStreamAdapter } from '@/providers/mimocode/normalization/mimocodeToolNormalization';

/**
 * What the ACP connection delivered, shared with every managed-ACP provider.
 *
 * Re-exported under this provider's name because that is what its own modules
 * and tests call it; the union itself belongs beside the backend that emits it.
 */
export type MimocodeContentPayload = AcpContentPayload;

/** What a session answered with when it was created or loaded. */
export interface MimocodeSessionOpening {
  readonly sessionId: string;
  readonly configOptions?: readonly AcpSessionConfigOption[] | null;
  readonly models?: AcpSessionModelState | null;
  readonly modes?: AcpSessionModeState | null;
}

export interface MimocodeContentPresenterPorts {
  /** The model a usage badge is labelled with. */
  readonly displayModel: () => string | undefined;
  /** The commands the session offers, which arrive as an update, not an answer. */
  readonly onCommands?: (commands: readonly SlashCommand[]) => void;
  /** The model, mode and effort the open session can be set to. */
  readonly onConfigOptions?: (configOptions: readonly AcpSessionConfigOption[]) => void;
  /** What the vendor charged, for the plan-limit indicator. */
  readonly onCost?: (cost: AcpUsageUpdate['cost']) => void;
  /** The mode the session switched to, which the user may not have chosen. */
  readonly onCurrentMode?: (modeId: string) => void;
  /**
   * What the session answered with when it opened: the models, the modes and
   * the config options a tab's selectors are built from.
   *
   * Separate from `onCurrentMode` because the mode reported here is MiMoCode's
   * own default rather than a switch: pushing it at the toolbar would overwrite
   * the Safe/Plan/Auto the user picked, before the turn applies theirs.
   */
  readonly onSessionOpened?: (opening: MimocodeSessionOpening) => void;
  /**
   * What became of the saved session this turn tried to resume.
   *
   * Separate from `onSessionOpened`, which fires for every session however it
   * was obtained: this one only fires when there was a saved session to resume,
   * and it is the difference between a fresh conversation and one whose history
   * the agent has forgotten.
   */
  readonly onSessionResume?: (outcome: 'resumed' | 'replaced') => void;
}

/**
 * The chunks a turn's session updates become, produced by the normalization the
 * surface already reads.
 *
 * `AcpSessionUpdateNormalizer` and MiMoCode's own tool stream adapter are the
 * pieces that know how an ACP tool call, its output, a plan and a usage report
 * are rendered, and `MimocodeChatRuntime` drives exactly these two today. The
 * flip keeps them rather than writing a second opinion: the kernel carries the
 * update, this runs the same code the legacy runtime ran, and the surface
 * cannot tell which path produced the turn.
 *
 * Three things it owns that no chunk carries. The **session id**, because a
 * conversation that cannot learn its own ACP session can neither resume nor
 * fork. The **message ids** the finished turn is saved with. And the session's
 * own configuration — commands, config options, current mode — which arrive as
 * updates on the same channel and belong to the tab rather than the transcript.
 */
export class MimocodeContentPresenter {
  private readonly normalizer = new AcpSessionUpdateNormalizer();
  private readonly toolStream: AcpToolStreamAdapter = createMimocodeToolStreamAdapter();
  private sessionId: string | undefined;
  private metadata: ChatTurnMetadata = {};
  private refusal: AcpTurnRefusal | undefined;
  private contextUsage: AcpUsageUpdate | null = null;
  private promptUsage: AcpUsage | null = null;

  constructor(private readonly ports: MimocodeContentPresenterPorts) {}

  /**
   * The ACP session the connection is actually on.
   *
   * A new conversation learns its session from the turn that created it, and
   * the adapter reports the conversation's own binding into the kernel rather
   * than reading the backend's. Without this a tab starts a new session every
   * turn: no resume across a reload, and nothing to fork from.
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

  /**
   * Resets what only holds within one turn.
   *
   * The message ids the normalizer has already opened a message for, above
   * all. MiMoCode's legacy runtime resets both the normalizer and the tool
   * stream at the start of every turn, and again on the retry path; a turn that
   * kept them would append its answer to the previous turn's message.
   */
  beginTurn(): void {
    this.refusal = undefined;
    this.normalizer.reset();
    this.toolStream.reset();
    this.contextUsage = null;
    this.promptUsage = null;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const content = payload as Partial<MimocodeContentPayload> | null;
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
      case 'commands':
        this.ports.onCommands?.(normalized.commands);
        return [];
      case 'config_options':
        this.ports.onConfigOptions?.(normalized.configOptions);
        return [];
      case 'current_mode':
        this.ports.onCurrentMode?.(normalized.currentModeId);
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
        return normalized.streamChunks;
      case 'tool_call':
        return this.toolStream.normalizeToolCall(normalized.toolCall, normalized.streamChunks);
      case 'tool_call_update':
        return this.toolStream.normalizeToolCallUpdate(
          normalized.toolCallUpdate,
          normalized.streamChunks,
        );
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
   * MiMoCode reports its models, its modes and its config options in the reply
   * to `session/new` and `session/load`, and never again unless something is
   * set — the recorded session answers with all three at once and then sends
   * only `available_commands_update` and `usage_update`. A tab whose selectors
   * were fed only from later updates would start empty on a fresh vault and
   * stay empty until the user changed something.
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
   * The window update arrives while the turn is still running, so it knows how
   * full the context is and nothing about what this prompt cost. Re-emitting
   * the usage here is what puts the input and cache counts on the badge.
   */
  private presentPromptResult(response: AcpPromptResponse | undefined): readonly StreamChunk[] {
    if (!response) {
      return [];
    }
    const userMessageId = response.userMessageId?.trim();
    if (userMessageId) {
      this.metadata = { ...this.metadata, userMessageId };
    }
    this.promptUsage = response.usage ?? null;
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
