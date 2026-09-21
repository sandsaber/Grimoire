import type { ChatTurnMetadata } from '@/core/runtime/types';
import type { SlashCommand, StreamChunk } from '@/core/types';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import type { AcpContentPayload, AcpTurnRefusal } from '@/providers/acp/execution/AcpContentPayload';
import type { AcpNewSessionResponse, AcpSessionUpdate } from '@/providers/acp/types';
import { isRecord } from '@/utils/records';

export class PiContentPresenter {
  sessionId: string | undefined;
  sessionDropped = false;
  private readonly normalizer = new AcpSessionUpdateNormalizer();
  private metadata: ChatTurnMetadata = {};
  private refusal: AcpTurnRefusal | undefined;
  private readonly terminals = new Map<string, string>();

  constructor(private readonly onDiscovery: (session: Partial<AcpNewSessionResponse>) => void,
    private readonly onCommands: (commands: readonly SlashCommand[]) => void) {}

  beginTurn(): void { this.normalizer.reset(); this.terminals.clear(); this.refusal = undefined; this.metadata = {}; }

  forget(): void { this.sessionId = undefined; this.sessionDropped = false; this.beginTurn(); }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.metadata;
    this.metadata = {};
    return metadata;
  }

  consumeRefusal(): AcpTurnRefusal | undefined {
    const refusal = this.refusal;
    this.refusal = undefined;
    return refusal;
  }

  present(payload: unknown): readonly StreamChunk[] {
    const content = payload as AcpContentPayload | null;
    if (!content) return [];
    if (content.kind === 'session-config') {
      this.sessionId = content.session.sessionId;
      this.onDiscovery(content.session);
    } else if (content.kind === 'session-resume') {
      this.sessionDropped = content.outcome === 'replaced';
    } else if (content.kind === 'turn-refused') {
      this.refusal = { message: content.message, ...(content.origin ? { origin: content.origin } : {}) };
    } else if (content.kind === 'session-update') {
      this.sessionId = content.notification.sessionId;
      const normalized = this.normalizer.normalize(this.terminalUpdate(content.notification.update));
      switch (normalized.type) {
        case 'commands': this.onCommands(normalized.commands); break;
        case 'config_options': this.onDiscovery({ configOptions: normalized.configOptions }); break;
        case 'message_chunk':
          if (normalized.messageId) this.metadata = { ...this.metadata,
            ...(normalized.role === 'user' ? { userMessageId: normalized.messageId } : { assistantMessageId: normalized.messageId }) };
          // Assistant text is already delivered by the backend's output-delta.
          return normalized.role === 'assistant' ? normalized.streamChunks.filter(chunk => chunk.type !== 'text') : [];
        case 'tool_call':
        case 'tool_call_update':
        case 'plan': return normalized.streamChunks;
      }
    }
    // pi-acp 0.0.33 does not report context occupancy or usage; never invent it.
    return [];
  }

  private terminalUpdate(update: AcpSessionUpdate): AcpSessionUpdate {
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return update;
    // pi-acp owns its terminals and streams output through metadata, not terminal delegation.
    const terminal = update.content?.some(block => block.type === 'terminal');
    if (terminal) this.terminals.set(update.toolCallId, '');
    if (!this.terminals.has(update.toolCallId)) return update;
    const delta = update._meta?.terminal_output;
    const output = this.terminals.get(update.toolCallId)! +
      (isRecord(delta) && delta.terminal_id === update.toolCallId && typeof delta.data === 'string' ? delta.data : '');
    this.terminals.set(update.toolCallId, output);
    return { ...update,
      ...(terminal && update.title ? { title: 'bash', rawInput: { command: update.title } } : {}),
      content: [{ type: 'content', content: { type: 'text', text: output } }],
    };
  }
}
