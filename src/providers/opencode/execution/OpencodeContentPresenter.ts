import type { ChatTurnMetadata } from '@/core/runtime/types';
import type { SlashCommand, StreamChunk } from '@/core/types';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import type { AcpToolStreamAdapter } from '@/providers/acp/AcpToolStreamAdapter';
import { buildAcpUsageInfo } from '@/providers/acp/buildAcpUsageInfo';
import type {
  AcpPromptResponse,
  AcpSessionConfigOption,
  AcpSessionNotification,
  AcpUsage,
  AcpUsageUpdate,
} from '@/providers/acp/types';
import { createOpencodeToolStreamAdapter } from '@/providers/opencode/normalization/opencodeToolNormalization';

/**
 * What the ACP connection delivered, in the two shapes it delivers it.
 *
 * A session update is a notification; the tokens a prompt cost arrive only in
 * the answer to `session/prompt`, and the badge reads zero on every turn
 * without them. Both are the wire, neither is interpreted before it gets here.
 */
export type OpencodeContentPayload =
  | { readonly kind: 'session-update'; readonly notification: AcpSessionNotification }
  | { readonly kind: 'prompt-result'; readonly response: AcpPromptResponse };

export interface OpencodeContentPresenterPorts {
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
}

/**
 * The chunks a turn's session updates become, produced by the normalization the
 * surface already reads.
 *
 * `AcpSessionUpdateNormalizer` and the OpenCode tool stream adapter are the
 * pieces that know how an ACP tool call, its output, a plan and a usage report
 * are rendered — proven against real transcripts of every ACP provider. The
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
export class OpencodeContentPresenter {
  private readonly normalizer = new AcpSessionUpdateNormalizer();
  private readonly toolStream: AcpToolStreamAdapter = createOpencodeToolStreamAdapter();
  private sessionId: string | undefined;
  private metadata: ChatTurnMetadata = {};
  private contextUsage: AcpUsageUpdate | null = null;
  private promptUsage: AcpUsage | null = null;

  constructor(private readonly ports: OpencodeContentPresenterPorts) {}

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
   * all: OpenCode reuses a message id across a turn boundary, and a second
   * turn whose answer never opens is appended to the first one's.
   */
  beginTurn(): void {
    this.normalizer.reset();
    this.toolStream.reset();
    this.contextUsage = null;
    this.promptUsage = null;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const content = payload as Partial<OpencodeContentPayload> | null;
    if (content?.kind === 'prompt-result') {
      return this.presentPromptResult(content.response);
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
