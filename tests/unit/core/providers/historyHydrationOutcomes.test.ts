import '@/providers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
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

  const providerIds = providerCatalog().ids();

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

  /**
   * The provider's transcript port, through its module's own workspace.
   *
   * The context stub carries only the two members the slot literal *calls*
   * while it is being built; everything else is reached inside a closure that
   * these cases never enter. Built through the module rather than by
   * constructing each history service directly, because what is being checked
   * is what the host would get.
   */
  async function transcriptsFor(providerId: ProviderId) {
    const workspace = await providerCatalog().require(providerId).workspace.initialize(
      { commandsPort: () => ({}), mcpPort: () => ({}) },
      new AbortController().signal,
    );
    return workspace.transcripts;
  }

  it.each(providerIds)('%s answers with an outcome, not with nothing', async providerId => {
    const transcripts = await transcriptsFor(providerId);

    const hydration = await transcripts!.hydrate(unboundConversation(providerId), null);

    expect(hydration).toBeDefined();
    expect(OUTCOMES).toContain(hydration.outcome);
  });

  it.each(providerIds)(
    '%s calls a conversation with no session absent rather than complete',
    async providerId => {
      const transcripts = await transcriptsFor(providerId);

      const hydration = await transcripts!.hydrate(unboundConversation(providerId), null);

      // The distinction the surface acts on: a conversation that never had a
      // provider-side history is not one that lost it, and an empty new chat
      // must not be captioned as missing something.
      expect(hydration.outcome).toBe('absent');
    },
  );
});
