import type { ProviderHistoryHydration } from '../../../core/providers/ProviderModule';
import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getKimicodeState, type KimicodeProviderState } from '../types';
import { loadKimicodeSessionMessages } from './KimicodeHistoryStore';

export class KimicodeConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<ProviderHistoryHydration> {
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      // Never bound to a session, so there is no provider history to be
      // missing: what the conversation shows is what its own metadata holds.
      this.hydratedKeys.delete(conversation.id);
      return { outcome: 'absent' };
    }

    const state = getKimicodeState(conversation.providerState);
    const hydrationKey = `${sessionId}::${state.databasePath ?? ''}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return { outcome: 'complete' };
    }

    const messages = await loadKimicodeSessionMessages(sessionId, state);
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      // **The silence this outcome exists to replace.** The conversation names
      // a session and the store has nothing under it: the session was deleted,
      // the database moved, or it was written by a CLI this machine no longer
      // has. Until now that was indistinguishable from an empty conversation.
      return conversation.messages.length > 0
        ? { outcome: 'stale', reason: 'sessionNotFound' }
        : { outcome: 'absent' };
    }

    conversation.messages = messages;
    this.hydratedKeys.set(conversation.id, hydrationKey);
    return { outcome: 'complete' };
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Never mutate Kimi Code native history.
  }

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

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const state = getKimicodeState(conversation.providerState);
    const providerState: KimicodeProviderState = {
      ...(state.databasePath ? { databasePath: state.databasePath } : {}),
    };

    return Object.keys(providerState).length > 0
      ? providerState as Record<string, unknown>
      : undefined;
  }
}
