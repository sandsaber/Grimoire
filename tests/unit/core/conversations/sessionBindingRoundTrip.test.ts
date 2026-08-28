import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ConversationRepository } from '@/core/conversations/ConversationRepository';
import type { SessionMetadata } from '@/core/types';
import { grokProviderModule } from '@/providers/grok/GrokProviderModule';

/**
 * What a conversation resumes from, written and read back out of a vault.
 *
 * **The binding had no coverage that runs.** `buildSessionUpdates` — the thing
 * that turns a provider's session into the two fields a conversation stores —
 * appeared in tests only under `*LiveSmoke`, which are skipped without
 * credentials and drive an adapter method nothing in `src/` calls. The
 * `ConversationController` tests that reach the save path stub it to `{}` and
 * assert `expect.any(Object)`, which any wrong value also satisfies. So the
 * most dangerous write in the migration was pinned by nothing a CI run
 * executes, and the migration plan moves it to the coordinator's persistence
 * barrier next.
 *
 * These are the invariants that move has to preserve, asserted against the real
 * provider rule and a real reload rather than a mock: **a writer that changed
 * something else does not take the binding with it**, and **an invalidated
 * session keeps the provider state that outlives it.** Grok is the provider
 * because its patch is the one with a rule in it — the session id goes and the
 * paths stay, since the next session is written to the same directory and the
 * transcript already there is still this conversation's.
 */
describe('session binding round trip', () => {
  const CONVERSATION_ID = 'conv-1';
  const SESSION_DIR = '/vault/.grok/sessions/conv-1';

  /** Grok's own patch builder, over the paths its workspace would report. */
  const buildSessionPatch = grokProviderModule.runtimePorts({
    readSessionPaths: () => ({ sessionDirPath: SESSION_DIR }),
  } as never).history?.buildSessionPatch;

  function metadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
    return {
      id: CONVERSATION_ID,
      title: 'Tomatoes',
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    };
  }

  /**
   * A vault, and a way to open it again.
   *
   * The map outlives the storage, so `reopen()` is a reader that shares nothing
   * with the writer but the bytes — which is the only way to tell a field that
   * was persisted from one that is still in somebody's memory.
   */
  function vault() {
    const files = new Map<string, string>();
    const open = () => new ConversationRepository({
      storage: new TestDurableStorage(files),
      now: () => 1_000,
    });
    return { files, open };
  }

  /** The two fields a session patch contributes, as the save path applies them. */
  function applyPatch(
    current: SessionMetadata,
    patch: { sessionId?: string | null; providerState?: unknown },
  ): SessionMetadata {
    return {
      ...current,
      ...(patch.sessionId === undefined ? {} : { sessionId: patch.sessionId }),
      // Narrowed at the boundary the host narrows it at: `providerState` is
      // opaque to core, and the adapter that builds this patch today casts it
      // into the conversation the same way.
      ...(patch.providerState === undefined
        ? {}
        : { providerState: patch.providerState as Record<string, unknown> }),
    };
  }

  it('gives back the session a turn established, from a vault opened again', async () => {
    const { open } = vault();
    const writer = open();
    await writer.save(metadata(), null);

    const patch = buildSessionPatch?.({
      conversationId: CONVERSATION_ID,
      sessionInvalidated: false,
      nativeSessionRef: 'grok-session-9',
    });
    await writer.apply(CONVERSATION_ID, current => applyPatch(current, patch ?? {}));

    const reloaded = await open().read(CONVERSATION_ID);

    expect(reloaded.kind).toBe('present');
    expect(reloaded.kind === 'present' && reloaded.metadata.sessionId).toBe('grok-session-9');
    expect(reloaded.kind === 'present' && reloaded.metadata.providerState)
      .toEqual({ sessionDirPath: SESSION_DIR });
  });

  it('keeps the binding when a different writer changes something else', async () => {
    const { open } = vault();
    const writer = open();
    await writer.save(metadata(), null);
    const patch = buildSessionPatch?.({
      conversationId: CONVERSATION_ID,
      sessionInvalidated: false,
      nativeSessionRef: 'grok-session-9',
    });
    await writer.apply(CONVERSATION_ID, current => applyPatch(current, patch ?? {}));

    // A title generated in the background, through a repository that never saw
    // the binding written. This is the shape of the bug the milestone is for: a
    // writer that holds a whole conversation and puts back the parts it knows.
    await open().apply(CONVERSATION_ID, current => ({ ...current, title: 'Renamed' }));

    const reloaded = await open().read(CONVERSATION_ID);

    expect(reloaded.kind === 'present' && reloaded.metadata.title).toBe('Renamed');
    expect(reloaded.kind === 'present' && reloaded.metadata.sessionId).toBe('grok-session-9');
    expect(reloaded.kind === 'present' && reloaded.metadata.providerState)
      .toEqual({ sessionDirPath: SESSION_DIR });
  });

  it('drops an invalidated session id and keeps the state that outlives it', async () => {
    const { open } = vault();
    const writer = open();
    // **Started with no binding at all, on purpose.** A first version of this
    // wrote a valid patch, then the invalidated one, and asserted the paths
    // were still there — which they were, because the *earlier* write had put
    // them there and a patch without them changes nothing. It passed with the
    // rule deleted from the provider. The state has to arrive *in* the
    // invalidated patch for this to be about the rule.
    await writer.save(metadata(), null);

    // The provider refused the resume, so the id it refused must not be tried
    // again — but the directory its transcript is in is still this
    // conversation's, and losing it loses the history the next session reads.
    const invalidated = buildSessionPatch?.({
      conversationId: CONVERSATION_ID,
      sessionInvalidated: true,
      nativeSessionRef: 'grok-session-9',
    });
    await open().apply(CONVERSATION_ID, current => applyPatch(current, invalidated ?? {}));

    const reloaded = await open().read(CONVERSATION_ID);

    expect(reloaded.kind === 'present' && reloaded.metadata.sessionId).toBeNull();
    expect(reloaded.kind === 'present' && reloaded.metadata.providerState)
      .toEqual({ sessionDirPath: SESSION_DIR });
  });
});
