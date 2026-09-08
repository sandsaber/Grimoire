import type { Conversation } from '../types';

/**
 * Whether some conversation already holds this provider session.
 *
 * A conversation created from a live session is keyed by that session's id, so
 * its transcript can be found again. The store refuses a second write under an
 * id it already holds — but a conversation can hold a session without being
 * *named* by it: an id of its own in `id`, the session in `sessionId`. The
 * store cannot see that claim, because no record under that id exists.
 *
 * That is how one Codex chat came to be stored twice, ten messages and all,
 * one millisecond after its own turn ended: a save found the tab's binding
 * missing, took the runtime's live session for an id, and no refusal came.
 */
export function isSessionClaimed(
  conversations: readonly Conversation[],
  sessionId: string | undefined | null,
): boolean {
  if (!sessionId) return false;
  return conversations.some(conversation => conversation.sessionId === sessionId);
}
