import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { Conversation } from '@/core/types';
import type { ProviderId } from '@/core/types/provider';

/**
 * Every provider says what happened when a conversation's history was loaded.
 *
 * The port used to answer `void`, so a conversation whose session the provider
 * no longer has was indistinguishable from one with nothing in it — the M0a
 * characterization recorded that silence, and these outcomes are what replaces
 * it. A provider added later that answers nothing would restore it for itself
 * alone, which is what this checks.
 */
describe('history hydration outcomes', () => {
  const OUTCOMES = ['absent', 'complete', 'partial', 'stale', 'corrupt', 'recovered'];

  const providerIds = ProviderRegistry.getRegisteredProviderIds();

  it('has providers to check', () => {
    // Guards the guard: an empty registry would make every case below vacuous.
    expect(providerIds.length).toBeGreaterThan(0);
  });

  function unboundConversation(providerId: ProviderId): Conversation {
    return {
      id: 'conv-unbound',
      providerId,
      title: 'Untitled',
      createdAt: 1,
      updatedAt: 1,
      sessionId: null,
      messages: [],
    };
  }

  it.each(providerIds)('%s answers with an outcome, not with nothing', async providerId => {
    const service = ProviderRegistry.getConversationHistoryService(providerId);

    const hydration = await service.hydrateConversationHistory(
      unboundConversation(providerId),
      null,
    );

    expect(hydration).toBeDefined();
    expect(OUTCOMES).toContain(hydration.outcome);
  });

  it.each(providerIds)(
    '%s calls a conversation with no session absent rather than complete',
    async providerId => {
      const service = ProviderRegistry.getConversationHistoryService(providerId);

      const hydration = await service.hydrateConversationHistory(
        unboundConversation(providerId),
        null,
      );

      // The distinction the surface acts on: a conversation that never had a
      // provider-side history is not one that lost it, and an empty new chat
      // must not be captioned as missing something.
      expect(hydration.outcome).toBe('absent');
    },
  );
});
