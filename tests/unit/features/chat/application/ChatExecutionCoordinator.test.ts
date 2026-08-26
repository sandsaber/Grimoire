import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ConversationRepository } from '@/core/conversations/ConversationRepository';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import {
  type ExecutionSessionId,
  executionSessionId,
  interactionId,
  type LifecycleLeaseId,
  lifecycleLeaseId,
  type RunId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';
import type { ChatMessage, Conversation, SessionMetadata } from '@/core/types';
import {
  type ChatConversationPort,
  ChatExecutionCoordinator,
  type ChatExecutionLifecyclePort,
  type SubmitChatTurnCommand,
} from '@/features/chat/application/ChatExecutionCoordinator';
import { liveAssistantText } from '@/features/chat/projections/ChatProjection';

/**
 * Turn acceptance, dispatch, the persistence barrier, and queued-input release.
 *
 * Composed against the real kernel and the real conversation store rather than
 * against stubs of both, because wave 1's lesson is that **a seam both sides
 * stub is not covered**: every fatal defect that flip found was found by the
 * end-to-end composition test, and only because it ran before the flip was
 * trusted. So the registry here is the registry, the store is the store, and
 * the only fake is the provider — which is what a fake is for.
 */

const INSTANCE_ID = sessionInstanceId(`si-${'1'.repeat(32)}`);
const CONVERSATION_ID = 'conv-1';
const FAKE_BACKEND_ID = executionBackendId('internal-deterministic-fake');

interface Harness {
  readonly coordinator: ChatExecutionCoordinator;
  readonly registry: ExecutionLifecycleRegistry;
  readonly backend: DeterministicFakeBackend;
  readonly storage: TestDurableStorage;
  readonly conversations: ConversationRepository;
  advance(milliseconds: number): void;
  /** A second coordinator over the same kernel and vault, as a reload gives. */
  createCoordinator(): ChatExecutionCoordinator;
}

function opaque(prefix: string, ordinal: number): string {
  return `${prefix}-${ordinal.toString(16).padStart(32, '0')}`;
}

/**
 * The conversation as the store holds it, and as the chat surface reads it.
 *
 * The two shapes differ — a stored conversation's provider, messages and
 * session binding are all optional, because a vault in the field holds files
 * this build did not write. The projection this coordinator feeds is the chat
 * surface's shape, so the port is where the two meet. Only the fields a turn
 * touches are carried here; the plugin does the whole of it today.
 */
function toConversation(metadata: SessionMetadata): Conversation {
  return {
    id: metadata.id,
    providerId: metadata.providerId ?? 'claude',
    title: metadata.title,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ...(metadata.lastResponseAt !== undefined
      ? { lastResponseAt: metadata.lastResponseAt }
      : {}),
    sessionId: metadata.sessionId ?? null,
    messages: metadata.messages ? [...metadata.messages] : [],
  };
}

function toMetadata(conversation: Conversation): SessionMetadata {
  return {
    id: conversation.id,
    providerId: conversation.providerId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    ...(conversation.lastResponseAt !== undefined
      ? { lastResponseAt: conversation.lastResponseAt }
      : {}),
    sessionId: conversation.sessionId,
    messages: [...conversation.messages],
  };
}

function conversationPort(repository: ConversationRepository): ChatConversationPort {
  return {
    async read(conversationId) {
      const read = await repository.read(conversationId);
      if (read.kind === 'absent') {
        return { kind: 'absent' };
      }
      if (read.kind === 'unreadable') {
        return { kind: 'unreadable', reason: read.reason, detail: read.detail };
      }
      return {
        kind: 'present',
        conversation: toConversation(read.metadata),
        revision: read.revision,
      };
    },
    async apply(conversationId, change) {
      const applied = await repository.apply(conversationId, current => (
        toMetadata(change(toConversation(current)))
      ));
      return { conversation: toConversation(applied.metadata), revision: applied.revision };
    },
  };
}

async function createHarness(options: { readonly withRecovery?: boolean } = {}): Promise<Harness> {
  const storage = new TestDurableStorage();
  let clock = 1_000;
  const now = () => clock;
  let ordinal = 0;
  const repositories = new ExecutionControlRepositories(storage, now);
  const registry = new ExecutionLifecycleRegistry({
    repositories,
    controlTransactions: new ExecutionControlTransactionCoordinator(
      storage,
      repositories,
      { now },
    ),
    nextTransactionId: () => opaque('tx', ++ordinal),
    now,
    scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
  });
  const backend = new DeterministicFakeBackend({
    sessionInstanceIdFactory: () => INSTANCE_ID,
    now,
  });
  registry.registerBackend({
    backend,
    interactions: backend,
    // Left off by default so a recovery falls straight through to the terminal
    // the registry states itself, which is the case with no ingested envelope
    // behind it.
    ...(options.withRecovery ? { recovery: backend.nativeStatusRecovery } : {}),
  });
  await registry.start();

  const conversations = new ConversationRepository({ storage, now });
  await conversations.save({
    id: CONVERSATION_ID,
    providerId: 'claude',
    title: 'Tomatoes',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }, null);

  let sessionOrdinal = 0;
  let runOrdinal = 0;
  let leaseOrdinal = 0;
  const createCoordinator = () => new ChatExecutionCoordinator({
    lifecycle: registry,
    conversations: conversationPort(conversations),
    nextExecutionSessionId: () => executionSessionId(opaque('es', ++sessionOrdinal)),
    nextRunId: () => runId(opaque('run', ++runOrdinal)),
    nextLeaseId: () => lifecycleLeaseId(opaque('lease', ++leaseOrdinal)),
    assistantMessageIdForRun: forRunId => `assistant-${forRunId}`,
    now,
  });

  return {
    coordinator: createCoordinator(),
    registry,
    backend,
    storage,
    conversations,
    createCoordinator,
    advance(milliseconds) {
      clock += milliseconds;
    },
  };
}

/** Waits for something the kernel drives, which no ticket is waiting on. */
async function waitUntil(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function userMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, timestamp: 1 };
}

