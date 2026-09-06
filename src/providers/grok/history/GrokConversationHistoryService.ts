import { carryOverImageAttachments } from '../../../core/attachments/carryOverImages';
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
  ): Promise<void> {
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
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
      return;
    }

    const messages = await loadGrokSessionMessages(
      sessionId,
      state,
      vaultPath ?? state.workspacePath ?? null,
    );
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    // A prompt that never reached Grok (Invalid params before session/prompt)
    // is saved only in Grimoire. Replacing a longer local transcript with the
    // native log would drop that question when the user reopens the chat.
    if (conversation.messages.length > messages.length) {
      this.hydratedKeys.set(conversation.id, hydrationKey);
      return;
    }

    conversation.messages = carryOverImageAttachments(conversation.messages, messages);
    this.hydratedKeys.set(conversation.id, hydrationKey);
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
