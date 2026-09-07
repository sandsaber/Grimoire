import { isSessionClaimed } from '@/core/conversations/sessionClaims';
import type { Conversation } from '@/core/types';

function conversation(id: string, sessionId: string | null): Conversation {
  return {
    createdAt: 1,
    id,
    messages: [],
    providerId: 'codex',
    sessionId,
    title: id,
    updatedAt: 1,
  };
}

describe('isSessionClaimed', () => {
  it('sees a session a conversation holds without being named by it', () => {
    // The store refuses a second write under an id it already holds, and that
    // refusal is what keys-by-session relies on. It cannot see this case: the
    // conversation's own id is `conv-…` and the session is only a field, so
    // nothing collides and the same chat is written twice - which is what
    // happened to a ten-message Codex conversation on 2026-09-07.
    const conversations = [conversation('conv-1788731323296-rrrqlvy17', '01a078b1')];

    expect(isSessionClaimed(conversations, '01a078b1')).toBe(true);
  });

  it('sees a session a conversation is named by', () => {
    expect(isSessionClaimed([conversation('01a078b1', '01a078b1')], '01a078b1')).toBe(true);
  });

  it('leaves an unclaimed session to be keyed by', () => {
    expect(isSessionClaimed([conversation('conv-1', 'other')], '01a078b1')).toBe(false);
  });

  it('claims nothing for a conversation started without a session', () => {
    expect(isSessionClaimed([conversation('conv-1', null)], undefined)).toBe(false);
    expect(isSessionClaimed([conversation('conv-1', null)], null)).toBe(false);
  });
});
