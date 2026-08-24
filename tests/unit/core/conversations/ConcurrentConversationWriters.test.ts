import '@/providers';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { SESSIONS_PATH, SessionStorage } from '@/core/bootstrap/SessionStorage';
import type { ChatMessage, Conversation } from '@/core/types';

/**
 * Two writers, one conversation.
 *
 * This is the whole of what M4 is for, and it is not hypothetical: a title is
 * generated in the background while a stream appends messages, a rename lands in
 * one window while another is mid-turn, and an environment change clears a
 * session binding across every conversation at once. Each of those reads the
 * conversation, changes part of it, and — on the legacy path — wrote the whole
 * of it back, so the last one to finish reverted the others.
 *
 * The fix is not a lock. It is that a writer writes **what it changed**.
 */
describe('two writers on one conversation', () => {
  const CONVERSATION_ID = 'conv-shared';
  const PATH = `${SESSIONS_PATH}/${CONVERSATION_ID}.meta.json`;

  function message(role: 'user' | 'assistant', content: string): ChatMessage {
    return { role, content, timestamp: 1 } as ChatMessage;
  }

  function conversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: CONVERSATION_ID,
      providerId: 'claude',
      title: 'New conversation',
      createdAt: 1,
      updatedAt: 2,
      messages: [],
      ...overrides,
    } as Conversation;
  }

  function createStorage(): { storage: SessionStorage; read: () => any } {
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));
    return {
      storage,
      read: () => JSON.parse(adapter.files.get(PATH) as string).payload,
    };
  }

  it('keeps the messages a rename never saw', async () => {
    const { storage, read } = createStorage();
    // What both writers started from.
    const shared = conversation();
    await storage.createMetadata(storage.toSessionMetadata(shared));

    // Writer B — the stream — appends a turn.
    const streaming = conversation({
      messages: [message('user', 'what now?'), message('assistant', 'the answer')],
    });
    await storage.updateMetadata(streaming, ['messages']);

    // Writer A — a background title generator holding the conversation as it
    // was **before** the turn — renames it.
    const stale = conversation({ title: 'About tomatoes', messages: [] });
    await storage.updateMetadata(stale, ['title']);

    const stored = read();
    expect(stored.title).toBe('About tomatoes');
    // On the legacy path this was `[]`: the rename wrote the whole conversation
    // it was holding, and the user watched their own message disappear.
    expect(stored.messages).toHaveLength(2);
  });

  it('keeps a title the stream never saw', async () => {
    const { storage, read } = createStorage();
    await storage.createMetadata(storage.toSessionMetadata(conversation()));

    await storage.updateMetadata(conversation({ title: 'About tomatoes' }), ['title']);
    // The stream still holds the conversation as it was named when it started.
    await storage.updateMetadata(
      conversation({ messages: [message('user', 'what now?')] }),
      ['messages'],
    );

    const stored = read();
    expect(stored.title).toBe('About tomatoes');
    expect(stored.messages).toHaveLength(1);
  });

  it('clears a session binding without touching anything else', async () => {
    const { storage, read } = createStorage();
    await storage.createMetadata(storage.toSessionMetadata(conversation({
      sessionId: 'session-123',
      messages: [message('user', 'what now?')],
      title: 'About tomatoes',
    })));

    // What an environment change does across every conversation at once. It
    // holds each conversation as it was at load, which for an open one is
    // already out of date.
    const invalidated = conversation({ sessionId: null, messages: [] });
    await storage.updateMetadata(invalidated, ['sessionId', 'providerState']);

    const stored = read();
    expect(stored.sessionId).toBeNull();
    expect(stored.title).toBe('About tomatoes');
    expect(stored.messages).toHaveLength(1);
  });

  it('applies a status without reverting the title beside it', async () => {
    const { storage, read } = createStorage();
    await storage.createMetadata(storage.toSessionMetadata(conversation()));

    // The two halves of title generation, from callers that each hold their own
    // copy: the rename lands, then the status arrives from a copy that predates
    // it.
    await storage.updateMetadata(conversation({ title: 'About tomatoes' }), ['title']);
    await storage.updateMetadata(
      conversation({ titleGenerationStatus: 'success' }),
      ['titleGenerationStatus'],
    );

    const stored = read();
    expect(stored.title).toBe('About tomatoes');
    expect(stored.titleGenerationStatus).toBe('success');
  });

  it('moves the derived fields with the messages they are derived from', async () => {
    const { storage, read } = createStorage();
    await storage.createMetadata(storage.toSessionMetadata(conversation()));

    const answer = message('assistant', 'the answer');
    answer.responseMetadata = { model: 'claude-sonnet-4-5' };
    await storage.updateMetadata(
      conversation({ messages: [message('user', 'what now?'), answer] }),
      ['messages'],
    );
    // A writer that changed nothing about the messages must not blank what was
    // read out of them. The response headers and the vault search rows are
    // projections of the message list, so they travel with it — and only with
    // it.
    await storage.updateMetadata(conversation({ title: 'About tomatoes' }), ['title']);

    const stored = read();
    expect(stored.messages).toHaveLength(2);
    expect(stored.assistantResponseMetadata).toEqual([
      { assistantMessageIndex: 0, metadata: { model: 'claude-sonnet-4-5' } },
    ]);
  });

  it('gives every write its own revision', async () => {
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));
    await storage.createMetadata(storage.toSessionMetadata(conversation()));

    await storage.updateMetadata(conversation({ title: 'One' }), ['title']);
    await storage.updateMetadata(conversation({ title: 'Two' }), ['title']);

    // The revision is what a later checkpoint reads to refuse a whole-object
    // writer; here it is simply proof that each write is a new version of the
    // record rather than a fresh file.
    const stored = JSON.parse(adapter.files.get(PATH) as string);
    expect(stored.revision).toBe(3);
    expect(stored.schemaVersion).toBe(1);
  });
});
