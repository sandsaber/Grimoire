import type { ProviderHistoryHydration } from '@/core/providers/ProviderModule';
import type { Conversation } from '@/core/types';
import { GrokConversationHistoryService } from '@/providers/grok/history/GrokConversationHistoryService';
import { loadGrokSessionMessages } from '@/providers/grok/history/GrokHistoryStore';
import { KimicodeConversationHistoryService } from '@/providers/kimicode/history/KimicodeConversationHistoryService';
import { loadKimicodeSessionMessages } from '@/providers/kimicode/history/KimicodeHistoryStore';
import { MimocodeConversationHistoryService } from '@/providers/mimocode/history/MimocodeConversationHistoryService';
import { loadMimocodeSessionMessages } from '@/providers/mimocode/history/MimocodeHistoryStore';
import { OpencodeConversationHistoryService } from '@/providers/opencode/history/OpencodeConversationHistoryService';
import { loadOpencodeSessionMessages } from '@/providers/opencode/history/OpencodeHistoryStore';

jest.mock('@/providers/opencode/history/OpencodeHistoryStore', () => ({
  loadOpencodeSessionMessages: jest.fn(),
}));
jest.mock('@/providers/mimocode/history/MimocodeHistoryStore', () => ({
  loadMimocodeSessionMessages: jest.fn(),
}));
jest.mock('@/providers/kimicode/history/KimicodeHistoryStore', () => ({
  loadKimicodeSessionMessages: jest.fn(),
}));
jest.mock('@/providers/grok/history/GrokHistoryStore', () => ({
  loadGrokSessionMessages: jest.fn(),
  normalizeImportedGrokUserMessage: (message: unknown) => message,
}));

/**
 * A conversation whose session the provider no longer has.
 *
 * The case the whole outcome vocabulary exists for, and the one a cross-provider
 * smoke check cannot reach: it needs the store to be asked and to answer with
 * nothing. Until this was named, the user opened such a conversation, saw an
 * empty transcript, and had no way to tell it from a chat they never used.
 */
describe('a session the provider no longer has', () => {
  const PROVIDERS = [
    {
      id: 'opencode',
      service: () => new OpencodeConversationHistoryService(),
      loader: loadOpencodeSessionMessages as jest.Mock,
    },
    {
      id: 'mimocode',
      service: () => new MimocodeConversationHistoryService(),
      loader: loadMimocodeSessionMessages as jest.Mock,
    },
    {
      id: 'kimicode',
      service: () => new KimicodeConversationHistoryService(),
      loader: loadKimicodeSessionMessages as jest.Mock,
    },
    {
      id: 'grok',
      service: () => new GrokConversationHistoryService(),
      loader: loadGrokSessionMessages as jest.Mock,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function conversation(providerId: string, messages: unknown[]): Conversation {
    return {
      id: 'conv-1',
      providerId,
      title: 'Untitled',
      createdAt: 1,
      updatedAt: 1,
      sessionId: 'session-gone',
      messages,
    } as unknown as Conversation;
  }

  it.each(PROVIDERS)(
    '$id calls it stale when the conversation has messages it can no longer explain',
    async ({ id, service, loader }) => {
      loader.mockResolvedValue([]);

      const hydration: ProviderHistoryHydration = await service()
        .hydrateConversationHistory(
          conversation(id, [{ role: 'user', content: 'what now?', timestamp: 1 }]),
          '/vault',
        );

      // The conversation names a session, the store has nothing under it, and
      // what is on screen is Grimoire's own copy of a conversation the provider
      // has forgotten.
      expect(hydration).toEqual({ outcome: 'stale', reason: 'sessionNotFound' });
    },
  );

  it.each(PROVIDERS)(
    '$id calls it absent when there is nothing on screen either',
    async ({ id, service, loader }) => {
      loader.mockResolvedValue([]);

      const hydration = await service().hydrateConversationHistory(
        conversation(id, []),
        '/vault',
      );

      // Nothing was lost that the user can see, so nothing is said. A caption
      // over an empty chat would be noise.
      expect(hydration).toEqual({ outcome: 'absent' });
    },
  );

  it.each(PROVIDERS)('$id calls it complete when the store answers', async ({ id, service, loader }) => {
    loader.mockResolvedValue([{ role: 'user', content: 'what now?', timestamp: 1 }]);

    const hydration = await service().hydrateConversationHistory(
      conversation(id, []),
      '/vault',
    );

    expect(hydration).toEqual({ outcome: 'complete' });
  });
});
