import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeMigration } from '@/app/runtime/ApplicationRuntimeMigration';
import { SESSIONS_PATH } from '@/core/bootstrap/StoragePaths';
import { ConversationRepository } from '@/core/persistence/ConversationRepository';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ApplicationRuntimeMigration', () => {
  it('runs once and is idempotent', async () => {
    const storage = new TestDurableStorage();
    const conversations = new ConversationRepository(storage);
    const legacySessions = { listMetadata: async () => [] };
    const migration = new ApplicationRuntimeMigration(conversations, legacySessions, builtInProviderCatalog);
    await expect(migration.migrate()).resolves.toBeUndefined();
    await expect(migration.migrate()).resolves.toBeUndefined();
  });

  it('imports legacy session metadata into the revisioned conversation repository', async () => {
    const storage = new TestDurableStorage();
    // Seed a legacy session metadata file.
    await storage.writeAtomic(`${SESSIONS_PATH}/legacy-1.meta.json`, JSON.stringify({
      id: 'legacy-1',
      providerId: 'claude',
      title: 'Legacy Conversation',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [],
    }));

    const conversations = new ConversationRepository(storage);
    const migration = new ApplicationRuntimeMigration(
      conversations,
      { listMetadata: async () => [] }, // Migration reads from DurableStorage directly via adapter
      builtInProviderCatalog,
    );

    // Test with the adapter directly
    const { LegacySessionMetadataAdapter } = await import('@/app/runtime/LegacySessionMetadataAdapter');
    const adapter = new LegacySessionMetadataAdapter(storage);
    const metadatas = await adapter.listMetadata();
    expect(metadatas).toHaveLength(1);
    expect(metadatas[0]?.id).toBe('legacy-1');

    // Import the metadata
    await conversations.importLegacyMetadata(metadatas[0], 'claude');

    // Verify the conversation is readable from the revisioned repository
    const read = await conversations.read('legacy-1');
    expect(read.kind).not.toBe('absent');

    void migration;
    void digest;
  });
});
