import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { ChatTurnMetadata } from '../../../core/runtime/types';
import type { StreamChunk } from '../../../core/types';
import { isContextWindowEvent, isSessionInitEvent, isStreamChunk } from '../sdk/typeGuards';
import {
  createTransformStreamState,
  createTransformUsageState,
  type TransformOptions,
  transformSDKMessage,
} from '../stream/transformClaudeMessage';

/** What the surface needs to know about the vault to size a context window. */
export interface ClaudeContentSettings {
  readonly intendedModel?: string;
  readonly customContextLimits?: Record<string, number>;
  readonly resolvedContextWindow?: number;
}

export interface ClaudeContentPresenterPorts {
  readonly settings: () => ClaudeContentSettings;
  /**
   * The SDK approves `EnterPlanMode` itself, so the tool is never offered for
   * approval and the only sign the turn switched into planning is the tool call
   * in the stream. Without this the toolbar keeps showing the mode the user
   * chose while the model is already planning.
   */
  readonly onPlanModeEntered?: () => void;
  /**
   * Every message, for whatever counts what a turn cost.
   *
   * The plan indicator is fed from the SDK's own `result` and rate-limit
   * messages and from nothing else, so a path that renders chunks and drops the
   * message leaves the indicator empty. Wave 2 found this class for Codex; the
   * Claude store had no caller at all.
   */
  readonly onUsageMessage?: (message: SDKMessage | Record<string, unknown>) => void;
}

/**
 * The chunks a turn's SDK messages become, produced by the normalization the
 * surface already reads.
 *
 * `transformSDKMessage` is the piece that knows how a Claude tool call, its
 * result, a subagent, a plan and a usage report are rendered — six hundred
 * lines of it, proven against real transcripts. The flip keeps it rather than
 * writing a second opinion: the kernel carries the message, this runs the same
 * code the legacy runtime ran, and the surface cannot tell which path produced
 * the turn.
 *
 * Two things it owns that no chunk carries. The **session id**, because a
 * conversation that cannot learn its own session can neither resume nor fork,
 * and the kernel reports the tab's answer to that question rather than the
 * backend's. And the **assistant message id**, because a fork asks the SDK to
 * rewind to it.
 */
export class ClaudeContentPresenter {
  private readonly streamState = createTransformStreamState();
  private readonly usageState = createTransformUsageState();
  private sessionId: string | undefined;
  private metadata: ChatTurnMetadata = {};
  private bufferedUsage: Extract<StreamChunk, { type: 'usage' }> | undefined;
  private sawStreamText = false;
  private sawStreamThinking = false;
  private failure: string | undefined;

  constructor(private readonly ports: ClaudeContentPresenterPorts) {}

  /**
   * The session the SDK is actually on.
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
  /**
   * The provider's own words for the last failure it reported.
   *
   * What `describeFailure` answers with, so a failing turn shows Claude's
   * message instead of the neutral sentence. Kept rather than consumed: the
   * terminal arrives after the chunk, and a turn that failed twice is still one
   * turn.
   */
  lastFailure(): string | undefined {
    return this.failure;
  }

  forgetConversation(): void {
    this.sessionId = undefined;
    this.metadata = {};
    this.bufferedUsage = undefined;
    this.beginTurn();
  }

  /** Resets what only holds within one turn. */
  beginTurn(): void {
    this.sawStreamText = false;
    this.sawStreamThinking = false;
    // Cleared here rather than when it is read: a turn that succeeds after one
    // that failed must not describe its own terminal with the last turn's
    // words, and `describeFailure` is asked once per terminal whether or not
    // anything failed.
    this.failure = undefined;
    this.streamState.clearAll();
    this.usageState.clear();
  }

