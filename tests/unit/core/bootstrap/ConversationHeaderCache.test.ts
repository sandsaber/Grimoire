import '@/providers';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { SessionStorage } from '@/core/bootstrap/SessionStorage';

describe('selective conversation loading', () => {
  function vault() {
    const adapter = createDurableInMemoryVaultAdapter();
    let modified = 1;
    adapter.stat = async path => {
      const content = adapter.files.get(path);
      return content === undefined ? null : { mtime: modified, size: content.length };
    };
    const createStorage = () => new SessionStorage(adapter, new VaultDurableStorage(adapter));
    return { adapter, createStorage, changed: () => { modified += 1; } };
  }

  it('reads only open transcripts after building the header cache and retains history summaries', async () => {
    const { adapter, createStorage } = vault();
    const initial = createStorage();
    for (const id of ['open', 'closed']) {
      await initial.createMetadata({
        id, title: id, providerId: 'codex', createdAt: 1, updatedAt: 2,
        messages: [{ id: 'user', role: 'user', content: `Hello ${id}`, timestamp: 1 }],
      });
    }
    await initial.listConversations(new Set(['open']));
    const read = jest.spyOn(adapter, 'read');
    const listing = await createStorage().listConversations(new Set(['open']));
    expect(read.mock.calls.map(([path]) => path)).not.toContain('.grimoire/sessions/closed.meta.json');
    expect(listing.metadata.find(meta => meta.id === 'open')?.messages).toHaveLength(1);
    expect(listing.metadata.find(meta => meta.id === 'closed')?.messages).toBeUndefined();
    expect(listing.unloaded?.get('closed')).toMatchObject({
      messageCount: 1, preview: 'Hello closed', hasUserMessage: true,
    });
    expect((await createStorage().loadMetadata('closed'))?.messages?.[0].content).toBe('Hello closed');
  });

  it('refreshes externally changed records and drops deleted ones', async () => {
    const { adapter, createStorage, changed } = vault();
    const storage = createStorage();
    await storage.createMetadata({ id: 'chat', title: 'Old', createdAt: 1, updatedAt: 2 });
    await storage.listConversations(new Set());
    await storage.records.apply('chat', current => ({ ...current, title: 'New' }));
    changed();
    expect((await createStorage().listConversations(new Set())).metadata[0].title).toBe('New');
    await storage.deleteMetadata('chat');
    expect((await createStorage().listConversations(new Set())).metadata).toEqual([]);
    expect(adapter.files.has('.grimoire/sessions/chat.meta.json')).toBe(false);
  });

  it('rebuilds a broken cache and still reports unreadable conversation records', async () => {
    const { adapter, createStorage, changed } = vault();
    const storage = createStorage();
    await storage.createMetadata({ id: 'chat', title: 'Saved', createdAt: 1, updatedAt: 2 });
    await storage.listConversations(new Set());
    adapter.files.set('.grimoire/cache/conversation-headers.json', '{broken');
    expect((await createStorage().listConversations(new Set())).metadata[0].title).toBe('Saved');
    adapter.files.set('.grimoire/sessions/chat.meta.json', '{broken');
    changed();
    const listing = await createStorage().listConversations(new Set());
    expect(listing.metadata).toEqual([]);
    expect(listing.unreadable).toEqual([{ id: 'chat', reason: 'corrupt' }]);
  });

  it('rebuilds old cache entries that cannot answer whether a user message exists', async () => {
    const { adapter, createStorage } = vault();
    const storage = createStorage();
    await storage.createMetadata({
      id: 'chat', title: 'Saved', createdAt: 1, updatedAt: 2,
      messages: [{ id: 'user', role: 'user', content: '', timestamp: 1 }],
    });
    await storage.listConversations(new Set());
    const path = '.grimoire/cache/conversation-headers.json';
    const cache = JSON.parse(adapter.files.get(path)!);
    delete cache.entries[0].summary.hasUserMessage;
    adapter.files.set(path, JSON.stringify(cache));
    const listing = await createStorage().listConversations(new Set());
    expect(listing.unloaded?.get('chat')?.hasUserMessage).toBe(true);
  });
});
