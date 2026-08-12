import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ConversationRepository } from '@/core/persistence/ConversationRepository';
import { RevisionConflictError } from '@/core/persistence/VersionedRepository';
import type { Conversation } from '@/core/types';

class CommitThenThrowStorage extends TestDurableStorage {
  private shouldThrow = true;

  override async compareAndSwap(
    path: string,
    expectedContent: string | null,
    nextContent: string | null,
  ): Promise<boolean> {
    const written = await super.compareAndSwap(path, expectedContent, nextContent);
    if (written && this.shouldThrow) {
      this.shouldThrow = false;
      throw new Error('simulated crash after commit');
    }
    return written;
  }
}

function createConversation(): Conversation {
  return {
    id: 'conversation-1',
    providerId: 'future-provider',
    title: 'Conversation',
    createdAt: 1,
    updatedAt: 1,
    sessionId: 'native-session',
    providerState: {
      futureNestedShape: {
        nativeId: 'opaque-1',
        flags: [true, false],
      },
    },
    messages: [],
  };
}

describe('ConversationRepository', () => {
  it('round-trips opaque provider state without shared parsing', async () => {
    const repository = new ConversationRepository(new TestDurableStorage(), {
      now: () => 10,
    });
    const conversation = createConversation();

    await repository.create(conversation);
    const read = await repository.read(conversation.id);

    expect(read).toMatchObject({
      kind: 'current',
      record: {
        revision: 1,
        payload: conversation,
      },
    });
  });

  it('validates run-specific execution completion markers', async () => {
    const repository = new ConversationRepository(new TestDurableStorage(), {
      now: () => 10,
    });
    const malformed = {
      ...createConversation(),
      executionCompletions: [{
        runId: 'run-1',
        terminalKind: 'unexpected',
        completedAt: 5,
      }],
    } as unknown as Conversation;

    await expect(repository.create(malformed)).rejects.toThrow('Invalid conversation payload.');
  });

  it('serializes updates, rejects stale revisions, and keeps provider binding immutable', async () => {
    const repository = new ConversationRepository(new TestDurableStorage(), {
      now: () => 10,
    });
    await repository.create(createConversation());

    const first = repository.update('conversation-1', 1, conversation => ({
      ...conversation,
      title: 'First update',
      updatedAt: 2,
    }));
    const stale = repository.update('conversation-1', 1, conversation => ({
      ...conversation,
      title: 'Stale update',
      updatedAt: 3,
    }));

    await expect(first).resolves.toMatchObject({
      revision: 2,
      payload: { title: 'First update' },
    });
    await expect(stale).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(repository.update('conversation-1', 2, conversation => ({
      ...conversation,
      providerId: 'other-provider',
    }))).rejects.toThrow('Conversation provider binding is immutable.');
  });

  it('imports existing session metadata without losing opaque state', async () => {
    const repository = new ConversationRepository(new TestDurableStorage(), {
      now: () => 10,
    });
    const metadata = {
      id: 'legacy-conversation',
      title: 'Legacy',
      createdAt: 1,
      updatedAt: 2,
      sessionId: 'native-session',
      providerState: {
        futureProviderKey: { nested: ['value'] },
      },
      externalContextPaths: ['Notes'],
      orchestratorMode: true,
    };

    const first = await repository.importLegacyMetadata(metadata, 'future-provider');
    const repeated = await repository.importLegacyMetadata(metadata, 'future-provider');
    expect(first.revision).toBe(1);
    expect(repeated.revision).toBe(1);
    await expect(repository.read(metadata.id)).resolves.toMatchObject({
      kind: 'current',
      record: {
        payload: {
          ...metadata,
          providerId: 'future-provider',
          messages: [],
        },
      },
    });
  });

  it('treats a retry after a committed-but-unacknowledged import as success', async () => {
    const storage = new CommitThenThrowStorage();
    const repository = new ConversationRepository(storage, { now: () => 10 });
    const metadata = {
      id: 'legacy-crash',
      title: 'Legacy crash',
      createdAt: 1,
      updatedAt: 2,
      providerState: { nativeId: 'opaque-native-id' },
    };

    await expect(repository.importLegacyMetadata(metadata, 'future-provider'))
      .rejects.toThrow('simulated crash after commit');
    await expect(repository.importLegacyMetadata(metadata, 'future-provider'))
      .resolves.toMatchObject({ revision: 1, payload: { id: metadata.id } });
  });

  it('does not treat different legacy data as an idempotent replay', async () => {
    const repository = new ConversationRepository(new TestDurableStorage(), {
      now: () => 10,
    });
    const metadata = {
      id: 'legacy-conflict',
      title: 'Original',
      createdAt: 1,
      updatedAt: 2,
    };

    await repository.importLegacyMetadata(metadata, 'future-provider');
    await expect(repository.importLegacyMetadata({
      ...metadata,
      title: 'Different',
    }, 'future-provider')).rejects.toThrow('conflicts with the durable record');
  });
});
