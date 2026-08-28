import {
  CONVERSATION_ID,
  conversationPort,
  createHarness,
  FAKE_BACKEND_ID,
} from '@test/unit/features/chat/chatExecutionHarness';

import { ConversationAgentDispatcher } from '@/app/agents/ConversationAgentDispatcher';
import type { AgentDispatchRequest } from '@/core/agents/AgentContracts';
import { ConversationRepository } from '@/core/conversations/ConversationRepository';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';

/**
 * A turn dispatched with no tab behind it.
 *
 * **This is what the worker-tab row was blocked on**, and the suite is written
 * against the real coordinator, the real kernel and a real vault for the
 * reason wave 1 recorded: a seam both sides stub is not covered. The only fake
 * is the provider — the deterministic backend the chat harness already runs —
 * plus the encoder, which is the one thing a provider genuinely owns.
 */
describe('conversation agent dispatcher', () => {
  const REQUEST: AgentDispatchRequest = {
    agentInstanceId: 'agi-worker-1' as never,
    agentRunId: 'agr-worker-1' as never,
    dispatchToken: 'adt-worker-1' as never,
    providerId: 'claude',
    executionMode: 'provider-native',
    rootOwner: { kind: 'conversation', ownerId: CONVERSATION_ID },
    goalRef: 'refactor-auth-a1b2',
    policy: {} as never,
    idempotency: 'none',
  };

  /**
   * The provider's three steps, which is all a dispatched turn needs of it.
   *
   * `compose` is a parameter because **the providers disagree and the
   * disagreement is the defect this suite caught**: what a turn persists is the
   * provider's to decide, three of the nine replace the text outright and two
   * rewrite it, so a dispatcher that assumed the stored message equals the
   * prompt works for Claude and fails for OpenCode.
   */
  function runtime(compose: (text: string) => string = text => text): ExecutionChatRuntimeAdapter {
    return {
      syncConversationState: jest.fn(),
      getSessionId: () => null,
      turnEncoder: {
        prepareTurn: (request: { text: string }) => ({
          request,
          persistedContent: compose(request.text),
          prompt: request.text,
          isCompact: false,
        }),
        encodeRequestRef: () => 'req-worker-1',
      },
    } as unknown as ExecutionChatRuntimeAdapter;
  }

  function dispatcher(
    harness: Awaited<ReturnType<typeof createHarness>>,
    overrides: Partial<ConstructorParameters<typeof ConversationAgentDispatcher>[0]> = {},
  ) {
    return new ConversationAgentDispatcher({
      chat: { submitTurn: command => harness.composition.submitTurn(command) },
      conversations: conversationPort(harness.conversations),
      createRuntime: () => runtime(),
      nextCommandId: () => 'cmd-worker-1',
      backendIdFor: () => FAKE_BACKEND_ID,
      ...overrides,
    });
  }

  /** A dispatcher that has been told the task, as the orchestrator tells it. */
  function toldDispatcher(
    harness: Awaited<ReturnType<typeof createHarness>>,
    overrides: Partial<ConstructorParameters<typeof ConversationAgentDispatcher>[0]> = {},
  ) {
    const port = dispatcher(harness, overrides);
    port.rememberGoal(REQUEST.agentRunId, 'Refactor the auth module.');
    return port;
  }

  async function storedMessages(harness: Awaited<ReturnType<typeof createHarness>>) {
    const read = await new ConversationRepository({ storage: harness.storage })
      .read(CONVERSATION_ID);
    return read.kind === 'present' ? read.metadata.messages ?? [] : [];
  }

  it('runs a turn with nobody drawing it, and the vault holds the goal', async () => {
    const harness = await createHarness();

    const outcome = await toldDispatcher(harness).dispatch(REQUEST);

    expect(outcome.kind).toBe('accepted');
    // The kernel's own identities, which is what makes the run findable later:
    // a dispatch that reported nothing would leave a record pointing at
    // nothing.
    expect(outcome.kind === 'accepted' && outcome.execution?.executionRunId).toBeDefined();
    // **The goal is in the conversation, and that is the whole design.** No
    // control record holds it, no second store exists for it, and the words a
    // person wrote are where free text already lives.
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'Refactor the auth module.' }),
    ]);
  });

  it('reads the goal back from the conversation when a retry is dispatched', async () => {
    // **A retry, which is the path that actually redispatches.** The
    // coordinator returns early for a run whose intent is already `accepted`
    // and refuses one that is `dispatching`, so the same run is never
    // dispatched twice after a turn went out; a retry is a *new* run against
    // the same conversation. The caller has forgotten the task by then — a
    // reload, or simply a later session — and the conversation is the record
    // that did not.
    const harness = await createHarness();
    const first = await toldDispatcher(harness).dispatch(REQUEST);
    const runId = first.kind === 'accepted' ? first.execution?.executionRunId : undefined;
    harness.backend.emit(runId as never, {
      kind: 'terminal',
      terminal: 'failed',
      reason: 'provider-failure',
    });
    await harness.registry.waitForIdle();

    const forgetful = dispatcher(harness);
    const outcome = await forgetful.dispatch({
      ...REQUEST,
      agentRunId: 'agr-worker-1-retry' as never,
    });

    expect(outcome.kind).toBe('accepted');
    // Asked again, which is what a retry is: two messages, both the task, and
    // the transcript says the question was put twice because it was.
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'Refactor the auth module.' }),
      expect.objectContaining({ role: 'user', content: 'Refactor the auth module.' }),
    ]);
  });

  it('lets the provider compose what the turn persists', async () => {
    // **The defect this caught.** What a turn persists is the provider's to
    // decide — three of the nine replace the text outright and two rewrite it —
    // and a first version wrote the prompt into the conversation itself and
    // then handed that message back to the turn. The turn appended a different
    // object under an id the conversation already held, which the coordinator
    // refuses as a caller bug, so every provider that composes anything failed
    // to dispatch and was recorded as indeterminate.
    const harness = await createHarness();

    const outcome = await toldDispatcher(harness, {
      createRuntime: () => runtime(text => `<task>${text}</task>`),
    }).dispatch(REQUEST);

    expect(outcome.kind).toBe('accepted');
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ content: '<task>Refactor the auth module.</task>' }),
    ]);
  });

  it('refuses without a side effect when nothing recorded a goal', async () => {
    const harness = await createHarness();

    const outcome = await dispatcher(harness).dispatch(REQUEST);

    // A refusal rather than an invented task. The coordinator files this as
    // `invalidated` — the run never reached the provider — which is only
    // honest because every refusal here happens before the turn is submitted.
    expect(outcome).toEqual({
      kind: 'rejected',
      code: 'dispatch.no-goal-recorded',
      sideEffectFree: true,
    });
    await expect(storedMessages(harness)).resolves.toEqual([]);
  });

  it('writes into the conversation the run names, not the owner\'s', async () => {
    // **The two are different conversations on purpose (D10).** The owner is
    // what a person is looking at, so its work card lists what it started; the
    // run's own is what this turn writes into, because a conversation runs one
    // turn at a time and two dispatched workers cannot share one.
    const harness = await createHarness();

    const outcome = await toldDispatcher(harness).dispatch({
      ...REQUEST,
      rootOwner: { kind: 'conversation', ownerId: 'conv-orchestrator' },
      conversationId: CONVERSATION_ID,
    });

    expect(outcome.kind).toBe('accepted');
    // Written to the run's conversation. The owner's does not exist in this
    // vault at all, so a dispatcher that used it would have refused.
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'Refactor the auth module.' }),
    ]);
  });

  it('refuses when nothing names a conversation to write into', async () => {
    const harness = await createHarness();

    const outcome = await toldDispatcher(harness).dispatch({
      ...REQUEST,
      rootOwner: { kind: 'agent', ownerId: 'agi-parent' } as never,
    });

    expect(outcome).toEqual({
      kind: 'rejected',
      code: 'dispatch.no-conversation-to-write-into',
      sideEffectFree: true,
    });
  });

  it('refuses a provider this build does not compose', async () => {
    const harness = await createHarness();

    const outcome = await toldDispatcher(harness, { createRuntime: () => null })
      .dispatch(REQUEST);

    expect(outcome).toEqual({
      kind: 'rejected',
      code: 'dispatch.provider-not-composed',
      sideEffectFree: true,
    });
    // Nothing was written: a refusal that had already appended the user message
    // would be claiming side-effect freedom it does not have.
    await expect(storedMessages(harness)).resolves.toEqual([]);
  });

  it('binds the adapter to the conversation before it encodes anything', async () => {
    // A provider resolves its session, its paths and its history against the
    // conversation it is told it is on. An adapter told nothing answers for
    // whichever conversation it saw last, which for a dispatcher that builds a
    // fresh one is none at all.
    const harness = await createHarness();
    const adapter = runtime();

    await toldDispatcher(harness, { createRuntime: () => adapter }).dispatch(REQUEST);

    expect(adapter.syncConversationState).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONVERSATION_ID }),
    );
  });
});
