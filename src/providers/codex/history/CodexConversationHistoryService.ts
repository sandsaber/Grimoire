import * as fs from 'fs';

import type { ProviderHistoryHydration } from '../../../core/providers/ProviderModule';
import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { ChatMessage, Conversation } from '../../../core/types';
import type { CodexProviderState } from '../types';
import { getCodexState } from '../types';
import {
  type CodexParsedTurn,
  deriveCodexSessionsRootFromSessionPath,
  findCodexSessionFile,
  parseCodexSessionFile,
  parseCodexSessionTurns,
} from './CodexHistoryStore';

function readSessionTurns(sessionFilePath: string): CodexParsedTurn[] {
  let content: string;
  try {
    content = fs.readFileSync(sessionFilePath, 'utf-8');
  } catch {
    return [];
  }
  return parseCodexSessionTurns(content);
}

function getComparableMessageContent(message: ChatMessage): string {
  return (message.displayContent ?? message.content).trim();
}

function messagesMatch(first: ChatMessage, second: ChatMessage): boolean {
  return first.role === second.role
    && getComparableMessageContent(first) === getComparableMessageContent(second);
}

/**
 * A new Codex thread can persist only the replayed suffix used to resume a
 * Grimoire conversation. Retain the vault's complete stored prefix and append
 * only provider messages that were not yet persisted.
 */
function mergeStoredAndHydratedMessages(
  stored: ChatMessage[],
  hydrated: ChatMessage[],
): ChatMessage[] {
  if (stored.length === 0) return hydrated;

  const maxOverlap = Math.min(stored.length, hydrated.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const storedSuffix = stored.slice(-overlap);
    const hydratedPrefix = hydrated.slice(0, overlap);
    if (storedSuffix.every((message, index) => messagesMatch(message, hydratedPrefix[index]))) {
      return [...stored, ...hydrated.slice(overlap)];
    }
  }

  return hydrated;
}

export class CodexConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedConversationPaths = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<ProviderHistoryHydration> {
    const state = getCodexState(conversation.providerState);
    const transcriptRootPath = state.transcriptRootPath
      ?? deriveCodexSessionsRootFromSessionPath(state.sessionFilePath);

    // Pending fork with existing in-memory messages: keep them as-is
    if (this.isPendingForkConversation(conversation) && conversation.messages.length > 0) {
      return { outcome: 'complete' };
    }

    // Pending fork without messages: hydrate from source transcript truncated at resumeAt
    if (this.isPendingForkConversation(conversation)) {
      const sourceSessionFile = this.resolveSourceSessionFile(state);
      if (!sourceSessionFile) {
        // The transcript this fork was taken from is not on this machine.
        return { outcome: 'stale', reason: 'forkSourceNotFound' };
      }

      const turns = readSessionTurns(sourceSessionFile);
      const resumeAt = state.forkSource!.resumeAt;
      const truncated = this.truncateTurnsAtCheckpoint(turns, resumeAt);
      if (!truncated) {
        this.hydratedConversationPaths.delete(conversation.id);
        // The checkpoint this fork was taken at is no longer in the transcript.
        return { outcome: 'stale', reason: 'forkCheckpointNotFound' };
      }
      conversation.messages = truncated.flatMap(t => t.messages);
      return { outcome: 'complete' };
    }

    // Established fork: source prefix + fork-only turns
    if (state.forkSource && state.threadId) {
      const sourceSessionFile = this.resolveSourceSessionFile(state);
      const forkSessionFile = state.sessionFilePath ?? (
        state.threadId
          ? findCodexSessionFile(state.threadId, transcriptRootPath ?? undefined)
          : null
      );

      if (sourceSessionFile && forkSessionFile) {
        const sourceTurns = readSessionTurns(sourceSessionFile);
        const forkTurns = readSessionTurns(forkSessionFile);

        const resumeAt = state.forkSource.resumeAt;
        const sourcePrefix = this.truncateTurnsAtCheckpoint(sourceTurns, resumeAt);
        if (!sourcePrefix) {
          this.hydratedConversationPaths.delete(conversation.id);
          return { outcome: 'stale', reason: 'forkCheckpointNotFound' };
        }
        const sourceTurnIds = new Set(sourceTurns.map(t => t.turnId).filter(Boolean));
        const forkOnlyTurns = forkTurns.filter(t => !t.turnId || !sourceTurnIds.has(t.turnId));

        const messages = [
          ...sourcePrefix.flatMap(t => t.messages),
          ...forkOnlyTurns.flatMap(t => t.messages),
        ];

        if (messages.length === 0) {
          this.hydratedConversationPaths.delete(conversation.id);
          return conversation.messages.length > 0
            ? { outcome: 'stale', reason: 'sessionNotFound' }
            : { outcome: 'absent' };
        }

        conversation.messages = messages;
        this.hydratedConversationPaths.set(conversation.id, `fork::${state.threadId}`);
        return { outcome: 'complete' };
      }
    }

