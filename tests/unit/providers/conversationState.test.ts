import '@/providers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
import type { Conversation } from '@/core/types';

/**
 * What a conversation's session binding means to each provider.
 *
 * Half of the history row, and the half that is **pure**: all four members read
 * a conversation and answer, or build a record to put back. None of the nine
 * reads a plugin, touches a file or awaits anything — and their consumers are
 * synchronous, which is why they are a declaration rather than a workspace
 * service. `SessionStorage` derives the state to persist inside a save, and two
 * `hasStartedConversation` predicates ask whether a conversation has a session
 * while a tab paints.
 *
 * The round trip is what is asserted rather than the write alone: a fork's
 * state is built by one member and read back by another, and a test that only
 * checked the shape written would not notice the reader disagreeing about it.
 */
function conversation(providerId: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    providerId,
    title: 'Untitled',
    createdAt: 1,
    updatedAt: 1,
    sessionId: null,
    messages: [],
    ...overrides,
  };
}

describe('provider conversation state', () => {
  const catalog = providerCatalog();

  it.each(catalog.ids())('%s declares what its session binding means', (providerId) => {
    expect(catalog.declarations(providerId).conversationState).toBeDefined();
  });

  it.each(catalog.ids())('%s answers nothing for a conversation with no binding', (providerId) => {
    const state = catalog.declarations(providerId).conversationState!;

    expect(state.resolveSessionId(conversation(providerId))).toBeNull();
    expect(state.isPendingFork(conversation(providerId))).toBe(false);
    // The fork path asks before a conversation is bound, which is why the
    // member takes a nullable one.
    expect(state.resolveSessionId(null)).toBeNull();
  });

  /**
   * The two providers whose fork state is a session the fork resumes from.
   *
   * Written out rather than asserted of all nine, because it is not true of all
   * nine and a blanket assertion would have been a claim about the seven it is
   * not true of. Antigravity has no resumable session at all — it starts a
   * fresh process per run — and the six ACP providers fork by copying the
   * conversation rather than by resuming the source's session, so their
   * `forkState` is empty by design.
   */
  const RESUMES_A_FORK_SOURCE = ['claude', 'codex'];

  it.each(RESUMES_A_FORK_SOURCE)('%s reads back the fork state it built', (providerId) => {
    const state = catalog.declarations(providerId).conversationState!;

    const forked = conversation(providerId, {
      providerState: state.forkState('source-session', 'assistant-1'),
    });

    // The round trip, which is the point: one member writes the opaque record
    // and the other is asked, of a conversation carrying it, where the fork
    // resumes from. A test of the write alone would not notice the reader
    // disagreeing about the shape.
    expect(state.resolveSessionId(forked)).toBe('source-session');
    expect(state.isPendingFork(forked)).toBe(true);
  });

  it.each(catalog.ids().filter(id => !RESUMES_A_FORK_SOURCE.includes(id)))(
    '%s forks without a source session to resume',
    (providerId) => {
      const state = catalog.declarations(providerId).conversationState!;

      expect(state.forkState('source-session', 'assistant-1')).toEqual({});
    },
  );

  /** Antigravity resumes nothing, which is why it is the one exception. */
  it.each(catalog.ids().filter(id => id !== 'antigravity'))(
    '%s resolves a bound session id',
    (providerId) => {
      const state = catalog.declarations(providerId).conversationState!;

      expect(state.resolveSessionId(conversation(providerId, { sessionId: 'live-session' })))
        .toBe('live-session');
    },
  );

  it('answers no session for the provider that has none to resume', () => {
    const state = catalog.declarations('antigravity').conversationState!;

    expect(state.resolveSessionId(conversation('antigravity', { sessionId: 'live-session' })))
      .toBeNull();
  });
});
