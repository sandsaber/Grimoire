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

  /** The provider's three steps, which is all a dispatched turn needs of it. */
  function runtime(): ExecutionChatRuntimeAdapter {
    return {
      syncConversationState: jest.fn(),
      getSessionId: () => null,
      turnEncoder: {
        prepareTurn: (request: { text: string }) => ({
          request,
          persistedContent: request.text,
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
      goalFor: () => 'Refactor the auth module.',
      nextCommandId: () => 'cmd-worker-1',
      backendIdFor: () => FAKE_BACKEND_ID,
      ...overrides,
    });
  }

  async function storedMessages(harness: Awaited<ReturnType<typeof createHarness>>) {
    const read = await new ConversationRepository({ storage: harness.storage })
      .read(CONVERSATION_ID);
    return read.kind === 'present' ? read.metadata.messages ?? [] : [];
  }

  it('runs a turn with nobody drawing it, and the vault holds the goal', async () => {
    const harness = await createHarness();

    const outcome = await dispatcher(harness).dispatch(REQUEST);

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

  it('reads the goal back from the conversation on a redispatch', async () => {
    const harness = await createHarness();
    const first = await dispatcher(harness).dispatch(REQUEST);
    // Ended before the second, because a conversation runs one turn at a time:
    // a redispatch against a live run queues behind it, which is the
    // coordinator being right rather than this being a retry.
    const runId = first.kind === 'accepted' ? first.execution?.executionRunId : undefined;
    harness.backend.emit(runId as never, {
      kind: 'terminal',
      terminal: 'failed',
      reason: 'provider-failure',
    });
    await harness.registry.waitForIdle();

    // The caller has forgotten — a reload between the attempts — and the
    // conversation is the record that did not.
    const forgetful = dispatcher(harness, { goalFor: () => null });
    const outcome = await forgetful.dispatch(REQUEST);

    expect(outcome.kind).toBe('accepted');
    // Still one message: the append is idempotent by id, so a redispatch of the
    // same run resubmits rather than asking twice.
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'Refactor the auth module.' }),
    ]);
  });

  it('refuses without a side effect when nothing recorded a goal', async () => {
    const harness = await createHarness();

    const outcome = await dispatcher(harness, { goalFor: () => null }).dispatch(REQUEST);

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

  it('refuses an owner that is not a conversation', async () => {
    const harness = await createHarness();

    const outcome = await dispatcher(harness).dispatch({
      ...REQUEST,
      rootOwner: { kind: 'agent', ownerId: 'agi-parent' } as never,
    });

    expect(outcome).toEqual({
      kind: 'rejected',
      code: 'dispatch.owner-not-a-conversation',
      sideEffectFree: true,
    });
  });

  it('refuses a provider this build does not compose', async () => {
    const harness = await createHarness();

    const outcome = await dispatcher(harness, { createRuntime: () => null })
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

    await dispatcher(harness, { createRuntime: () => adapter }).dispatch(REQUEST);

    expect(adapter.syncConversationState).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONVERSATION_ID }),
    );
  });
});