    // Normal hydration
    const threadId = state.threadId ?? conversation.sessionId ?? null;
    const sessionFilePath = state.sessionFilePath ?? (
      threadId
        ? findCodexSessionFile(threadId, transcriptRootPath ?? undefined)
        : null
    );
    const resolvedTranscriptRootPath = transcriptRootPath
      ?? deriveCodexSessionsRootFromSessionPath(sessionFilePath);

    if (!sessionFilePath) {
      this.hydratedConversationPaths.delete(conversation.id);
      // A conversation that names a thread with no transcript beside it: the
      // session was deleted, or it belongs to a machine this vault syncs from.
      return conversation.messages.length > 0 && threadId
        ? { outcome: 'stale', reason: 'sessionNotFound' }
        : { outcome: 'absent' };
    }

    const hydrationKey = `${threadId ?? ''}::${sessionFilePath}`;
    if (
      conversation.messages.length > 0
      && this.hydratedConversationPaths.get(conversation.id) === hydrationKey
    ) {
      return { outcome: 'complete' };
    }

    if (sessionFilePath !== state.sessionFilePath) {
      conversation.providerState = {
        ...(conversation.providerState ?? {}),
        ...(threadId ? { threadId } : {}),
        sessionFilePath,
        ...(resolvedTranscriptRootPath ? { transcriptRootPath: resolvedTranscriptRootPath } : {}),
      };
    } else if (resolvedTranscriptRootPath && resolvedTranscriptRootPath !== state.transcriptRootPath) {
      conversation.providerState = {
        ...(conversation.providerState ?? {}),
        ...(threadId ? { threadId } : {}),
        transcriptRootPath: resolvedTranscriptRootPath,
      };
    }

    const sdkMessages = parseCodexSessionFile(sessionFilePath);
    if (sdkMessages.length === 0) {
      this.hydratedConversationPaths.delete(conversation.id);
      // **The silence this outcome exists to replace.** The transcript file is
      // there and holds nothing this build can read back as a turn.
      return conversation.messages.length > 0
        ? { outcome: 'stale', reason: 'transcriptEmpty' }
        : { outcome: 'absent' };
    }

    conversation.messages = mergeStoredAndHydratedMessages(conversation.messages, sdkMessages);
    this.hydratedConversationPaths.set(conversation.id, hydrationKey);
    return { outcome: 'complete' };
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Never delete ~/.codex transcripts
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) return null;
    const state = getCodexState(conversation.providerState);
    return state.threadId ?? conversation.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  isPendingForkConversation(conversation: Conversation): boolean {
    const state = getCodexState(conversation.providerState);
    return !!state.forkSource && !state.threadId && !conversation.sessionId;
  }

  buildForkProviderState(
    sourceSessionId: string,
    resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    const sourceState = getCodexState(sourceProviderState);
    const sourceTranscriptRootPath = sourceState.transcriptRootPath
      ?? deriveCodexSessionsRootFromSessionPath(sourceState.sessionFilePath);
    const providerState: CodexProviderState = {
      forkSource: { sessionId: sourceSessionId, resumeAt },
      ...(sourceState.sessionFilePath ? { forkSourceSessionFilePath: sourceState.sessionFilePath } : {}),
      ...(
        sourceTranscriptRootPath
          ? { forkSourceTranscriptRootPath: sourceTranscriptRootPath }
          : {}
      ),
    };
    return providerState as Record<string, unknown>;
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const entries = Object.entries(getCodexState(conversation.providerState))
      .filter(([, value]) => value !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveSourceSessionFile(state: CodexProviderState): string | null {
    if (!state.forkSource) return null;
    const sourceTranscriptRootPath = state.forkSourceTranscriptRootPath
      ?? deriveCodexSessionsRootFromSessionPath(state.forkSourceSessionFilePath);
    return state.forkSourceSessionFilePath
      ?? findCodexSessionFile(state.forkSource.sessionId, sourceTranscriptRootPath ?? undefined);
  }

  private truncateTurnsAtCheckpoint(
    turns: CodexParsedTurn[],
    resumeAt: string,
  ): CodexParsedTurn[] | null {
    const checkpointIndex = turns.findIndex(turn => turn.turnId === resumeAt);
    if (checkpointIndex < 0) {
      return null;
    }

    return turns.slice(0, checkpointIndex + 1);
  }
}
