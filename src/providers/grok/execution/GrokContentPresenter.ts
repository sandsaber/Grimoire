import type { ChatTurnMetadata } from '@/core/runtime/types';
import type { SlashCommand, StreamChunk, UsageInfo } from '@/core/types';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import type { AcpToolStreamAdapter } from '@/providers/acp/AcpToolStreamAdapter';
import { buildAcpUsageInfo } from '@/providers/acp/buildAcpUsageInfo';
import type {
  AcpContentPayload,
  AcpTurnRefusal,
} from '@/providers/acp/execution/AcpContentPayload';
import type {
  AcpNewSessionResponse,
  AcpSessionConfigOption,
  AcpSessionModelState,
  AcpSessionModeState,
  AcpSessionNotification,
  AcpUsage,
  AcpUsageUpdate,
} from '@/providers/acp/types';
import { normalizeGrokSubagentFinishedUpdate } from '@/providers/grok/normalization/grokSubagentNormalization';
import { createGrokToolStreamAdapter } from '@/providers/grok/normalization/grokToolNormalization';
import type { ProviderCostValue } from '@/providers/shared/ProviderSpendUsageStore';

import { isRecord } from '../../../utils/records';

/**
 * A dollar, in the unit Grok bills in.
 *
 * Not inferred: `grok --help` says it outright — "`total_cost_usd_ticks` is the
 * same value in exact integer ticks (1 USD = 10^10 ticks)… summing per-invocation
 * ticks matches the server's usage export exactly, which float dollars cannot
 * guarantee." So the division happens once, here, and the integer is what
 * travels.
 */
const TICKS_PER_USD = 10_000_000_000;

/**
 * What the wire delivered, plus the one thing it never does.
 *
 * Grok sends no context-window update at all — its wire recording observes
 * seven update types and none of them is one — so the composition reads it out
 * of the session log and hands it back on this channel. Grok-local rather than
 * in the shared union, because the shared union is what an ACP connection
 * delivered.
 */
export type GrokContentPayload =
  | AcpContentPayload
  | { readonly kind: 'session-usage'; readonly usage: AcpUsageUpdate | null };

/** What a session opened with, in whichever shape the agent answered. */
export interface GrokSessionOpening {
  readonly sessionId: string;
  readonly configOptions?: readonly AcpSessionConfigOption[] | null;
  readonly models?: AcpSessionModelState | null;
  readonly modes?: AcpSessionModeState | null;
}

export interface GrokContentPresenterPorts {
  /** The model a usage badge is labelled with. */
  readonly displayModel: () => string | undefined;
  /** The commands the session offers, which arrive as an update, not an answer. */
  readonly onCommands?: (commands: readonly SlashCommand[]) => void;
  /**
   * What the session says it is set to now, when that changes mid-conversation.
   *
   * A `/mode` typed into the composer moves the session under the tab, and a
   * tab that never hears it keeps asking for the mode it believes the session
   * is in — translated against a current mode that is no longer current.
   */
  readonly onCurrentMode?: (currentModeId: string) => void;
  /**
   * What became of the saved session this dispatch tried to resume.
   *
   * `replaced` is the conversation's history ceasing to be the agent's memory,
   * which the surface says before the user types.
   */
  readonly onSessionResume?: (outcome: 'resumed' | 'replaced') => void;
  /** The options a session re-advertises, thinking levels among them. */
  readonly onConfigOptions?: (configOptions: readonly AcpSessionConfigOption[]) => void;
  /** What the vendor charged for one turn, for the plan-limit indicator. */
  readonly onCost?: (cost: ProviderCostValue) => void;
  /**
   * The model the session switched to, and the effort it is running at.
   *
   * Grok reports this itself, on its own channel: a `/model` typed into the
   * composer changes the session under the tab, and the toolbar is otherwise
   * the last thing to know.
   */
  readonly onModelChanged?: (change: {
    readonly modelId: string;
    readonly reasoningEffort?: string;
  }) => void;
  /** What the session answered with when it opened. */
  readonly onSessionOpened?: (opening: GrokSessionOpening) => void;
}

/**
 * The chunks a Grok turn becomes, and the three answers only Grok gives.
 *
 * The ACP half is the shared normalization every managed-ACP provider uses,
 * with Grok's own tool vocabulary over it. What is Grok's alone are the updates
 * it sends on `_x.ai/session_notification`, which the wire recording is the
 * evidence for:
 *
 * - **`response_completed`** carries the turn's tokens. Nothing else does: the
 *   answer to `session/prompt` is a stop reason and no usage at all;
 * - **`turn_completed`** carries the stop reason, the model calls and the cost,
 *   in integer ticks. The runtime this replaces reads a cost off Grok's session
 *   log instead — and for a turn like the recorded one there is no cost record
 *   there to read, only these ticks;
 * - **`model_changed`** is how a session says the model moved under the tab;
 * - **`subagent_finished`** is how a background subagent says it ended without
 *   anyone polling for it. The legacy runtime read this and the flip did not
 *   carry it, so a subagent that finished on its own kept rendering as running.
 */
export class GrokContentPresenter {
  private readonly normalizer = new AcpSessionUpdateNormalizer();
  private readonly toolStream: AcpToolStreamAdapter = createGrokToolStreamAdapter();
  private sessionId: string | undefined;
  private metadata: ChatTurnMetadata = {};
  private refusal: AcpTurnRefusal | undefined;
  private contextUsage: AcpUsageUpdate | null = null;
  private promptUsage: AcpUsage | null = null;

  constructor(private readonly ports: GrokContentPresenterPorts) {}