function turnCommand(overrides: Partial<SubmitChatTurnCommand> = {}): SubmitChatTurnCommand {
  return {
    commandId: 'cmd-1',
    conversationId: CONVERSATION_ID,
    backendId: FAKE_BACKEND_ID,
    requestRef: 'req-1',
    resultExpectation: 'optional',
    userMessage: userMessage('msg-user-1', 'Are tomatoes a fruit?'),
    ...overrides,
  };
}

async function storedMessages(harness: Harness): Promise<ChatMessage[]> {
  // Read through a store built over the same vault rather than the one that
  // wrote: what the file holds is the claim, and the writer's own cache cannot
  // be the witness for it.
  const reopened = new ConversationRepository({ storage: harness.storage });
  const read = await reopened.read(CONVERSATION_ID);
  return read.kind === 'present' ? read.metadata.messages ?? [] : [];
}

describe('chat execution coordinator', () => {
  it('is satisfied by the registry it was written against', () => {
    // The port is narrow on purpose, and narrow contracts drift: a method
    // renamed on the registry would leave this coordinator compiling against a
    // shape nothing implements, and nothing would say so until composition.
    const assignable: (registry: ExecutionLifecycleRegistry) => ChatExecutionLifecyclePort = (
      registry => registry
    );

    expect(typeof assignable).toBe('function');
  });

  it('runs a turn end to end and leaves the answer in the vault', async () => {
    const harness = await createHarness();
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;

    expect(ticket.admission).toBe('started');
    harness.backend.emit(started.runId, { kind: 'run-started' });
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanically, ',
    });
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'yes.',
    });
    harness.backend.emit(started.runId, {
      kind: 'result',
      result: { resultId: `result-${started.runId}`, storage: 'projection' },
    });
    harness.advance(500);
    harness.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    const completed = await ticket.completion;

    expect(completed.terminal.kind).toBe('succeeded');
    expect(completed.result?.finalAssistantText).toBe('Botanically, yes.');
    expect(completed.result?.resultRef.resultId).toBe(`result-${started.runId}`);

    const projection = harness.coordinator.getProjection(CONVERSATION_ID);
    expect(projection?.turns).toHaveLength(1);
    expect(projection?.turns[0]?.persistence).toBe('saved');
    expect(projection?.turns[0]?.run.state).toBe('succeeded');
    expect(projection?.activeRunId).toBeUndefined();
    expect(projection?.queuedCommandIds).toEqual([]);
    expect(projection?.messages.map(message => message.content)).toEqual([
      'Are tomatoes a fruit?',
      'Botanically, yes.',
    ]);

    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ id: 'msg-user-1', role: 'user' }),
      expect.objectContaining({
        id: `result-${started.runId}`,
        role: 'assistant',
        content: 'Botanically, yes.',
      }),
    ]);
  });

  it('shows the answer while the turn is still running', async () => {
    // What the projection is for. A surface that can only see the answer once
    // the turn is over has to be fed a second stream of chunks beside the
    // projection, and that is the consumption this step exists to replace.
    const harness = await createHarness();
    const seen: (string | undefined)[] = [];
    const detach = await harness.coordinator.attach(CONVERSATION_ID, projection => {
      seen.push(projection.turns[0] ? liveAssistantText(projection.turns[0]) : undefined);
    });
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanically, ',
    });
    await harness.registry.waitForIdle();

    expect(seen.at(-1)).toBe('Botanically, ');
    const running = harness.coordinator.getProjection(CONVERSATION_ID)?.turns[0];
    expect(running?.run.terminal).toBeUndefined();
    expect(running?.persistence).toBe('pending');
    // Nothing is in the conversation yet but the question: an answer still
    // arriving is not an answer, and the barrier is what makes it one.
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ role: 'user' }),
    ]);

    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'yes.',
    });
    harness.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await ticket.completion;
    detach();

    // The barrier persisted what the surface had been reading, because it read
    // the same place: there is one accumulator, not one per consumer.
    const settled = harness.coordinator.getProjection(CONVERSATION_ID)?.turns[0];
    expect(liveAssistantText(settled!)).toBe('Botanically, yes.');
    expect(settled?.assistantMessageId).toBeDefined();
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant', content: 'Botanically, yes.' }),
    ]);
  });

  it('queues the next turn and releases it once the first is durable', async () => {
    const harness = await createHarness();
    const first = await harness.coordinator.submitTurn(turnCommand());
    const firstStarted = await first.started;
    const second = await harness.coordinator.submitTurn(turnCommand({
      commandId: 'cmd-2',
      requestRef: 'req-2',
      userMessage: userMessage('msg-user-2', 'And a vegetable?'),
    }));

    expect(second.admission).toBe('queued');
    expect(harness.coordinator.getProjection(CONVERSATION_ID)?.queuedCommandIds).toEqual(['cmd-2']);
    // The release is the whole point: while the first turn is open the second
    // must not reach the provider, because a second run over one conversation
    // is two answers interleaved into one transcript.
    expect(harness.backend.dispatchedRequests.size).toBe(1);

    harness.backend.emit(firstStarted.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Yes.',
    });
    harness.backend.emit(firstStarted.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await first.completion;
    const secondStarted = await second.started;

    expect(secondStarted.runId).not.toBe(firstStarted.runId);
    expect(secondStarted.executionSessionId).toBe(firstStarted.executionSessionId);
    expect(harness.coordinator.getProjection(CONVERSATION_ID)?.queuedCommandIds).toEqual([]);
    expect(harness.backend.dispatchedRequests.size).toBe(2);
    // One session for the conversation, which is what lets the provider resume
    // its own thread instead of starting a new one per turn.
    expect(harness.backend.sessions.size).toBe(1);
  });

  it('keeps what arrived when a turn is cancelled', async () => {
    const harness = await createHarness();
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanically, ',
    });
    await harness.registry.waitForIdle();
    await harness.coordinator.cancelActive(CONVERSATION_ID);
    const completed = await ticket.completion;

    expect(completed.terminal.kind).toBe('cancelled');
    // Partial, not final: an interrupted turn presented as a finished answer is
    // a lie the surface cannot walk back.
    expect(completed.result).toBeUndefined();
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant', content: 'Botanically, ' }),
    ]);
  });

  it('marks a cancelled turn partial when the run committed a result', async () => {
    const harness = await createHarness();
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Half an ',
    });
    harness.backend.emit(started.runId, {
      kind: 'result',
      result: { resultId: `result-${started.runId}`, storage: 'projection' },
    });
    await harness.registry.waitForIdle();
    await harness.coordinator.cancelActive(CONVERSATION_ID);
    const completed = await ticket.completion;

    expect(completed.result?.partialAssistantText).toBe('Half an ');
    expect(completed.result?.finalAssistantText).toBeUndefined();
  });

  it('reaches the barrier on a terminal the registry stated itself', async () => {
    // The turn streamed first, so the run record's position has already moved.
    // A terminal the registry reaches on its own carries that same position,
    // and read as a replay it never arrives: the answer is never saved and the
    // input never unlocks. This is the composition that proves the run
    // projection's synthesized-envelope rule, from the outside.
    const harness = await createHarness();
    harness.backend.cancellationMode = 'silent';
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    harness.backend.emit(started.runId, { kind: 'run-started' });
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Botanically, ',
    });
    await harness.registry.waitForIdle();
    await harness.coordinator.cancelActive(CONVERSATION_ID);
    await harness.registry.recoverRun(started.runId);
    const completed = await ticket.completion;

    expect(completed.terminal).toEqual(expect.objectContaining({
      kind: 'indeterminate',
      reason: 'cancellation-unknown',
    }));
    await expect(storedMessages(harness)).resolves.toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant', content: 'Botanically, ' }),
    ]);
  });

  it('shows an interaction from the record the kernel committed', async () => {
    const harness = await createHarness();
    const ticket = await harness.coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    const openInteractionId = interactionId(`ix-${'a'.repeat(32)}`);
    harness.backend.emit(started.runId, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: openInteractionId,
        runId: started.runId,
        kind: 'approval',
        presentationRef: 'approval-write-file',
        responseIds: ['allow', 'deny'],
      },
    });
    await harness.registry.waitForIdle();

    const opened = harness.coordinator.getProjection(CONVERSATION_ID)?.interactions;
    expect(opened).toEqual([expect.objectContaining({
      interactionId: openInteractionId,
      status: 'open',
      presentationRef: 'approval-write-file',
      responseIds: ['allow', 'deny'],
    })]);
    expect(harness.coordinator.getProjection(CONVERSATION_ID)?.turns[0]?.run.state)
      .toBe('waiting-interaction');

    await harness.coordinator.resolveInteraction({
      interactionId: openInteractionId,
      responseId: 'allow',
      resolvedAt: 1_100,
    });

    expect(harness.backend.resolutions.map(resolution => resolution.responseId)).toEqual(['allow']);
    // The kernel publishes no envelope for a resolution, because the provider
    // reports its own. The person who clicked has already answered, so the
    // committed record is what the surface is shown.
    expect(harness.coordinator.getProjection(CONVERSATION_ID)?.interactions).toEqual([
      expect.objectContaining({ status: 'resolved', selectedResponseId: 'allow' }),
    ]);
  });

  it('holds the queue and the turn open when the conversation write fails', async () => {
    const harness = await createHarness();
    const failing = conversationPort(harness.conversations);
    let failNext = false;
    const coordinator = new ChatExecutionCoordinator({
      lifecycle: harness.registry,
      conversations: {
        read: conversationId => failing.read(conversationId),
        apply: async (conversationId, change) => {
          if (failNext) {
            failNext = false;
            throw new Error('Vault is read-only.');
          }
          return failing.apply(conversationId, change);
        },
      },
      nextExecutionSessionId: () => executionSessionId(opaque('es', 9)),
      nextRunId: () => runId(opaque('run', 9)),
      nextLeaseId: () => lifecycleLeaseId(opaque('lease', 9)),
      assistantMessageIdForRun: forRunId => `assistant-${forRunId}`,
    });
    const ticket = await coordinator.submitTurn(turnCommand());
    const started = await ticket.started;
    harness.backend.emit(started.runId, {
      kind: 'output-delta',
      channel: 'assistant',
      text: 'Yes.',
    });
    failNext = true;
    harness.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await harness.registry.waitForIdle();
    await Promise.resolve();

    const failed = coordinator.getProjection(CONVERSATION_ID);
    expect(failed?.turns[0]?.persistence).toBe('failed');
    expect(failed?.turns[0]?.persistenceErrorCode).toBe('conversation-persistence-failed');
    // Still active: releasing the queue here would let the next turn append its
    // own messages over an answer that never reached the vault.
    expect(failed?.activeRunId).toBe(started.runId);

    await coordinator.retryPersistence(CONVERSATION_ID);

    expect(coordinator.getProjection(CONVERSATION_ID)?.turns[0]?.persistence).toBe('saved');
    await expect(ticket.completion).resolves.toEqual(expect.objectContaining({
      runId: started.runId,
    }));
    coordinator.dispose();
  });

  it('refuses a conversation this build cannot read, by name', async () => {
    const harness = await createHarness();
    const coordinator = new ChatExecutionCoordinator({
      lifecycle: harness.registry,
      conversations: {
        read: async () => ({
          kind: 'unreadable',
          reason: 'future',
          detail: 'written by a newer release',
        }),
        apply: () => Promise.reject(new Error('unreachable')),
      },
      nextExecutionSessionId: () => executionSessionId(opaque('es', 8)),
      nextRunId: () => runId(opaque('run', 8)),
      nextLeaseId: () => lifecycleLeaseId(opaque('lease', 8)),
      assistantMessageIdForRun: forRunId => `assistant-${forRunId}`,
    });

    // D5's read-only state, said out loud. Reporting it as "no conversation" is
    // the legacy reader's recorded defect, and a turn dispatched over it would
    // write a fresh conversation on top of one this build simply cannot parse.
    await expect(coordinator.submitTurn(turnCommand())).rejects.toThrow(/cannot be read \(future\)/);
    coordinator.dispose();
  });

  it('keeps the envelopes a provider sends before dispatch returns', async () => {
    // A provider that answers inside its own dispatch — a warm CLI does, and
    // so does every in-process backend — publishes before this coordinator has
    // a run to attribute the envelopes to. The projection drops an envelope
    // for a turn it does not have, so the opening tokens of a fast turn were
    // silently gone. Driven through a stub because the timing is the subject:
    // the shape is the registry's, only the moment is chosen.
    const lifecycle = eagerLifecycle();
    const storage = new TestDurableStorage();
    const conversations = new ConversationRepository({ storage });
    await conversations.save({
      id: CONVERSATION_ID,
      providerId: 'claude',
      title: 'Tomatoes',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    }, null);
    const coordinator = new ChatExecutionCoordinator({
      lifecycle,
      conversations: conversationPort(conversations),
      nextExecutionSessionId: () => lifecycle.sessionId,
      nextRunId: () => lifecycle.runId,
      nextLeaseId: () => lifecycleLeaseId(opaque('lease', 1)),
      assistantMessageIdForRun: forRunId => `assistant-${forRunId}`,
      now: () => 5_000,
    });

    const ticket = await coordinator.submitTurn(turnCommand());
    const completed = await ticket.completion;

    expect(completed.result?.finalAssistantText).toBe('Instant.');
    const stored = new ConversationRepository({ storage });
    const read = await stored.read(CONVERSATION_ID);
    expect(read.kind === 'present' ? read.metadata.messages : []).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant', content: 'Instant.' }),
    ]);
    coordinator.dispose();
  });

  describe('adopting the work the kernel already owns', () => {
    it('takes over a run that outlived the surface watching it', async () => {
      // A run is durable and the surface watching it is not. Without adoption
      // the turn is orphaned: nothing renders it, nothing runs its persistence
      // barrier, and the answer it is still producing is written nowhere.
      const harness = await createHarness();
      const abandoned = await harness.coordinator.submitTurn(turnCommand());
      const started = await abandoned.started;
      harness.backend.emit(started.runId, { kind: 'run-started' });
      harness.backend.emit(started.runId, {
        kind: 'output-delta',
        channel: 'assistant',
        text: 'Botan',
      });
      await harness.registry.waitForIdle();

      harness.coordinator.dispose();
      await expect(abandoned.completion).rejects.toThrow(/detached/);

      const reopened = harness.createCoordinator();
      const adopted = await reopened.loadConversation(CONVERSATION_ID);

      expect(adopted.turns).toHaveLength(1);
      expect(adopted.turns[0]?.runId).toBe(started.runId);
      expect(adopted.activeRunId).toBe(started.runId);
      expect(adopted.turns[0]?.run.state).toBe('running');
      // What was said before the reload went with the process that heard it:
      // the control store keeps facts, not a transcript, and D2 is why.
      expect(liveAssistantText(adopted.turns[0])).toBeUndefined();

      harness.backend.emit(started.runId, {
        kind: 'output-delta',
        channel: 'assistant',
        text: 'ically, yes.',
      });
      harness.backend.emit(started.runId, {
        kind: 'terminal',
        terminal: 'succeeded',
        reason: 'completed',
      });
      await waitUntil(
        () => reopened.getProjection(CONVERSATION_ID)?.turns[0]?.persistence === 'saved',
        'the adopted turn to reach the persistence barrier',
      );

      await expect(storedMessages(harness)).resolves.toEqual([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant', content: 'ically, yes.' }),
      ]);
      reopened.dispose();
    });

    it('queues a new turn behind the one it adopted', async () => {
      const harness = await createHarness();
      const abandoned = await harness.coordinator.submitTurn(turnCommand());
      const started = await abandoned.started;
      await harness.registry.waitForIdle();
      harness.coordinator.dispose();
      await expect(abandoned.completion).rejects.toThrow(/detached/);

      const reopened = harness.createCoordinator();
      const queued = await reopened.submitTurn(turnCommand({
        commandId: 'cmd-2',
        requestRef: 'req-2',
        userMessage: userMessage('msg-user-2', 'And a vegetable?'),
      }));

      // Two runs over one conversation is two answers interleaved into one
      // transcript, and a reload must not be the way to get there.
      expect(queued.admission).toBe('queued');
      expect(harness.backend.dispatchedRequests.size).toBe(1);

      harness.backend.emit(started.runId, {
        kind: 'terminal',
        terminal: 'succeeded',
        reason: 'completed',
      });
      const secondStarted = await queued.started;

      expect(secondStarted.runId).not.toBe(started.runId);
      expect(secondStarted.executionSessionId).toBe(started.executionSessionId);
      expect(harness.backend.sessions.size).toBe(1);
      reopened.dispose();
    });

    it('adopts only the conversation it was asked about', async () => {
      // The filter is the whole of this: a query that answered for every owner
      // would read exactly the same from inside one conversation's test, and
      // put another chat's running turn into this one.
      const harness = await createHarness();
      await harness.conversations.save({
        id: 'conv-2',
        providerId: 'claude',
        title: 'Cucumbers',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      }, null);
      const mine = await harness.coordinator.submitTurn(turnCommand());
      const mineStarted = await mine.started;
      const theirs = await harness.coordinator.submitTurn(turnCommand({
        commandId: 'cmd-2',
        conversationId: 'conv-2',
        requestRef: 'req-2',
        userMessage: userMessage('msg-user-2', 'And cucumbers?'),
      }));
      const theirsStarted = await theirs.started;
      harness.coordinator.dispose();
      await expect(mine.completion).rejects.toThrow(/detached/);
      await expect(theirs.completion).rejects.toThrow(/detached/);

      const reopened = harness.createCoordinator();
      const adopted = await reopened.loadConversation(CONVERSATION_ID);

      expect(adopted.turns.map(turn => turn.runId)).toEqual([mineStarted.runId]);
      expect(theirsStarted.runId).not.toBe(mineStarted.runId);
      expect(theirsStarted.executionSessionId).not.toBe(mineStarted.executionSessionId);
      reopened.dispose();
    });

    it('leaves a finished run to the transcript that already holds it', async () => {
      const harness = await createHarness();
      const ticket = await harness.coordinator.submitTurn(turnCommand());
      const started = await ticket.started;
      harness.backend.emit(started.runId, {
        kind: 'output-delta',
        channel: 'assistant',
        text: 'Yes.',
      });
      harness.backend.emit(started.runId, {
        kind: 'terminal',
        terminal: 'succeeded',
        reason: 'completed',
      });
      await ticket.completion;
      harness.coordinator.dispose();

      const reopened = harness.createCoordinator();
      const adopted = await reopened.loadConversation(CONVERSATION_ID);

      // Adopting it would add a turn whose answer this coordinator can never
      // supply, beside the message that already holds it.
      expect(adopted.turns).toEqual([]);
      expect(adopted.activeRunId).toBeUndefined();
      expect(adopted.messages.map(message => message.content)).toEqual([
        'Are tomatoes a fruit?',
        'Yes.',
      ]);
      reopened.dispose();
    });
  });

  it('detaches from a durable turn on dispose and refuses what never started', async () => {
    const harness = await createHarness();
    const running = await harness.coordinator.submitTurn(turnCommand());
    await running.started;
    const queued = await harness.coordinator.submitTurn(turnCommand({
      commandId: 'cmd-2',
      requestRef: 'req-2',
      userMessage: userMessage('msg-user-2', 'And a vegetable?'),
    }));

    harness.coordinator.dispose();

    // Two different answers, because a caller deciding whether to re-send needs
    // to know which happened: the first turn is still running inside the kernel
    // and the second never reached it.
    await expect(running.completion).rejects.toThrow(/detached while the durable turn continues/);
    await expect(queued.started).rejects.toThrow(/disposed before turn admission/);
    await expect(harness.coordinator.submitTurn(turnCommand({ commandId: 'cmd-3' })))
      .rejects.toThrow(/is disposed/);
  });

  it('refuses a turn whose input is not a user message', async () => {
    const harness = await createHarness();

    await expect(harness.coordinator.submitTurn(turnCommand({
      userMessage: { id: 'msg-1', role: 'assistant', content: 'Hello', timestamp: 1 },
    }))).rejects.toThrow(/must contain a user message/);
    await expect(harness.coordinator.submitTurn(turnCommand({ commandId: 'not a command id' })))
      .rejects.toThrow(/constrained identifier/);
    harness.coordinator.dispose();
  });
});

