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
  AcpSessionUpdate,
  AcpUsage,
  AcpUsageUpdate,
} from '@/providers/acp/types';
import type { DevinToolCallRecord } from '@/providers/devin/execution/DevinPermissionPresentation';
import { mapDevinModeToGrimoire } from '@/providers/devin/modes';

/** What the ACP connection delivered, shared with every managed-ACP provider. */
export type DevinContentPayload = AcpContentPayload;

/** What a session answered with when it was created or loaded. */
export interface DevinSessionOpening {
  readonly sessionId: string;
  readonly configOptions?: readonly AcpSessionConfigOption[] | null;
  readonly models?: AcpSessionModelState | null;
  readonly modes?: AcpSessionModeState | null;
}

export interface DevinContentPresenterPorts {
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
   * Devin announces its own — `login`, `status`, `model`, and the vault's
   * skills as slash commands — and the tab lists what the open session said.
   */
  readonly onCommands?: (commands: readonly SlashCommand[]) => void;
  /** What the session answered with when it opened. */
  readonly onSessionOpened?: (opening: DevinSessionOpening) => void;
  /**
   * A tool call the session announced, kept for the permission request that
   * may follow it: the request names the call by id and nothing else.
   */
  readonly onToolCall?: (call: DevinToolCallRecord) => void;
}

/**
 * The chunks a Devin turn's session updates become.
 *
 * `AcpSessionUpdateNormalizer` knows how an ACP tool call, its output, a plan
 * and a usage report are rendered, and this forwards what it produced. What
 * the recording shows Devin sending beyond the shared vocabulary —
 * `session_info_update`, and `_cognition.ai/*` notifications outside
 * `session/update` — draws nothing, and is dropped by the normalizer and the
 * transport respectively.
 *
 * The context window comes on the wire: Devin's `usage_update` carries
 * `used` and `size`, so unlike Qwen there is no vendor method to ask.
 */
export class DevinContentPresenter {
  private readonly normalizer = new AcpSessionUpdateNormalizer();
  private sessionId: string | undefined;
  private metadata: ChatTurnMetadata = {};
  private refusal: AcpTurnRefusal | undefined;
  private contextUsage: AcpUsageUpdate | null = null;
  private promptUsage: AcpUsage | null = null;

  constructor(private readonly ports: DevinContentPresenterPorts) {}

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
  }

  present(payload: unknown): readonly StreamChunk[] {
    const content = payload as Partial<DevinContentPayload> | null;
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
    if (notification.update.sessionUpdate === 'tool_call') {
      this.ports.onToolCall?.(recordToolCall(notification.update));
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
      case 'usage':
        this.contextUsage = normalized.usage;
        this.ports.onCost?.(normalized.usage.cost ?? null);
        return this.usageChunks();
      default:
        return [];
    }
  }

  /**
   * What the session was opened with. Devin reports its models and modes as
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

  /** The answer to `session/prompt`, which is where the turn's own tokens are. */
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

/** What a person is told when the session would not take the mode they picked. */
function presentRefusedMode(modeId: string, detail?: string): StreamChunk {
  const asked = PERMISSION_LABELS[mapDevinModeToGrimoire(modeId)];
  return {
    type: 'notice',
    level: 'warning',
    content: detail
      ? `Devin did not switch to ${asked}: ${detail} This turn ran in the mode the session was `
        + 'already in.'
      : `Devin did not switch to ${asked}. This turn ran in the mode the session was already in.`,
  };
}

/** What a `tool_call` update said, in the shape the permission sentence reads. */
function recordToolCall(update: AcpSessionUpdate): DevinToolCallRecord {
  const call = update as AcpSessionUpdate & {
    toolCallId?: string;
    title?: string | null;
    kind?: string | null;
    rawInput?: unknown;
    locations?: Array<{ path: string }> | null;
    content?: Array<{ type?: string; path?: string }> | null;
    _meta?: Record<string, unknown> | null;
  };
  const diffPath = call.content?.find(entry => entry.type === 'diff' && typeof entry.path === 'string')?.path;
  return {
    toolCallId: call.toolCallId ?? '',
    title: call.title ?? null,
    kind: call.kind ?? null,
    rawInput: call.rawInput,
    locations: call.locations ?? null,
    diffPath: diffPath ?? null,
    meta: call._meta ?? null,
  };
}

/** The toolbar's own words for its three values. */
const PERMISSION_LABELS: Readonly<Record<'normal' | 'full_access' | 'plan', string>> = {
  normal: 'Safe',
  full_access: 'Auto-approve',
  plan: 'Plan',
};