  /** The ACP session the connection is actually on. */
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
    this.toolStream.reset();
    this.contextUsage = null;
    this.promptUsage = null;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const content = payload as GrokContentPayload | null;
    if (content?.kind === 'session-config') {
      return this.presentSessionConfig(content.session);
    }
    if (content?.kind === 'session-resume') {
      this.ports.onSessionResume?.(content.outcome);
      return [];
    }
    if (content?.kind === 'turn-refused') {
      const message = content.message?.trim();
      this.refusal = message
        ? { message, ...(content.origin ? { origin: content.origin } : {}) }
        : undefined;
      return [];
    }
    if (content?.kind === 'session-usage') {
      // How full the context is, which Grok never says over the wire: the
      // composition reads it out of the session log while the answer is being
      // committed and hands it back here, in time for this turn's badge.
      this.contextUsage = content.usage ?? null;
      return this.usageChunks();
    }
    if (content?.kind === 'prompt-result') {
      // Grok's prompt answer is a stop reason and nothing else; its tokens
      // arrive as `response_completed` on the channel below.
      return [];
    }
    if (content?.kind !== 'session-update' || !content.notification) {
      return [];
    }
    return this.presentSessionUpdate(content.notification);
  }

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

  private presentSessionUpdate(notification: AcpSessionNotification): readonly StreamChunk[] {
    if (notification.sessionId) {
      this.sessionId = notification.sessionId;
    }
    const vendor = this.presentVendorUpdate(notification.update as unknown as Record<string, unknown>);
    if (vendor) {
      return vendor;
    }
    const normalized = this.normalizer.normalize(notification.update);
    switch (normalized.type) {
      case 'commands':
        this.ports.onCommands?.(normalized.commands);
        return [];
      case 'message_chunk': {
        if (normalized.messageId) {
          this.metadata = normalized.role === 'user'
            ? { ...this.metadata, userMessageId: normalized.messageId }
            : { ...this.metadata, assistantMessageId: normalized.messageId };
        }
        // The backend mirrors an assistant chunk's text as `output-delta`,
        // which is the copy core can read; letting both through prints every
        // sentence twice.
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
      case 'current_mode':
        this.ports.onCurrentMode?.(normalized.currentModeId);
        return [];
      case 'config_options':
        this.ports.onConfigOptions?.(normalized.configOptions);
        return [];
      case 'usage':
        this.contextUsage = normalized.usage;
        return this.usageChunks();
      default:
        return [];
    }
  }

  /**
   * The three updates ACP does not define, which Grok sends anyway.
   *
   * Answers `undefined` for anything else, so the shared normalization decides
   * what a standard update means — this is an addition to the vocabulary, not a
   * replacement for it.
   */
  private presentVendorUpdate(update: Record<string, unknown>): readonly StreamChunk[] | undefined {
    const subagentFinished = normalizeGrokSubagentFinishedUpdate(update);
    if (subagentFinished) {
      return [subagentFinished];
    }
    switch (update.sessionUpdate) {
      case 'response_completed':
        this.promptUsage = readResponseUsage(update.usage);
        return this.usageChunks();
      case 'turn_completed': {
        const usage = readTurnUsage(update.usage);
        if (usage.tokens) {
          this.promptUsage = usage.tokens;
        }
        if (usage.cost) {
          this.ports.onCost?.(usage.cost);
        }
        return this.usageChunks();
      }
      case 'model_changed': {
        const modelId = readString(update.model_id ?? update.modelId);
        const reasoningEffort = readString(update.reasoning_effort ?? update.reasoningEffort);
        if (modelId) {
          this.ports.onModelChanged?.({
            modelId,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          });
        }
        return [];
      }
      default:
        return undefined;
    }
  }

  private usageChunks(): readonly StreamChunk[] {
    const usage: UsageInfo | null = buildAcpUsageInfo({
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

/** `response_completed`, which names its fields the way the API does. */
function readResponseUsage(value: unknown): AcpUsage | null {
  if (!isRecord(value)) {
    return null;
  }
  const inputTokens = readNumber(value.input_tokens ?? value.inputTokens);
  const outputTokens = readNumber(value.output_tokens ?? value.outputTokens);
  if (inputTokens === null && outputTokens === null) {
    return null;
  }
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    cachedReadTokens: readNumber(value.cache_read_input_tokens ?? value.cachedReadTokens) ?? 0,
    cachedWriteTokens: readNumber(
      value.cache_creation_input_tokens ?? value.cacheCreationTokens,
    ) ?? 0,
    thoughtTokens: readNumber(value.reasoning_tokens ?? value.reasoningTokens) ?? 0,
  };
}

/** `turn_completed`, which names the same numbers the other way and adds the bill. */
function readTurnUsage(value: unknown): {
  readonly tokens: AcpUsage | null;
  readonly cost: ProviderCostValue | null;
} {
  if (!isRecord(value)) {
    return { tokens: null, cost: null };
  }
  const totalTokens = readNumber(value.totalTokens ?? value.total_tokens);
  const inputTokens = readNumber(value.inputTokens ?? value.input_tokens);
  const outputTokens = readNumber(value.outputTokens ?? value.output_tokens);
  const ticks = readNumber(value.costUsdTicks ?? value.cost_usd_ticks);
  return {
    tokens: inputTokens === null && outputTokens === null
      ? null
      : {
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
        cachedReadTokens: readNumber(value.cachedReadTokens ?? value.cached_read_tokens) ?? 0,
        cachedWriteTokens: readNumber(value.cacheCreationTokens ?? value.cache_creation_tokens) ?? 0,
        thoughtTokens: readNumber(value.reasoningTokens ?? value.reasoning_tokens) ?? 0,
      },
    // Zero is not a charge, and a fraction of a tick is not a number Grok
    // sends: the integer is exact and the division happens once.
    cost: ticks !== null && ticks > 0
      ? { amount: ticks / TICKS_PER_USD, currency: 'USD' }
      : null,
  };
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
