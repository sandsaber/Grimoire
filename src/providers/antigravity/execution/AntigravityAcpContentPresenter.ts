import type { ChatTurnMetadata } from '@/core/runtime/types';
import type { StreamChunk } from '@/core/types';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import { buildAcpUsageInfo } from '@/providers/acp/buildAcpUsageInfo';
import type { AcpContentPayload, AcpTurnRefusal } from '@/providers/acp/execution/AcpContentPayload';
import type { AcpNewSessionResponse, AcpUsage, AcpUsageUpdate } from '@/providers/acp/types';

import { normalizeAntigravityToolInput, normalizeAntigravityToolName } from '../normalization/antigravityToolNormalization';

/** Presentation state is owned by one tab, including its native session id. */
export class AntigravityAcpContentPresenter {
  private readonly normalizer = new AcpSessionUpdateNormalizer();
  private sessionId: string | null = null;
  private metadata: ChatTurnMetadata = {};
  private refusal: AcpTurnRefusal | undefined;
  private contextUsage: AcpUsageUpdate | null = null;
  private promptUsage: AcpUsage | null = null;

  constructor(private readonly ports: {
    readonly onSessionOpened: (session: AcpNewSessionResponse) => void;
    readonly onSessionResume: (outcome: 'resumed' | 'replaced') => void;
    readonly displayModel: () => string | undefined;
  }) {}

  lastSessionId(): string | null { return this.sessionId; }

  beginTurn(): void {
    this.normalizer.reset();
    this.metadata = {};
    this.refusal = undefined;
    this.contextUsage = null;
    this.promptUsage = null;
  }

  forgetConversation(): void {
    this.sessionId = null;
    this.beginTurn();
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const result = this.metadata;
    this.metadata = {};
    return result;
  }

  consumeTurnRefusal(): AcpTurnRefusal | undefined {
    const result = this.refusal;
    this.refusal = undefined;
    return result;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const content = payload as Partial<AcpContentPayload> | null;
    if (content?.kind === 'session-config' && content.session) {
      this.sessionId = content.session.sessionId;
      this.ports.onSessionOpened(content.session);
    } else if (content?.kind === 'session-resume' && content.outcome) {
      this.ports.onSessionResume(content.outcome);
    } else if (content?.kind === 'turn-refused') {
      this.refusal = content.message ? { message: content.message, origin: content.origin } : undefined;
    } else if (content?.kind === 'prompt-result' && content.response) {
      if (content.response.userMessageId) this.metadata.userMessageId = content.response.userMessageId;
      this.promptUsage = content.response.usage ?? null;
      return this.usageChunks();
    } else if (content?.kind === 'session-update' && content.notification) {
      this.sessionId = content.notification.sessionId;
      const normalized = this.normalizer.normalize(content.notification.update);
      if (normalized.type === 'message_chunk') {
        if (normalized.messageId) {
          if (normalized.role === 'assistant') this.metadata.assistantMessageId = normalized.messageId;
          else this.metadata.userMessageId = normalized.messageId;
        }
        return normalized.role === 'assistant'
          ? normalized.streamChunks.filter(chunk => chunk.type !== 'text')
          : normalized.streamChunks;
      }
      if (normalized.type === 'usage') {
        this.contextUsage = normalized.usage;
        return this.usageChunks();
      }
      if (normalized.type === 'plan' || normalized.type === 'tool_call' || normalized.type === 'tool_call_update') {
        return normalized.streamChunks.map(chunk => chunk.type === 'tool_use' ? {
          ...chunk,
          name: normalizeAntigravityToolName(chunk.name),
          input: normalizeAntigravityToolInput(chunk.name, chunk.input),
        } : chunk);
      }
    }
    return [];
  }

  private usageChunks(): readonly StreamChunk[] {
    const usage = buildAcpUsageInfo({
      contextWindow: this.contextUsage, promptUsage: this.promptUsage,
      ...(this.ports.displayModel() ? { model: this.ports.displayModel() } : {}),
    });
    return usage ? [{ type: 'usage', usage, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }] : [];
  }
}