/**
 * A kernel that answers inside `startRun`, which is the moment under test.
 *
 * Everything it does, the real registry does: it publishes run-scoped envelopes
 * to the session's observers, and it publishes them once the run exists. The
 * only thing chosen here is when.
 */
function eagerLifecycle(): ChatExecutionLifecyclePort & {
  readonly sessionId: ExecutionSessionId;
  readonly runId: RunId;
} {
  const sessionId = executionSessionId(opaque('es', 1));
  const eagerRunId = runId(opaque('run', 1));
  const observers = new Set<(envelope: ExecutionEventEnvelope) => void>();
  let sequence = 0;
  const publish = (envelope: Omit<ExecutionEventEnvelope, 'schemaVersion' | 'backendId'
  | 'backendGeneration' | 'executionSessionId' | 'sessionInstanceId' | 'sequence' | 'occurredAt'
  | 'scope'>) => {
    for (const observer of observers) {
      observer({
        schemaVersion: 1,
        backendId: FAKE_BACKEND_ID,
        backendGeneration: 1,
        executionSessionId: sessionId,
        sessionInstanceId: INSTANCE_ID,
        sequence: ++sequence,
        occurredAt: sequence,
        scope: { kind: 'run', runId: eagerRunId },
        ...envelope,
      });
    }
  };
  return {
    sessionId,
    runId: eagerRunId,
    createSession: async () => sessionId,
    startRun: async () => {
      publish({
        eventId: 'eager-delta',
        event: { kind: 'output-delta', channel: 'assistant', text: 'Instant.' },
      });
      publish({
        eventId: 'eager-result',
        event: { kind: 'result', result: { resultId: 'result-eager', storage: 'projection' } },
      });
      publish({
        eventId: 'eager-terminal',
        event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      });
      return eagerRunId;
    },
    cancelRun: async () => undefined,
    resolveInteraction: async () => undefined,
    observe: (_executionSessionId, observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    getRun: () => null,
    getSession: () => null,
    getSessionsForOwner: () => [],
    getRunsForOwner: () => [],
    getInteraction: () => null,
    acquireLease: (leaseId: LifecycleLeaseId) => ({
      leaseId,
      executionSessionId: sessionId,
      purpose: 'persistence' as const,
      release: () => undefined,
    }),
  };
}
