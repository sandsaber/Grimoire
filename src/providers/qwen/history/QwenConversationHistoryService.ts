import type { ProviderHistoryHydration } from '../../../core/providers/ProviderModule';
import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';

export class QwenConversationHistoryService implements ProviderConversationHistoryService {
  /**
   * Nothing to load: this provider keeps no transcript Grimoire can read back.
   *
   * `absent` rather than `complete`, and the difference is what the surface can
   * say: the conversation shows the messages its own metadata holds, and there
   * was never a provider-side history to be missing.
   */
  async hydrateConversationHistory(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<ProviderHistoryHydration> {
    return { outcome: 'absent' };
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {}

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {};
  }

  buildPersistedProviderState(_conversation: Conversation): Record<string, unknown> | undefined {
    return undefined;
  }
}
