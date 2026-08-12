import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { ApplicationRuntimeInfrastructure } from '@/app/runtime/ApplicationRuntimeInfrastructure';
import { createChatExecutionCoordinator } from '@/app/runtime/ChatRuntimeWiring';
import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { ConversationRepository } from '@/core/persistence/ConversationRepository';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('createChatExecutionCoordinator', () => {
  it('constructs a chat coordinator from the lifecycle registry and conversation repository', () => {
    const storage = new TestDurableStorage();
    const infra = new ApplicationRuntimeInfrastructure({ storage, digest });
    const conversations = new ConversationRepository(storage);
    const results = new DurableExecutionResultStore(storage, digest);
    const identities = new ApplicationIdentityFactory();

    const coordinator = createChatExecutionCoordinator({
      lifecycle: infra.lifecycle,
      conversations,
      results,
      identities,
    });

    expect(coordinator).toBeDefined();
    expect(typeof coordinator.submitTurn).toBe('function');
    expect(typeof coordinator.loadConversation).toBe('function');
    expect(typeof coordinator.cancelActive).toBe('function');
  });
});
