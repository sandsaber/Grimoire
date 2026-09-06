import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { StoredChatConversations } from '@/app/chat/StoredChatConversations';
import type { SessionStorage } from '@/core/bootstrap/SessionStorage';
import { SESSIONS_PATH } from '@/core/bootstrap/StoragePaths';
import { ConversationRepository } from '@/core/conversations/ConversationRepository';
import type { SessionMetadata } from '@/core/types';

/**
 * Where the execution path and the vault meet.
 *
 * Composed against the real record store rather than a fake of it, because the
 * two properties that matter are the store's: a change applied inside its own
 * slot cannot lose a message appended beside it, and a record this build cannot
 * read has a state of its own rather than being reported as absent.
 */

const CONVERSATION_ID = 'conv-1';

function projection(): Pick<SessionStorage, 'toConversation' | 'toSessionMetadata'> {
  // The real projection's two rules, which is all this port asks of it: a
  // provider for a record that names none, and a session binding that falls
  // back to the conversation's own id.
  return {
    toConversation: (metadata, defaultProviderId) => ({
      id: metadata.id,
      providerId: metadata.providerId ?? defaultProviderId,
      title: metadata.title,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      sessionId: metadata.sessionId !== undefined ? metadata.sessionId : metadata.id,
      messages: metadata.messages ? [...metadata.messages] : [],
      usage: metadata.usage,
    }),
    toSessionMetadata: conversation => ({
      id: conversation.id,
      providerId: conversation.providerId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      sessionId: conversation.sessionId,
      messages: [...conversation.messages],
      usage: conversation.usage,
    }),
  };
}

function createPort(storage = new TestDurableStorage()) {
  const repository = new ConversationRepository({ storage, now: () => 1_000 });
  return {
    storage,
    repository,
    port: new StoredChatConversations({
      repository,
      projection: projection(),
      defaultProviderId: 'claude',
    }),
  };
}

const metadata: SessionMetadata = {
  id: CONVERSATION_ID,
  title: 'Tomatoes',
  createdAt: 1,
  updatedAt: 2,
  messages: [],
};

describe('stored chat conversations', () => {
  it('reads a conversation the vault holds, at its revision', async () => {
    const { port, repository } = createPort();
    await repository.save(metadata, null);

    await expect(port.read(CONVERSATION_ID)).resolves.toEqual({
      kind: 'present',
      revision: 1,
      conversation: expect.objectContaining({
        id: CONVERSATION_ID,
        // The record names no provider, so the caller's is used; and no
        // binding, so it resumes under its own id.
        providerId: 'claude',
        sessionId: CONVERSATION_ID,
      }),
    });
  });

  it('says a conversation is absent, and says separately that it cannot be read', async () => {
    const { port, storage, repository } = createPort();

    await expect(port.read(CONVERSATION_ID)).resolves.toEqual({ kind: 'absent' });

    await repository.save(metadata, null);
    const written = storage.get(`${SESSIONS_PATH}/${CONVERSATION_ID}.meta.json`) ?? '';
    storage.seed(
      `${SESSIONS_PATH}/${CONVERSATION_ID}.meta.json`,
      written.replace('"schemaVersion":1', '"schemaVersion":99'),
    );

    // D5's read-only state. Reported as "no conversation" it becomes a turn
    // dispatched over a record this build cannot parse, writing a fresh
    // conversation on top of it.
    await expect(port.read(CONVERSATION_ID)).resolves.toEqual({
      kind: 'unreadable',
      reason: 'future',
      detail: expect.stringContaining('newer release'),
    });
  });

  it('applies two changes that never saw each other', async () => {
    const { port, repository } = createPort();
    await repository.save(metadata, null);

    await Promise.all([
      port.apply(CONVERSATION_ID, current => ({
        ...current,
        messages: [...current.messages, message('msg-1', 'First')],
      })),
      port.apply(CONVERSATION_ID, current => ({
        ...current,
        messages: [...current.messages, message('msg-2', 'Second')],
      })),
    ]);

    // The property the barrier depends on: a title generated in the background
    // and an answer appended here compose, rather than the later one reverting
    // the earlier.
    const read = await port.read(CONVERSATION_ID);
    expect(read.kind === 'present' ? read.conversation.messages.map(item => item.id) : [])
      .toEqual(['msg-1', 'msg-2']);
  });

  it('answers with what it wrote, at the revision it wrote', async () => {
    const { port, repository, storage } = createPort();
    await repository.save(metadata, null);

    const applied = await port.apply(CONVERSATION_ID, current => ({
      ...current,
      messages: [...current.messages, message('msg-1', 'First')],
    }));

    expect(applied.revision).toBe(2);
    expect(applied.conversation.messages.map(item => item.id)).toEqual(['msg-1']);
    // Read back through a port built over the same vault, because the writer's
    // own answer is not the witness for what the file holds.
    const reopened = createPort(storage).port;
    const read = await reopened.read(CONVERSATION_ID);
    expect(read).toEqual({
      kind: 'present',
      revision: 2,
      conversation: expect.objectContaining({
        messages: [expect.objectContaining({ id: 'msg-1' })],
      }),
    });
  });
});

function message(id: string, content: string) {
  return { id, role: 'user' as const, content, timestamp: 1 };
}
