import type { ProviderHistoryHydration } from '../../../core/providers/ProviderModule';
import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getGrokState, type GrokProviderState } from '../types';
import {
  loadGrokSessionMessages,
  normalizeImportedGrokUserMessage,
} from './GrokHistoryStore';

export class GrokConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    vaultPath: string | null,
  ): Promise<ProviderHistoryHydration> {
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      // Never bound to a session, so there is no provider history to be
      // missing: what the conversation shows is what its own metadata holds.
      this.hydratedKeys.delete(conversation.id);
      return { outcome: 'absent' };
    }

    conversation.messages = conversation.messages
      .map((message) => normalizeImportedGrokUserMessage(message))
      .filter((message): message is NonNullable<typeof message> => message !== null);

    const state = getGrokState(conversation.providerState);
    const hydrationKey = [
      sessionId,
      state.sessionDirPath ?? '',
      state.workspacePath ?? vaultPath ?? '',
    ].join('::');
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return { outcome: 'complete' };
    }

    const messages = await loadGrokSessionMessages(
      sessionId,
      state,
      vaultPath ?? state.workspacePath ?? null,
    );
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      // **The silence this outcome exists to replace.** The conversation names
      // a session and the native log has nothing under it: the session was
      // deleted, the managed home moved, or it was written by a CLI this
      // machine no longer has.
      return conversation.messages.length > 0
        ? { outcome: 'stale', reason: 'sessionNotFound' }
        : { outcome: 'absent' };
    }

    // A prompt that never reached Grok (Invalid params before session/prompt)
    // is saved only in Grimoire. Replacing a longer local transcript with the
    // native log would drop that question when the user reopens the chat.
    if (conversation.messages.length > messages.length) {
      this.hydratedKeys.set(conversation.id, hydrationKey);
      // What is on screen is Grimoire's own record, which has more in it than
      // the native log does — the turn the agent never saw.
      return { outcome: 'partial', reason: 'localTranscriptAhead' };
    }

    conversation.messages = messages;
    this.hydratedKeys.set(conversation.id, hydrationKey);
    return { outcome: 'complete' };
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Never mutate Grok native history.
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
    const state = getGrokState(conversation.providerState);
    const providerState: GrokProviderState = {
      ...(state.sessionDirPath ? { sessionDirPath: state.sessionDirPath } : {}),
      ...(state.workspacePath ? { workspacePath: state.workspacePath } : {}),
    };

    return Object.keys(providerState).length > 0
      ? providerState as Record<string, unknown>
      : undefined;
  }
}