  present(payload: unknown): readonly StreamChunk[] {
    const message = payload as SDKMessage | null;
    if (!message || typeof (message as { type?: unknown }).type !== 'string') {
      return [];
    }
    this.ports.onUsageMessage?.(message);
    if ('session_id' in message && typeof message.session_id === 'string' && message.session_id) {
      this.sessionId = message.session_id;
    }
    if (message.type === 'assistant' && typeof message.uuid === 'string' && message.uuid) {
      this.metadata = { ...this.metadata, assistantMessageId: message.uuid };
    }
    const chunks: StreamChunk[] = [];
    for (const event of transformSDKMessage(message, this.transformOptions())) {
      if (isSessionInitEvent(event)) {
        this.sessionId = event.sessionId;
        continue;
      }
      if (isContextWindowEvent(event)) {
        const usage = this.applyContextWindow(event.contextWindow);
        if (usage) {
          chunks.push(usage);
        }
        continue;
      }
      if (!isStreamChunk(event)) {
        continue;
      }
      if (event.type === 'tool_use' && event.name === ENTER_PLAN_MODE) {
        this.ports.onPlanModeEntered?.();
      }
      if (message.type === 'stream_event') {
        // The kernel mirrors these as `output-delta`, which is the copy core
        // can read. Letting both through prints every sentence twice — and the
        // flag is what tells the assistant message below that its own copy is
        // the second one.
        if (event.type === 'text') {
          this.sawStreamText = true;
          continue;
        }
        if (event.type === 'thinking') {
          this.sawStreamThinking = true;
          continue;
        }
      }
      if (message.type === 'assistant') {
        // The SDK reports the answer twice: as deltas while it runs, and whole
        // in the assistant message. Only the second one is dropped, and only
        // when the first arrived — a turn with no streaming still renders.
        if (event.type === 'text' && this.sawStreamText) {
          continue;
        }
        if (event.type === 'thinking' && this.sawStreamThinking) {
          continue;
        }
      }
      if (event.type === 'usage') {
        chunks.push(this.rememberUsage(event));
        continue;
      }
      if (event.type === 'error') {
        // **Two different errors wear this type, and only one of them is how
        // the turn ended.** A result-level error *is* the ending — the kernel
        // owns that fact and `describeFailure` reads these words back for it,
        // so letting the chunk through as well would put the failure on screen
        // twice. An error on an *assistant* message is a rate limit or a
        // billing warning on a turn that usually finishes anyway; it is
        // something the provider is saying, not an ending, and it is a notice.
        //
        // Dropping both is what the projection path did before this: `error` is
        // turn framing there and never reaches the column, so a rate limit
        // vanished with nothing shown.
        this.failure = event.content;
        if (message.type !== 'result') {
          chunks.push({ type: 'notice', level: 'warning', content: event.content });
        }
        continue;
      }
      chunks.push(event);
    }
    return chunks;
  }

  private transformOptions(): TransformOptions {
    const settings = this.ports.settings();
    return {
      ...(settings.intendedModel ? { intendedModel: settings.intendedModel } : {}),
      ...(settings.customContextLimits
        ? { customContextLimits: settings.customContextLimits }
        : {}),
      ...(settings.resolvedContextWindow
        ? { resolvedContextWindow: settings.resolvedContextWindow }
        : {}),
      streamState: this.streamState,
      usageState: this.usageState,
    };
  }

  private rememberUsage(
    chunk: Extract<StreamChunk, { type: 'usage' }>,
  ): Extract<StreamChunk, { type: 'usage' }> {
    const stamped: Extract<StreamChunk, { type: 'usage' }> = {
      ...chunk,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };
    this.bufferedUsage = stamped;
    return stamped;
  }

  /**
   * The context window, which arrives after the usage it belongs to.
   *
   * The SDK reports how much was used before it reports how much there is, so
   * the indicator would sit at an unknown fraction until the next turn without
   * re-emitting the usage this answers for.
   */
  private applyContextWindow(
    contextWindow: number,
  ): Extract<StreamChunk, { type: 'usage' }> | undefined {
    if (!this.bufferedUsage || contextWindow <= 0) {
      return undefined;
    }
    const usage = this.bufferedUsage.usage;
    const percentage = Math.min(
      100,
      Math.max(0, Math.round((usage.contextTokens / contextWindow) * 100)),
    );
    const next: Extract<StreamChunk, { type: 'usage' }> = {
      ...this.bufferedUsage,
      usage: {
        ...usage,
        contextWindow,
        contextWindowIsAuthoritative: true,
        percentage,
      },
    };
    this.bufferedUsage = next;
    return next;
  }
}

/** The tool the SDK approves itself, and the only sign a turn began planning. */
const ENTER_PLAN_MODE = 'EnterPlanMode';
