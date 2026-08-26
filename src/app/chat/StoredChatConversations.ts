import type { SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { ConversationRepository } from '../../core/conversations/ConversationRepository';
import type { Conversation } from '../../core/types';
import type { ProviderId } from '../../core/types/provider';
import type {
  ChatConversationPort,
  ChatConversationRead,
} from '../../features/chat/application/ChatExecutionCoordinator';

/**
 * The conversation store, as a turn's persistence barrier needs it.
 *
 * The one place the execution path and the vault meet, and it is deliberately
 * thin: the record store already refuses a stale write and applies a change
 * inside its own slot, and `SessionStorage` already owns the projection between
 * what is stored and what a chat reads. What is left here is naming which of
 * those two a coordinator gets.
 *
 * **Reads report a record this build cannot read as its own state.** D5 makes
 * such a record read-only rather than absent, and answering "no conversation"
 * for it is the legacy reader's recorded defect: a turn dispatched over that
 * answer would write a fresh conversation on top of one this build simply
 * cannot parse.
 */
export interface StoredChatConversationsOptions {
  readonly repository: ConversationRepository;
  /** Owns the projection between a stored record and a chat's conversation. */
  readonly projection: Pick<SessionStorage, 'toConversation' | 'toSessionMetadata'>;
  /** The provider a stored conversation belongs to when it names none. */
  readonly defaultProviderId: ProviderId;
}

export class StoredChatConversations implements ChatConversationPort {
  constructor(private readonly options: StoredChatConversationsOptions) {}

  async read(conversationId: string): Promise<ChatConversationRead> {
    const record = await this.options.repository.read(conversationId);
    if (record.kind === 'absent') {
      return { kind: 'absent' };
    }
    if (record.kind === 'unreadable') {
      return { kind: 'unreadable', reason: record.reason, detail: record.detail };
    }
    return {
      kind: 'present',
      conversation: this.toConversation(record.metadata),
      revision: record.revision,
    };
  }

  async apply(
    conversationId: string,
    change: (current: Conversation) => Conversation,
  ): Promise<{ conversation: Conversation; revision: number }> {
    const applied = await this.options.repository.apply(conversationId, current => (
      this.options.projection.toSessionMetadata(change(this.toConversation(current)))
    ));
    return {
      conversation: this.toConversation(applied.metadata),
      revision: applied.revision,
    };
  }

  private toConversation(metadata: Parameters<SessionStorage['toConversation']>[0]): Conversation {
    return this.options.projection.toConversation(metadata, this.options.defaultProviderId);
  }
}
